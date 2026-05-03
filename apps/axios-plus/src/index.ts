/* Public barrel — only imports/exports, no logic. */

// ─── Core ─────────────────────────────────────────────────────────────────
export { create, default as Core } from "./core";
export type {
  Named,
  CoreOptions,
  ICommonOptions,
  IBaseOptions,
  IMethodOptions,
  IHttpOptions,
  HttpMethodLower,
  HttpPrototype,
} from "./core";

// ─── Plugin manager + plugin types ────────────────────────────────────────
export type {
  Plugin,
  PluginCleanup,
  PluginContext,
  PluginLogger,
  PluginRecord,
  IPluginCommonRequestOptions,
} from "./plugin";

// ─── Shared objects ───────────────────────────────────────────────────────
export { default as ApiResponse, ERR_CODES } from "./objects/ApiResponse";
export {
  default as StorageManager,
  resolveStorage,
} from "./objects/StorageManager";
export type {
  IStorageManagerOptions,
  IStorageOpOptions,
} from "./objects/StorageManager";
export { default as SimpleIndexDB } from "./objects/SimpleIndexDB";
export type { ISimpleIndexDBOptions } from "./objects/SimpleIndexDB";
export { default as LoopWrapper } from "./objects/LoopWrapper";
export type { ILoopWrapperOptions } from "./objects/LoopWrapper";
export { default as TokenManager } from "./objects/TokenManager";
export type { ITokenManager } from "./objects/TokenManager";

// ─── Cross-cutting helpers ────────────────────────────────────────────────
export {
  isRetry,
  RETRY_KEY,
  requirePlugin,
  __DEV__,
  asArray,
  Type,
  AuthFailureAction,
  ACCESS_DENIED_CODE,
  DEFAULT_ON_AUTH_FAILURE,
  authFailureFactory,
} from "./helper";
export type { Primitive, Falsy, MaybeFunc as MaybeFun } from "./helper";

// ─── Plugins —— 工厂函数全部 `xxxPlugin` 命名，避免与业务常用词撞名 ─────────
//
// `xxxPlugin` 是公开顶级 API，对应的 deep-import 路径仍是 `http-plugins/plugins/xxx`，
// 配套类型 / 工具函数（如 `removeCache` / `cancelAll`）保持原名 —— 它们不是插件本体。

export { default as keyPlugin } from "./plugins/key";
export type { IKeyOptions, IKeyObject } from "./plugins/key";

export { default as filterPlugin } from "./plugins/filter";
export type { IFilterOptions, TPredicate } from "./plugins/filter";

export {
  default as normalizePlugin,
  NETWORK_ERR_CODE,
} from "./plugins/normalize";
export type {
  INormalizeOptions,
  IBizTriple,
  TBizField,
  TSuccess,
} from "./plugins/normalize";

export {
  default as cachePlugin,
  removeCache,
  clearCache,
} from "./plugins/cache";
export type {
  ICacheOptions,
  ICacheStorage,
  TCacheStorage,
  TCacheGiver,
  ICacheEntry,
} from "./plugins/cache";

export { default as cancelPlugin, cancelAll } from "./plugins/cancel";
export type { ICancelOptions } from "./plugins/cancel";

export { default as envsPlugin } from "./plugins/envs";
export type { IEnvRule, IEnvsOptions } from "./plugins/envs";

export { default as loadingPlugin } from "./plugins/loading";
export type { ILoadingOptions, TLoadingFunc } from "./plugins/loading";

export { default as mockPlugin } from "./plugins/mock";
export type { IMockOptions } from "./plugins/mock";

export { default as reurlPlugin } from "./plugins/reurl";
export type { IReurlOptions } from "./plugins/reurl";

export { default as retryPlugin } from "./plugins/retry";
export type {
  IRetryOptions,
  IRetryHookCtx,
  TShouldRetry,
  TBeforeRetry,
} from "./plugins/retry";

export { default as sharePlugin } from "./plugins/share";
export type { ISharedOptions, SharePolicy } from "./plugins/share";

export { default as notificationPlugin } from "./plugins/notification";
export type {
  INotificationOptions,
  INotificationMessages,
  INotifyHookCtx,
  INotifyResolveCtx,
  TNotifyFn,
  TNotifyMessage,
} from "./plugins/notification";

export { default as rethrowPlugin } from "./plugins/rethrow";
export type {
  IRethrowOptions,
  TShouldRethrow,
  TRethrowTransform,
} from "./plugins/rethrow";

export { default as authPlugin } from "./plugins/auth";
export type { IAuthOptions, TAuthFunc } from "./plugins/auth";

export { default as concurrencyPlugin } from "./plugins/concurrency";
export type { IConcurrencyOptions } from "./plugins/concurrency";
