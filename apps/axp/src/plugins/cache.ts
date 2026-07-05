
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
 *   - **缓存维度**：默认用 `config.key`（由 reqkey 计算）；可在请求级 `config.cache.key`
 *     或插件级 `defaults.key` 自定义
 *   - **TTL**：请求级 `expires` > 插件级 `defaults.expires`，默认 60s
 *   - **存储**：本插件用进程内 Map（不持久化）。需要 sessionStorage / localStorage
 *     可在外面包一层（cache + 自定义 storage 适配器），保持插件本体简单
 *   - **失效操作**：导出 `removeCache(ax, key)` / `clearCache(ax)` 工具函数
 *
 * @example
 *   useAxiosPlugin(ax)
 *     .use(cache({ expires: 30_000 }))
 *     .use(reqkey({ ... }));   // 注意：cache 之前装，reqkey 之后装
 *
 *   ax.get('/api/list', { cache: true });
 *   ax.get('/api/user', { cache: { expires: 5_000 } });
 *   ax.get('/api/big',  { cache: { key: 'big-list' } });
 */
export default function cache({ enable = true, expires = 60_000, key, clone }: ICacheOptions = {}): Plugin {
    const defaults: ICacheOptions = { expires, key, clone };
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

                // 解析拷贝策略（一次）：缺省/`true` → null(共享引用)；'deep' 环境缺 structuredClone 会在此早抛
                const cloneFn = $resolveCloneFn(opt.clone);

                // 命中：返回拷贝（按策略）；store 里始终是未被外部碰过的原件，杜绝调用方就地改污染缓存
                const hit = store.get(k);
                if (hit && hit.expiresAt > Date.now()) {
                    if (__DEV__) ctx.logger.log(`${name} hit: ${k}`);
                    return Promise.resolve($applyClone(hit.response, cloneFn));
                }
                if (hit) store.delete(k);  // 过期，清掉

                // 未命中：走原 adapter，成功后写入「原件」，对外发出「拷贝」
                return prev(config).then((response) => {
                    const ttl = opt.expires ?? defaults.expires ?? 60_000;
                    store.set(k, { response, expiresAt: Date.now() + ttl });
                    if (__DEV__) ctx.logger.log(`${name} set: ${k} ttl=${ttl}ms`);
                    return $applyClone(response, cloneFn);
                });
            });

            ctx.cleanup(() => { stores.delete(ctx.axios); store.clear(); });
        },
    };
}


/** 把 clone 策略解析成一个「拷贝 data」的函数；返回 null 表示共享引用（不拷贝）。
 *   - 缺省 / `cache: true`（resolved.clone 为 undefined）→ null（共享引用）
 *   - `'shallow'` → 浅拷贝（仅顶层；嵌套仍共享，适合 immutable-update 风格）
 *   - `'deep'`    → `structuredClone` 深拷贝（环境不支持则**直接抛错**，绝不静默退化为浅拷贝）
 *   - `function`  → 自定义深拷贝（data 含 Date/Map/类实例/函数等不可结构化克隆时使用）
 * @internal exported for unit tests
 */
export function $resolveCloneFn(clone: TCloneStrategy | undefined): ((data: any) => any) | null {
    if (!clone) return null;
    if (clone === 'shallow') return $shallowClone;
    if (clone === 'deep') {
        if (typeof structuredClone !== 'function') {
            throw new Error(`[${name}] clone:"deep" 需要 structuredClone（当前环境不可用）；请改用 clone: (data) => ... 自定义深拷贝`);
        }
        return (data) => structuredClone(data);
    }
    if (typeof clone === 'function') return clone;
    return null;
}

/** 浅拷贝：数组/对象复制顶层，原始值原样返回 @internal */
export function $shallowClone(d: any): any {
    if (Array.isArray(d)) return [...d];
    if (d && typeof d === 'object') return { ...d };
    return d;
}

/** 按拷贝函数发出响应：null → 原样共享；否则返回新 response（浅拷壳 + 拷贝后的 data）@internal */
export function $applyClone(resp: AxiosResponse, cloneFn: ((data: any) => any) | null): AxiosResponse {
    if (!cloneFn) return resp;
    return { ...resp, data: cloneFn(resp.data) };
}


/** 解析请求级 cache 配置；返回 null 表示本请求不缓存 @internal
 *   - `false` / 未指定 → null（不缓存）
 *   - `true`           → 启用 + **共享引用**（不携带 clone，拷贝语义只在对象形式里指定）
 *   - 对象              → 启用；`clone` 请求级优先、回退插件级 `defaults.clone`
 */
export function $resolveCache(config: AxiosRequestConfig, defaults: ICacheOptions): IResolvedCache | null {
    const v = config.cache;
    if (v === false || v == null) return null;
    if (v === true) return { expires: defaults.expires };
    if (typeof v === 'object') return { expires: v.expires ?? defaults.expires, key: v.key, clone: v.clone ?? defaults.clone };
    return null;
}

/** 解析缓存 key：请求级 > 插件级 > config.key（reqkey 兜底）@internal */
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


/**
 * 命中缓存时返回值的拷贝策略。**默认（含 `cache: true`）共享引用，不拷贝。**
 *   - `'shallow'` 浅拷贝顶层（嵌套仍共享，适合永远整体替换、不就地改嵌套的 immutable-update 风格）
 *   - `'deep'`    `structuredClone` 深拷贝（要随便改 data 任意层；环境无 structuredClone 时抛错）
 *   - `function`  自定义深拷贝（data 含 Date/Map/类实例/函数等）
 */
export type TCloneStrategy = 'shallow' | 'deep' | ((data: any) => any);

export interface ICacheOptions {
    enable?: boolean;
    /** 默认 TTL（毫秒）；可由请求级 `config.cache.expires` 覆盖。默认 60_000。 */
    expires?: number;
    /** 默认 key 计算函数；未指定时回退到 `config.key`（reqkey 写入）。 */
    key?: (config: AxiosRequestConfig) => string | undefined;
    /** 默认拷贝策略；对象形式请求级 `config.cache.clone` 未指定时回退到此。默认共享引用。 */
    clone?: TCloneStrategy;
}

interface IResolvedCache {
    expires?: number;
    key?: string | ((config: AxiosRequestConfig) => string | undefined);
    clone?: TCloneStrategy;
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
         *   - `true`           → 启用，**返回共享引用**（零拷贝，须视为只读；要改请用对象形式指定 clone）
         *   - `{ expires?, key?, clone? }` → 自定义 TTL / key / 拷贝策略
         *     （`clone: 'shallow' | 'deep' | (data)=>data`，缺省共享引用）
         */
        cache?: boolean | {
            expires?: number;
            key?: string | ((config: AxiosRequestConfig) => string | undefined);
            clone?: TCloneStrategy;
        };
    }
}
