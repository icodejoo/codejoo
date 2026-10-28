/**
 * 过渡垫片：旧 auth / retry 仍按 axios 请求配置读取 share、cache 两个开关。
 * 新的 mock / share / cache 只扩展 AxpRequestOptions，不再污染 axios 模块；
 * B3 重写 auth / retry 之后整份文件应删除。
 */
import type { AxiosRequestConfig } from "axios";

/** 旧 auth / retry 透传的两个开关；有这个导出，文件才是模块，下面的 declare module 才是增强而不是覆盖。 */
export type TLegacySourceSwitches = Pick<AxiosRequestConfig, "share" | "cache">;

declare module "axios" {
  interface AxiosRequestConfig {
    /** 仅供旧 auth / retry 透传，新管线不读取。 */
    share?: unknown;
    /** 仅供旧 auth / retry 透传，新管线不读取。 */
    cache?: unknown;
  }
}
