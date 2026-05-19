
import type { Plugin } from '../types';
import { __DEV__ } from '../helper';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';


const name = 'http-loading'

/**
 * 在请求生命周期内自动调用 `loading(true)` / `loading(false)` 控制加载提示。
 *
 *   - **适配器模式**：包装 `ctx.axios.defaults.adapter`（PluginManager 构造时已归一化为函数）
 *   - **全局单计数器**：所有参与请求共用一个 `count`：
 *       - `++count === 1` 触发 `fn(true)`
 *       - `--count === 0` 触发 `fn(false)`
 *     中间并发请求只对计数贡献，不重复 show/hide
 *   - **回调按请求解析**：`config.loading` 是函数时直接作为本请求的回调，`true`/未指定回退到
 *     插件级 `loading`，`false` 跳过该请求（不参与计数）
 *   - **插件级 `enable: false`** kill switch
 */
export default function httpLoading({ enable = true, loading }: ILoadingOptions = {}): Plugin {
    const defaults: ILoadingOptions = { loading };
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable} hasDefault:${!!loading}`);
            if (!enable) return;
            // PluginManager 构造时已把 defaults.adapter 归一化为函数，这里直接当 AxiosAdapter 用
            const prev = ctx.axios.defaults.adapter as AxiosAdapter;
            ctx.adapter($wrap(prev, defaults));
        },
    };
}


/**
 * 解析本次请求要使用的 loading 回调：
 *   - `config.loading === false` → null（跳过本请求）
 *   - `config.loading` 是函数 → 直接作为回调（请求级覆盖）
 *   - `config.loading === true` 或未指定 → 回退到插件级 `defaults.loading`
 *   - 都没有 → null
 *
 * @internal exported for unit tests
 */
export function $resolveLoading(
    config: AxiosRequestConfig,
    defaults: ILoadingOptions,
): TLoadingFunc | null {
    const v = config.loading;
    if (v === false) return null;
    if (typeof v === 'function') return v;
    return defaults.loading ?? null;
}


/**
 * 构造包装后的 adapter：闭包内维护一个 `count`，按计数边界触发 true/false。
 *   - count 0 → 1：调用本次请求解析出的 fn(true)
 *   - count 1 → 0：调用本次（最后一个）请求解析出的 fn(false)
 *   - 中间过程：仅加减计数器，不调用回调
 *   - 失败也经 finally 减计数器，loading 不会卡住
 *
 * 注：count 0→1 与 1→0 的 fn 来自不同请求时，可能出现"X 触发 true、Y 触发 false"。
 *     绝大多数场景下两者是同一个全局回调，因此对称；如确需严格对称，调用方应保持回调
 *     在所有相关请求中一致（或都让它走插件级默认）。
 *
 * @internal exported for unit tests
 */
export function $wrap(prev: AxiosAdapter, defaults: ILoadingOptions): AxiosAdapter {
    let count = 0;
    return (config) => {
        const fn = $resolveLoading(config, defaults);
        delete config.loading;
        if (!fn) return prev(config);
        if (++count === 1) fn(true);
        return prev(config).finally(() => {
            if (--count === 0) fn(false);
        });
    };
}


export type TLoadingFunc = (visible: boolean) => any;

export interface ILoadingOptions {
    /** 插件级总开关；默认 `true`。设为 `false` 时整个插件不安装。 */
    enable?: boolean;
    /** loading 状态切换回调（兜底）：当请求级未指定函数时使用。 */
    loading?: TLoadingFunc;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 控制本请求是否参与全局 loading 计数：
         *   - `false`     → 跳过本请求（不计数、不调用回调）
         *   - `true` 或未指定 → 参与，使用插件级回调
         *   - `function`  → 参与，使用此函数作为本请求的回调（覆盖插件级）
         */
        loading?: boolean | TLoadingFunc;
    }
}
