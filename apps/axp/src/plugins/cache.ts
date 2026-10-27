import type { Plugin } from "../types";
import { cloneAxiosHeaders, pluginLog, wrapAdapter } from "../helper";
import AxpResponse from "../objects/Response";
import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";

const name = "axp:cache";

/** 默认 TTL（毫秒） / default TTL (ms) */
const DEFAULT_EXPIRES = 60_000;
/** 默认最大缓存条数 / default max entry count */
const DEFAULT_MAX = 500;

/** 每个 axios 实例的缓存仓（按实例隔离） / per-axios-instance cache store (isolated per instance) */
const stores = new WeakMap<AxiosInstance, ICacheStore>();

/**
 * 响应缓存插件：TTL 内对相同 key 的请求直接返回缓存响应，跳过 HTTP。
 *   - **基于 adapter 包装**：命中直接 `Promise.resolve(cachedResponse)`；未命中走原
 *     adapter 并把响应写入缓存
 *   - **缓存维度**：默认 `config.key`；可用请求级 `config.cache.key` 或插件级 `defaults.key` 自定义
 *   - **TTL**：请求级 `expires` > 插件级 `defaults.expires`，默认 60s
 *   - **存储**：进程内 Map（不持久化）；要 sessionStorage/localStorage 请在外面包一层
 *   - **失效操作**：导出 `removeCache(ax, key)` / `clearCache(ax)`（`clearCache` 之前发出的在途请求落定后不会回写，切换账号时调用安全）
 *   - **容量**：`max`（默认 500）条，LRU 淘汰；每次写入顺带清理过期项
 *   - **写入条件**：`shouldCache(response)`；默认不缓存业务失败信封（与 normalize 的成功判定一致）
 *   - **快照**：缓存 adapter 返回的原始响应，每次命中返回独立外壳，交给 axios 正常转换一次
 *   - **并发写入**：按请求发起顺序，较晚完成的旧请求不会覆盖较新的结果
 *
 * Response-caching plugin: within the TTL, same-key requests return the cached
 * response directly, skipping HTTP.
 *   - **Adapter-based**: a hit resolves immediately from cache; a miss falls
 *     through to the original adapter and caches the result
 *   - **Cache key**: defaults to `config.key`; customizable per-request via
 *     `config.cache.key` or plugin-wide via `defaults.key`
 *   - **TTL**: per-request `expires` > plugin-wide `defaults.expires`, default 60s
 *   - **Storage**: an in-process `Map` (not persisted); wrap externally for
 *     sessionStorage/localStorage
 *   - **Invalidation**: exports `removeCache(ax, key)` / `clearCache(ax)`
 *
 * @example
 *   useAxiosPlugin(ax)
 *     .use(cache({ expires: 30_000 }))
 *     .use(key({ ... }));   // 注意：cache 之前装，key 之后装
 *
 *   ax.get('/api/list', { cache: true });
 *   ax.get('/api/user', { cache: { expires: 5_000 } });
 *   ax.get('/api/big',  { cache: { key: 'big-list' } });
 * @param options 插件配置：enable/expires/key/clone/max/shouldCache / plugin config: enable/expires/key/clone/max/shouldCache
 * @returns Plugin：install 时包装 adapter 实现缓存读写，卸载还原 adapter 并清空本实例缓存 / a Plugin that wraps the adapter to cache on install, and restores the adapter + clears this instance's cache on teardown
 */
export default function axpCache({
  enable = true,
  expires = DEFAULT_EXPIRES,
  key,
  clone,
  max = DEFAULT_MAX,
  shouldCache,
}: ICacheOptions = {}): Plugin {
  const defaults: ICacheOptions = { expires, key, clone, max, shouldCache };
  const capacity = max >= 1 ? max : DEFAULT_MAX;
  return {
    name,
    install(axios) {
      pluginLog(
        axios.defaults,
        `[${name}] enabled:${enable} expires:${expires}ms`,
      );
      if (!enable) return;
      const store: ICacheStore = { map: new Map(), seq: 0, epoch: 0, written: new Map(), inflight: new Map() };
      stores.set(axios, store);

      // 作为独立一层叠在 adapter 链上，可按任意顺序卸载
      const off = wrapAdapter(axios, (prev) => (config) => {
        const opt = $resolveCache(config, defaults);
        delete config.cache;
        if (!opt) return prev(config);

        const k = $resolveKey(config, opt, defaults);
        if (!k) return prev(config);

        // 解析拷贝策略（一次）：缺省/`true` → null(共享引用)；'deep' 环境缺 structuredClone 会在此早抛
        const cloneFn = $resolveCloneFn(opt.clone);

        // 命中：返回拷贝（按策略）；store 里始终是未被外部碰过的原件，杜绝调用方就地改污染缓存
        const hit = store.map.get(k);
        if (hit && hit.expiresAt > Date.now()) {
          pluginLog(config, `[${name}] hit: ${k}`);
          // LRU：命中后移到最新位置
          store.map.delete(k);
          store.map.set(k, hit);
          // 每次命中都是独立外壳：headers 单独拷贝，config 换成本次请求的（否则下游如 cancel 按旧 config 释放资源会漏）；
          // data 仍是 adapter 的原始值，交给 axios 的 transformResponse 正常转换一次
          const shell = $shell(hit.response);
          return Promise.resolve({ ...$applyClone(shell, cloneFn), config });
        }
        if (hit) store.map.delete(k); // 过期，清掉

        // 未命中：走原 adapter；按发起顺序/代次决定能否写入，对外发出「拷贝」
        const seq = ++store.seq;
        const epoch = store.epoch;
        store.inflight.set(k, (store.inflight.get(k) ?? 0) + 1);
        return prev(config).then((response) => {
          const accept = opt.shouldCache ?? defaults.shouldCache ?? $defaultShouldCache;
          // 已被 clearCache 清过 / 有更晚发起的请求已写入过（即使条目已被淘汰）/ 业务判定不缓存 → 不写
          if (epoch === store.epoch && seq > (store.written.get(k) ?? 0) && accept(response)) {
            store.written.set(k, seq);
            const ttl = opt.expires ?? defaults.expires ?? DEFAULT_EXPIRES;
            // 快照 adapter 的原始响应：axios 之后会就地改写 response.data，快照不受影响
            const snapshot = $shell(response);
            $write(store, k, { response: snapshot, expiresAt: Date.now() + ttl }, capacity);
            pluginLog(config, `[${name}] set: ${k} ttl=${ttl}ms`);
          }
          return $applyClone(response, cloneFn);
        }).finally(() => $settle(store, k));
      });

      return () => {
        off();
        stores.delete(axios);
        store.epoch++;
        store.map.clear();
        store.written.clear();
      };
    },
  };
}

/**
 * 把 clone 策略解析成一个「拷贝 data」的函数；`null` 表示共享引用（不拷贝）。
 *   - 缺省/`cache: true` → null（共享引用）
 *   - `'shallow'` → 浅拷贝（仅顶层；嵌套仍共享，适合 immutable-update 风格）
 *   - `'deep'` → `structuredClone`（环境不支持则**直接抛错**，绝不静默退化为浅拷贝）
 *   - `function` → 自定义深拷贝（data 含 Date/Map/类实例/函数等不可结构化克隆时使用）
 *
 * Resolves a clone strategy into a "clone the data" function; `null` means a
 * shared reference (no cloning). `'deep'` **throws directly** if `structuredClone`
 * is unavailable — it never silently degrades to a shallow clone.
 *
 * @internal exported for unit tests
 * @param clone 拷贝策略 / clone strategy: `undefined`/`'shallow'`/`'deep'`/custom fn
 * @returns 拷贝函数，或 null 表示不拷贝 / a clone function, or null meaning no cloning
 */
export function $resolveCloneFn(
  clone: TCloneStrategy | undefined,
): ((data: any) => any) | null {
  if (!clone) return null;
  if (clone === "shallow") return $shallowClone;
  if (clone === "deep") {
    if (typeof structuredClone !== "function") {
      throw new Error(
        `[${name}] clone:"deep" 需要 structuredClone（当前环境不可用）；请改用 clone: (data) => ... 自定义深拷贝`,
      );
    }
    return (data) => structuredClone(data);
  }
  if (typeof clone === "function") return clone;
  return null;
}

/** 浅拷贝：数组/对象复制顶层，原始值原样返回 / shallow clone: copies the top level, primitives pass through @internal */
export function $shallowClone(d: any): any {
  if (Array.isArray(d)) return [...d];
  if (d && typeof d === "object") return { ...d };
  return d;
}

/** 按拷贝函数发出响应：null → 原样共享；否则壳拷贝 + 拷贝后的 data / emits per the clone fn: null shares as-is, otherwise a shallow-cloned shell + cloned data @internal */
export function $applyClone(
  resp: AxiosResponse,
  cloneFn: ((data: any) => any) | null,
): AxiosResponse {
  if (!cloneFn) return resp;
  return { ...resp, data: cloneFn(resp.data) };
}

/**
 * 解析请求级 cache 配置；null 表示本请求不缓存。
 *   - `false`/未指定 → null（不缓存）
 *   - `true` → 启用 + **共享引用**（不携带 clone，拷贝语义只在对象形式里指定）
 *   - 对象 → 启用；`clone` 请求级优先、回退插件级 `defaults.clone`
 *
 * Resolves the per-request `cache` config; `null` means not cached. `true` means
 * enabled + **shared reference** (clone is only specified via the object form).
 *
 * @internal
 * @param config 请求配置 / the request config
 * @param defaults 插件级默认配置 / plugin-wide defaults
 * @returns 解析后的缓存配置，或 null / the resolved config, or null if not cached
 */
export function $resolveCache(
  config: AxiosRequestConfig,
  defaults: ICacheOptions,
): IResolvedCache | null {
  const v = config.cache;
  if (v === false || v == null) return null;
  if (v === true) return { expires: defaults.expires };
  if (typeof v === "object")
    return {
      expires: v.expires ?? defaults.expires,
      key: v.key,
      clone: v.clone ?? defaults.clone,
      shouldCache: v.shouldCache,
    };
  return null;
}

/** 解析缓存 key：请求级 > 插件级 > config.key（key 插件兜底） / resolves the cache key: per-request > plugin-wide > config.key (set by the key plugin) @internal */
export function $resolveKey(
  config: AxiosRequestConfig,
  resolved: IResolvedCache,
  defaults: ICacheOptions,
): string | undefined {
  const reqKey = resolved.key;
  if (typeof reqKey === "string" && reqKey) return reqKey;
  if (typeof reqKey === "function") return reqKey(config) || undefined;
  if (typeof defaults.key === "function")
    return defaults.key(config) || undefined;
  return (config as any).key;
}

/**
 * 清除指定 axios 实例的某条缓存 / removes a single cache entry for the given axios instance.
 * @param ax 目标 axios 实例 / the target axios instance
 * @param key 要清除的缓存 key / the cache key to remove
 * @returns 是否真的删了 / whether an entry was actually deleted
 */
export function removeCache(ax: AxiosInstance, key: string): boolean {
  return stores.get(ax)?.map.delete(key) ?? false;
}

/**
 * 清空指定 axios 实例的全部缓存 / clears all cache entries for the given axios instance.
 * @param ax 目标 axios 实例 / the target axios instance
 * 调用前已发出、尚在途的请求落定后不会再写回缓存，适合在登录态/账号切换时调用。
 * @returns 被清空的条目数 / the number of entries cleared
 * @example
 *   clearCache(axios); // 账号切换后
 */
export function clearCache(ax: AxiosInstance): number {
  const s = stores.get(ax);
  if (!s) return 0;
  const n = s.map.size;
  s.map.clear();
  s.written.clear();
  s.epoch++;
  return n;
}

/**
 * 默认写入判定：状态非 2xx、或信封里 code 不是成功值（0 / "0000"）的响应不缓存，
 * 与 normalize 插件用的 `AxpResponse.isSuccessful` 同源。adapter 层的 data 可能还是未解析的 JSON 字符串，这里容错解析。
 *
 * @internal
 * @param response adapter 返回的原始响应 / the raw response from the adapter
 * @returns 是否应当缓存 / whether to cache it
 */
export function $defaultShouldCache(response: AxiosResponse): boolean {
  let body: unknown = response.data;
  if (typeof body === "string") {
    const t = body.trim();
    if (t.charCodeAt(0) === 0x7b /* { */) {
      try {
        body = JSON.parse(t);
      } catch {
        // 非 JSON：按普通文本处理
      }
    }
  }
  return AxpResponse.fromResponse({ status: response.status, data: body }).successful;
}

/**
 * 给响应做一层独立外壳：浅拷贝并单独克隆 headers，避免与缓存原件共享可变对象。
 *
 * @internal
 * @param r 原响应 / the source response
 * @returns 新外壳 / a fresh shell
 */
function $shell(r: AxiosResponse): AxiosResponse {
  return { ...r, headers: cloneAxiosHeaders(r.headers) } as AxiosResponse;
}

/**
 * 写入一条缓存：先清理全部过期项，再放到最新位置，超出容量时淘汰最久未使用的项。
 *
 * @internal
 * @param store 缓存仓 / the cache store
 * @param k 缓存 key / cache key
 * @param entry 新条目 / the new entry
 * @param capacity 最大条数 / max entry count
 */
function $write(store: ICacheStore, k: string, entry: ICacheEntry, capacity: number): void {
  const now = Date.now();
  for (const [key, e] of store.map) {
    if (e.expiresAt <= now) store.map.delete(key);
  }
  store.map.delete(k);
  store.map.set(k, entry);
  while (store.map.size > capacity) {
    store.map.delete(store.map.keys().next().value as string);
  }
  $sweepWritten(store);
}

/** 在途请求落定：计数减一，并尝试回收该 key 的 seq 屏障 @internal */
function $settle(store: ICacheStore, k: string): void {
  const n = (store.inflight.get(k) ?? 0) - 1;
  if (n > 0) store.inflight.set(k, n);
  else store.inflight.delete(k);
  $sweepWritten(store);
}

/** 回收「无在途请求且条目已不在」的 key 的 seq 屏障，避免表无限增长 @internal */
function $sweepWritten(store: ICacheStore): void {
  for (const key of store.written.keys()) {
    if (!store.inflight.has(key) && !store.map.has(key)) store.written.delete(key);
  }
}

/**
 * 命中缓存时返回值的拷贝策略。**默认（含 `cache: true`）共享引用，不拷贝。**
 *   - `'shallow'` 浅拷贝顶层（嵌套仍共享，适合 immutable-update 风格）
 *   - `'deep'` `structuredClone` 深拷贝（环境无 structuredClone 时抛错）
 *   - `function` 自定义深拷贝（data 含 Date/Map/类实例/函数等）
 *
 * Clone strategy for a cache hit. **Default (incl. `cache: true`) is a shared
 * reference — no cloning.**
 */
export type TCloneStrategy = "shallow" | "deep" | ((data: any) => any);

export interface ICacheOptions {
  /** 插件级总开关；默认 true / plugin-wide kill switch; defaults to true */
  enable?: boolean;
  /** 默认 TTL（毫秒）；可由请求级 config.cache.expires 覆盖，默认 60_000 / default TTL (ms); overridable per-request via config.cache.expires, defaults to 60_000 */
  expires?: number;
  /** 默认 key 计算函数；未指定时回退到 config.key（key 插件写入） / default key-computing fn; falls back to config.key (set by the key plugin) */
  key?: (config: AxiosRequestConfig) => string | undefined;
  /** 默认拷贝策略；对象形式请求级 config.cache.clone 未指定时回退到此，默认共享引用 / default clone strategy; falls back here when the per-request object form is unspecified, default shared reference */
  clone?: TCloneStrategy;
  /**
   * 最大缓存条数，超出按 LRU 淘汰；每次写入还会顺带清理过期项。默认 500，可传 `Infinity` 不限。
   *
   * Max entry count, LRU-evicted when exceeded; expired entries are also swept on every write. Default 500, `Infinity` for unlimited.
   * @default 500
   */
  max?: number;
  /**
   * 写入判定：返回 false 则这次响应不入缓存（仍正常返回给调用方）。
   * 默认不缓存业务失败信封（HTTP 非 2xx，或 body.code 不是 0 / "0000"，与 normalize 一致）；自定义后完全由你决定。
   * 请求级 `cache: { shouldCache }` 优先。
   *
   * Decides whether a response is written to the cache. Default skips business-failure envelopes (consistent with normalize).
   * @param response adapter 返回的原始响应（data 可能是未解析的字符串） / the raw adapter response (data may be an unparsed string)
   * @returns 是否缓存 / whether to cache
   * @example
   * cache({ shouldCache: (r) => r.status === 200 })
   */
  shouldCache?: (response: AxiosResponse) => boolean;

  storage?: {
    getItem: (key: string) => any | Promise<any>;
    setItem: (key: string, value: any) => any | Promise<any>;
    removeItem: (key: string) => any | Promise<any>;
    clear: () => any | Promise<any>;
  };

  memory?: boolean;
}

/** `$resolveCache` 解析出的请求级缓存配置（内部中间态） / the per-request config resolved by $resolveCache (internal) */
interface IResolvedCache {
  /** 本请求生效的 TTL（毫秒） / effective TTL (ms) for this request */
  expires?: number;
  /** 本请求生效的 key 或 key 计算函数 / effective key or key-computing fn for this request */
  key?: string | ((config: AxiosRequestConfig) => string | undefined);
  /** 本请求生效的拷贝策略 / effective clone strategy for this request */
  clone?: TCloneStrategy;
  /** 本请求生效的写入判定 / effective write predicate for this request */
  shouldCache?: (response: AxiosResponse) => boolean;
}

/** 缓存仓：条目表 + 请求代次 + 清空代次 / cache store: entry map + request sequence + clear epoch */
interface ICacheStore {
  /** key → 条目；Map 插入序即 LRU 序（头部最久未用） */
  map: Map<string, ICacheEntry>;
  /** 请求发起序号（单调递增），用于旧响应不覆盖新结果 */
  seq: number;
  /** 每次 clearCache/卸载自增；在途请求发起时记下，落定时不一致则不回写 */
  epoch: number;
  /** key → 已写入过的最大 seq，独立于条目，条目被淘汰后屏障仍在 */
  written: Map<string, number>;
  /** key → 在途请求数；归零且条目不在时才回收 written */
  inflight: Map<string, number>;
}

/** 单条缓存记录：原始（未拷贝）响应 + 过期时间点 / a single cache entry: the original (uncloned) response + its expiry */
interface ICacheEntry {
  /** adapter 返回时的原始响应快照（data 为未经 transformResponse 的原值；命中时再套独立外壳） / snapshot of the raw adapter response (pre-transformResponse data; wrapped in a fresh shell on each hit) */
  response: AxiosResponse;
  /** 过期时间点（Date.now() 毫秒时间戳） / expiry timestamp (ms since epoch) */
  expiresAt: number;
}

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * 响应缓存：
     *   - `false`/未指定 → 不缓存
     *   - `true` → 启用，**返回共享引用**（零拷贝，须视为只读；要改请用对象形式指定 clone）
     *   - `{ expires?, key?, clone?, shouldCache? }` → 自定义 TTL/key/拷贝策略/写入判定
     *
     * Response caching: `false`/unspecified → not cached; `true` → enabled,
     * **returns a shared reference** (read-only; use the object form to opt
     * into cloning); object form customizes TTL/key/clone.
     */
    cache?: boolean | IResolvedCache;
  }
}
