export type * from "./types"
export { default as Core } from "./core"
export { Axp } from "./install"
export type { AxpPlugins, AxpHandle } from "./install"
export { pluginLog, pluginWarn, pluginError } from "./helper"
export type { LoggableSource } from "./helper"

/* ── runtime model objects ─────────────────────────────────────────────── */
export { default as AxpResponse, AxpError as ApiError } from "./objects/Response"
export { default as TokenManager } from "./objects/TokenManager"
export type { ITokenManager } from "./objects/TokenManager"

/* ── bundled plugins ───────────────────────────────────────────────────────
 * 每个插件文件还通过 `declare module 'axios'` 扩展了 AxiosRequestConfig
 * (cache / retry / share / key / loading / mock / filter ...)，从入口导出
 * 即保证这些请求级配置的类型增强一并生效。 */
export {
  default as axpAuth,
  AuthFailureAction,
  authFailureFactory,
  DEFAULT_ON_AUTH_FAILURE,
  ACCESS_DENIED_CODE,
} from "./plugins/auth"

export type { IAuthOptions, TAuthFunc } from "./plugins/auth"

export { default as axpKey, $key } from "./plugins/key"
export type { IKeyOptions, IKeyObject, KeyOpts } from "./plugins/key"

export { default as axpCache, removeCache, clearCache } from "./plugins/cache"
export type { ICacheOptions } from "./plugins/cache"

export { default as axpCancel, cancelAll } from "./plugins/cancel"
export type { ICancelOptions } from "./plugins/cancel"

export { default as axpEnvs } from "./plugins/envs"
export type { IEnvRule, IEnvsOptions } from "./plugins/envs"

export { default as axpFilter } from "./plugins/filter"
export type { IFilterOptions, TPredicate } from "./plugins/filter"

export { default as axpLoading } from "./plugins/loading"
export type { ILoadingOptions, TLoadingFunc } from "./plugins/loading"

export { default as axpLogger } from "./plugins/logger"
export type { ILoggerOptions } from "./plugins/logger"

export { default as axpMock } from "./plugins/mock"
export type { IMockOptions } from "./plugins/mock"

export { default as axpNormalize } from "./plugins/normalize"
export type { INormalizeOptions } from "./plugins/normalize"

export { default as axpNotify } from "./plugins/notify"
export type { INotifyOptions } from "./plugins/notify"

export { default as axpRepath } from "./plugins/repath"
export type { IRepathOptions } from "./plugins/repath"

export { default as axpRetry } from "./plugins/retry"
export type { IRetryOptions, TShouldRetry, TRetryDelay } from "./plugins/retry"

export { default as axpShare } from "./plugins/share"
export type { ISharedOptions, SharePolicy } from "./plugins/share"
