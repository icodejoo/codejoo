import type {
  AsyncStorage,
  BaseStorageOptions,
  MemoCache,
  StorageEntity,
  StorageOptions,
  SyncStore,
} from "./interface";

/** 把 expireAt（时间戳 | 日期字符串 | Date）归一化为毫秒时间戳，非法时返回 NaN */
const ts = (v: number | string | Date): number =>
  typeof v === "number" ? v : v instanceof Date ? v.getTime() : new Date(v).getTime();

// —— 可同步可异步的组合子：后端同步则全程同步，异步则自动串成 Promise —— //
type Maybe<T> = T | Promise<T>;
const isPromise = (v: unknown): v is Promise<unknown> =>
  typeof (v as { then?: unknown } | null)?.then === "function";
function chain<A, B>(v: Maybe<A>, fn: (a: A) => Maybe<B>): Maybe<B> {
  return isPromise(v) ? v.then(fn) : fn(v as A);
}
function attempt<T>(run: () => Maybe<T>, onErr: (e: unknown) => Maybe<T>): Maybe<T> {
  try {
    const v = run();
    return isPromise(v) ? v.catch(onErr) : v;
  } catch (e) {
    return onErr(e);
  }
}

/** 后端为异步存储时，get/set 等返回 Promise，否则返回同步值 */
export type Result<S, T> = S extends AsyncStorage ? Promise<T> : T;

/** proxy 返回的处理器形态（同步/异步由 S 决定），供 fast 等复用签名 */
export interface Handlers<S extends SyncStore | AsyncStorage> {
  get<T>(key: string): Result<S, T | null>;
  get(key: string, defaultValue: number): Result<S, number>;
  get(key: string, defaultValue: string): Result<S, string>;
  get(key: string, defaultValue: boolean): Result<S, boolean>;
  get(key: string, defaultValue: bigint): Result<S, bigint>;
  get<T>(key: string, defaultValue: T): Result<S, T>;
  set<T>(key: string, value: T, ttl?: number): Result<S, void>;
  set<T>(key: string, value: T, memoized?: boolean): Result<S, void>;
  set<T>(key: string, value: T, options?: StorageOptions): Result<S, void>;
  remove(key: string): Result<S, void>;
  clear(): Result<S, void>;
  /** 第 index 个逻辑键（已解密、去命名空间前缀） */
  key(index: number): Result<S, string | null>;
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

/** 把后端（SyncStore / AsyncStorage）统一成「可同步可异步」的内部视图 */
interface AnyStore {
  get(k: string): Maybe<string | null>;
  set(k: string, v: string): Maybe<void>;
  remove(k: string): Maybe<void>;
  clear(): Maybe<void>;
  key(i: number): Maybe<string | null>;
  length: number | (() => Promise<number>);
}

/** 与后端无关的实例级配置 */
function settings(opts?: BaseStorageOptions) {
  let ns = opts?.namespace ? opts.namespace + ":" : "";
  const serialize = opts?.serialize ?? JSON.stringify;
  const deserialize = opts?.deserialize ?? JSON.parse;
  const codeable = opts?.codeable ?? false;
  const dump = (e: StorageEntity): string => {
    const s = serialize(e);
    return codeable && opts?.codec ? opts.codec.encode(s) : s;
  };
  const load = (s: string): StorageEntity | null => {
    try {
      const text = codeable && opts?.codec ? opts.codec.decode(s) : s;
      return text == null ? null : deserialize(text);
    } catch {
      return null;
    }
  };
  // enckey：用同一 codec 对「ns+key」做确定性加密作为真实存储键（codec.encode 确定性，同键稳定）
  const enckey = (opts?.enckey ?? false) && opts?.codec != null;
  const fullKey = (k: string): string => {
    const nk = ns + k;
    return enckey ? opts!.codec!.encode(nk) : nk;
  };
  /** 把存储键还原为「ns+key」（供 debug 用）；解不开则原样返回 */
  const decKey = (sk: string): string => {
    if (!enckey) return sk;
    return opts!.codec!.decode(sk) ?? sk;
  };
  return {
    get ns() {
      return ns;
    },
    /** 原地切换命名空间前缀（空值回到无前缀）；fullKey 闭包读取此 ns，故已有引用自动生效 */
    setNamespace(n?: string) {
      ns = n ? n + ":" : "";
    },
    isRaw: opts?.raw ?? false,
    sliding: opts?.sliding ?? false,
    force: opts?.force ?? true,
    cache: opts?.memoized ?? false, // 实例级：是否启用 memo 读缓存
    readOnly: opts?.readonly ?? false, // 只写一次：非空则丢弃
    dump,
    load,
    fullKey,
    decKey,
  };
}

/** 解析 set 的 per-call 第三参（ttl / memoized / options），合并实例级默认 */
function writeArgs(opts: BaseStorageOptions | undefined, arg?: number | boolean | StorageOptions) {
  let ttl: number | undefined;
  let memoized = opts?.memoized;
  let expireAt: number | string | Date | undefined;
  if (typeof arg === "number") ttl = arg;
  else if (typeof arg === "boolean") memoized = arg;
  else if (arg) {
    if (arg.ttl != null) ttl = arg.ttl;
    if (arg.memoized != null) memoized = arg.memoized;
    if (arg.expireAt != null) expireAt = arg.expireAt;
  }
  return { ttl, memoized: memoized ?? false, expireAt };
}

/** 由 value + 写入选项构造 entity；返回 null 表示校验未过（已 warn），应放弃写入 */
function buildEntity(
  value: unknown,
  ttl: number | undefined,
  expireAt: number | string | Date | undefined,
  sliding: boolean,
  key: string,
): StorageEntity | null {
  const now = Date.now();
  const entity: StorageEntity = { value, createdAt: now };
  if (ttl != null) {
    entity.ttl = ttl;
    entity.expireAt = now + ttl;
  }
  if (expireAt != null) {
    const abs = ts(expireAt);
    if (Number.isNaN(abs)) {
      console.warn(`[storage] expireAt 无法解析，已放弃写入 "${key}"`);
      return null;
    }
    if (abs <= now && !sliding) {
      console.warn(`[storage] expireAt 早于当前时间，已放弃写入 "${key}"`);
      return null;
    }
    entity.expireAt = abs <= now && sliding && ttl != null ? now + ttl : abs;
  }
  return entity;
}

/**
 * 统一 proxy：同步后端（localStorage/sessionStorage/MemoryStorage）与异步后端（IndexedDB）共用一套逻辑。
 * 返回类型由泛型 S 决定：异步后端的 get/set 等返回 Promise，同步后端返回同步值。
 * memo 是按 memoized 开关的读缓存（非全量镜像）：开启时写入双写、读取缓存优先、删除双删。
 */
export function proxy<S extends SyncStore | AsyncStorage>(
  storage: S,
  memo: MemoCache,
  opts?: BaseStorageOptions,
): Handlers<S> {
  const cfg = settings(opts);
  const { isRaw, sliding, force, cache, readOnly, dump, load, fullKey, decKey } = cfg;
  const st = storage as unknown as AnyStore;
  const isAsync = typeof st.length === "function";

  /** 归一返回：异步后端把同步结果也包成 Promise，使类型与 await 行为一致 */
  const out = <T>(v: Maybe<T>): Maybe<T> => (isAsync && !isPromise(v) ? Promise.resolve(v) : v);

  /** 双删：memo + 持久层 */
  const del = (k: string): Maybe<void> => {
    memo.remove(k);
    return st.remove(k);
  };

  /** 清理已过期的持久层数据（仅同步后端；异步后端容量大，暂不清理） */
  function purgeExpired(): void {
    const now = Date.now();
    const len = st.length as number;
    const expired: string[] = [];
    for (let i = 0; i < len; i++) {
      const k = st.key(i) as string | null;
      if (k == null) continue;
      const s = st.get(k) as string | null;
      if (s == null) continue;
      const e = load(s);
      if (e?.expireAt != null && now >= e.expireAt) expired.push(k);
    }
    for (const k of expired) del(k);
  }

  /** 写入持久层，处理容量不足。同步 force 时清过期重试；异步暂只记日志后放弃 */
  function persist(k: string, str: string): Maybe<boolean> {
    return attempt(
      () => chain(st.set(k, str), () => true),
      (err) => {
        if (!force) throw err;
        if (isAsync) {
          console.error(`[storage] 写入失败 "${k}"`, err);
          return false;
        }
        purgeExpired();
        return attempt(
          () => chain(st.set(k, str), () => true),
          (e2) => {
            console.error(`[storage] 容量不足，清理后仍无法写入 "${k}"，已放弃`, e2);
            return false;
          },
        );
      },
    );
  }

  /** entity 命中后的过期/续期处理，返回最终值 */
  function resolve(entity: StorageEntity, k: string, fromMemo: boolean, fallback: unknown): Maybe<unknown> {
    const now = Date.now();
    if (entity.expireAt != null && now >= entity.expireAt) {
      return chain(del(k), () => fallback); // 懒过期：双删
    }
    if (sliding && entity.ttl != null) {
      entity.expireAt = now + entity.ttl; // 滑动续期，回写持久层 + 缓存
      return chain(persist(k, dump(entity)), () => {
        if (cache) memo.set(k, entity);
        return entity.value;
      });
    }
    if (!fromMemo && cache) memo.set(k, entity); // 读穿回填（仅开启缓存时）
    return entity.value;
  }

  function get<T>(key: string): Result<S, T | null>;
  function get(key: string, defaultValue: number): Result<S, number>;
  function get(key: string, defaultValue: string): Result<S, string>;
  function get(key: string, defaultValue: boolean): Result<S, boolean>;
  function get(key: string, defaultValue: bigint): Result<S, bigint>;
  function get<T>(key: string, defaultValue: T): Result<S, T>;
  function get(key: string, defaultValue?: unknown): Maybe<unknown> {
    const k = fullKey(key);
    const fallback = defaultValue ?? null;

    if (isRaw) {
      const m = memo.get(k);
      if (m != null) return out(m);
      return out(
        chain(st.get(k), (s) => {
          if (s == null) return fallback;
          if (cache) memo.set(k, s);
          return s;
        }),
      );
    }

    // 缓存优先
    const cached = memo.get(k) as StorageEntity | null;
    if (cached) return out(resolve(cached, k, true, fallback));

    return out(
      chain(st.get(k), (s) => {
        if (s == null) return fallback;
        const entity = load(s);
        if (entity == null) return chain(del(k), () => fallback); // 解不开 → 清除，回退
        return resolve(entity, k, false, fallback);
      }),
    );
  }

  function set<T>(key: string, value: T, ttl?: number): Result<S, void>;
  function set<T>(key: string, value: T, memoized?: boolean): Result<S, void>;
  function set<T>(key: string, value: T, options?: StorageOptions): Result<S, void>;
  function set(key: string, value: unknown, arg?: number | boolean | StorageOptions): Maybe<void> {
    const { ttl, memoized, expireAt } = writeArgs(opts, arg);
    const k = fullKey(key);

    const write = (): Maybe<void> => {
      if (isRaw) {
        return chain(persist(k, value as string), (ok) => {
          if (ok && memoized) memo.set(k, value);
        });
      }
      const entity = buildEntity(value, ttl, expireAt, sliding, key);
      if (entity == null) return undefined;
      return chain(persist(k, dump(entity)), (ok) => {
        if (ok && memoized) memo.set(k, entity);
      });
    };

    // readonly：仅当键为空（不存在/已过期）才写入，否则丢弃
    if (readOnly) return out(chain(get(key), (existing) => (existing == null ? write() : undefined)));
    return out(write());
  }

  return {
    get,
    set,
    get namespace() {
      return cfg.ns;
    },
    /** 切换命名空间（如按 username 隔离账号）：先清 memo 读缓存再改前缀，已持有的引用自动生效 */
    setNamespace: (namespace?: string): void => {
      memo.clear();
      cfg.setNamespace(namespace);
    },
    /** 第 index 个逻辑键（已解密、去命名空间前缀）；供调试/枚举 */
    key: (index: number): Result<S, string | null> =>
      out(
        chain(st.key(index), (sk) => {
          if (sk == null) return null;
          const fk = decKey(sk);
          return cfg.ns && fk.startsWith(cfg.ns) ? fk.slice(cfg.ns.length) : fk;
        }),
      ) as Result<S, string | null>,
    remove: (key: string): Result<S, void> => out(del(fullKey(key))) as Result<S, void>,
    clear: (): Result<S, void> => {
      memo.clear();
      return out(st.clear()) as Result<S, void>;
    },
    /** 释放资源：清空 memo 读缓存，并断开可关闭的后端（Idb）。不删除已落盘数据 */
    destroy: (): Result<S, void> => {
      memo.clear();
      const close = (st as { destroy?: () => Maybe<void> }).destroy;
      return out(close ? close.call(st) : undefined) as Result<S, void>;
    },
    get length(): Result<S, number> {
      // 注意：必须 st.length() 直接调用以保留 this；先取出再调用会丢失绑定（Idb 内部用到 this）
      return (
        isAsync ? (st as { length(): Promise<number> }).length() : (st.length as number)
      ) as Result<S, number>;
    },
  };
}
