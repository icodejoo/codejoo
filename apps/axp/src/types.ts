import type {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
  Method,
} from 'axios';
import type AxpResponse from './objects/Response';

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
export interface ICommonOptions {

}

/** 插件通用的请求前/后钩子形状。 / Shape for plugin-common before/after-request hooks. */
export interface IPluginCommonRequestOptions {
  /** 请求发出前的钩子。 Hook before the request is sent. */
  before?(config: InternalAxiosRequestConfig): any
  /** 请求发出后的钩子。 Hook after the request is sent. */
  after?(config: InternalAxiosRequestConfig): any
}

/** 插件通用的响应前/后钩子形状（字段目前均为占位，未启用）。
 *
 *  Shape for plugin-common before/after-response hooks (fields currently reserved, unused). */
export interface IPluginCommonResponseOptions {
  // before?(response): any
  // after?(config: HttpInternalRequestConfig): any
}

/** 直接复用 axios 请求配置的基础选项类型。 / Base options type that simply reuses axios's own request config. */
export interface IBaseOptions extends AxiosRequestConfig {
}

/** 单次方法调用（`get`/`post`/...）可接受的选项。 / Options accepted by a single method call (`get`/`post`/...). */
export interface IMethodOptions extends IBaseOptions {
  /** 是否触发 loading 插件的显示/隐藏。 Whether this call triggers the loading plugin's show/hide. */
  loading?: boolean;
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
  key: string | undefined
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

/** 方法优先 schema 要启用路径/请求体/响应推断必须匹配的结构性形状——纯形状检查，不引用具名/全局类型。不匹配时（包括默认值 `unknown`）回退成 `string` 路径与原样传递类型。
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

/* `T` 是匹配 `MethodSchema` 的方法优先 schema；构建者已做过路径优先→方法优先的反转，故每次查找都是直接字面量键访问 `T[Mt][P]`，类型检查阶段不做 mapped/conditional 扇出。
 *
 * `T` is a method-major schema matching `MethodSchema`; whoever built it already did the path-major→method-major inversion, so every lookup here is a direct literal-key access `T[Mt][P]` — no mapped/conditional fan-out at type-check time. */

/** 严格路径：只允许该方法下真实存在的 key。未列出的 URL 是编译错误——需要扩展时用本地 `.d.ts` 声明合并；`T` 不匹配 `MethodSchema` 时放宽为 `string`。
 *
 *  Strict path: only keys present under that method. Unlisted URLs are a compile error — extend via a local `.d.ts` declaration merge; relaxes to `string` when `T` doesn't match `MethodSchema`. */
type LoosePath<T, Mt extends HttpMethodLower> = [T] extends [MethodSchema]
  ? Mt extends keyof T
    ? keyof T[Mt]
    : never
  : string;

/** 某 path/method 对应的 `[response, request]` 元组，或 `never`；O(1) 字面量查找。
 *
 *  `[response, request]` tuple for a path/method, or `never`; O(1) literal lookup. */
type EntryFor<T, Mt extends HttpMethodLower, P> = [T] extends [MethodSchema]
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
type ResolvePayload<T, Mt extends HttpMethodLower, P, Q> = IsLoose<Q> extends true
  ? [EntryFor<T, Mt, P>] extends [never]
  ? Q
  : PayloadFor<T, Mt, P>
  : Q;

/** 解析后的响应类型——显式 `R` 优先，否则从 schema 推断，否则原样传递。
 *
 *  Resolved response — explicit `R` wins, else infer from schema, else passthrough. */
type ResolveResponse<T, Mt extends HttpMethodLower, P, R> = IsLoose<R> extends true
  ? [EntryFor<T, Mt, P>] extends [never]
  ? R
  : ResponseFor<T, Mt, P>
  : R;

/** 元组构造器，使请求体可必填、可选，或 `any` 原样传递。 / Tuple builder so a payload can be required, optional, or `any`-passthrough. */
type Payload<Q, Rest extends unknown[]> = 0 extends 1 & Q
  ? [payload: Q, ...Rest]                      // Q = any → required
  : unknown extends Q
  ? [payload?: unknown, ...Rest]             // Q = unknown (default) → optional
  : [Q] extends [undefined | void]
  ? [payload?: undefined, ...Rest]           // empty `request: []` → no payload
  : [payload: Q, ...Rest];                   // Q = concrete → required

/** 三路重载分发：raw / wrap / plain。 / Three-way overloaded dispatch: raw / wrap / plain. */
interface HttpDispatch<T, Mt extends HttpMethodLower, P> {
  <R = unknown, Q = unknown>(
    ...args: Payload<
      ResolvePayload<T, Mt, P, Q>,
      [config: IHttpOptions & { raw: true }]
    >
  ): Promise<{
    code: number | string;
    data: ResolveResponse<T, Mt, P, R>;
    message?: string;
  }>;
  <R = unknown, Q = unknown>(
    ...args: Payload<
      ResolvePayload<T, Mt, P, Q>,
      [config: IHttpOptions & { wrap: true }]
    >
  ): Promise<AxpResponse<ResolveResponse<T, Mt, P, R>>>;
  <R = unknown, Q = unknown>(
    ...args: Payload<
      ResolvePayload<T, Mt, P, Q>,
      [config?: IHttpOptions]
    >
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
export type MaybeFun<T> = T | ((config: AxiosRequestConfig) => T)


/** 虚值。 Falsy value. */
export type Falsy = false | "" | null | undefined;
