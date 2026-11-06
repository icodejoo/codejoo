import type { AsyncStorage, BaseStorageOptions, MemoCache, StorageEntity, StorageOptions, SyncStore } from "./interface";
import { all, attempt, chain, isPromise, type Maybe } from "./maybe";
import { keyspace } from "./keyspace";
import { isExpired, mkEntity, parseEntity, renewOf, typeMismatch } from "./entity";
import { report, type StorageOperation } from "./errors";
import { memoHub } from "./hub";
export { isPromise } from "./maybe";
/** 内部提交订阅键；不从公共入口导出。 */
export const COMMIT = Symbol("storage.commit");
/** 内部后端身份；不从公共入口导出。 */
export const STORE = Symbol("storage.store");
/** 内部回放入口；不产生提交事件。 */
export const APPLY = Symbol("storage.apply");
/** 内部只读快照，供 debug 固定操作开始时的键空间。 */
export const SNAPSHOT = Symbol("storage.snapshot");
/** 落盘完成后的内部事件；renewal 表示滑动续期来源。 */
export interface CommitEvent {
  /** 提交操作。 */
  op: "set" | "remove" | "clear";
  /** 操作开始时的命名空间。 */
  namespace: string;
  /** 逻辑键；clear 为空串。 */
  key: string;
  /** 最终落盘串；删除为 null。 */
  payload: string | null;
  /** 绝对过期时间。 */
  expireAt?: number;
  /** 是否来自滑动续期。 */
  renewal: boolean;
}
/** 后端为异步存储时，get/set 等返回 Promise，否则返回同步值 */
export type Result<S, T> = S extends AsyncStorage ? Promise<T> : T;
/** 批量 get 的逐位返回类型：第 i 位取默认值元组同位的类型，缺省位为 unknown（含 null） */
export type MGet<K extends readonly string[], V extends readonly unknown[]> = {
  [I in keyof K]: I extends keyof V ? undefined extends V[I] ? V[I] | null : V[I] : unknown;
};
/** proxy 返回的处理器形态（同步/异步由 S 决定），供 fast 等复用签名 */
export interface Handlers<S extends SyncStore | AsyncStorage> {
  /** 当前处理器的底层后端。 */
  readonly [STORE]: S;
  /** 回放逻辑键的落盘串；null 删除，过期消息忽略，不触发 COMMIT。 */
  [APPLY](key: string, payload: string | null, expireAt?: number): Result<S, void>;
  /** 内部落盘事件订阅，返回注销函数。 */
  [COMMIT](listener: (event: CommitEvent) => void): () => void;
  /** 捕获枚举与读取使用的键空间。 */
  [SNAPSHOT](): { namespace: string; keys(): Result<S, string[]>; get(key: string): Result<S, unknown> };
  get<T>(key: string): Result<S, T | null>;
  get(key: string, defaultValue: number): Result<S, number>;
  get(key: string, defaultValue: string): Result<S, string>;
  get(key: string, defaultValue: boolean): Result<S, boolean>;
  get(key: string, defaultValue: bigint): Result<S, bigint>;
  get<T>(key: string, defaultValue: T): Result<S, undefined extends T ? T | null : T>;
  /**
   * 批量读取：传键数组（元组），返回与 keys 等长的元组，逐位联动类型。
   *  - 有默认值：逐位取默认值类型，缺位（含整体缺省）为 unknown：
   *    `get(["a","b"], [1, false])` → `[number, boolean]`；`get(["a","b"], [1])` → `[number, unknown]`；
   *    `get(["a","b"])` → `[unknown, unknown]`（`as const` 保留字面量）
   *  - 显式泛型断言（无默认值）：键可能不存在，故每位为 `X | null`：
   *    `get<[number, boolean]>(["a","b"])` → `[number | null, boolean | null]`
   */
  get<K extends readonly string[], V extends readonly unknown[]>(keys: readonly [...K], defaults: readonly [...V]): Result<S, MGet<K, V>>;
  // 无默认值：显式泛型 V 逐位断言类型（每位 X|null）。键的形状由 V 反推
  // （TS 无法在显式给定 V 时再独立推断键长度，故让 keys 随 V 定形；不给泛型时 V 从 keys 反推为等长 unknown 元组）。
  get<const V extends readonly unknown[] = []>(keys: { readonly [I in keyof V]: string }): Result<S, { -readonly [I in keyof V]: V[I] | null }>;
  set<T>(key: string, value: T, ttl?: number): Result<S, void>;
  set<T>(key: string, value: T, options?: StorageOptions): Result<S, void>;
  /** 批量写入：values 与 keys 逐位对应；第三参（ttl 毫秒数 / options）对全部键生效 */
  set(keys: readonly string[], values: readonly unknown[], options?: number | StorageOptions): Result<S, void>;
  remove(key: string | readonly string[]): Result<S, void>;
  clear(): Result<S, void>;
  /**
   * 第 index 个逻辑键（已解密、去命名空间前缀）。
   * @deprecated 请使用 keys()。
   */
  key(index: number): Result<S, string | null>;
  /** 本实例管辖范围内的全部逻辑键（已解密、去命名空间前缀） */
  keys(): Result<S, string[]>;
  /** 主动清理已过期条目（仅本实例管辖、本库写入的数据；raw 模式无 entity 信封，不处理）。平时为惰性过期，长期不被读取的过期数据靠它回收配额 */
  purge(): Result<S, void>;
  /** 命名空间前缀（形如 "ns:"，无则为空串） */
  readonly namespace: string;
  /** 切换命名空间（如按 username 隔离账号）：清空 memo 读缓存并原地改前缀，已持有的引用自动生效 */
  setNamespace(namespace?: string): void;
  readonly length: Result<S, number>;
  /**
   * 释放资源：清空 memo 读缓存，并断开可关闭的后端（如 Idb 的 IndexedDB 连接），
   * 便于 GC 回收。**不删除已落盘数据**（localStorage/IndexedDB 内容保留）。
   * 异步后端返回 Promise，可 await 以确保连接已断开。
   */
  destroy(): Result<S, void>;
}
/** 单一编排：同步后端保留同步返回，异步后端统一返回 Promise。 */
export function proxy<S extends SyncStore | AsyncStorage>(storage: S, memo: MemoCache, opts: BaseStorageOptions = {}): Handlers<S> {
  const st = storage as SyncStore & AsyncStorage, async = typeof st.length === "function";
  const { raw = false, sliding = false, memoized = false, readonly = false, cloned = false, force = true, onError } = opts;
  const codec = opts.codeable ? opts.codec : undefined, area = st.area ?? st;
  let space = keyspace(opts.namespace, opts.enckey ? opts.codec : undefined), epoch = 0, scans = 0;
  const versions = new Map<string, { _refs: number; _writes: number; _stale?: boolean }>(), queues = new Map<string, Promise<void>>(), strings = new WeakMap<StorageEntity, string>();
  const listeners = new Set<(event: CommitEvent) => void>(), pending = new Set<Promise<unknown>>();
  /** 清除期间的读写与枚举等待扫描完成，屏障不传播清除异常。 */
  let clearing: Promise<void> | undefined;
  /** 外部写入使在途读和 memo 一并失效。 */
  const evict = (key: string | null) => { if (key === null) { epoch++; memo.clear(); } else { const token = versions.get(key); if (token?._writes) token._stale = true; else versions.delete(key); memo.remove(key); } };
  const hub = memoHub(area, evict, async && opts.broadcast ? (st as unknown as { name?: string }).name ?? "default" : undefined);
  if ((opts.enckey || opts.codeable) && !opts.codec) console.warn("[storage] codec required; encoding disabled");
  /** 成功落盘后通知其他实例和内部订阅者。 */
  const committed = (ks: typeof space, key: string | null, payload: string | null, renewal = false, expireAt?: number) => {
    if (key !== null) hub.publish(key);
    listeners.forEach(fn => fn({ op: key === null ? "clear" : payload === null ? "remove" : "set", namespace: ks.prefix, key: key === null ? "" : ks.logical(key), payload, renewal, expireAt }));
  };
  /** 追踪在途任务，完成或失败后立即释放引用。 */
  const track = <T>(task: Promise<T>): Promise<T> => { pending.add(task); void task.then(() => pending.delete(task), () => pending.delete(task)); return task; };
  /** 归一同步和异步返回并保留异常身份。 */
  const run = <T>(fn: () => Maybe<T>): Result<S, T> => {
    try { const value = fn(), result = async ? Promise.resolve(value) : value;
      if (isPromise(result)) void track(result);
      return result as Result<S, T>; }
    catch (error) { if (async) return Promise.reject(error) as Result<S, T>; throw error; }
  };
  /** 追踪每键操作；令牌仅在最后一个引用完成后回收。 */
  const operation = <T>(key: string, write: boolean, fn: (valid: () => boolean, writable: () => boolean) => Maybe<T>, mutation = write): Maybe<T> => {
    const generation = epoch;
    const token: { _refs: number; _writes: number; _stale?: boolean } = (!write && versions.get(key)) || { _refs: 0, _writes: 0 }; versions.set(key, token); token._refs++;
    const cacheable = mutation || token._writes === 0; if (mutation) { token._writes++; }
    const writable = () => versions.get(key) === token;
    const valid = () => cacheable && !token._stale && epoch === generation && writable();
    const done = () => { if (mutation) token._writes--; if (--token._refs === 0 && !scans && versions.get(key) === token) versions.delete(key); };
    let result: Maybe<T>;
    try { result = fn(valid, writable); } catch (error) { done(); throw error; }
    if (isPromise(result)) return track(result.finally(done));
    done(); return result;
  };
  /** 把后端异常转成结果，避免捕获用户错误处理器异常。 */
  const io = <T>(fn: () => Maybe<T>) => attempt< { value?: T; error?: unknown; _failed: boolean }>(() => chain(fn(), value => ({ value, _failed: false })), error => ({ error, _failed: true }));
  /** 上报后端写入异常，保留 AbortError 分类。 */
  const failure = (error: unknown, op: StorageOperation, key: string) => report(onError, { kind: (error as Error)?.name === "AbortError" ? "abort" : "write", op, key, error });
  /** 编解码与形状校验共用入口。 */
  const load = (text: string) => parseEntity(codec ? codec.decode(text) : text, opts.deserialize);
  /** 序列化失败有回调则上报，否则保留同步抛错/异步 reject。 */
  const dump = (entity: StorageEntity, key: string): string | undefined => attempt(() => {
    const text = (opts.serialize ?? JSON.stringify)(entity); return codec ? codec.encode(text) : text;
  }, error => { if (!onError) throw error; report(onError, { kind: "serialize", op: "set", key, error }); return undefined; }) as string | undefined;
  /** 获取键空间快照内的所有物理键。 */
  const ownKeys = (ks: typeof space): Maybe<string[]> => {
    if (st.keys) return chain(st.keys(), keys => keys.filter(ks.owns));
    // 交叉类型优先采用同步重载；异步分支按后端实际模式恢复 Promise 数组类型。
    const collect = (length: number): Maybe<string[]> => { const keys = Array.from({ length }, (_, i) => st.key(i)); return chain(async ? Promise.all(keys as unknown as Promise<string | null>[]) : keys as (string | null)[], values => values.filter((key): key is string => key !== null && ks.owns(key))); };
    return chain(async ? st.length() : st.length as unknown as number, collect);
  };
  /** 在固定键空间内枚举，供公开键查询和快照复用。 */
  const scan = <T>(ks: typeof space, fn: (keys: string[]) => T): Maybe<T> => chain(clearing, () => chain(ownKeys(ks), fn));
  /** 条件写：事务型后端检查落盘串；其他后端依赖每键版本。 */
  const change = (ks: typeof space, key: string, expected: string | null | undefined, next: string | null, valid: () => boolean, renewal = false, expireAt?: number, op: StorageOperation = "set", quiet = false, retryable = false): Maybe<boolean> => {
    if (!valid()) return false;
    let applied = false;
    const write = () => !valid() ? false : st.update && expected !== undefined ? chain(st.update(key, current => {
      if (!valid() || current !== expected) return undefined; applied = true; return next;
    }), () => applied) : chain(next === null ? st.remove(key) : st.set(key, next), () => true);
    return chain(io(write), first => chain(first._failed && force && !async && retryable ? chain(io(() => purge(ks, true)), cleaned => cleaned._failed ? cleaned : io(write)) : first, result => {
      if (result._failed) { if (quiet) throw result.error; failure(result.error, op, ks.logical(key)); return false; }
      if (result.value) { if (op !== "clear") committed(ks, key, next, renewal, expireAt); }
      else if (expected !== undefined && valid()) evict(key);
      return result.value!;
    }));
  };
  /** purge 固定命名空间；每次读后删除都校验版本和落盘串。 */
  const purge = (ks: typeof space, quiet = false): Maybe<void> => raw ? undefined : chain(ownKeys(ks), keys => {
    const tasks = keys.map(key => operation(key, false, valid => chain(st.get(key), text => {
      if (text === null) return;
      let entity: StorageEntity; try { entity = load(text); } catch { return; }
      if (isExpired(entity, Date.now())) return chain(change(ks, key, text, null, valid, false, undefined, "purge", quiet), ok => { if (ok && valid()) memo.remove(key); });
    }), quiet));
    return async ? all(tasks) : undefined;
  });
  /** 读取内部存在性，不通过公开 get，null 仍视为存在。 */
  const exists = (text: string | null): boolean => {
    if (text === null) return false; if (raw) return true;
    try { return !isExpired(load(text), Date.now()); } catch { return false; }
  };
  /** 单键读取：损坏先上报再条件删除，类型不匹配保留落盘数据。 */
  const read = (ks: typeof space, key: string, fallback: unknown, generation = epoch, sk = ks.full(key)): Maybe<unknown> => operation(sk, false, current => {
    const valid = () => current() && generation === epoch;
    const cached = memo.get(sk);
    const hydrate = (text: string | null, entity?: StorageEntity): Maybe<unknown> => {
      if (text === null && entity === undefined) return fallback;
      if (raw) { if (memoized && valid()) memo.set(sk, text); return text; }
      if (!entity) {
        try { entity = load(text!); strings.set(entity, text!); } catch (error) {
          report(onError, { kind: "corrupt", op: "get", key, error });
        }
      }
      if (!entity || isExpired(entity, Date.now())) return chain(change(ks, sk, text, null, valid, false, undefined, "get"), ok => { if (ok && valid()) memo.remove(sk); return fallback; });
      const e = entity;
      const value = e.value === null && fallback != null && typeof fallback !== "object" && typeof fallback !== "function" ? fallback : e.value;
      if (typeMismatch(value, fallback)) { report(onError, { kind: "type", op: "get", key, error: new TypeError("Stored value differs from default type") }); return fallback; }
      const renew = sliding ? renewOf(e, Date.now()) : undefined;
      const finish = (cachedEntity = e) => { if (valid() && (memoized || cached != null)) { memo.set(sk, cachedEntity); } return cloned && e.value !== null && typeof e.value === "object" ? structuredClone(e.value) : value; };
      if (renew) { const next = dump(renew, key); if (next !== undefined) return chain(change(ks, sk, text, next, valid, true, renew.expireAt, "get"), ok => { if (ok) strings.set(renew, next); return finish(ok ? renew : e); }); }
      return finish();
    };
    return cached != null ? hydrate(raw ? cached : strings.get(cached) ?? null, raw ? undefined : cached) : chain(st.get(sk), text => hydrate(text));
  });
  /** 捕获键空间并在入口同步建立版本。 */
  const get = (key: string | readonly string[], fallback?: unknown): unknown => {
    const ks = space; if (memoized) hub.connect();
    if (typeof key !== "string") { const values = key.map((k, i) => get(k, (fallback as unknown[])?.[i])); return async ? Promise.all(values) : values; }
    return run(() => chain(clearing, () => read(ks, key, fallback ?? null)));
  };
  /** 单键写入，readonly 对异步同键操作串联且事务内确认不存在。 */
  const set = (key: string | readonly string[], value: unknown, arg?: number | StorageOptions): unknown => {
    if (typeof key !== "string") { const values = (value ?? []) as unknown[]; if (values.length < key.length) console.warn("[storage] batch set: missing values skipped"); const tasks = key.slice(0, values.length).map((k, i) => set(k, values[i], arg)); return async ? all(tasks as Promise<void>[]) : undefined; }
    if (memoized) hub.connect();
    const ks = space, options = typeof arg === "number" ? { ttl: arg } : { ...arg };
    return run(() => { const sk = ks.full(key); if (async) memo.remove(sk); return operation(sk, !(readonly && queues.has(sk)), (valid, writable) => {
      const write = (): Maybe<void> => {
        if (!writable()) return;
        if (raw && typeof value !== "string") { console.warn("[storage] raw mode requires a string value"); return; }
        const entity = raw ? value as string : mkEntity(value, options.ttl, options.expireAt, sliding, key);
        if (entity === null) return;
        const text = raw ? entity as string : dump(entity as StorageEntity, key); if (text === undefined) return;
        const save = (expected?: string | null): Maybe<void> => chain(change(ks, sk, expected, text, writable, false, raw ? undefined : (entity as StorageEntity).expireAt, "set", false, true), ok => {
          if (ok) remember();
        });
        const remember = () => { if (!valid()) return; if ((options.memoized ?? memoized) && (raw || (entity as StorageEntity).value !== undefined)) { hub.connect(); memo.set(sk, entity); if (!raw) strings.set(entity as StorageEntity, text); } else memo.remove(sk); };
        if (!readonly) return save();
        return chain(st.get(sk), current => exists(current) ? undefined : save(current));
      };
      if (!async) return write();
      const previous = readonly ? queues.get(sk) : undefined;
      const gate = clearing && previous ? clearing.then(() => previous) : clearing ?? previous;
      const task = gate ? gate.then(write) : Promise.resolve(write());
      if (!readonly) return task;
      const tail = task.then(() => undefined, () => undefined); queues.set(sk, tail);
      void tail.then(() => { if (queues.get(sk) === tail) queues.delete(sk); }); return task;
    }, true); });
  };
  return {
    [STORE]: storage,
    [APPLY]: (key, payload, expireAt) => run(() => {
      if (expireAt !== undefined && expireAt <= Date.now()) return;
      const sk = space.full(key); evict(sk);
      return chain(payload === null ? st.remove(sk) : st.set(sk, payload), () => {
        evict(sk); hub.publish(sk);
      });
    }),
    [SNAPSHOT]: () => { const ks = space, generation = epoch; return { namespace: ks.prefix, keys: () => run(() => scan(ks, keys => keys.map(ks.logical))), get: key => run(() => chain(clearing, () => read(ks, key, null, generation))) }; },
    [COMMIT]: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get: get as Handlers<S>["get"], set: set as Handlers<S>["set"],
    get namespace() { return space.prefix; },
    setNamespace: namespace => { evict(null); space = keyspace(namespace, opts.enckey ? opts.codec : undefined); },
    keys: () => { const ks = space; return run(() => scan(ks, keys => keys.map(ks.logical))); },
    key: index => { const ks = space; return run(() => chain(clearing, () => ks.plain ? st.key(Math.trunc(index) || 0) : scan(ks, keys => { const i = Math.trunc(index) || 0; return keys[i] === undefined ? null : ks.logical(keys[i]); }))); },
    get length() { const ks = space; return run(() => chain(clearing, () => ks.plain ? async ? st.length() : st.length as unknown as number : scan(ks, keys => keys.length))); },
    purge: () => { const ks = space; return run(() => chain(clearing, () => purge(ks))); },
    remove: key => { const ks = space; const tasks = (typeof key === "string" ? [key] : key).map(k => { const sk = ks.full(k); memo.remove(sk); return operation(sk, true, (_valid, writable) => run(() => chain(change(ks, sk, undefined, null, writable, false, undefined, "remove"), () => undefined))); }); return (async ? all(tasks) : undefined) as Result<S, void>; },
    clear: () => {
      const ks = space; evict(null); versions.clear(); scans++;
      const finish = () => { hub.publish(null); if (--scans === 0) versions.forEach((token, key) => { if (!token._refs) versions.delete(key); }); };
      return run(() => {
        let result: Maybe<void>;
        try {
          result = ks.plain ? chain(io(() => st.clear()), outcome => {
            if (outcome._failed) failure(outcome.error, "clear", ""); else committed(ks, null, null);
          }) : chain(ownKeys(ks), keys => {
            let complete = true;
            const tasks = keys.map(key => operation(key, false, (_valid, writable) => chain(change(ks, key, undefined, null, writable, false, undefined, "clear"), ok => { if (!ok) complete = false; }), false));
            return chain(async ? all(tasks) : undefined, () => { if (complete) committed(ks, null, null); });
          });
        } catch (error) { finish(); throw error; }
        if (isPromise(result)) {
          const task = result.finally(() => { finish(); if (clearing === barrier) clearing = undefined; });
          const barrier = task.then(() => undefined, () => undefined);
          clearing = barrier; return task;
        }
        finish(); return result;
      });
    },
    destroy: () => { evict(null); hub.destroy(); const close = (st as { destroy?: () => Maybe<void> }).destroy; return run(() => async ? Promise.allSettled(pending).then(() => { hub.destroy(); return close?.call(st); }) : close?.call(st)); },
  };
}
