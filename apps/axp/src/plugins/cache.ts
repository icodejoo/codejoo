import type { Plugin } from "../types";
import { pluginLog } from "../helper";
import type {
  AxiosAdapter,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";

const name = "axp:cache";

/** 每个 axios 实例的缓存表（按实例隔离） / per-axios-instance cache table (isolated per instance) */
const stores = new WeakMap<AxiosInstance, Map<string, ICacheEntry>>();

/**
 * 响应缓存插件：TTL 内对相同 key 的请求直接返回缓存响应，跳过 HTTP。
 *   - **基于 adapter 包装**：命中直接 `Promise.resolve(cachedResponse)`；未命中走原
 *     adapter 并把响应写入缓存
 *   - **缓存维度**：默认 `config.key`；可用请求级 `config.cache.key` 或插件级 `defaults.key` 自定义
 *   - **TTL**：请求级 `expires` > 插件级 `defaults.expires`，默认 60s
 *   - **存储**：进程内 Map（不持久化）；要 sessionStorage/localStorage 请在外面包一层
 *   - **失效操作**：导出 `removeCache(ax, key)` / `clearCache(ax)`
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
 * @param options 插件配置：enable/expires/key/clone / plugin config: enable/expires/key/clone
 * @returns Plugin：install 时包装 adapter 实现缓存读写，卸载还原 adapter 并清空本实例缓存 / a Plugin that wraps the adapter to cache on install, and restores the adapter + clears this instance's cache on teardown
 */
export default function axpCache({
  enable = true,
  expires = 60_000,
  key,
  clone,
}: ICacheOptions = {}): Plugin {
  const defaults: ICacheOptions = { expires, key, clone };
  return {
    name,
    install(axios) {
      pluginLog(
        axios.defaults,
        `[${name}] enabled:${enable} expires:${expires}ms`,
      );
      if (!enable) return;
      const store = new Map<string, ICacheEntry>();
      stores.set(axios, store);

      const prev = axios.defaults.adapter as AxiosAdapter;
      axios.defaults.adapter = (config) => {
        const opt = $resolveCache(config, defaults);
        delete config.cache;
        if (!opt) return prev(config);

        const k = $resolveKey(config, opt, defaults);
        if (!k) return prev(config);

        // 解析拷贝策略（一次）：缺省/`true` → null(共享引用)；'deep' 环境缺 structuredClone 会在此早抛
        const cloneFn = $resolveCloneFn(opt.clone);

        // 命中：返回拷贝（按策略）；store 里始终是未被外部碰过的原件，杜绝调用方就地改污染缓存
        const hit = store.get(k);
        if (hit && hit.expiresAt > Date.now()) {
          pluginLog(config, `[${name}] hit: ${k}`);
          return Promise.resolve($applyClone(hit.response, cloneFn));
        }
        if (hit) store.delete(k); // 过期，清掉

        // 未命中：走原 adapter，成功后写入「原件」，对外发出「拷贝」
        return prev(config).then((response) => {
          const ttl = opt.expires ?? defaults.expires ?? 60_000;
          store.set(k, { response, expiresAt: Date.now() + ttl });
          pluginLog(config, `[${name}] set: ${k} ttl=${ttl}ms`);
          return $applyClone(response, cloneFn);
        });
      };

      return () => {
        axios.defaults.adapter = prev;
        stores.delete(axios);
        store.clear();
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
  return stores.get(ax)?.delete(key) ?? false;
}

/**
 * 清空指定 axios 实例的全部缓存 / clears all cache entries for the given axios instance.
 * @param ax 目标 axios 实例 / the target axios instance
 * @returns 被清空的条目数 / the number of entries cleared
 */
export function clearCache(ax: AxiosInstance): number {
  const s = stores.get(ax);
  if (!s) return 0;
  const n = s.size;
  s.clear();
  return n;
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
}

/** 单条缓存记录：原始（未拷贝）响应 + 过期时间点 / a single cache entry: the original (uncloned) response + its expiry */
interface ICacheEntry {
  /** 写入缓存时的原始响应（store 里始终是未被外部碰过的原件） / the original response as stored (always pristine, untouched by callers) */
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
     *   - `{ expires?, key?, clone? }` → 自定义 TTL/key/拷贝策略
     *
     * Response caching: `false`/unspecified → not cached; `true` → enabled,
     * **returns a shared reference** (read-only; use the object form to opt
     * into cloning); object form customizes TTL/key/clone.
     */
    cache?: boolean | IResolvedCache;
  }
}
