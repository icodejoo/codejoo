export interface IConcurrencyOptions {
    /** 插件级总开关；默认 `true`。`false` ⇒ 跳过 install，所有请求直接放行 */
    enable?: boolean;
    /**
     * 最大并发数。超过则进入 FIFO 队列等待空闲槽位。
     *   - `<= 0` ⇒ 不限制（等同 `enable: false`）
     * @default 6
     */
    max?: number;
    /**
     * 参与并发控制的 method 白名单（不区分大小写）。
     *   - `'*'` / `['*']` / `[]` / `undefined` ⇒ 不限制（所有方法都参与）
     *   - 其余 method 直接放行，不入队
     * @default '*'
     */
    methods?: string[] | '*';
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 请求级 bypass：
         *   - `false` ⇒ 跳过排队直接放行，不计入并发
         *   - `true` / 未指定 ⇒ 按插件配置走（参与并发控制）
         */
        concurrency?: boolean;
        /**
         * 请求优先级 —— **仅在排队时生效**（active < max 直接取槽位，priority 无影响）。
         *   - 数值越大越优先派发；同优先级保持 FIFO
         *   - 默认 `0`
         */
        priority?: number;
    }
}
