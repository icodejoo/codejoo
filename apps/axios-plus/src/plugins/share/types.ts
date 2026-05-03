import type { MaybeFunc } from '../../helper';


export type SharePolicy =
    | 'start'
    | 'end'
    | 'race'
    | 'none';


export interface ISharedOptions {
    /** 插件级总开关；默认 `true`。设为 `false` 时整个插件不安装。 */
    enable?: boolean;
    /** 默认共享策略；可由请求级 `config.share` 覆盖。默认 `'start'`。 */
    policy?: SharePolicy;
    /**
     * 允许参与共享的 HTTP method 白名单（大小写不敏感）。
     *   - 默认 `['get', 'head']` —— 仅幂等请求默认参与，避免 POST/PUT 因为同 key 被吞
     *   - 设为 `[]` 或 `undefined` ⇒ 不限制 method（向后兼容旧行为）
     * @default ['get', 'head']
     */
    methods?: string[];
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 共享策略（同 `config.key` 的并发请求如何处理）：
         *   - `false`           → 不共享（policy='none'）
         *   - `true` / 未指定    → 走插件级 `policy`
         *   - 字符串 policy      → 强制使用该策略
         *   - `{ policy }`       → 对象形式
         *   - 函数              → 动态返回上述任一形式
         */
        share?: MaybeFunc<SharePolicy | boolean | { policy?: SharePolicy }>;
    }
}
