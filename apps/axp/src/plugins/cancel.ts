
import type { Plugin } from '../types';
import { pluginLog } from '../helper';
import { setInternal, getInternal, delInternal } from '../bag';
import type { AxiosInstance, GenericAbortSignal } from 'axios';


const name = 'axp:cancel'

/** bag 里存 AbortController 引用用的键——Symbol 私有，不跨 mergeConfig 存活，仅用作单次请求内部脚手架（见 bag.ts） / key for storing the AbortController reference in the bag — Symbol-private, doesn't survive mergeConfig, scaffolding for a single request only (see bag.ts). */
const CANCEL_CTRL = `${name}:ctrl`;

/** 每个 axios 实例对应的活跃 AbortController 集合 / the set of active AbortControllers per axios instance. */
const instances = new WeakMap<AxiosInstance, Set<AbortController>>();

/** 插件签发的 signal 到 controller 的映射；重放沿用在途或已取消的信号，最终按信号释放。 */
const selfIssued = new WeakMap<GenericAbortSignal, AbortController>();


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
        /** 注册取消信号的签发和最终释放，维护当前实例的控制器集合。 */
        install(axios) {
            pluginLog(axios.defaults, `[${name}] enabled:${enable}`);
            if (!enable) return;
            const set = new Set<AbortController>();
            instances.set(axios, set);

            const reqId = axios.interceptors.request.use(
                /** 为新逻辑请求签发 controller，重放保留原取消状态。 */
                function $cancel(config) {
                    if (config.cancelToken) return config;  // 用户自带，尊重 / user-supplied, respected
                    const existing = config.signal ? selfIssued.get(config.signal) : undefined;
                    if (config.signal && !existing) return config;
                    if (existing && (set.has(existing) || existing.signal.aborted)) {
                        setInternal(config, CANCEL_CTRL, existing);
                        return config;
                    }
                    const ctrl = new AbortController();
                    config.signal = ctrl.signal;
                    selfIssued.set(ctrl.signal, ctrl);
                    // 内部 controller 收进私有 bag（Symbol 键），不以可枚举字段污染 config
                    //
                    // internal controller goes into the private bag (Symbol key), not an enumerable field on config
                    setInternal(config, CANCEL_CTRL, ctrl);
                    set.add(ctrl);
                    return config;
                },
            );

            /** 按 bag 或重放保留的 signal 释放 controller；重复释放无副作用。 */
            const release = (config: any) => {
                if (!config) return;
                // 优先读 bag；bag 没有（重发后的 merged config）就按 signal 身份回查
                const ctrl = getInternal<AbortController>(config, CANCEL_CTRL)
                    ?? (config.signal ? selfIssued.get(config.signal) : undefined);
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
 * @param ax 已安装取消插件的 axios 实例。
 * @param reason 取消原因。
 * @returns 本次中止的逻辑请求数量。
 * @example cancelAll(ax, '离开页面');
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
