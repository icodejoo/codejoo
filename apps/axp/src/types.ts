import type { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig, Method } from "axios";
import type AxpResponse from "./objects/Response";

/* ═══════════════════════════════════════════════════════════════════════════
 *  Plugin system
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 插件从 `install` 返回的拆卸函数，调用它撤销该插件注册的一切（拦截器/adapter 包装/定时器……）；无需拆卸可不返回。
 *
 *  Cleanup a plugin may return from `install`; calling it undoes everything that plugin registered (interceptors/adapter wrapping/timers/...); may be omitted if nothing to undo. */
export type PluginCleanup = () => void;

/** 插件可用的日志接口，通常挂在 `axios.defaults.logger` 上供 `pluginLog` 之类的工具读取。
 *
 *  Logging interface plugins can use, typically hung off `axios.defaults.logger` for utilities like `pluginLog` to read. */
export interface PluginLogger {
  /** 普通日志。 Regular log. */
  log(...args: unknown[]): void;
  /** 警告级别。 Warning level. */
  warn(...args: unknown[]): void;
  /** 错误级别。 Error level. */
  error(...args: unknown[]): void;
}

/**
 * 插件是独立的——直接与 `axios` 打交道（自己的拦截器/adapter 包装/状态），像 dioman 的 `DiomanPlugin` 直接与 `Dio` 打交道一样，没有共享编排器跟踪注册内容；需要拆卸的插件从 `install` 返回自己的 cleanup 闭包。`Axp.install` 只是按顺序调用每个插件的 `install(axios)` 并收集 cleanup。
 *
 * A plugin is independent — it talks to `axios` directly (own interceptors/adapter wrapping/state), like dioman's `DiomanPlugin` talks to `Dio` directly, with no shared orchestrator; a plugin needing teardown returns its own cleanup closure from `install`. `Axp.install` just calls each plugin's `install(axios)` in order and collects the cleanups.
 */
export interface Plugin {
  /** 唯一标识，用于在 `AxpHandle` 中按名称查找。 / Unique id, used for lookup in `AxpHandle`. */
  name: string;

  /** 把插件接到 `axios` 上；顺序由调用方负责，无优先级字段。axios 原生语义：request 拦截器 LIFO，response 拦截器 FIFO。返回 `PluginCleanup` 以撤销注册；无需撤销可不返回。
   *
   *  Wires the plugin onto `axios`; order is the caller's responsibility, no priority field. axios native semantics: request interceptors LIFO, response FIFO. Return a `PluginCleanup` to undo registration; omit if nothing to undo. */
  install(axios: AxiosInstance): PluginCleanup | void;
}

/** `Core` 构造函数的选项。 / `Core` constructor options. */
export interface CoreOptions extends ICommonOptions {}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Plugin runtime options (consumed inside interceptors / dispatch)
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 内部日志回调形状，被 `IInnerOptions._logger` 使用。 / Internal logging-callback shape, used by `IInnerOptions._logger`. */
type HttpLogger = (config: IInnerOptions) => void;

/** 公共选项的占位/扩展点，供 `CoreOptions` 等扩展共享字段；目前未定义任何字段。
 *
 *  Placeholder/extension point for options common to everything; no fields defined yet. */
export interface ICommonOptions {}

/** 插件通用的请求前/后钩子形状。 / Shape for plugin-common before/after-request hooks. */
export interface IPluginCommonRequestOptions {
  /** 请求发出前的钩子。 Hook before the request is sent. */
  before?(config: InternalAxiosRequestConfig): any;
  /** 请求发出后的钩子。 Hook after the request is sent. */
  after?(config: InternalAxiosRequestConfig): any;
}

/** 插件通用的响应前/后钩子形状（字段目前均为占位，未启用）。
 *
 *  Shape for plugin-common before/after-response hooks (fields currently reserved, unused). */
export interface IPluginCommonResponseOptions {
  // before?(response): any
  // after?(config: HttpInternalRequestConfig): any
}

/** 直接复用 axios 请求配置的基础选项类型。 / Base options type that simply reuses axios's own request config. */
export interface IBaseOptions extends AxiosRequestConfig {}

/** 单次方法调用（`get`/`post`/...）可接受的选项。 / Options accepted by a single method call (`get`/`post`/...). */
export interface IMethodOptions extends IBaseOptions {
  // loading 等插件选项继承 AxiosRequestConfig 的增强，保留对象与函数写法。
  /** 是否静默处理（如跳过 notify 提示）。 Whether to handle silently (e.g. skip the notify toast). */
  silent?: boolean;
  // `retry` 继承自 AxiosRequestConfig（由 plugins/retry.ts 的 `declare module 'axios'` 扩展），不在此重复声明。
  // `retry` is inherited from AxiosRequestConfig (augmented by plugins/retry.ts's `declare module 'axios'`); not redeclared here.
}

/** `dispatch` 实际接受的完整配置——`IMethodOptions` 之上叠加控制返回形态的标志。
 *
 *  The full config `dispatch` accepts — `IMethodOptions` plus flags controlling the returned shape. */
export interface IHttpOptions extends IMethodOptions, ICommonOptions {
  /** 允许响应数据为 `null`/`undefined`。 Allows the response data to be `null`/`undefined`. */
  nullable?: boolean;
  /** 令 `dispatch` 返回 `AxpResponse` 包装形态而非解包数据。 Makes `dispatch` return the `AxpResponse`-wrapped shape instead of unwrapped data. */
  wrap?: boolean;
  /** 令 `dispatch` 返回原始信封 `{ code, data, message }`。 Makes `dispatch` return the raw envelope `{ code, data, message }`. */
  raw?: boolean;
}

/** 拦截器/插件内部读取的运行期选项（调试开关 + 日志回调）。
 *
 *  Runtime options read internally by interceptors/plugins (debug flag + logging callback). */
export interface IInnerOptions {
  /** 是否开启调试日志。 Whether debug logging is enabled. */
  _debug?: boolean;
  /** 实际使用的日志回调。 The logging callback actually used. */
  _logger: HttpLogger;
}

/** `normalize` 插件的运行时选项。 / Runtime options for the `normalize` plugin. */
export interface NormalizeOptions {
  /** 是否启用归一化。 Whether normalization is enabled. */
  enable?: boolean;
  /** 判断某响应是否应被归一化的谓词。 Predicate deciding whether a response should be normalized. */
  predicate?(data: any, config: IHttpOptions): boolean;
}

/** 附带 `key` 插件写入的请求指纹字段的内部请求配置。
 *
 *  Internal request config carrying the request-fingerprint field written by the `key` plugin. */
export interface HttpInternalRequestConfig extends InternalAxiosRequestConfig {
  /** `key` 插件计算出的请求指纹，未计算时为 `undefined`。 Request fingerprint computed by the `key` plugin; `undefined` if not yet computed. */
  key: string | undefined;
}

/* ═════════════════════════════════════════════════════════════════════════════
 *  HttpPrototype — single entry-point used by `Core<T>`.
 *
 *      class Core<T = unknown> implements HttpPrototype<T> { ... }
 *
 *  把匹配 `MethodSchema` 形状的任意 schema 传入泛型，即可拿到完整的
 *  `{ get, post, put, ... }` 分发形态，并内建路径/请求体/响应推断。axp
 *  只检查 `T` 的结构性形状，不要求任何具名/全局类型；`T` 从哪来（手写、
 *  codegen、`@codejoo/openapi2lang` 生成……）由你决定。`Core<unknown>`
 *  （默认）把所有路径放宽为 `string`。此行以下均为该唯一导出项的私有实现。
 *
 *  期望的 schema 形状——方法优先、静态预展开：
 *      { [method]: { [path]: [response: R, request: [payload: P] | []] } }
 *
 *  面向 IDE 性能的设计：不做类型层面反转（`T[Mt][P]` 是 O(1) 字面量键访问，
 *  反转由你的 codegen/手写过程提前一次性完成）；`[X] extends [Y]` 非分布式
 *  写法防止联合类型扇出；字面量 `P` 在 wrap 处捕获一次并在三个
 *  `HttpDispatch` 重载间复用；重载按 raw → wrap → plain 排序，让约束最强
 *  的签名最先尝试。
 *
 *  Pass ANY schema shaped like `MethodSchema` below as the generic and get
 *  back the full `{ get, post, put, ... }` shape with path/payload/response
 *  inference baked in. axp only checks the STRUCTURAL shape of `T` — no
 *  required global namespace or named type; where `T` comes from
 *  (hand-written, your own codegen, `@codejoo/openapi2lang`'s emitted
 *  type, ...) is up to you. `Core<unknown>` (the default) relaxes every
 *  path to `string`. Everything below this line is a private
 *  implementation detail of that single export.
 *
 *  Expected schema shape — method-major, statically pre-expanded:
 *      { [method]: { [path]: [response: R, request: [payload: P] | []] } }
 *
 *  IDE-perf choices: no type-level inversion (`T[Mt][P]` is a direct O(1)
 *  literal-key access; your codegen/hand-authoring did the inversion once,
 *  ahead of time); `[X] extends [Y]` non-distributive guards prevent
 *  fan-out on unions; literal `P` is captured once on the wrap and reused
 *  across all three `HttpDispatch` overloads; the overload list is ordered
 *  raw → wrap → plain so the most flag-constrained signature is tried
 *  first.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 方法优先 schema 的结构示意；内部按 schema 的实际键验证，不要求接口具有索引签名。不匹配时（包括默认值 `unknown`）回退成 `string` 路径与原样传递类型。
 *
 *  Structural shape a method-major schema must match to enable inference — a plain shape check, no named/global type reference. Falls back to `string` paths and passthrough types when it doesn't match (including the default `unknown`). */
export type MethodSchema = {
  [method: string]: {
    [path: string]: readonly [response: unknown, request: unknown];
  };
};

/** 小写化的 `Method` 字面量；导出是为了让调用方需要时遍历同一套键集合（如构建运行期 map）。
 *
 *  Lower-cased `Method` literals; exposed so callers can iterate the same key set if needed (e.g. building a runtime map). */
export type HttpMethodLower = Lowercase<Method>;

/** `Core<T>` 使用的唯一辅助类型，把 `T` 展开成完整的 `{ get, post, put, ... }` 分发形态。
 *
 *  The single helper `Core<T>` uses, expanding `T` into the full `{ get, post, put, ... }` dispatch shape. */
export type HttpPrototype<T> = {
  [K in HttpMethodLower]: HttpWrap<T, K>;
};

/* ─── private helpers (not exported) ──────────────────────────────────────── */

/** 按实际方法与路径键校验元组，不要求 interface 声明字符串索引签名。 */
type SchemaShape<T> = {
  [Mt in keyof T]: {
    [P in keyof T[Mt]]: readonly [response: unknown, request: readonly [] | readonly [unknown]];
  };
};

/** 默认 unknown/any 保持宽松，其余对象按实际键验证方法优先结构。 */
type IsMethodSchema<T> = unknown extends T
  ? false
  : [T] extends [object & SchemaShape<T>]
    ? true
    : false;

/* `T` 是匹配 `SchemaShape<T>` 的方法优先 schema；按已有键检查结构后，每次查找均使用 `T[Mt][P]`，无需反转路径与方法。
 *
 * `T` is a method-major schema matching `MethodSchema`; whoever built it already did the path-major→method-major inversion, so every lookup here is a direct literal-key access `T[Mt][P]` — no mapped/conditional fan-out at type-check time. */

/** 严格路径：只允许该方法下真实存在的 key。未列出的 URL 是编译错误；本地扩展可继承方法优先 schema，不匹配时放宽为 `string`。
 *
 *  Strict path: only keys present under that method. Unlisted URLs are a compile error — extend via a local `.d.ts` declaration merge; relaxes to `string` when `T` doesn't match `MethodSchema`. */
type LoosePath<T, Mt extends HttpMethodLower> =
  IsMethodSchema<T> extends true ? (Mt extends keyof T ? keyof T[Mt] : never) : string;

/** 某 path/method 对应的 `[response, request]` 元组，或 `never`；O(1) 字面量查找。
 *
 *  `[response, request]` tuple for a path/method, or `never`; O(1) literal lookup. */
type EntryFor<T, Mt extends HttpMethodLower, P> =
  IsMethodSchema<T> extends true
    ? Mt extends keyof T
      ? P extends keyof T[Mt]
        ? T[Mt][P]
        : never
      : never
    : never;

/** 从 `EntryFor` 取出响应类型 `R`，取不到回退 `unknown`。 / Extracts response type `R` from `EntryFor`, falls back to `unknown`. */
type ResponseFor<T, Mt extends HttpMethodLower, P> =
  EntryFor<T, Mt, P> extends readonly [infer R, ...unknown[]] ? R : unknown;

/** 从 `EntryFor` 取出请求体类型；空 `request: []` 表示无请求体（解析为 `undefined`），其余回退 `unknown`。
 *
 *  Extracts payload type from `EntryFor`; empty `request: []` means no payload (resolves to `undefined`), else falls back to `unknown`. */
type PayloadFor<T, Mt extends HttpMethodLower, P> =
  EntryFor<T, Mt, P> extends readonly [unknown, infer Req]
    ? Req extends readonly [infer Pl, ...unknown[]]
      ? Pl
      : Req extends readonly []
        ? undefined
        : unknown
    : unknown;

/** 泛型仍是默认值 `unknown`/`any` 时为真。 / True when the generic was left at its `unknown`/`any` default. */
type IsLoose<T> = unknown extends T ? true : false;

/** 解析后的请求体类型——显式 `Q` 优先，否则从 schema 推断，否则原样传递。
 *
 *  Resolved payload — explicit `Q` wins, else infer from schema, else passthrough. */
type ResolvePayload<T, Mt extends HttpMethodLower, P, Q> =
  IsLoose<Q> extends true ? ([EntryFor<T, Mt, P>] extends [never] ? Q : PayloadFor<T, Mt, P>) : Q;

/** 解析后的响应类型——显式 `R` 优先，否则从 schema 推断，否则原样传递。
 *
 *  Resolved response — explicit `R` wins, else infer from schema, else passthrough. */
type ResolveResponse<T, Mt extends HttpMethodLower, P, R> =
  IsLoose<R> extends true ? ([EntryFor<T, Mt, P>] extends [never] ? R : ResponseFor<T, Mt, P>) : R;

/** 元组构造器，使请求体可必填、可选，或 `any` 原样传递。 / Tuple builder so a payload can be required, optional, or `any`-passthrough. */
type Payload<Q, Rest extends unknown[]> = 0 extends 1 & Q
  ? [payload: Q, ...Rest] // Q = any → required
  : unknown extends Q
    ? [payload?: unknown, ...Rest] // Q = unknown (default) → optional
    : [Q] extends [undefined | void]
      ? [payload?: undefined, ...Rest] // empty `request: []` → no payload
      : [payload: Q, ...Rest]; // Q = concrete → required

/** 三路重载分发：raw / wrap / plain。 / Three-way overloaded dispatch: raw / wrap / plain. */
interface HttpDispatch<T, Mt extends HttpMethodLower, P> {
  <R = unknown, Q = unknown>(
    ...args: Payload<ResolvePayload<T, Mt, P, NoInfer<Q>>, [config: IHttpOptions & { raw: true }]>
  ): Promise<{
    code: number | string;
    data: ResolveResponse<T, Mt, P, R>;
    message?: string;
  }>;
  <R = unknown, Q = unknown>(
    ...args: Payload<ResolvePayload<T, Mt, P, NoInfer<Q>>, [config: IHttpOptions & { wrap: true }]>
  ): Promise<AxpResponse<ResolveResponse<T, Mt, P, R>>>;
  <R = unknown, Q = unknown>(
    ...args: Payload<ResolvePayload<T, Mt, P, NoInfer<Q>>, [config?: IHttpOptions]>
  ): Promise<ResolveResponse<T, Mt, P, R>>;
}

/** 单个 verb 对应的函数；`<P extends ...>` 保留字面量类型以传播到 `HttpDispatch`，让 payload/response 每个调用点只解析一次。
 *
 *  Per-verb function; `<P extends ...>` preserves the literal so it propagates into `HttpDispatch`, resolving payload/response once per call site. */
type HttpWrap<T, Mt extends HttpMethodLower> = <P extends LoosePath<T, Mt>>(
  path: P,
  config?: IMethodOptions,
) => HttpDispatch<T, Mt, P>;

/** 原始值类型的联合，各插件/工具用来判断"是否原始值"的基准类型。
 *
 *  Union of primitive types, the baseline various plugins/helpers use to check "is this a primitive". */
export type Primitive = string | number | boolean | symbol | bigint | undefined | null;

/** 可以是值本身，也可以是根据当前 axios 配置计算该值的函数——让配置项既支持静态值也支持动态求值。
 *
 *  Either the value itself, or a function computing it from the current axios config — lets an option accept a static or dynamically evaluated value. */
export type MaybeFun<T> = T | ((config: AxiosRequestConfig) => T);

/** 虚值。 Falsy value. */
export type Falsy = false | "" | null | undefined;

/* 洋葱管线类型；旧类型保持原样，B6 再切换公共入口。 */
import type { AxpContext } from "./context";
import type {
  IAxpResponse,
  IAxpResponseFactory,
  AxpResponse as PipelineResponse,
} from "./response";
import type { IKeyOptions } from "./key";
import type { STAGE_BUILTINS } from "./stages";

/** 管线日志接口。 */
export interface AxpLogger extends PluginLogger {}
/** 可由插件模块扩展的请求选项。 */
export interface AxpRequestOptions {
  /** 成功也返回响应对象。 */
  wrap?: boolean;
  /** false 时可预期失败也返回响应。 */
  throws?: boolean;
  /** 跳过通知。 */
  silent?: boolean;
  /** 显式 key 或关闭 key；省略时惰性计算。 */
  key?: string | false;
  /** 用户的逻辑请求取消信号。 */
  signal?: AbortSignal;
}
/** 排除旧 axios 模块增强字段，只保留 axios 原生字段。 */
type TAxpAxiosConfig = Pick<
  AxiosRequestConfig,
  | "url"
  | "method"
  | "baseURL"
  | "allowAbsoluteUrls"
  | "transformRequest"
  | "transformResponse"
  | "headers"
  | "params"
  | "paramsSerializer"
  | "data"
  | "timeout"
  | "timeoutErrorMessage"
  | "withCredentials"
  | "adapter"
  | "auth"
  | "responseType"
  | "responseEncoding"
  | "xsrfCookieName"
  | "xsrfHeaderName"
  | "onUploadProgress"
  | "onDownloadProgress"
  | "maxContentLength"
  | "validateStatus"
  | "maxBodyLength"
  | "maxRedirects"
  | "maxRate"
  | "beforeRedirect"
  | "socketPath"
  | "httpAgent"
  | "httpsAgent"
  | "proxy"
  | "decompress"
  | "transitional"
  | "insecureHTTPParser"
  | "env"
  | "formSerializer"
  | "family"
  | "lookup"
  | "withXSRFToken"
  | "fetchOptions"
  | "allowedSocketPaths"
  | "transport"
  | "parseReviver"
  | "httpVersion"
  | "http2Options"
  | "formDataHeaderPolicy"
  | "redact"
  | "sensitiveHeaders"
>;
/** 新请求配置不接受旧 cancelToken 或旧插件字段。 */
export type AxpRequestConfig = TAxpAxiosConfig & AxpRequestOptions;
/** 请求补丁；undefined 删除字段，headers 再合并一层。 */
export type AxpRequestPatch = { [K in keyof AxpRequestConfig]?: AxpRequestConfig[K] | undefined };
/** 保留扩展响应字段并替换接口数据类型。 */
export type WithData<R, D> = Omit<R, "data"> & { /** 当前接口的业务数据。 */ readonly data: D };
/** 从外到内的固定阶段。 */
export type AxpStage = keyof typeof STAGE_BUILTINS;
/** next 永远 resolve，程序异常临时归类为 internal。 */
export type AxpNext<R extends IAxpResponse = IAxpResponse> = (
  patch?: AxpRequestPatch,
) => Promise<R>;
/** 请求不可变的洋葱中间件。 */
export type AxpMiddleware<R extends IAxpResponse = IAxpResponse> = (
  ctx: AxpContext<R>,
  next: AxpNext<R>,
) => Promise<R>;
/** 一个独立参与排序的请求/响应挂载段。 */
export interface AxpTap<R extends IAxpResponse = IAxpResponse> {
  /** 挂载阶段。 */
  stage: AxpStage;
  /** 自定义段默认在内置段之后。 */
  enforce?: "pre" | "post";
  /** 可返回传给内层的补丁。 */
  onRequest?(ctx: AxpContext<R>): void | AxpRequestPatch | Promise<void | AxpRequestPatch>;
  /** 可替换内层响应。 */
  onResponse?(response: R, ctx: AxpContext<R>): void | R | Promise<void | R>;
}
/** 每个客户端独立的插件实例。 */
export interface AxpPluginInstance<R extends IAxpResponse = IAxpResponse, A = void> {
  /** 有状态中间件。 */
  handle?: AxpMiddleware<R>;
  /** 有状态挂载段。 */
  taps?: readonly AxpTap<R>[];
  /** 插件暴露的管理能力。 */
  api?: A;
  /** 卸载或客户端销毁时清理。 */
  dispose?(): void;
}
/** 具名插件，状态必须在 setup 中建立以支持 extend。
 * @example `{ name: 'timing', async handle(ctx, next) { return next() } }`
 */
export interface AxpPlugin<R extends IAxpResponse = IAxpResponse, A = void> {
  /** 客户端内唯一名称。 */
  readonly name: string;
  /** false 时不 setup、不进链。 */
  readonly enable?: boolean;
  /** 默认 attempt，内置名称使用固定阶段。 */
  readonly stage?: AxpStage;
  /** 自定义插件默认 post。 */
  readonly enforce?: "pre" | "post";
  /** 每客户端装载一次。 */
  setup?(client: AxpClient<unknown, R>): AxpPluginInstance<R, A> | void;
  /** 无状态中间件。 */
  handle?: AxpMiddleware<R>;
  /** 无状态挂载段。 */
  taps?: readonly AxpTap<R>[];
}
/** 新客户端的共同选项。 */
interface IAxpBaseOptions<R extends IAxpResponse> {
  /** 使用现有实例，省略时创建新实例。 */
  axios?: AxiosInstance;
  /** 初始化插件列表。 */
  plugins?: readonly AxpPlugin<R, any>[];
  /** key 服务选项。 */
  key?: IKeyOptions;
  /** 仅转换即将抛出的可预期失败。 */
  reject?: (response: R) => unknown;
  /** 日志与调用点捕获。 */
  debug?: boolean | AxpLogger;
}
/** 判断是否为默认响应的结构类型。 */
export type TAxpDefaultResponse<R> = [R] extends [PipelineResponse]
  ? [PipelineResponse] extends [R]
    ? true
    : false
  : false;
/** 默认响应可省略选项，自定义响应必须提供完整选项。 */
export type TAxpArgs<R, O> = TAxpDefaultResponse<R> extends true ? [options?: O] : [options: O];
/** 自定义响应必须显式提供匹配的工厂。 */
export type AxpOptions<R extends IAxpResponse = PipelineResponse> = IAxpBaseOptions<R> &
  (TAxpDefaultResponse<R> extends true
    ? { /** 默认响应工厂。 */ response?: IAxpResponseFactory<R> }
    : { /** 自定义响应工厂。 */ response: IAxpResponseFactory<R> });
/** 根据选项决定返回形态。 */
type TAxpResult<R extends IAxpResponse, D, O> = O extends { wrap: true } | { throws: false }
  ? WithData<R, D>
  : D;
/** 新动词的调用签名，沿用原有 Schema 查表和 NoInfer。 */
type TAxpDispatchArgs<S, Mt extends HttpMethodLower, P, Q, C extends unknown[]> = Payload<
  ResolvePayload<S, Mt, P, NoInfer<Q>>,
  C
>;
/** 按调用级有效开关选择返回形态的动词签名。 */
interface IAxpDispatch<S, Mt extends HttpMethodLower, P, R extends IAxpResponse, O> {
  /** 调用级明确包装或关闭抛错时返回响应。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<
      S,
      Mt,
      P,
      Q,
      [config: AxpRequestConfig & ({ wrap: true } | { throws: false })]
    >
  ): Promise<WithData<R, ResolveResponse<S, Mt, P, D>>>;
  /** 调用级同时关闭包装并开启抛错时返回数据。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<
      S,
      Mt,
      P,
      Q,
      [
        config: AxpRequestConfig & {
          /** 调用级关闭包装。 */ wrap: false;
          /** 调用级开启抛错。 */ throws: true;
        },
      ]
    >
  ): Promise<ResolveResponse<S, Mt, P, D>>;
  /** 调用级覆盖包装，抛错开关继承方法配置。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<
      S,
      Mt,
      P,
      Q,
      [
        config: AxpRequestConfig & {
          /** 调用级关闭包装。 */ wrap: false;
          /** 缺省时继承方法级。 */ throws?: undefined;
        },
      ]
    >
  ): Promise<
    TAxpResult<
      R,
      ResolveResponse<S, Mt, P, D>,
      Omit<O, "wrap"> & { /** 有效包装值。 */ wrap: false }
    >
  >;
  /** 调用级覆盖抛错，包装开关继承方法配置。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<
      S,
      Mt,
      P,
      Q,
      [
        config: AxpRequestConfig & {
          /** 缺省时继承方法级。 */ wrap?: undefined;
          /** 调用级开启抛错。 */ throws: true;
        },
      ]
    >
  ): Promise<
    TAxpResult<
      R,
      ResolveResponse<S, Mt, P, D>,
      Omit<O, "throws"> & { /** 有效抛错值。 */ throws: true }
    >
  >;
  /** 未覆盖开关时根据方法配置决定返回形态。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<S, Mt, P, Q, [config?: AxpRequestConfig]>
  ): Promise<TAxpResult<R, ResolveResponse<S, Mt, P, D>, O>>;
}
/** axios 的十个小写动词与柯里化 Schema 分派。 */
export type HttpVerbs<S, R extends IAxpResponse> = {
  [Mt in HttpMethodLower]: <
    P extends LoosePath<S, Mt>,
    O extends AxpRequestConfig = AxpRequestConfig,
  >(
    path: P,
    config?: O,
  ) => IAxpDispatch<S, Mt, P, R, O>;
};
/** 编译后的可观测挂载项。 */
export interface IAxpInspection {
  /** 所在阶段。 */
  readonly stage: AxpStage;
  /** 插件名或带序号的段名。 */
  readonly name: string;
}
/** 洋葱管线客户端的公开契约。
 * @example `const data = await api.get('/pets')()`
 */
export interface AxpClient<
  S = unknown,
  R extends IAxpResponse = PipelineResponse,
> extends HttpVerbs<S, R> {
  /** 底层传输实例。 */
  readonly axios: AxiosInstance;
  /** 逃生口，明确请求返回响应。
   * @param config 包含 wrap:true 或 throws:false 的请求配置。
   * @returns 保留 R 扩展字段且 data 为 D 的响应。
   * @example `api.request<Pet>({ url: '/pet', wrap: true })`
   */
  request<D = unknown>(
    config: AxpRequestConfig & ({ wrap: true } | { throws: false }),
  ): Promise<WithData<R, D>>;
  /** 逃生口，默认解包业务数据；internal 始终抛原始异常。
   * @param config axios 原生字段及可扩展请求选项。
   * @returns 接口业务数据，失败按请求 throws 和客户端 reject 约定落定。
   * @example `api.request<Pet>({ url: '/pet' })`
   */
  request<D = unknown>(config: AxpRequestConfig): Promise<D>;
  /** 克隆 defaults，默认继承插件并重新 setup。
   * @param overrides 子客户端的 axios defaults 覆盖项。
   * @param opts 插件列表或 inherit。
   * @returns 插件状态独立的子客户端。
   * @example `api.extend({ baseURL: '/v2' }, { plugins: 'inherit' })`
   */
  extend(
    overrides?: AxiosRequestConfig,
    opts?: { /** inherit 为默认。 */ plugins?: "inherit" | readonly AxpPlugin<R, any>[] },
  ): AxpClient<S, R>;
  /** 安装插件并重新编译链；重名抛错，enable:false 不 setup。
   * @param plugin 客户端内具名插件。
   * @example `api.use(timing)`
   */
  use(plugin: AxpPlugin<R, any>): void;
  /** 卸载插件并调用该实例的 dispose；在途请求保持原链快照。
   * @param name 插件名称。
   * @returns 是否存在该注册项。
   * @example `api.eject('timing')`
   */
  eject(name: string): boolean;
  /** 获取本客户端的插件管理 API。
   * @param plugin 原始具名插件对象。
   * @returns 本客户端的 API，未安装或未暴露时为 undefined。
   * @example `api.plugin(cachePlugin)?.clear()`
   */
  plugin<A>(plugin: AxpPlugin<R, A>): A | undefined;
  /** 中止尚未中止的逻辑请求并返回数量。
   * @param reason 传递给逻辑 signal 的取消原因。
   * @returns 本次实际中止数，重复取消返回零。
   * @example `api.cancelAll('route changed')`
   */
  cancelAll(reason?: string): number;
  /** 读取尚未落定的逻辑请求数量。
   * @returns 在途请求数。
   * @example `api.pending()`
   */
  pending(): number;
  /** 读取解析后的完整链顺序；结果副本不会改变客户端。
   * @returns 按阶段排序的挂载项。
   * @example `api.inspect().map(item => item.name)`
   */
  inspect(): ReadonlyArray<IAxpInspection>;
  /** 品牌检查，收窄为当前响应类型。
   * @param value 任意捕获值。
   * @returns 是否携带共享响应品牌。
   * @example `if (api.isResponse(error)) console.log(error.kind)`
   */
  isResponse(value: unknown): value is R;
  /** 中止在途请求并逆序清理插件实例，可重复调用。
   * 清理异常不会中断其它实例，最后抛出首次异常；销毁后不能发起新请求。
   * @example `api.dispose()`
   */
  dispose(): void;
}
