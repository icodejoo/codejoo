export type TLoadingFunc = (visible: boolean) => any;


export interface ILoadingOptions {
    /** 插件级总开关；默认 `true`。设为 `false` 时整个插件不安装。 */
    enable?: boolean;
    /** loading 状态切换回调（兜底）：当请求级未指定函数时使用。 */
    loading?: TLoadingFunc;
    /**
     * 触发 `cb(true)` 前的延迟（毫秒）—— 请求在 `delay` 内返回则不闪一次 loading。
     *   - `0` / 未指定（默认）：原行为，立即触发
     *   - `> 0`：count 0→1 时启动 setTimeout；定时器触发前若所有请求都已结束则跳过 `cb(true)`
     * @default 0
     */
    delay?: number;
    /**
     * Min Display Time —— spinner 一旦显示就至少停留 `mdt` 毫秒，避免一闪即消的视觉抖动。
     *
     *   若可见时长 < `mdt`，延后到刚好 `mdt` 才 `cb(false)`；
     *   等待期内若有新请求进来则取消延后，spinner 持续显示
     *
     * 与 `delay` 配套使用 —— `delay` 滤掉快请求（不出现），`mdt` 给慢请求兜底（不闪）。
     * 行业惯用值：`delay: 200ms` + `mdt: 500ms`。
     * @default 500
     */
    mdt?: number;
    /**
     * 请求级 `config.loading` 未指定时的默认参与策略：
     *   - `false`（默认）⇒ 不参与（opt-in 模式：每个请求要显式 `loading: true` 才转圈）
     *   - `true`         ⇒ 参与全局计数（opt-out 模式：每个请求都转圈，需 `loading: false` 跳过）
     *
     * `config.loading` 是函数 / 显式布尔时此字段不生效。
     * @default false
     */
    default?: boolean;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 控制本请求的 loading 行为：
         *   - `false`                → 跳过本请求（不计数、不调用任何回调）
         *   - `true`                 → 参与**全局计数**，使用插件级回调（受 `delay` 影响）
         *   - `function`             → **独立执行**：立即 `fn(true)`、settle 后 `fn(false)`，
         *                             完全脱离全局计数与 `delay` 体系，互不干扰
         *   - 未指定                  → 走插件级 `default` 决定（默认 `false` ⇒ 跳过）
         */
        loading?: boolean | TLoadingFunc;
    }
}
