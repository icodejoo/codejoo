export interface IMockOptions {
    /** 插件级总开关；建议设为 `import.meta.env.DEV` 之类的编译期常量。默认 `false`。 */
    enable?: boolean;
    /** 默认是否 mock；为 `true` 时所有请求都走 mockUrl，除非请求级显式 `mock: false`。 */
    mock?: boolean;
    /** mock 服务器基地址 */
    mockUrl?: string;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * mock 配置：
         *   - `false`              → 不 mock（覆盖插件级）
         *   - `true`               → 启用，使用插件级 mockUrl
         *   - `{ mock?, mockUrl? }` → 自定义 mock url
         */
        mock?: boolean | { mock?: boolean; mockUrl?: string };
    }
}
