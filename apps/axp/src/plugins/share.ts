
import type { Plugin, MaybeFun } from '../types';
import { __DEV__ } from '../helper';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';


const name = 'share'

/**
 * 防抖 / 节流 / 合并 / 重试 多策略合一插件，按 `policy` 切换具体语义。
 * **所有策略以 `config.key` 为去重维度——key 由 `reqkey` 插件计算。**
 *
 *   - **start**：相同 key 的并发请求等待并复用首个的 promise（HTTP 只发一次）
 *   - **end**：  后到的请求顶替前面，所有 caller 等待最后一个的 HTTP 结果
 *   - **race**： 多个 caller 各自发 HTTP，第一个成功的赢家分发给所有 caller（`Promise.any`）
 *   - **retry**：相同 key 共享同一个 promise；HTTP 失败时按 `interval` 自动重试 `retries` 次，
 *                直到成功或耗尽。caller 不感知重试过程，只看最终结果
 *   - **none**： 不参与，等同于关闭；没有 key 也走 none
 *
 * **核心实现**：每个 (key, 一轮请求) 共享一个 `Promise.withResolvers()` 的 promise，
 * 不同策略只是决定"哪个 HTTP 有资格 settle 它"。Promise 一经 settle，其他重复 resolve/reject
 * 自动 no-op，无需 callers 列表或显式去重。
 *
 * **不要与 `retry` 插件的 `policy:'retry'` 叠加**：本插件的 retry 发生在 adapter 层，settle
 * 之前 `retry` 插件的响应拦截器完全看不到；一旦最终 reject 才会被 `retry` 再次整链路重发，
 * 触发 share 一次全新的内部重试循环 —— 总次数变成 `(retry.max+1) * (share.retries+1)`
 * 的乘积，而不是两者中较大的一个。同一 key 上二选一：用本插件的 `retry` 策略处理瞬时失败，
 * 或用 `retry` 插件处理全链路重发，不要同时开。
 */
export default function share({ enable = true, policy = 'start', interval = 0, retries = 3 }: ISharedOptions = {}): Plugin {
    const defaults: ISharedOptions = { policy, interval, retries };
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable} policy:${policy}`);
            if (!enable) return;
            const map = new Map<string, IShareEntry>();
            const prev = ctx.axios.defaults.adapter as AxiosAdapter;
            ctx.adapter((config) => {
                const key = config.key;
                if (!key) return prev(config);
                // 全部读完 config.share 再删——否则 $resolveRetries/$resolveInterval 各自
                // 重新 $unwrap(config) 时 config.share 已被删掉，per-request 的 interval/retries
                // 覆盖会静默失效，回退到插件级 defaults（对齐 cache.ts 的 opt 先捕获再 delete 模式）。
                const p = $resolvePolicy(config, defaults);
                const r = p === 'start' ? 0 : $resolveRetries(config, defaults);
                const interval = $resolveInterval(config, defaults);
                delete config.share;
                if (p === 'none') return prev(config);
                if (p === 'end') return $end(prev, map, key, config);
                if (p === 'race') return $race(prev, map, key, config);
                // start = retry with retries=0
                return $retry(prev, map, key, config, r, interval);
            });
        },
    };
}


// ───────────────────────────────────────────────────────────────────────────
//  解析（对 config.share 做 MaybeFun 解包 + 与 defaults 合并）
// ───────────────────────────────────────────────────────────────────────────

/** 解开 config.share 的 MaybeFun 包装 */
function $unwrap(config: AxiosRequestConfig): unknown {
    const v = config.share;
    return typeof v === 'function' ? v(config) : v;
}

/** @internal exported for unit tests */
export function $resolvePolicy(config: AxiosRequestConfig, defaults: ISharedOptions): SharePolicy {
    const v = $unwrap(config);
    const fallback = defaults.policy ?? 'start';
    if (v === false) return 'none';
    if (v === true || v == null) return fallback;
    if (typeof v === 'string') return $isValidPolicy(v) ? v : fallback;
    if (typeof v === 'object' && $isValidPolicy((v as any).policy)) return (v as any).policy;
    return fallback;
}

/** @internal */
export function $resolveInterval(config: AxiosRequestConfig, defaults: ISharedOptions): number {
    const v = $unwrap(config);
    return (typeof v === 'object' && v && typeof (v as any).interval === 'number') ? (v as any).interval : defaults.interval ?? 0;
}

/** @internal */
export function $resolveRetries(config: AxiosRequestConfig, defaults: ISharedOptions): number {
    const v = $unwrap(config);
    return (typeof v === 'object' && v && typeof (v as any).retries === 'number') ? (v as any).retries : defaults.retries ?? 3;
}

function $isValidPolicy(v: any): v is SharePolicy {
    return v === 'start' || v === 'end' || v === 'race' || v === 'retry' || v === 'none';
}


// ───────────────────────────────────────────────────────────────────────────
//  核心：共享 entry + 策略实现
// ───────────────────────────────────────────────────────────────────────────

/**
 * 创建共享 entry：用 `Promise.withResolvers` 拿到 promise + resolve/reject，
 * 配 `promise.finally` 在 settle 后自动从 map 清理（避免下一轮命中陈旧条目）。
 * @internal
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
 * @internal
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
 * @internal
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
 * **retry**（同时也是 start：retries=0 时退化为单发不重试）：相同 key 共享一个 promise；
 * 内部用首发 caller 的 config 自动重试到成功或耗尽。
 * @internal
 */
export function $retry(
    prev: AxiosAdapter,
    map: Map<string, IShareEntry>,
    key: string,
    config: InternalAxiosRequestConfig,
    retries: number,
    interval: number,
): Promise<AxiosResponse> {
    let entry = map.get(key);
    if (!entry) {
        entry = $createEntry(map, key);
        $loop(entry, prev, config, retries, interval, 0);
    }
    return entry.promise;
}

/** retry 的内部循环 */
function $loop(e: IShareEntry, prev: AxiosAdapter, config: InternalAxiosRequestConfig, retries: number, interval: number, attempt: number): void {
    prev(config).then(e.resolve, (err) => {
        if (attempt >= retries) return e.reject(err);
        const next = () => $loop(e, prev, config, retries, interval, attempt + 1);
        if (interval > 0) setTimeout(next, interval);
        else next();
    });
}


// ───────────────────────────────────────────────────────────────────────────
//  类型
// ───────────────────────────────────────────────────────────────────────────

export type SharePolicy = 'start' | 'end' | 'race' | 'retry' | 'none';

export interface ISharedOptions {
    /** 插件级总开关；默认 `true`。设为 `false` 时整个插件不安装。 */
    enable?: boolean;
    /** 默认共享策略；可由请求级 `config.share` 覆盖。默认 `'start'`。 */
    policy?: SharePolicy;
    /** retry 策略下两次重试之间的间隔（毫秒）；默认 `0`。 */
    interval?: number;
    /** retry 策略下首次失败后的最大重试次数；默认 `3`（共最多 4 次尝试）。 */
    retries?: number;
}

interface IShareEntry {
    promise: Promise<AxiosResponse>;
    resolve: (v: AxiosResponse) => void;
    reject: (e: any) => void;
    /** $end：单调递增序号，settle 时比对自己是否还是最新 */
    seq?: number;
    /** $race：还在跑的 HTTP 数，归零且尚未 settle 时表示全失败 */
    inFlight?: number;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 共享策略（同 `config.key` 的并发请求如何处理）：
         *   - `false`           → 不共享（policy='none'）
         *   - `true` / 未指定    → 走插件级 `policy`
         *   - 字符串 policy      → 强制使用该策略
         *   - `{ policy, interval, retries }` → 对象形式
         *   - 函数              → 动态返回上述任一形式
         */
        share?: MaybeFun<SharePolicy | boolean | { policy?: SharePolicy; interval?: number; retries?: number }>;
    }
}
