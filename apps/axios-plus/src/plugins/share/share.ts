
import type { Plugin } from '../../plugin/types';
import { __DEV__, SHARE_SETTLED_KEY , lockName} from '../../helper';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { ISharedOptions, SharePolicy } from './types';


export const name = 'share'

/**
 * 防抖 / 节流 / 合并 多策略合一插件，按 `policy` 切换具体语义。
 * **所有策略以 `config.key` 为去重维度——key 由 `buildKey` 插件计算。**
 *
 *   - **start**：相同 key 的并发请求等待并复用首个的 promise（HTTP 只发一次）
 *   - **end**：  后到的请求顶替前面，所有 caller 等待最后一个的 HTTP 结果
 *   - **race**： 多个 caller 各自发 HTTP，第一个成功的赢家分发给所有 caller（`Promise.any`）
 *   - **none**： 不参与，等同于关闭；没有 key 也走 none
 *
 * **核心实现**：每个 (key, 一轮请求) 共享一个 `Promise.withResolvers()` 的 promise，
 * 不同策略只是决定"哪个 HTTP 有资格 settle 它"。Promise 一经 settle，其他重复 resolve/reject
 * 自动 no-op，无需 callers 列表或显式去重。
 *
 * **失败重试**：交给独立的 `retry` 插件，本插件不再内置 retry 策略。
 */
export default function share({ enable = true, policy = 'start', methods = ['get', 'head'] }: ISharedOptions = {}): Plugin {
    const defaults: ISharedOptions = { policy, methods };
    // 预归一化 method 白名单：null 表示"不过滤"
    const allowedMethods = methods && methods.length ? new Set(methods.map(m => m.toLowerCase())) : null;
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable} policy:${policy} methods:${allowedMethods ? [...allowedMethods].join(',') : '*'}`);
            if (!enable) return;
            const map = new Map<string, IShareEntry>();
            const prev = ctx.axios.defaults.adapter as AxiosAdapter;
            ctx.adapter((config) => {
                const key = config.key;
                if (!key) return prev(config);
                // method allowlist guard — same-key POSTs默认不共享
                if (allowedMethods && !allowedMethods.has((config.method || 'get').toLowerCase())) {
                    delete config.share;
                    return prev(config);
                }
                const p = $resolvePolicy(config, defaults);
                delete config.share;
                if (p === 'none') return prev(config);
                if (p === 'end') return $end(prev, map, key, config);
                if (p === 'race') return $race(prev, map, key, config);
                // 'start'：相同 key 共享一个 promise；首发的 HTTP 结果广播给所有 caller
                return $start(prev, map, key, config);
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

function $isValidPolicy(v: any): v is SharePolicy {
    return v === 'start' || v === 'end' || v === 'race' || v === 'none';
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
 * **start**：相同 key 共享一个 promise；首发的 HTTP settle 它，后续 caller 直接拿同一 promise。
 * @internal
 */
export function $start(prev: AxiosAdapter, map: Map<string, IShareEntry>, key: string, config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    let entry = map.get(key);
    if (!entry) {
        entry = $createEntry(map, key);
        prev(config).then(entry.resolve, entry.reject);
    }
    return entry.promise;
}


/**
 * **end**：每来一个新请求 ++seq；只有 myGen === e.seq 的 HTTP 才 settle 共享 promise。
 * @internal
 */
export function $end(prev: AxiosAdapter, map: Map<string, IShareEntry>, key: string, config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    let e = map.get(key);
    if (!e) {
        e = $createEntry(map, key);
        e.seq = 0;
    }
    const my = ++e.seq!;
    prev(config).then(
        (v) => { if (my === e!.seq) e!.resolve(v); },
        (err) => { if (my === e!.seq) e!.reject(err); },
    );
    return e.promise;
}


/**
 * **race**：每个 caller 各发 HTTP，**第一个成功**的赢家分发给所有 caller（`Promise.any` 语义）；
 * 所有 in-flight 都失败才用最后一个 error reject。
 *
 * **与 retry 的联动**：每个参与者的 config 上挂 `__raceSettled` 探针，retry 在重试前查询；
 * 一旦有人成功（entry.settled=true），其他失败者不再无意义重试。
 * @internal
 */
export function $race(prev: AxiosAdapter, map: Map<string, IShareEntry>, key: string, config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    let e = map.get(key);
    if (!e) {
        e = $createEntry(map, key);
        e.inFlight = 0;
        e.settled = false;
    }
    const entry = e;
    entry.inFlight!++;
    (config as unknown as Record<string, unknown>)[SHARE_SETTLED_KEY] = () => entry.settled === true;
    prev(config).then(
        (resp) => {
            entry.inFlight!--;
            if (!entry.settled) {
                entry.settled = true;
                entry.resolve(resp);
            }
        },
        (err) => {
            entry.inFlight!--;
            if (entry.inFlight === 0 && !entry.settled) entry.reject(err);
        },
    );
    return entry.promise;
}


// ───────────────────────────────────────────────────────────────────────────
//  内部类型
// ───────────────────────────────────────────────────────────────────────────

interface IShareEntry {
    promise: Promise<AxiosResponse>;
    resolve: (v: AxiosResponse) => void;
    reject: (e: any) => void;
    /** $end：单调递增序号，settle 时比对自己是否还是最新 */
    seq?: number;
    /** $race：还在跑的 HTTP 数，归零且尚未 settle 时表示全失败 */
    inFlight?: number;
    /** $race：promise 是否已被首个成功者 settle —— 通过 config 上的探针暴露给 retry，避免无意义重试 */
    settled?: boolean;
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(share)` 在 minify 后仍能识别
lockName(share, name);
