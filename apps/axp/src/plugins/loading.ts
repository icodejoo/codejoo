
import type { Plugin } from '../types';
import { pluginLog } from '../helper';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';


const name = 'axp:loading'

/**
 * 在请求生命周期内自动调用 `loading(true)` / `loading(false)` 控制加载提示。
 *   - **适配器模式**：包装 `ctx.axios.defaults.adapter`（PluginManager 构造时已归一化为函数）
 *   - **全局单计数器**：所有参与请求共用一个 `count`：`++count===1` 触发显示，
 *     `--count===0` 触发隐藏；中间并发请求只贡献计数，不重复 show/hide
 *   - **`delay`/`delayClose` 防闪烁**：`delay`——0→1 后不立刻显示，等 `delay` ms，
 *     若期间计数已回落到 0（请求很快就结束了）则直接取消，从不显示；`delayClose`——
 *     1→0 后不立刻隐藏，等 `delayClose` ms，若期间又有新请求把计数顶回 1（紧接着的
 *     下一个请求），则取消这次隐藏，直接保持显示，避免两个连续请求之间闪一下。两者
 *     默认都是 0（即时显示/隐藏，行为跟老版本一致）
 *   - **回调/delay 按请求解析**：`config.loading` 是函数时直接作为本请求回调；对象
 *     形式可覆盖 `loading`/`delay`/`delayClose`/`enable`；`true`/未指定回退到插件级
 *     默认；`false` 或对象里 `enable:false` 跳过该请求（不参与计数）
 *   - **插件级 `enable: false`** kill switch
 *
 * Automatically calls `loading(true)`/`loading(false)` across a request's
 * lifecycle. All participating requests share one global counter — only the
 * 0→1 and 1→0 transitions trigger the callback; concurrent requests in
 * between just contribute to the count. `delay`/`delayClose` guard against
 * flicker: `delay` defers the show past a 0→1 edge, canceling it outright if
 * the count falls back to 0 before the delay elapses (a request that
 * finishes fast enough never shows loading at all); `delayClose` defers the
 * hide past a 1→0 edge, canceling it if a new request bumps the count back
 * to 1 before it elapses (back-to-back requests don't flicker the indicator
 * off and immediately back on). Both default to 0 (immediate show/hide,
 * matching the pre-existing behavior).
 *
 * @param options 插件配置：enable/loading/delay/delayClose / plugin config: enable/loading/delay/delayClose
 * @returns Plugin：install 时用 $wrap 包装 adapter 实现计数与回调触发，卸载还原 adapter / a Plugin wrapping the adapter via $wrap on install, restores the adapter on teardown
 */
export default function axpLoading({ enable = true, loading, delay = 0, delayClose = 0 }: ILoadingOptions = {}): Plugin {
    const defaults: ILoadingOptions = { loading, delay, delayClose };
    return {
        name,
        install(axios) {
            pluginLog(axios.defaults, `[${name}] enabled:${enable} hasDefault:${!!loading} delay:${delay} delayClose:${delayClose}`);
            if (!enable) return;
            // Core 构造时已把 defaults.adapter 归一化为函数，这里直接当 AxiosAdapter 用
            const prev = axios.defaults.adapter as AxiosAdapter;
            axios.defaults.adapter = $wrap(prev, defaults);
            return () => { axios.defaults.adapter = prev; };
        },
    };
}


/**
 * 单请求是否显式跳过：`loading: false`，或对象形式的 `loading: { enable: false }`。
 *
 * Whether this request is explicitly skipped: `loading: false`, or the
 * object form's `loading: { enable: false }`.
 *
 * @internal
 */
function $isSkipped(config: AxiosRequestConfig): boolean {
    const v = config.loading;
    if (v === false) return true;
    return typeof v === 'object' && v != null && v.enable === false;
}

/**
 * 解析本次请求要使用的 loading 回调：
 *   - `$isSkipped` → null（跳过本请求）
 *   - `config.loading` 是函数 → 直接作为回调（请求级覆盖）
 *   - `config.loading` 是对象且给了 `loading` 字段 → 用它
 *   - 否则回退到插件级 `defaults.loading`
 *
 * Resolves the loading callback for this request: skipped → null; a
 * function overrides per-request; an object form's `loading` field
 * overrides; otherwise falls back to the plugin-wide default.
 *
 * @internal exported for unit tests
 * @param config 请求配置 / the request config
 * @param defaults 插件级默认配置 / plugin-wide defaults
 * @returns 本次请求生效的回调，或 null 表示跳过 / the effective callback, or null meaning skipped
 */
export function $resolveLoading(
    config: AxiosRequestConfig,
    defaults: ILoadingOptions,
): TLoadingFunc | null {
    if ($isSkipped(config)) return null;
    const v = config.loading;
    if (typeof v === 'function') return v;
    if (typeof v === 'object' && v != null && typeof v.loading === 'function') return v.loading;
    return defaults.loading ?? null;
}

/** 解析 `delay`：请求级对象 > 插件级 > 0 / resolves `delay`: per-request object > plugin-level > 0. @internal exported for unit tests */
export function $resolveDelay(config: AxiosRequestConfig, defaults: ILoadingOptions): number {
    const v = config.loading;
    if (typeof v === 'object' && v != null && typeof v.delay === 'number') return v.delay;
    return defaults.delay ?? 0;
}

/** 解析 `delayClose`：请求级对象 > 插件级 > 0 / resolves `delayClose`: per-request object > plugin-level > 0. @internal exported for unit tests */
export function $resolveDelayClose(config: AxiosRequestConfig, defaults: ILoadingOptions): number {
    const v = config.loading;
    if (typeof v === 'object' && v != null && typeof v.delayClose === 'number') return v.delayClose;
    return defaults.delayClose ?? 0;
}


/**
 * 构造包装后的 adapter：闭包内维护一个 `count`，按计数边界触发 true/false；中间过程仅
 * 加减计数器，失败也经 finally 减计数器，loading 不会卡住。
 *
 * `delay`/`delayClose` 用两个可取消的 timer 实现：0→1 时若 `delay>0` 不立刻显示，
 * 排一个 timer；期间计数回落到 0（`showTimer` 还没触发）就直接清掉 timer，从不显示，
 * 也不需要隐藏。1→0 时若已经显示（`shown`）且 `delayClose>0`，排一个 timer 延后隐藏；
 * 期间新请求把计数顶回 1，就清掉这个 timer，保持显示状态不变。`delay`/`delayClose`
 * 取的是触发这次 0→1/1→0 边界的那次请求解析出的值——同插件此前就有的"跨边界回调可能
 * 不对称"的既有说明一致。
 *
 * 注：count 0→1 与 1→0 的 fn 来自不同请求时，可能出现"X 触发 true、Y 触发 false"。
 * 绝大多数场景下两者是同一个全局回调，因此对称；如确需严格对称，调用方应保持回调
 * 在所有相关请求中一致（或都让它走插件级默认）。
 *
 * Builds the wrapped adapter: a closure-scoped `count` triggers true/false only
 * at the 0→1/1→0 boundaries; decrements even on failure (via `finally`) so
 * loading never gets stuck.
 *
 * `delay`/`delayClose` are implemented via two cancelable timers: on a 0→1
 * edge, if `delay>0` the show is deferred behind a timer instead of firing
 * immediately; if the count falls back to 0 before that timer fires, it's
 * simply cleared — the indicator never shows and never needs to be hidden
 * either. On a 1→0 edge, if already shown and `delayClose>0`, the hide is
 * deferred behind a timer; if a new request bumps the count back to 1
 * before it fires, that timer is cleared and the indicator stays shown.
 * `delay`/`delayClose` are resolved from whichever request happens to
 * trigger that particular 0→1/1→0 edge — same pre-existing asymmetry note
 * as the callback itself (see below).
 *
 * Note: if the boundary-crossing requests used different callbacks, you
 * could see "X triggers true, Y triggers false" — in practice both are
 * usually the same global callback.
 *
 * @internal exported for unit tests
 * @param prev 原始 adapter / the original adapter
 * @param defaults 插件级默认配置 / plugin-wide defaults
 * @returns 包装后的 adapter / the wrapped adapter
 */
export function $wrap(prev: AxiosAdapter, defaults: ILoadingOptions): AxiosAdapter {
    let count = 0;
    let shown = false;
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    function clearShowTimer() {
        if (showTimer == null) return;
        clearTimeout(showTimer);
        showTimer = undefined;
    }
    function clearHideTimer() {
        if (hideTimer == null) return;
        clearTimeout(hideTimer);
        hideTimer = undefined;
    }

    return (config) => {
        const fn = $resolveLoading(config, defaults);
        const delay = $resolveDelay(config, defaults);
        const delayClose = $resolveDelayClose(config, defaults);
        delete config.loading;
        if (!fn) return prev(config);
        if (++count === 1) {
            // 被 delayClose 打断的隐藏窗口——保持之前的显示状态，不用重新走一遍 delay。
            clearHideTimer();
            if (!shown && !showTimer) {
                if (delay > 0) {
                    showTimer = setTimeout(() => {
                        showTimer = undefined;
                        shown = true;
                        fn(true);
                    }, delay);
                } else {
                    shown = true;
                    fn(true);
                }
            }
        }
        return prev(config).finally(() => {
            if (--count === 0) {
                if (showTimer) {
                    // 还没到显示的点请求就已经全部结束了，直接取消，从不显示。
                    clearShowTimer();
                    return;
                }
                if (!shown) return;
                if (delayClose > 0) {
                    hideTimer = setTimeout(() => {
                        hideTimer = undefined;
                        shown = false;
                        fn(false);
                    }, delayClose);
                } else {
                    shown = false;
                    fn(false);
                }
            }
        });
    };
}


/** loading 状态切换回调：visible 为 true 时显示，false 时隐藏 / the loading-state toggle callback: shows on true, hides on false */
export type TLoadingFunc = (visible: boolean) => any;

export interface ILoadingOptions {
    /** 插件级总开关；默认 true / plugin-wide kill switch; defaults to true */
    enable?: boolean;
    /** loading 状态切换回调（兜底）；请求级未指定函数时使用 / the toggle callback (fallback); used when no function is specified per-request */
    loading?: TLoadingFunc;
    /** 0→1 后延迟多久才真正显示，期间计数回落到 0 则从不显示；默认 0（即时显示） / how long to wait after a 0→1 edge before actually showing — canceled outright if the count falls back to 0 first; defaults to 0 (immediate). */
    delay?: number;
    /** 1→0 后延迟多久才真正隐藏，期间新请求把计数顶回 1 则取消隐藏；默认 0（即时隐藏） / how long to wait after a 1→0 edge before actually hiding — canceled if a new request bumps the count back to 1 first; defaults to 0 (immediate). */
    delayClose?: number;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 控制本请求是否参与全局 loading 计数：
         *   - `false` → 跳过本请求（不计数、不调用回调）
         *   - `true` 或未指定 → 参与，使用插件级默认（回调/delay/delayClose）
         *   - `function` → 参与，使用此函数作为本请求的回调（覆盖插件级 `loading`）
         *   - `ILoadingOptions` → 参与，按字段覆盖插件级默认（`loading`/`delay`/
         *     `delayClose`），`enable: false` 等价于顶层 `false`
         *
         * Whether this request participates in the global loading count:
         * `false` skips it; `true`/unspecified uses the plugin-wide defaults
         * (callback/delay/delayClose); a function overrides the callback for
         * this request only; an `ILoadingOptions` object overrides any of
         * `loading`/`delay`/`delayClose` per field (`enable: false` is
         * equivalent to the top-level `false`).
         */
        loading?: boolean | TLoadingFunc | ILoadingOptions;
    }
}
