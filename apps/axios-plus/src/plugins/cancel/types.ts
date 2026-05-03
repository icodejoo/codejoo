export interface ICancelOptions {
  /** 插件级总开关；默认 `true`。 */
  enable?: boolean;
}

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * 取消配置
     * `true`:可以被全局取消,
     * `false`:不可被取消
     * `null|undefined`:不设置，使用默认值
     * `string`:指定一个标识符，用于分组取消
     * `AbortController`:指定一个 AbortController 对象，手动管理取消
     * @default true
     */
    aborter?: string | AbortController | boolean | null;
  }
}
