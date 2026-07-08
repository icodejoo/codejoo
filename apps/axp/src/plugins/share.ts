
import type { Plugin, MaybeFun } from '../types';
import { pluginLog } from '../helper';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';


const name = 'axp:share'

/**
 * 防抖/节流/合并多策略合一插件，按 `policy` 切换具体语义。
 * **所有策略以 `config.key` 为去重维度——key 由 `key` 插件计算。**
 *   - **start**：相同 key 的并发请求等待并复用首个的 promise（HTTP 只发一次）
 *   - **end**：后到的请求顶替前面，所有 caller 等待最后一个的 HTTP 结果
 *   - **race**：多个 caller 各自发 HTTP，第一个成功的赢家分发给所有 caller（`Promise.any`）
 *   - **none**：不参与，等同于关闭；没有 key 也走 none
 *
 * **核心实现**：每个 (key, 一轮请求) 共享一个 `Promise.withResolvers()` 的 promise，
 * 不同策略只是决定"哪个 HTTP 有资格 settle 它"。一经 settle，其他重复 resolve/reject
 * 自动 no-op，无需 callers 列表或显式去重。
 *
 * 失败重试请用独立的 `retry` 插件——两者不会再互相干扰：本插件不再有内部重试循环，
 * `retry` 的整链路重发会重新经过这里的去重逻辑，不会触发一次已经不存在的内部重试。
 *
 * A single plugin unifying debounce/throttle/merge strategies via `policy`. All
 * strategies dedupe on `config.key`. Each (key, round of requests) shares one
 * `Promise.withResolvers()` promise; strategies only decide *which* HTTP call
 * may settle it — once settled, extra resolve/reject calls are automatic
 * no-ops. Failure retries belong in the standalone `retry` plugin: this plugin
 * has no internal retry loop anymore, so a `retry` resend cleanly re-enters
 * this dedup logic instead of double-triggering a retry that no longer exists.
 *
 * @param options 插件配置：enable/policy / plugin config: enable/policy
 * @returns Plugin：install 时包装 adapter 按 key+policy 去重/合并，卸载还原 adapter / a Plugin that dedupes/merges by key+policy on install, restores the adapter on teardown
 */
export default function axpShare({ enable = true, policy = 'start' }: ISharedOptions = {}): Plugin {
    const defaults: ISharedOptions = { policy };
    return {
        name,
        install(axios) {
            pluginLog(axios.defaults, `[${name}] enabled:${enable} policy:${policy}`);
            if (!enable) return;
            const map = new Map<string, IShareEntry>();
            const prev = axios.defaults.adapter as AxiosAdapter;
            axios.defaults.adapter = (config) => {
                const key = config.key;
                if (!key) return prev(config);
                const p = $resolvePolicy(config, defaults);
                delete config.share;
                if (p === 'none') return prev(config);
                if (p === 'end') return $end(prev, map, key, config);
                if (p === 'race') return $race(prev, map, key, config);
                return $start(prev, map, key, config);
            };
            return () => { axios.defaults.adapter = prev; };
        },
    };
}


// ───────────────────────────────────────────────────────────────────────────
//  解析（对 config.share 做 MaybeFun 解包 + 与 defaults 合并）
//  Resolution (unwraps the MaybeFun on config.share + merges with defaults)
// ───────────────────────────────────────────────────────────────────────────

/** 解开 config.share 的 MaybeFun 包装 / unwraps the MaybeFun wrapper on config.share */
function $unwrap(config: AxiosRequestConfig): unknown {
    const v = config.share;
    return typeof v === 'function' ? v(config) : v;
}

/**
 * 解析本次请求生效的共享策略：请求级 `config.share` 优先，回退插件级 `defaults.policy`。
 *
 * Resolves the policy for this request: per-request `config.share` first,
 * falling back to plugin-wide `defaults.policy`.
 *
 * @internal exported for unit tests
 * @param config 请求配置 / the request config
 * @param defaults 插件级默认配置 / plugin-wide defaults
 * @returns 本次请求生效的策略 / the policy in effect for this request
 */
export function $resolvePolicy(config: AxiosRequestConfig, defaults: ISharedOptions): SharePolicy {
    const v = $unwrap(config);
    const fallback = defaults.policy ?? 'start';
    if (v === false) return 'none';
    if (v === true || v == null) return fallback;
    if (typeof v === 'string') return $isValidPolicy(v) ? v : fallback;
    if (typeof v === 'object' && $isValidPolicy((v as any).policy)) return (v as any).policy;
    return fallback;
}

/** 判断 v 是否为合法的 SharePolicy 字面量 / checks whether v is a valid SharePolicy literal */
function $isValidPolicy(v: any): v is SharePolicy {
    return v === 'start' || v === 'end' || v === 'race' || v === 'none';
}


// ───────────────────────────────────────────────────────────────────────────
//  核心：共享 entry + 策略实现
//  Core: shared entry + strategy implementations
// ───────────────────────────────────────────────────────────────────────────

/**
 * 创建共享 entry：用 `Promise.withResolvers` 拿到 promise + resolve/reject，配
 * cleanup 在 settle 后自动从 map 清理（避免下一轮命中陈旧条目）。
 *
 * Creates a shared entry via `Promise.withResolvers`, with cleanup that removes
 * it from the map once settled (so the next round never hits a stale entry).
 *
 * @internal
 * @param map 该策略的共享 entry 表 / the shared-entry table for this strategy
 * @param key 本轮请求的去重 key / the dedup key for this round
 * @returns 新建的共享 entry（已写入 map） / the newly created entry (already in the map)
 */
export function $createEntry(map: Map<string, IShareEntry>, key: string): IShareEntry {
    const { promise, resolve, reject } = Promise.withResolvers<AxiosResponse>();
    const entry: IShareEntry = { promise, resolve, reject };
    map.set(key, entry);
    // 两个分支都跑 cleanup（语义同 finally，但 .then 不会把 rejection 传到派生 promise，
    // 避免在 caller 没 catch 共享 promise 时触发 unhandled rejection）
    const cleanup = () => { if (map.get(key) === entry) map.delete(key); };
    promise.then(cleanup, cleanup);
    return entry;
}


/**
 * **end**：每来一个新请求 ++seq；只有 myGen === e.seq 的 HTTP 才 settle 共享 promise。
 *
 * **end**: `++seq` per incoming request; only the call whose `myGen === e.seq`
 * settles the shared promise.
 *
 * @internal
 * @param prev 原始 adapter / the original adapter
 * @param map end 策略的共享 entry 表 / the shared-entry table for `end`
 * @param key 本轮请求的去重 key / the dedup key for this round
 * @param config 本次请求的配置 / this request's config
 * @returns 共享 promise，由最新一次请求的 HTTP 结果 settle / the shared promise, settled by the most recent request's result
 */
export function $end(prev: AxiosAdapter, map: Map<string, IShareEntry>, key: string, config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    const e = map.get(key) ?? Object.assign($createEntry(map, key), { seq: 0 });
    const my = ++e.seq!;
    prev(config).then(
        (v) => { if (my === e.seq) e.resolve(v); },
        (err) => { if (my === e.seq) e.reject(err); },
    );
    return e.promise;
}


/**
 * **race**：每个 caller 各发 HTTP，**第一个成功**的赢家分发给所有 caller（`Promise.any` 语义）；
 * 所有 in-flight 都失败才用最后一个 error reject。
 *
 * **race**: each caller sends its own HTTP call; whichever **succeeds first**
 * wins and is dispatched to everyone; rejects with the last error only once
 * every in-flight call has failed.
 *
 * @internal
 * @param prev 原始 adapter / the original adapter
 * @param map race 策略的共享 entry 表 / the shared-entry table for `race`
 * @param key 本轮请求的去重 key / the dedup key for this round
 * @param config 本次请求的配置 / this request's config
 * @returns 共享 promise，由首个成功结果 settle（或全败后用最后错误 reject） / the shared promise, settled by the first success (or rejected with the last error once all fail)
 */
export function $race(prev: AxiosAdapter, map: Map<string, IShareEntry>, key: string, config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    const e = map.get(key) ?? Object.assign($createEntry(map, key), { inFlight: 0 });
    e.inFlight!++;
    prev(config).then(
        (resp) => { e.inFlight!--; e.resolve(resp); },
        (err) => { e.inFlight!--; if (e.inFlight === 0) e.reject(err); },
    );
    return e.promise;
}


/**
 * **start**：相同 key 的并发请求等待并复用首发 caller 的 promise，HTTP 只发一次。
 *
 * **start**: concurrent same-key requests wait for and reuse the first caller's
 * promise; HTTP is sent only once.
 *
 * @internal
 * @param prev 原始 adapter / the original adapter
 * @param map start 策略的共享 entry 表 / the shared-entry table for `start`
 * @param key 本轮请求的去重 key / the dedup key for this round
 * @param config 本次请求的配置 / this request's config
 * @returns 共享 promise，由首发请求的 HTTP 结果 settle / the shared promise, settled by the first request's result
 */
export function $start(
    prev: AxiosAdapter,
    map: Map<string, IShareEntry>,
    key: string,
    config: InternalAxiosRequestConfig,
): Promise<AxiosResponse> {
    let entry = map.get(key);
    if (!entry) {
        entry = $createEntry(map, key);
        prev(config).then(entry.resolve, entry.reject);
    }
    return entry.promise;
}


// ───────────────────────────────────────────────────────────────────────────
//  类型
//  Types
// ───────────────────────────────────────────────────────────────────────────

/** 共享/去重策略字面量 / the sharing/dedup strategy literal */
export type SharePolicy = 'start' | 'end' | 'race' | 'none';

export interface ISharedOptions {
    /** 插件级总开关；默认 true / plugin-wide kill switch; defaults to true */
    enable?: boolean;
    /** 默认共享策略；可由请求级 config.share 覆盖，默认 'start' / default policy; overridable per-request via config.share, defaults to 'start' */
    policy?: SharePolicy;
}

/** 一个 (key, 一轮请求) 的共享状态 / the shared state for one (key, round of requests) */
interface IShareEntry {
    /** 本轮请求共享的 promise，最终由某次 HTTP settle / the promise shared by this round, settled by one HTTP call */
    promise: Promise<AxiosResponse>;
    /** settle 该 promise 为成功 / settles the promise as resolved */
    resolve: (v: AxiosResponse) => void;
    /** settle 该 promise 为失败 / settles the promise as rejected */
    reject: (e: any) => void;
    /** $end：单调递增序号，settle 时比对自己是否还是最新 / $end: monotonic seq, compared at settle time to check it's still latest */
    seq?: number;
    /** $race：还在跑的 HTTP 数，归零且未 settle 时表示全失败 / $race: in-flight count; hitting zero while unsettled means every call failed */
    inFlight?: number;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 共享策略（同 `config.key` 的并发请求如何处理）：
         *   - `false` → 不共享（policy='none'）
         *   - `true`/未指定 → 走插件级 `policy`
         *   - 字符串 policy → 强制使用该策略
         *   - `{ policy }` → 对象形式
         *   - 函数 → 动态返回上述任一形式
         *
         * Sharing strategy for concurrent same-key requests: `false` → none;
         * `true`/unspecified → plugin-wide `policy`; a string forces that
         * policy; `{ policy }` object form; a function dynamically returns any
         * of the above.
         */
        share?: MaybeFun<SharePolicy | boolean | { policy?: SharePolicy }>;
    }
}
