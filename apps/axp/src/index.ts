export type * from "./types";

/* ── 内核：客户端、响应、上下文、key ───────────────────────────────────────── */
export { createAxp } from "./client";

export { AXP_KINDS, AXP_RESPONSE, AxpResponse, axpResponse, isAxpResponse } from "./response";
export type {
  AxpKind,
  AxpResponseInit,
  IAxpEnvelope,
  IAxpResponse,
  IAxpResponseFactory,
  IAxpResponseOptions,
} from "./response";

export { stateKey } from "./context";
export type { AxpContext, AxpStateKey } from "./context";

export type { IKeyOptions } from "./key";

/* ── 令牌管理 ──────────────────────────────────────────────────────────────── */
export { default as TokenManager } from "./objects/TokenManager";
export type { ITokenManager } from "./objects/TokenManager";

/* ── 内置插件 ──────────────────────────────────────────────────────────────────
 * 每个插件文件还通过 `declare module "../types"` 扩展了 `AxpRequestOptions`
 * （loading / notify / repath / filter / retry / protected / mock / share / cache），
 * 从入口导出即保证这些请求级选项的类型增强一并生效。 */
export { default as axpLoading } from "./plugins/loading";
export type { ILoadingOptions, TLoadingFunc } from "./plugins/loading";

export { default as axpNotify } from "./plugins/notify";
export type { INotifyOptions } from "./plugins/notify";

export { default as axpRepath } from "./plugins/repath";
export type { IRepathOptions } from "./plugins/repath";

export { default as axpFilter } from "./plugins/filter";
export type { IFilterOptions, TPredicate } from "./plugins/filter";

export { default as axpEnvs } from "./plugins/envs";
export type { IEnvOptions, IEnvRule, IEnvsOptions } from "./plugins/envs";

export { default as axpRetry } from "./plugins/retry";
export type { IRetryOptions, TRetryDelay, TShouldRetry } from "./plugins/retry";
export type { TRetryJitter } from "./plugins/retry-timing";

export { default as axpAuth, AuthFailureAction, defaultAuthFailure } from "./plugins/auth";
export type { IAuthOptions, TAuthFunc } from "./plugins/auth";

export { default as axpMock } from "./plugins/mock";
export type { IMockOptions, IMockRequestOptions, TMockFallback } from "./plugins/mock";

export { default as axpShare } from "./plugins/share";
export type { ISharedOptions, ISharedRequestOptions, SharePolicy } from "./plugins/share";

export { default as axpCache, clearCache, removeCache } from "./plugins/cache";
export type {
  IAxpCacheEntry,
  IAxpCacheStore,
  ICacheApi,
  ICacheOptions,
  ICacheRequestOptions,
  TCloneStrategy,
} from "./plugins/cache";
