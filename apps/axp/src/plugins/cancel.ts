
import type { Plugin } from '../types';
import { __DEV__ } from '../helper';
import type { AxiosInstance } from 'axios';


const name = 'cancel'

/** 每个 axios 实例对应的活跃 AbortController 集合 */
const instances = new WeakMap<AxiosInstance, Set<AbortController>>();


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
                    if (config.signal || config.cancelToken) return config;  // 用户自带，尊重
                    const ctrl = new AbortController();
                    config.signal = ctrl.signal;
                    (config as any)._cancelCtrl = ctrl;
                    set.add(ctrl);
                    return config;
                },
            );

            const release = (config: any) => {
                const ctrl = config?._cancelCtrl as AbortController | undefined;
                if (!ctrl) return;
                set.delete(ctrl);
                delete config._cancelCtrl;
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
