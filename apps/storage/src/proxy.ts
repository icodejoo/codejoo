import type { AsyncStorage, BaseStorageOptions, MemoCache, StorageEntity, StorageOptions, SyncStore } from "./interface";

// —— 可同步可异步的组合子：后端同步则全程同步，异步则自动串成 Promise —— //
type Maybe<T> = T | Promise<T>;
export const isPromise = (v: unknown): v is Promise<unknown> => typeof (v as { then?: unknown } | null)?.then === "function";
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

/** 批量 get 的逐位返回类型：第 i 位取默认值元组同位的类型，缺省位为 unknown（含 null） */
export type MGet<K extends readonly string[], V extends readonly unknown[]> = {
  [I in keyof K]: I extends keyof V ? V[I] : unknown;
};

/** proxy 返回的处理器形态（同步/异步由 S 决定），供 fast 等复用签名 */
export interface Handlers<S extends SyncStore | AsyncStorage> {
  get<T>(key: string): Result<S, T | null>;
  get(key: string, defaultValue: number): Result<S, number>;
  get(key: string, defaultValue: string): Result<S, string>;
  get(key: string, defaultValue: boolean): Result<S, boolean>;
  get(key: string, defaultValue: bigint): Result<S, bigint>;
  get<T>(key: string, defaultValue: T): Result<S, T>;
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
  /** 第 index 个逻辑键（已解密、去命名空间前缀） */
  key(index: number): Result<S, string | null>;
  /** 本实例管辖范围内的全部逻辑键（已解密、去命名空间前缀） */
  keys(): Result<S, string[]>;
  /** 主动清理已过期条目（仅本实例管辖、本库写入的数据）。平时为惰性过期，长期不被读取的过期数据靠它回收配额 */
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

/** 把后端（SyncStore / AsyncStorage）统一成「可同步可异步」的内部视图 */
interface AnyStore {
  get(k: string): Maybe<string | null>;
  set(k: string, v: string): Maybe<void>;
  remove(k: string): Maybe<void>;
  clear(): Maybe<void>;
  key(i: number): Maybe<string | null>;
  keys?(): Maybe<string[]>;
  length: number | (() => Promise<number>);
}

/**
 * 统一 proxy：同步后端（localStorage/sessionStorage/MemoryStorage）与异步后端（IndexedDB）共用一套逻辑。
 * 返回类型由泛型 S 决定：异步后端的 get/set 等返回 Promise，同步后端返回同步值。
 * memo 是按 memoized 开关的读缓存（非全量镜像）：开启时写入双写、读取缓存优先、删除双删。
 */
export function proxy<S extends SyncStore | AsyncStorage>(storage: S, memo: MemoCache, opts?: BaseStorageOptions): Handlers<S> {
  const st = storage as unknown as AnyStore;
  const isAsync = typeof st.length === "function";
  const { sliding = false, raw: isRaw = false, force = true, memoized: cache = false, readonly: readOnly = false, cloned = false } = opts ?? {};
  const serialize = opts?.serialize ?? JSON.stringify;
  const deserialize = opts?.deserialize ?? JSON.parse;
  const cdc = opts?.codec;
  const codeable = (opts?.codeable ?? false) && cdc != null; // 值编解码开关
  const enckey = (opts?.enckey ?? false) && cdc != null; // 键加密开关（不要求 codeable）
  const onError = opts?.onError;
  // 开关需 codec 支撑，缺失则静默失效——显式告警避免误以为已加密/已编码
  if (opts?.enckey && cdc == null) console.warn("[storage] `enckey` requires a `codec`; none provided — keys remain in plaintext.");
  if (opts?.codeable && cdc == null) console.warn("[storage] `codeable` requires a `codec`; none provided — values are not encoded.");
  let ns = opts?.namespace ? opts.namespace + ":" : "";

  // 注：曾尝试 IndexedDB 非加密时 entity 对象直存（跳过 JSON、走结构化克隆），实测反而慢 10%+
  // ——结构化克隆序列化器遍历对象图比 JSON.stringify 慢，单条字符串存取近似 memcpy。故保持 JSON 路径。
  const dump = (e: StorageEntity): string => (codeable ? cdc!.encode(serialize(e)) : serialize(e));
  const load = (s: string): StorageEntity | null => {
    try {
      const text = codeable ? cdc!.decode(s) : s;
      return text == null ? null : deserialize(text);
    } catch {
      return null;
    }
  };
  // enckey：用 codec 对「ns+key」做确定性加密作为真实存储键（同键稳定）。
  // 结果按「ns+key」缓存——热路径同一逻辑键反复读写免重复编码（缓存键含 ns，切换命名空间无需失效）
  const ekCache = enckey ? new Map<string, string>() : undefined;
  const fullKey = (k: string): string => {
    const nk = ns + k;
    if (!ekCache) return nk;
    let v = ekCache.get(nk);
    if (v == null) {
      if (ekCache.size >= 1024) ekCache.clear(); // 防动态键名场景无限增长；偶发重建成本可忽略
      ekCache.set(nk, (v = cdc!.encode(nk)));
    }
    return v;
  };
  const decKey = (sk: string): string => (enckey ? (cdc!.decode(sk) ?? sk) : sk);
  /** 该存储键是否归本实例管辖（命名空间匹配；enckey 时须能解开）。clear/purge 仅作用于管辖范围 */
  const owns = (sk: string): boolean => (enckey ? (cdc!.decode(sk)?.startsWith(ns) ?? false) : sk.startsWith(ns));
  /** 存储键 → 逻辑键（解密、去命名空间前缀） */
  const logical = (sk: string): string => {
    const fk = decKey(sk);
    return ns && fk.startsWith(ns) ? fk.slice(ns.length) : fk;
  };

  /** 归一返回：异步后端把同步结果也包成 Promise，使类型与 await 行为一致；R 同时收口为对外的 Result 类型 */
  const out = <T>(v: Maybe<T>): Maybe<T> => (isAsync && !isPromise(v) ? Promise.resolve(v) : v);
  const R = <T>(v: Maybe<T>): Result<S, T> => out(v) as Result<S, T>;

  /** cloned：返回与 memo 共享的对象时给出深拷贝，隔离调用方修改对缓存的污染（原始值天然不可变，跳过） */
  const dup = (v: unknown): unknown => (cloned && typeof v === "object" && v != null ? structuredClone(v) : v);

  /** 双删：memo + 持久层 */
  const del = (k: string): Maybe<void> => {
    memo.remove(k);
    return st.remove(k);
  };

  /** 收集本实例管辖的全部存储键。后端提供 keys() 时走快路径（如 Idb 单次 getAllKeys，免逐下标 O(n²)） */
  function ownKeys(): Maybe<string[]> {
    if (typeof st.keys === "function") return chain(st.keys(), (ks) => ks.filter(owns));
    if (!isAsync) {
      const res: string[] = [];
      for (let i = 0, len = st.length as number; i < len; i++) {
        const k = st.key(i) as string | null;
        if (k != null && owns(k)) res.push(k);
      }
      return res;
    }
    return (async () => {
      const res: string[] = [];
      for (let i = 0, len = await (st as { length(): Promise<number> }).length(); i < len; i++) {
        const k = await st.key(i);
        if (k != null && owns(k)) res.push(k);
      }
      return res;
    })();
  }

  /**
   * 清理已过期数据：仅本实例管辖、且 entity 带 createdAt（本库写入标志）的条目，
   * 避免误删外部恰好形如 {expireAt} 的数据。容量不足重试与公开的 purge() 共用此入口。
   */
  /** 是否已过期：须同时带 createdAt（本库写入标志），避免外部恰好形如 {expireAt} 的数据被误判 */
  const isExpired = (e: StorageEntity | null, now: number): boolean => e?.expireAt != null && e.createdAt != null && now >= e.expireAt;

  function purgeExpired(): Maybe<void> {
    const now = Date.now();
    const dead = (s: string | null): boolean => isExpired(load(s ?? ""), now);
    return chain(ownKeys(), (ks): Maybe<void> => {
      if (!isAsync) {
        for (const k of ks) if (dead(st.get(k) as string | null)) void del(k);
        return;
      }
      // 逐键复用单键 del（含 memo 双删）：异步后端逐键一事务
      return Promise.all(ks.map((k) => chain(st.get(k), (s) => (dead(s) ? del(k) : undefined)))).then(() => undefined);
    });
  }

  /** 写入持久层；失败且 force 时清理过期数据重试一次（仅同步后端），仍失败回调 onError / 记日志放弃 */
  function persist(k: string, str: string): Maybe<boolean> {
    const fail = (err: unknown): boolean => {
      if (onError) onError({ op: "set", key: k, error: err });
      else console.error(`[storage] write failed for "${k}", giving up`, err);
      return false;
    };
    return attempt(
      () => chain(st.set(k, str), () => true),
      (err) => {
        if (!force) throw err;
        if (isAsync) return fail(err);
        void purgeExpired(); // 同步后端此调用同步完成
        return attempt(() => chain(st.set(k, str), () => true), fail);
      },
    );
  }

  /** entity 命中后的过期/续期处理，返回最终值 */
  function resolve(entity: StorageEntity, k: string, fromMemo: boolean, fallback: unknown): Maybe<unknown> {
    const now = Date.now();
    if (isExpired(entity, now)) return chain(del(k), () => fallback); // 懒过期：双删
    const shared = fromMemo || cache; // 值对象与 memo 共享引用（cloned 开启时对这类返回做深拷贝）
    if (sliding && entity.ttl != null && entity.expireAt != null && entity.expireAt - now <= entity.ttl * 0.9) {
      entity.expireAt = now + entity.ttl; // 滑动续期回写；剩余寿命 >90% 时跳过（消除高频读写放大，最多提前 ttl 的 10% 过期）
      return chain(persist(k, dump(entity)), (ok) => {
        if (ok && cache) memo.set(k, entity); // 与 write() 一致：仅落盘成功才写 memo，避免 memo 显示已续期而后端仍是旧值
        return shared ? dup(entity.value) : entity.value;
      });
    }
    if (!fromMemo && cache) memo.set(k, entity); // 读穿回填（仅开启缓存时）
    return shared ? dup(entity.value) : entity.value;
  }

  /** 后端取回的原始串 → 最终值（raw 直返并按需回填缓存；entity 解码 + 过期/续期处理） */
  const hydrate = (s: string | null, k: string, fallback: unknown): Maybe<unknown> => {
    if (s == null) return fallback;
    if (isRaw) {
      if (cache) memo.set(k, s);
      return s;
    }
    const entity = load(s);
    if (entity == null) return chain(del(k), () => fallback); // 解不开 → 清除，回退
    return resolve(entity, k, false, fallback);
  };

  /** memo 命中检查：raw 接受任意非空值；entity 仅接受对象（raw 实例可能向共享 memo 写入字符串，误读会得 undefined） */
  const fromMemo = (k: string, fallback: unknown): { hit: boolean; value?: Maybe<unknown> } => {
    const m = memo.get(k);
    if (isRaw) return m != null ? { hit: true, value: dup(m) } : { hit: false };
    if (m != null && typeof m === "object") return { hit: true, value: resolve(m as StorageEntity, k, true, fallback) };
    return { hit: false };
  };

  // 对外签名（含默认值拓宽/批量元组的重载）统一由 Handlers 接口声明，返回时一次断言，避免重复维护两份重载
  function get(key: string | readonly string[], defaultValue?: unknown): Maybe<unknown> {
    if (typeof key !== "string") {
      const ds = defaultValue as readonly unknown[] | undefined;
      // 批量：逐键复用单键逻辑（memo 命中/读穿/过期/续期全部沿用单键路径）。
      // 注意不可写成 key.map(get)——会把数组下标泄漏成默认值
      const rs = key.map((k, i) => get(k, ds?.[i]));
      return out(isAsync ? Promise.all(rs) : rs);
    }
    const k = fullKey(key);
    const fallback = defaultValue ?? null;
    const m = fromMemo(k, fallback);
    if (m.hit) return out(m.value);
    return out(chain(st.get(k), (s) => hydrate(s, k, fallback)));
  }

  /** set 第三参解析：数字=ttl（毫秒）/ 对象=选项，未指定的并入实例级默认 */
  const parseArg = (arg?: number | StorageOptions) => {
    const o = typeof arg === "object" && arg ? arg : undefined;
    return {
      ttl: typeof arg === "number" ? arg : o?.ttl,
      memoized: o?.memoized ?? cache,
      expireAt: o?.expireAt,
    };
  };

  /** 由 value + 写入选项构造 entity；null 表示校验未过（已 warn），放弃写入 */
  const mkEntity = (value: unknown, ttl: number | undefined, expireAt: StorageOptions["expireAt"], key: string): StorageEntity | null => {
    const now = Date.now();
    // ttl 须为正有限毫秒数：0/负数会令写入即过期（首读即被删）、NaN/Infinity 序列化后丢失变永不过期——一律告警并忽略，行为可预期
    if (ttl != null && (!Number.isFinite(ttl) || ttl <= 0)) {
      console.warn(`[storage] ttl must be a positive finite number of ms, got ${ttl}; ignoring ttl for "${key}"`);
      ttl = undefined;
    }
    const entity: StorageEntity = { value, createdAt: now };
    if (ttl != null) entity.expireAt = now + (entity.ttl = ttl);
    if (expireAt != null) {
      const abs = new Date(expireAt).getTime(); // Date 构造原生接受时间戳/日期串/Date，非法为 NaN
      // 无法解析，或已过期且无法按 sliding+ttl 从现在续期 → 放弃写入
      if (Number.isNaN(abs) || (abs <= now && !(sliding && ttl != null))) {
        console.warn(`[storage] expireAt is invalid or in the past; skipped writing "${key}"`);
        return null;
      }
      entity.expireAt = abs <= now ? now + ttl! : abs;
    }
    return entity;
  };

  function set(key: string | readonly string[], value: unknown, arg?: number | StorageOptions): Maybe<void> {
    if (typeof key !== "string") {
      // 批量：values 逐位对应；第三参对全部键生效。values 短于 keys 时缺位键跳过（告警），不写入 undefined。
      // 逐键复用单键 set（readonly/raw/codec/过期校验/失败回调全部沿用单键路径）
      const vs = (value ?? []) as readonly unknown[];
      if (vs.length < key.length) console.warn(`[storage] batch set: values(${vs.length}) shorter than keys(${key.length}); missing entries skipped`);
      const n = Math.min(key.length, vs.length);
      const rs: Maybe<void>[] = [];
      for (let i = 0; i < n; i++) rs.push(set(key[i], vs[i], arg));
      return out(isAsync ? Promise.all(rs).then(() => undefined) : undefined);
    }
    const { ttl, memoized, expireAt } = parseArg(arg);
    const k = fullKey(key);

    const write = (): Maybe<void> => {
      if (isRaw) {
        return chain(persist(k, value as string), (ok) => {
          if (ok && memoized) memo.set(k, value);
        });
      }
      const entity = mkEntity(value, ttl, expireAt, key);
      if (!entity) return;
      return chain(persist(k, dump(entity)), (ok) => {
        if (ok && memoized) memo.set(k, entity);
      });
    };

    // readonly：仅当键为空（不存在/已过期）才写入，否则丢弃
    if (readOnly) return out(chain(get(key), (existing) => (existing == null ? write() : undefined)));
    return out(write());
  }

  return {
    get: get as Handlers<S>["get"],
    set: set as Handlers<S>["set"],
    get namespace() {
      return ns;
    },
    /** 切换命名空间：先清 memo 读缓存再原地改前缀（fullKey 等闭包读 ns，已持有引用自动生效） */
    setNamespace(n?: string) {
      memo.clear();
      ns = n ? n + ":" : "";
    },
    /** 第 index 个逻辑键（已解密、去命名空间前缀）；供调试/枚举。有命名空间或 enckey 时按管辖范围取下标，与 keys()/length 口径一致 */
    key: (index: number) =>
      ns || enckey
        ? R(chain(ownKeys(), (ks) => (index < 0 || index >= ks.length ? null : logical(ks[index]))))
        : R(chain(st.key(index), (sk) => (sk == null ? null : logical(sk)))),
    keys: () => R(chain(ownKeys(), (ks) => ks.map(logical))),
    purge: () => R(purgeExpired()),
    remove: (key: string | readonly string[]) => {
      if (typeof key === "string") return R(del(fullKey(key)));
      // 批量：逐键复用单键 del（含 memo 双删）
      const fks = key.map((k) => fullKey(k));
      if (isAsync) return R(Promise.all(fks.map((k) => del(k))).then(() => undefined));
      for (const k of fks) void del(k);
      return R(undefined);
    },
    /** 清空：有命名空间或 enckey 时仅清本实例管辖的键（不波及同源其他应用/命名空间），否则整库清空 */
    clear: () => {
      memo.clear();
      if (!ns && !enckey) return R(st.clear());
      return R(
        chain(ownKeys(), (ks): Maybe<void> => {
          if (isAsync) return Promise.all(ks.map((k) => st.remove(k))).then(() => undefined);
          for (const k of ks) void st.remove(k); // 同步分支：st.remove 实际返回 void
        }),
      );
    },
    /** 释放资源：清空 memo 读缓存，并断开可关闭的后端（Idb）。不删除已落盘数据 */
    destroy: () => {
      memo.clear();
      const close = (st as { destroy?: () => Maybe<void> }).destroy;
      return R(close ? close.call(st) : undefined);
    },
    get length(): Result<S, number> {
      // 有命名空间或 enckey 时只数本实例管辖的键（与 keys()/clear() 作用域一致，避免 length 全局而 clear 局部的反直觉）
      if (ns || enckey) return R(chain(ownKeys(), (ks) => ks.length));
      // 注意：必须 st.length() 直接调用以保留 this；先取出再调用会丢失绑定（Idb 内部用到 this）
      return (isAsync ? (st as { length(): Promise<number> }).length() : (st.length as number)) as Result<S, number>;
    },
  };
}
