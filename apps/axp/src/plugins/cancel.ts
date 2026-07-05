
import type { Plugin } from '../types';
import { __DEV__ } from '../helper';
import { setInternal, getInternal, delInternal } from '../bag';
import type { AxiosInstance } from 'axios';


const name = 'cancel'

/** 每个 axios 实例对应的活跃 AbortController 集合 */
const instances = new WeakMap<AxiosInstance, Set<AbortController>>();

/** 标记"这个 signal 是本插件签发的"——`retry` 等插件用同一个 config 对象重发时，
 *  `config.signal` 这个可枚举字段会熬过 `mergeConfig`，但 Symbol bag 里的 controller 不会
 *  （已被上一次响应阶段 release 掉）。只看 `config.signal` 是否存在无法区分"用户自带"还是
 *  "本插件上一轮发的、已释放的"，会导致重发请求永远拿不到新 controller、脱离 cancelAll 追踪。
 *  用 signal 对象本身的身份做区分：命中这个 WeakSet → 本插件签发过，可以放心换发新的。 */
const selfIssued = new WeakSet<AbortSignal>();


/**
 * 取消请求插件：为每个未自带 `signal`/`cancelToken` 的请求自动注入 AbortController，
 * 并维护"该 axios 实例的活跃请求集合"——配合 `cancelAll(ax)` 可一次性中止所有在飞请求。
 *
 *   - 用户已显式提供 `config.signal` 或 `config.cancelToken` → **跳过**，尊重用户控制
 *   - 请求成功 / 失败 → 自动从集合移除（防止内存泄漏）
 *   - 插件 uninstall（cleanup）→ 清理 WeakMap 条目
 *
 * @example
 *   import cancel, { cancelAll } from './cancel';
 *   useAxiosPlugin(ax).use(cancel());
 *   // ...一段时间后想中止一切：
 *   cancelAll(ax, '用户切走了页面');
 */
export default function cancel({ enable = true }: ICancelOptions = {}): Plugin {
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable}`);
            if (!enable) return;
            const set = new Set<AbortController>();
            instances.set(ctx.axios, set);

            ctx.request(
                function $cancel(config) {
                    if (config.cancelToken) return config;  // 用户自带，尊重
                    // 有 signal 但不是本插件签发的 → 用户自带，尊重；是本插件签发的（含"上一轮
                    // 发过、已被 release 的"）→ 换发一个新的，重新纳入追踪
                    if (config.signal && !selfIssued.has(config.signal)) return config;
                    const ctrl = new AbortController();
                    config.signal = ctrl.signal;
                    selfIssued.add(ctrl.signal);
                    // 内部 controller 收进私有 bag（Symbol 键），不以可枚举字段污染 config
                    setInternal(config, 'cancelCtrl', ctrl);
                    set.add(ctrl);
                    return config;
                },
            );

            const release = (config: any) => {
                if (!config) return;
                const ctrl = getInternal<AbortController>(config, 'cancelCtrl');
                if (!ctrl) return;
                set.delete(ctrl);
                delInternal(config, 'cancelCtrl');
            };

            ctx.response(
                (response) => { release(response.config); return response; },
                (error: any) => { release(error?.config); return Promise.reject(error); },
            );

            ctx.cleanup(() => { instances.delete(ctx.axios); set.clear(); });
        },
    };
}


/**
 * 中止指定 axios 实例当前所有活跃请求。
 *   - 仅作用于通过 `cancel()` 插件注入的 controller；用户自带 signal 的请求不受影响
 *   - 调用后 set 被清空，新的请求会重新加入
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
    /** 插件级总开关；默认 `true`。 */
    enable?: boolean;
}
