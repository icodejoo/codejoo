import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, Method } from "axios";
import type { AxpContext } from "./context";
import type { AxpResponse, IAxpResponse, IAxpResponseFactory } from "./response";
import type { IKeyOptions } from "./key";
import type { STAGE_BUILTINS } from "./stages";

/* ═══════════════════════════════════════════════════════════════════════════
 *  Schema 推断：把任意方法优先的 schema 作为泛型传入，即可得到完整的
 *  `{ get, post, put, ... }` 柯里化分发形态，并内建路径、请求体、响应推断。
 *
 *  只检查 `T` 的结构性形状，不要求具名类型或全局命名空间；`T` 来自手写、
 *  codegen 或 `@codejoo/openapi2lang` 均可。`unknown`（默认）把路径放宽为
 *  `string`。期望形状：
 *      { [method]: { [path]: [response: R, request: [payload: P] | []] } }
 *
 *  IDE 性能：不做类型层反转（`T[Mt][P]` 是 O(1) 字面量查表）；`[X] extends [Y]`
 *  非分布式写法防止联合类型扇出；字面量 `P` 在动词处捕获一次，供各重载复用。
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

/* ─── private helpers (not exported) ──────────────────────────────────────── */

/** 按实际方法与路径键校验元组，不要求 interface 声明字符串索引签名。 */
type SchemaShape<T> = {
  [Mt in keyof T]: {
    [P in keyof T[Mt]]: readonly [response: unknown, request: readonly [] | readonly [unknown]];
  };
};

/** 默认 unknown/any 保持宽松，其余对象按实际键验证方法优先结构。 */
type IsMethodSchema<T> = unknown extends T ? false : [T] extends [object & SchemaShape<T>] ? true : false;

/* `T` 是匹配 `SchemaShape<T>` 的方法优先 schema；按已有键检查结构后，每次查找均使用 `T[Mt][P]`，无需反转路径与方法。
 *
 * `T` is a method-major schema matching `MethodSchema`; whoever built it already did the path-major→method-major inversion, so every lookup here is a direct literal-key access `T[Mt][P]` — no mapped/conditional fan-out at type-check time. */

/** 严格路径：只允许该方法下真实存在的 key。未列出的 URL 是编译错误；本地扩展可继承方法优先 schema，不匹配时放宽为 `string`。
 *
 *  Strict path: only keys present under that method. Unlisted URLs are a compile error — extend via a local `.d.ts` declaration merge; relaxes to `string` when `T` doesn't match `MethodSchema`. */
type LoosePath<T, Mt extends HttpMethodLower> = IsMethodSchema<T> extends true ? (Mt extends keyof T ? keyof T[Mt] : never) : string;

/** 某 path/method 对应的 `[response, request]` 元组，或 `never`；O(1) 字面量查找。
 *
 *  `[response, request]` tuple for a path/method, or `never`; O(1) literal lookup. */
type EntryFor<T, Mt extends HttpMethodLower, P> = IsMethodSchema<T> extends true ? (Mt extends keyof T ? (P extends keyof T[Mt] ? T[Mt][P] : never) : never) : never;

/** 从 `EntryFor` 取出响应类型 `R`，取不到回退 `unknown`。 / Extracts response type `R` from `EntryFor`, falls back to `unknown`. */
type ResponseFor<T, Mt extends HttpMethodLower, P> = EntryFor<T, Mt, P> extends readonly [infer R, ...unknown[]] ? R : unknown;

/** 从 `EntryFor` 取出请求体类型；空 `request: []` 表示无请求体（解析为 `undefined`），其余回退 `unknown`。
 *
 *  Extracts payload type from `EntryFor`; empty `request: []` means no payload (resolves to `undefined`), else falls back to `unknown`. */
type PayloadFor<T, Mt extends HttpMethodLower, P> =
  EntryFor<T, Mt, P> extends readonly [unknown, infer Req] ? (Req extends readonly [infer Pl, ...unknown[]] ? Pl : Req extends readonly [] ? undefined : unknown) : unknown;

/** 泛型仍是默认值 `unknown`/`any` 时为真。 / True when the generic was left at its `unknown`/`any` default. */
type IsLoose<T> = unknown extends T ? true : false;

/** 解析后的请求体类型——显式 `Q` 优先，否则从 schema 推断，否则原样传递。
 *
 *  Resolved payload — explicit `Q` wins, else infer from schema, else passthrough. */
type ResolvePayload<T, Mt extends HttpMethodLower, P, Q> = IsLoose<Q> extends true ? ([EntryFor<T, Mt, P>] extends [never] ? Q : PayloadFor<T, Mt, P>) : Q;

/** 解析后的响应类型——显式 `R` 优先，否则从 schema 推断，否则原样传递。
 *
 *  Resolved response — explicit `R` wins, else infer from schema, else passthrough. */
type ResolveResponse<T, Mt extends HttpMethodLower, P, R> = IsLoose<R> extends true ? ([EntryFor<T, Mt, P>] extends [never] ? R : ResponseFor<T, Mt, P>) : R;

/** 元组构造器，使请求体可必填、可选，或 `any` 原样传递。 / Tuple builder so a payload can be required, optional, or `any`-passthrough. */
type Payload<Q, Rest extends unknown[]> = 0 extends 1 & Q
  ? [payload: Q, ...Rest] // Q = any → required
  : unknown extends Q
    ? [payload?: unknown, ...Rest] // Q = unknown (default) → optional
    : [Q] extends [undefined | void]
      ? [payload?: undefined, ...Rest] // empty `request: []` → no payload
      : [payload: Q, ...Rest]; // Q = concrete → required

/* ═══ 洋葱管线类型 ═══ */

/** 管线日志接口。 */
export interface AxpLogger {
  /** 普通日志。 */
  log(...args: unknown[]): void;
  /** 警告级别。 */
  warn(...args: unknown[]): void;
  /** 错误级别。 */
  error(...args: unknown[]): void;
}
/** 可由插件模块扩展的请求选项。 */
export interface AxpRequestOptions {
  /** 成功也返回响应对象。 */
  wrap?: boolean;
  /** 请求级原生数据开关，开启时隐含 wrap，原生数据不可枚举地附到响应副本。 */
  raw?: boolean;
  /** false 时可预期失败也返回响应。 */
  throws?: boolean;
  /** 跳过通知。 */
  silent?: boolean;
  /** 显式 key（字符串）或关闭 key（false）；省略或 true 时惰性自动计算（true 保留给旧写法 `key: true, cache: true` 平滑迁移）。 */
  key?: string | boolean;
  /** 用户的逻辑请求取消信号。 */
  signal?: AbortSignal;
}
/** 不向调用方开放的 axios 字段：`cancelToken` 已废弃（统一用 `signal` 取消）；`signal` 由 {@link AxpRequestOptions} 以标准 `AbortSignal` 重新声明。 */
type TAxpOmittedAxiosKeys = "cancelToken" | "signal";
/** axios 原生请求字段；用排除法而非白名单，axios 新增字段无需同步维护。 */
type TAxpAxiosConfig = Omit<AxiosRequestConfig, TAxpOmittedAxiosKeys>;
/** 新请求配置：axios 原生字段（去掉 `cancelToken`、`signal`）叠加请求选项。 */
export type AxpRequestConfig = TAxpAxiosConfig & AxpRequestOptions;
/** 请求补丁；undefined 删除字段，headers 再合并一层。 */
export type AxpRequestPatch = { [K in keyof AxpRequestConfig]?: AxpRequestConfig[K] | undefined };
/** 保留扩展响应字段并替换接口数据类型。 */
export type WithData<R, D> = Omit<R, "data"> & { /** 当前接口的业务数据。 */ readonly data: D };
/** 开启 raw 后响应副本上的原生数据视图；先 Omit 再交叉，避免与自定义 R 的同名业务字段冲突。
 * raw 带 undefined：缓存命中、share 跟随者、网络错误等路径没有原生响应。
 * @example `const r = await api.get('/pet', { raw: true })(); r.raw?.headers; r.request.url`
 */
export type WithNative<R> = Omit<R, "raw" | "error" | "request"> & {
  /** 完整原生响应，无响应时为 undefined。 */ readonly raw: AxiosResponse | undefined;
  /** 原始异常，成功或非异常路径为 undefined。 */ readonly error: unknown;
  /** 完整请求配置视图。 */ readonly request: Readonly<AxpRequestConfig>;
};
/** 从外到内的固定阶段。 */
export type AxpStage = keyof typeof STAGE_BUILTINS;
/** next 永远 resolve，程序异常临时归类为 internal。 */
export type AxpNext<R extends IAxpResponse<unknown, string | number> = AxpResponse> = (patch?: AxpRequestPatch) => Promise<R>;
/** 请求不可变的洋葱中间件。 */
export type AxpMiddleware<R extends IAxpResponse<unknown, string | number> = AxpResponse> = (ctx: AxpContext<R>, next: AxpNext<R>) => Promise<R>;
/** 一个独立参与排序的请求/响应挂载段。 */
export interface AxpTap<R extends IAxpResponse<unknown, string | number> = AxpResponse> {
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
export interface AxpPluginInstance<R extends IAxpResponse<unknown, string | number> = AxpResponse, A = void> {
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
export interface AxpPlugin<R extends IAxpResponse<unknown, string | number> = AxpResponse, A = void> {
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
interface IAxpBaseOptions<R extends IAxpResponse<unknown, string | number>> {
  /** 使用现有实例，省略时创建新实例。 */
  axios?: AxiosInstance;
  /** 初始化插件列表；不参与推断 R，R 只由显式泛型或 response 工厂决定。 */
  plugins?: readonly AxpPlugin<NoInfer<R>, any>[];
  /** key 服务选项。 */
  key?: IKeyOptions;
  /** 仅转换即将抛出的可预期失败。 */
  reject?: (response: NoInfer<R>) => unknown;
  /** 日志与调用点捕获。 */
  debug?: boolean | AxpLogger;
}
/** 判断是否为默认响应的结构类型。 */
export type TAxpDefaultResponse<R> = [R] extends [AxpResponse] ? ([AxpResponse] extends [R] ? true : false) : false;
/** 默认响应可省略选项，自定义响应必须提供完整选项。 */
export type TAxpArgs<R, O> = TAxpDefaultResponse<R> extends true ? [options?: O] : [options: O];
/** 自定义响应必须显式提供匹配的工厂。 */
export type AxpOptions<R extends IAxpResponse<unknown, string | number> = AxpResponse> = IAxpBaseOptions<R> &
  (TAxpDefaultResponse<R> extends true ? { /** 默认响应工厂。 */ response?: IAxpResponseFactory<R> } : { /** 自定义响应工厂。 */ response: IAxpResponseFactory<R> });
/** 读取选项对象上必选属性 K 的类型，缺省或可选时为 undefined。 */
type TAxpFlag<O, K extends string> = O extends { [P in K]: infer V } ? V : undefined;
/** 不含 raw 时按 wrap/throws 决定返回响应还是数据；任一为宽 boolean 且无法确定包装时返回联合。 */
type TAxpPlainResult<R extends IAxpResponse<unknown, string | number>, D, O> = O extends { wrap: true } | { throws: false }
  ? WithData<R, D>
  : [boolean] extends [TAxpFlag<O, "wrap">]
    ? WithData<R, D> | D
    : [boolean] extends [TAxpFlag<O, "throws">]
      ? WithData<R, D> | D
      : D;
/** 根据选项决定返回形态；raw 优先于 wrap/throws，raw 为宽 boolean 时返回原生副本与其余形态的联合。
 * 已知限制：方法级传入 `AxpRequestConfig` 类型的变量时，raw、wrap、throws 都是可选属性，与缺省 O 无法区分，仍按数据推断。
 */
type TAxpResult<R extends IAxpResponse<unknown, string | number>, D, O> = O extends { raw: true }
  ? WithNative<WithData<R, D>>
  : O extends { raw: false }
    ? TAxpPlainResult<R, D, O>
    : O extends { raw: boolean }
      ? WithNative<WithData<R, D>> | TAxpPlainResult<R, D, O>
      : TAxpPlainResult<R, D, O>;
/** 新动词的调用签名，沿用原有 Schema 查表和 NoInfer。 */
type TAxpDispatchArgs<S, Mt extends HttpMethodLower, P, Q, C extends unknown[]> = Payload<ResolvePayload<S, Mt, P, NoInfer<Q>>, C>;
/* oxlint-disable typescript-eslint/no-unnecessary-type-parameters -- 动词重载里的 Q 只用于 payload 推断，必须保留为类型参数。 */
/** 调用级 raw 为 true 时返回带原生数据的响应副本。 */
interface IAxpRawDispatch<S, Mt extends HttpMethodLower, P, R extends IAxpResponse<unknown, string | number>> {
  /** raw 隐含包装，优先于 wrap 与 throws。 */
  <D = unknown, Q = unknown>(...args: TAxpDispatchArgs<S, Mt, P, Q, [config: AxpRequestConfig & { raw: true }]>): Promise<WithNative<WithData<R, ResolveResponse<S, Mt, P, D>>>>;
}
/** 调用级 raw 取 Raw（缺省、显式 false 或宽 boolean）时按有效开关选择返回形态的动词签名。 */
interface IAxpBaseDispatch<S, Mt extends HttpMethodLower, P, R extends IAxpResponse<unknown, string | number>, O, Raw extends boolean | undefined> {
  /** 调用级明确包装或关闭抛错时返回响应。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<S, Mt, P, Q, [config: AxpRequestConfig & { /** 调用级 raw 取值。 */ raw?: Raw } & ({ wrap: true } | { throws: false })]>
  ): Promise<TAxpResult<R, ResolveResponse<S, Mt, P, D>, Omit<O, "wrap" | "throws"> & { /** 有效包装值。 */ wrap: true }>>;
  /** 调用级同时关闭包装并开启抛错时返回数据。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<
      S,
      Mt,
      P,
      Q,
      [
        config: AxpRequestConfig & {
          /** 调用级 raw 取值。 */ raw?: Raw;
          /** 调用级关闭包装。 */ wrap: false;
          /** 调用级开启抛错。 */ throws: true;
        },
      ]
    >
  ): Promise<TAxpResult<R, ResolveResponse<S, Mt, P, D>, Omit<O, "wrap" | "throws"> & { /** 有效包装值。 */ wrap: false; /** 有效抛错值。 */ throws: true }>>;
  /** 调用级覆盖包装，抛错开关继承方法配置。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<
      S,
      Mt,
      P,
      Q,
      [
        config: AxpRequestConfig & {
          /** 调用级 raw 取值。 */ raw?: Raw;
          /** 调用级关闭包装。 */ wrap: false;
          /** 缺省时继承方法级。 */ throws?: undefined;
        },
      ]
    >
  ): Promise<TAxpResult<R, ResolveResponse<S, Mt, P, D>, Omit<O, "wrap"> & { /** 有效包装值。 */ wrap: false }>>;
  /** 调用级覆盖抛错，包装开关继承方法配置。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<
      S,
      Mt,
      P,
      Q,
      [
        config: AxpRequestConfig & {
          /** 调用级 raw 取值。 */ raw?: Raw;
          /** 缺省时继承方法级。 */ wrap?: undefined;
          /** 调用级开启抛错。 */ throws: true;
        },
      ]
    >
  ): Promise<TAxpResult<R, ResolveResponse<S, Mt, P, D>, Omit<O, "throws"> & { /** 有效抛错值。 */ throws: true }>>;
  /** 调用级 wrap 为宽 boolean，抛错开关继承方法配置。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<S, Mt, P, Q, [config: AxpRequestConfig & { /** 调用级 raw 取值。 */ raw?: Raw; /** 宽 boolean。 */ wrap: boolean; /** 缺省时继承方法级。 */ throws?: undefined }]>
  ): Promise<TAxpResult<R, ResolveResponse<S, Mt, P, D>, Omit<O, "wrap"> & { /** 宽包装值。 */ wrap: boolean }>>;
  /** 调用级 wrap 与 throws 都不是确定字面量。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<S, Mt, P, Q, [config: AxpRequestConfig & { /** 调用级 raw 取值。 */ raw?: Raw; /** 宽 boolean。 */ wrap: boolean; /** 宽 boolean。 */ throws: boolean }]>
  ): Promise<TAxpResult<R, ResolveResponse<S, Mt, P, D>, Omit<O, "wrap" | "throws"> & { /** 宽包装值。 */ wrap: boolean; /** 宽抛错值。 */ throws: boolean }>>;
  /** 调用级 throws 为宽 boolean，包装开关继承方法配置。 */
  <D = unknown, Q = unknown>(
    ...args: TAxpDispatchArgs<S, Mt, P, Q, [config: AxpRequestConfig & { /** 调用级 raw 取值。 */ raw?: Raw; /** 缺省时继承方法级。 */ wrap?: undefined; /** 宽 boolean。 */ throws: boolean }]>
  ): Promise<TAxpResult<R, ResolveResponse<S, Mt, P, D>, Omit<O, "throws"> & { /** 宽抛错值。 */ throws: boolean }>>;
  /** 未覆盖开关时根据方法配置决定返回形态。 */
  <D = unknown, Q = unknown>(...args: TAxpDispatchArgs<S, Mt, P, Q, [config?: AxpRequestConfig & { /** 调用级 raw 取值。 */ raw?: Raw }]>): Promise<TAxpResult<R, ResolveResponse<S, Mt, P, D>, O>>;
}
/* oxlint-enable typescript-eslint/no-unnecessary-type-parameters */
/** 按调用级有效开关（raw、wrap、throws）选择返回形态的动词签名。 */
type IAxpDispatch<S, Mt extends HttpMethodLower, P, R extends IAxpResponse<unknown, string | number>, O> = IAxpRawDispatch<S, Mt, P, R> &
  IAxpBaseDispatch<S, Mt, P, R, O, undefined> &
  IAxpBaseDispatch<S, Mt, P, R, Omit<O, "raw">, false> &
  IAxpBaseDispatch<S, Mt, P, R, Omit<O, "raw"> & { /** 调用级宽 boolean。 */ raw: boolean }, boolean>;
/** axios 的十个小写动词与柯里化 Schema 分派。 */
export type HttpVerbs<S, R extends IAxpResponse<unknown, string | number>> = {
  [Mt in HttpMethodLower]: <P extends LoosePath<S, Mt>, O extends AxpRequestConfig = AxpRequestConfig>(path: P, config?: O) => IAxpDispatch<S, Mt, P, R, O>;
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
export interface AxpClient<S = unknown, R extends IAxpResponse<unknown, string | number> = AxpResponse> extends HttpVerbs<S, R> {
  /** 底层传输实例。 */
  readonly axios: AxiosInstance;
  /** 逃生口，raw 为 true 时返回带原生数据的响应副本。
   * @param config 含 raw:true 的请求配置，优先于 wrap 与 throws。
   * @returns 保留 R 扩展字段、附带 raw/error/request 的响应。
   * @example `const r = await api.request<Pet>({ url: '/pet', raw: true }); r.raw?.status`
   */
  request<D = unknown>(config: AxpRequestConfig & { raw: true }): Promise<WithNative<WithData<R, D>>>;
  /** 逃生口，明确请求返回响应。
   * @param config 包含 wrap:true 或 throws:false 的请求配置。
   * @returns 保留 R 扩展字段且 data 为 D 的响应。
   * @example `api.request<Pet>({ url: '/pet', wrap: true })`
   */
  request<D = unknown>(config: AxpRequestConfig & { /** 未开启 raw。 */ raw?: false | undefined } & ({ wrap: true } | { throws: false })): Promise<WithData<R, D>>;
  /** 逃生口，包装但 raw 为非字面量 boolean 时返回响应或带原生数据的副本的联合。
   * @param config 含 wrap:true 或 throws:false 且 raw 宽 boolean 的请求配置。
   * @returns 响应或带原生数据的响应副本。
   * @example `api.request<Pet>({ url: '/pet', wrap: true, raw: flag })`
   */
  request<D = unknown>(config: AxpRequestConfig & ({ wrap: true } | { throws: false })): Promise<WithData<R, D> | WithNative<WithData<R, D>>>;
  /** 逃生口，wrap 或 throws 为宽 boolean 时无法静态判定，返回响应或数据的联合。
   * @param config 含宽 boolean wrap 或 throws 的请求配置。
   * @returns 响应或业务数据。
   * @example `api.request<Pet>({ url: '/pet', wrap: flag })`
   */
  request<D = unknown>(config: AxpRequestConfig & { /** 未开启 raw。 */ raw?: false | undefined } & ({ wrap: boolean } | { throws: boolean })): Promise<WithData<R, D> | D>;
  /** 逃生口，默认解包业务数据；internal 始终抛原始异常。
   * @param config axios 原生字段及可扩展请求选项。
   * @returns 接口业务数据，失败按请求 throws 和客户端 reject 约定落定。
   * @example `api.request<Pet>({ url: '/pet' })`
   */
  request<D = unknown>(config: AxpRequestConfig & { /** 未开启 raw。 */ raw?: false | undefined }): Promise<D>;
  /** 逃生口，raw 为非字面量 boolean 时无法静态判定，返回联合。
   * @param config 含宽 boolean raw 的请求配置。
   * @returns 带原生数据的响应副本或业务数据。
   * @example `const r = await api.request<Pet>({ url: '/pet', raw: flag })`
   */
  request<D = unknown>(config: AxpRequestConfig): Promise<WithNative<WithData<R, D>> | D>;
  /** 默认克隆 defaults（不复制拦截器），继承插件并重新 setup；指定 axios 时原样使用该实例。
   * @param overrides 插件 setup 完成后写入子实例的 axios defaults 覆盖项。
   * @param opts 插件列表或 inherit，以及可选的子实例；指定实例时不复制父 defaults。
   * @returns 插件状态独立的子客户端。
   * @example `api.extend({ baseURL: '/v2' }, { plugins: 'inherit' })`
   */
  extend(overrides?: AxiosRequestConfig, opts?: { /** inherit 为默认。 */ plugins?: "inherit" | readonly AxpPlugin<R, any>[]; /** 原样使用并保留拦截器的子实例。 */ axios?: AxiosInstance }): AxpClient<S, R>;
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
   * @example `if (api.isResponse(error)) console.log(failureOf(error)?.type)`
   */
  isResponse(value: unknown): value is R;
  /** 判断是否为内核取消响应。
   * @param value 任意响应或异常。
   * @returns 是否带 cancel 标记。
   * @example `if (api.isCancel(error)) return`
   */
  isCancel(value: unknown): boolean;
  /** 中止在途请求并逆序清理插件实例，可重复调用。
   * 清理异常不会中断其它实例，最后抛出首次异常；销毁后不能发起新请求。
   * @example `api.dispose()`
   */
  dispose(): void;
}
