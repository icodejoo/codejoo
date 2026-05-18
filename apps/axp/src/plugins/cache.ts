
import type { Plugin } from '../types';
import { __DEV__ } from '../helper';
import type { AxiosAdapter, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';


const name = 'cache'

/** 每个 axios 实例的缓存表（按 axios 实例隔离） */
const stores = new WeakMap<AxiosInstance, Map<string, ICacheEntry>>();


/**
 * 响应缓存插件：在 TTL 内对相同 key 的请求直接返回缓存的响应，跳过 HTTP。
 *
 *   - **基于 adapter 包装**：命中缓存直接 `Promise.resolve(cachedResponse)`，
 *     不发 HTTP；未命中走原 adapter 并把响应写入缓存
 *   - **缓存维度**：默认用 `config.key`（由 build-key 计算）；可在请求级 `config.cache.key`
 *     或插件级 `defaults.key` 自定义
 *   - **TTL**：请求级 `expires` > 插件级 `defaults.expires`，默认 60s
 *   - **存储**：本插件用进程内 Map（不持久化）。需要 sessionStorage / localStorage
 *     可在外面包一层（cache + 自定义 storage 适配器），保持插件本体简单
 *   - **失效操作**：导出 `removeCache(ax, key)` / `clearCache(ax)` 工具函数
 *
 * @example
 *   useAxiosPlugin(ax)
 *     .use(cache({ expires: 30_000 }))
 *     .use(buildKey({ ... }));   // 注意：cache 之前装，buildKey 之后装
 *
 *   ax.get('/api/list', { cache: true });
 *   ax.get('/api/user', { cache: { expires: 5_000 } });
 *   ax.get('/api/big',  { cache: { key: 'big-list' } });
 */
export default function cache({ enable = true, expires = 60_000, key }: ICacheOptions = {}): Plugin {
    const defaults: ICacheOptions = { expires, key };
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable} expires:${expires}ms`);
            if (!enable) return;
            const store = new Map<string, ICacheEntry>();
            stores.set(ctx.axios, store);

            const prev = ctx.axios.defaults.adapter as AxiosAdapter;
            ctx.adapter((config) => {
                const opt = $resolveCache(config, defaults);
                delete config.cache;
                if (!opt) return prev(config);

                const k = $resolveKey(config, opt, defaults);
                if (!k) return prev(config);

                // 命中
                const hit = store.get(k);
                if (hit && hit.expiresAt > Date.now()) {
                    if (__DEV__) ctx.logger.log(`${name} hit: ${k}`);
                    return Promise.resolve(hit.response);
                }
                if (hit) store.delete(k);  // 过期，清掉

                // 未命中：走原 adapter，成功后写入
                return prev(config).then((response) => {
                    const ttl = opt.expires ?? defaults.expires ?? 60_000;
                    store.set(k, { response, expiresAt: Date.now() + ttl });
                    if (__DEV__) ctx.logger.log(`${name} set: ${k} ttl=${ttl}ms`);
                    return response;
                });
            });

            ctx.cleanup(() => { stores.delete(ctx.axios); store.clear(); });
        },
    };
}


/** 解析请求级 cache 配置；返回 null 表示本请求不缓存 @internal */
export function $resolveCache(config: AxiosRequestConfig, defaults: ICacheOptions): IResolvedCache | null {
    const v = config.cache;
    if (v === false || v == null) return null;
    if (v === true) return { expires: defaults.expires };
    if (typeof v === 'object') return { expires: v.expires ?? defaults.expires, key: v.key };
    return null;
}

/** 解析缓存 key：请求级 > 插件级 > config.key（build-key 兜底）@internal */
export function $resolveKey(
    config: AxiosRequestConfig,
    resolved: IResolvedCache,
    defaults: ICacheOptions,
): string | undefined {
    const reqKey = resolved.key;
    if (typeof reqKey === 'string' && reqKey) return reqKey;
    if (typeof reqKey === 'function') return reqKey(config) || undefined;
    if (typeof defaults.key === 'function') return defaults.key(config) || undefined;
    return (config as any).key;
}


/** 清除指定 axios 实例的某条缓存。返回是否真的删了。 */
export function removeCache(ax: AxiosInstance, key: string): boolean {
    return stores.get(ax)?.delete(key) ?? false;
}

/** 清空指定 axios 实例的全部缓存。返回被清空的条目数。 */
export function clearCache(ax: AxiosInstance): number {
    const s = stores.get(ax);
    if (!s) return 0;
    const n = s.size;
    s.clear();
    return n;
}


export interface ICacheOptions {
    enable?: boolean;
    /** 默认 TTL（毫秒）；可由请求级 `config.cache.expires` 覆盖。默认 60_000。 */
    expires?: number;
    /** 默认 key 计算函数；未指定时回退到 `config.key`（build-key 写入）。 */
    key?: (config: AxiosRequestConfig) => string | undefined;
}

interface IResolvedCache {
    expires?: number;
    key?: string | ((config: AxiosRequestConfig) => string | undefined);
}

interface ICacheEntry {
    response: AxiosResponse;
    expiresAt: number;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 响应缓存：
         *   - `false` / 未指定 → 不缓存
         *   - `true`           → 启用，使用插件级 expires 与 key 来源
         *   - `{ expires, key }` → 自定义 TTL 与 key
         */
        cache?: boolean | { expires?: number; key?: string | ((config: AxiosRequestConfig) => string | undefined) };
    }
}
