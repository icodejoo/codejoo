
import type { Plugin } from '../types';
import { pluginLog } from '../helper';
import { setInternal, getInternal, delInternal } from '../bag';
import type { AxiosInstance } from 'axios';


const name = 'axp:cancel'

/** bag 里存 AbortController 引用用的键——Symbol 私有，不跨 mergeConfig 存活，仅用作单次请求内部脚手架（见 bag.ts） / key for storing the AbortController reference in the bag — Symbol-private, doesn't survive mergeConfig, scaffolding for a single request only (see bag.ts). */
const CANCEL_CTRL = `${name}:ctrl`;

/** 每个 axios 实例对应的活跃 AbortController 集合 / the set of active AbortControllers per axios instance. */
const instances = new WeakMap<AxiosInstance, Set<AbortController>>();

/**
 * 标记"这个 signal 是本插件签发的"。retry 等插件用同一 config 重发时，config.signal
 * （可枚举字段）会熬过 mergeConfig，但 Symbol bag 里的 controller 不会（已被上次响应阶段
 * release）；仅凭 config.signal 是否存在无法区分"用户自带"还是"本插件发过、已释放"，会让
 * 重发请求永远拿不到新 controller、脱离 cancelAll 追踪。用身份而非存在性区分：命中这个
 * WeakSet → 本插件签发过，可放心换发新的。
 *
 * Marks "this signal was issued by this plugin". When retry etc. re-send with
 * the same config, config.signal (enumerable) survives mergeConfig but the
 * controller in the Symbol bag doesn't (already released after the prior
 * response). Presence alone can't tell "user-supplied" from "issued by us,
 * already released", which would leave re-sends stuck without a new
 * controller and untracked by cancelAll. Identity (this WeakSet), not
 * presence, is what distinguishes them — a hit means it's safe to reissue.
 */
const selfIssued = new WeakSet<AbortSignal>();


/**
 * 取消请求插件：为每个未自带 signal/cancelToken 的请求自动注入 AbortController，并维护
 * 该 axios 实例的活跃请求集合，配合 cancelAll(ax) 可一次性中止所有在飞请求。
 *
 * Cancel plugin: auto-injects an AbortController into any request that
 * doesn't already carry a signal/cancelToken, and tracks the active-request
 * set per axios instance so cancelAll(ax) can abort everything in flight.
 *
 *   - 用户已提供 config.signal/cancelToken → 跳过，尊重用户控制 / user already provided config.signal/cancelToken → skipped, respects user control
 *   - 请求成功/失败 → 自动从集合移除，防内存泄漏 / success/failure → auto-removed from the set, prevents leaks
 *   - 插件 uninstall(cleanup) → 清理 WeakMap 条目 / plugin uninstall (cleanup) → clears the WeakMap entry
 *
 * @example
 *   import cancel, { cancelAll } from './cancel';
 *   useAxiosPlugin(ax).use(cancel());
 *   // ...想中止一切时 / when you want to abort everything later:
 *   cancelAll(ax, '用户切走了页面');
 */
export default function axpCancel({ enable = true }: ICancelOptions = {}): Plugin {
    return {
        name,
        install(axios) {
            pluginLog(axios.defaults, `[${name}] enabled:${enable}`);
            if (!enable) return;
            const set = new Set<AbortController>();
            instances.set(axios, set);

            const reqId = axios.interceptors.request.use(
                function $cancel(config) {
                    if (config.cancelToken) return config;  // 用户自带，尊重 / user-supplied, respected
                    // 有 signal 但非本插件签发 → 用户自带，尊重；是本插件签发（含上一轮发过已释放的）→ 换发新的重新纳入追踪
                    //
                    // has a signal but not issued by us → user-supplied, respected; issued by us (incl. a
                    // prior, already-released one) → reissue a new one and re-track it
                    if (config.signal && !selfIssued.has(config.signal)) return config;
                    const ctrl = new AbortController();
                    config.signal = ctrl.signal;
                    selfIssued.add(ctrl.signal);
                    // 内部 controller 收进私有 bag（Symbol 键），不以可枚举字段污染 config
                    //
                    // internal controller goes into the private bag (Symbol key), not an enumerable field on config
                    setInternal(config, CANCEL_CTRL, ctrl);
                    set.add(ctrl);
                    return config;
                },
            );

            const release = (config: any) => {
                if (!config) return;
                const ctrl = getInternal<AbortController>(config, CANCEL_CTRL);
                if (!ctrl) return;
                set.delete(ctrl);
                delInternal(config, CANCEL_CTRL);
            };

            const resId = axios.interceptors.response.use(
                (response) => { release(response.config); return response; },
                (error: any) => { release(error?.config); return Promise.reject(error); },
            );

            return () => {
                axios.interceptors.request.eject(reqId);
                axios.interceptors.response.eject(resId);
                instances.delete(axios);
                set.clear();
            };
        },
    };
}


/**
 * 中止指定 axios 实例当前所有活跃请求 / aborts all currently active requests on the given axios instance.
 *   - 仅作用于 cancel() 插件注入的 controller，用户自带 signal 的请求不受影响
 *     only affects controllers injected by the cancel() plugin; requests with a user-supplied signal are unaffected
 *   - 调用后 set 清空，新请求会重新加入 / after calling, the set is cleared; new requests re-join it
 */
export function cancelAll(ax: AxiosInstance, reason?: string): number {
    const set = instances.get(ax);
    if (!set || set.size === 0) return 0;
    const n = set.size;
    for (const ctrl of set) ctrl.abort(reason);
    set.clear();
    return n;
}


export interface ICancelOptions {
    /** 插件级总开关，默认 true / plugin-level master switch, defaults to true. */
    enable?: boolean;
}
