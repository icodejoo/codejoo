export type * from "./types"
export { create, default as Core } from "./core"

/* ── runtime model objects ─────────────────────────────────────────────── */
export { default as ApiResponse, ApiError } from "./objects/ApiResponse"
export { default as TokenManager } from "./objects/TokenManager"
export type { ITokenManager } from "./objects/TokenManager"

/* ── bundled plugins ───────────────────────────────────────────────────────
 * 每个插件文件还通过 `declare module 'axios'` 扩展了 AxiosRequestConfig
 * (cache / retry / share / key / loading / mock / filter ...)，从入口导出
 * 即保证这些请求级配置的类型增强一并生效。 */
export {
  default as auth,
  AuthFailureAction,
  authFailureFactory,
  DEFAULT_ON_AUTH_FAILURE,
  ACCESS_DENIED_CODE,
} from "./plugins/auth"
export type { IAuthOptions, TAuthFunc } from "./plugins/auth"

export { default as buildKey, $key } from "./plugins/build-key"
export type { IBuildKeyOptions, IBuildKeyObject, KeyOpts } from "./plugins/build-key"

export { default as cache, removeCache, clearCache } from "./plugins/cache"
export type { ICacheOptions } from "./plugins/cache"

export { default as cancel, cancelAll } from "./plugins/cancel"
export type { ICancelOptions } from "./plugins/cancel"

export { default as envs } from "./plugins/envs"
export type { IEnvRule, IEnvsOptions } from "./plugins/envs"

export { default as normalizeRequest } from "./plugins/normalize-request"
export type { INormalizeRequestOptions, TPredicate } from "./plugins/normalize-request"

export { default as loading } from "./plugins/loading"
export type { ILoadingOptions, TLoadingFunc } from "./plugins/loading"

export { default as mock } from "./plugins/mock"
export type { IMockOptions } from "./plugins/mock"

export { default as normalizeResponse } from "./plugins/normalize-response"
export type { INormalizeResponseOptions } from "./plugins/normalize-response"

export { default as repath } from "./plugins/repath"
export type { IRepathOptions } from "./plugins/repath"

export { default as retry } from "./plugins/retry"
export type { IRetryOptions, TIsException } from "./plugins/retry"

export { default as share } from "./plugins/share"
export type { ISharedOptions, SharePolicy } from "./plugins/share"
