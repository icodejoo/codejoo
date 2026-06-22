import type {
  AxiosAdapter,
  AxiosInstance,
  AxiosInterceptorOptions,
  AxiosRequestConfig,
  AxiosRequestTransformer,
  AxiosResponse,
  AxiosResponseTransformer,
  InternalAxiosRequestConfig,
  Method,
} from 'axios';
import type ApiResponse from './objects/ApiResponse';

/* ═══════════════════════════════════════════════════════════════════════════
 *  Plugin system
 * ═══════════════════════════════════════════════════════════════════════════ */

export type PluginCleanup = () => void;

export interface PluginLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** What a plugin sees during `install`. Every side-effect performed through
 *  `ctx` is auto-tracked and reverted on `eject` — plugin authors don't write
 *  cleanup boilerplate. Returning a `PluginCleanup` from `install` is for any
 *  resources outside axios (timers, sockets, etc.). */
export interface PluginContext {
  /** The wrapped axios instance — direct access for anything `ctx` doesn't cover. */
  readonly axios: AxiosInstance;

  /** This plugin's name (echo of `Plugin.name`), useful for logs. */
  readonly name: string;

  /** Tagged logger; no-op when `Core` was not constructed with `debug: true`. */
  readonly logger: PluginLogger;

  /** Register a request interceptor; auto-ejected on uninstall. */
  request<C = InternalAxiosRequestConfig>(
    onFulfilled?: ((config: C) => C | Promise<C>) | null,
    onRejected?: ((error: unknown) => unknown) | null,
    options?: AxiosInterceptorOptions,
  ): void;

  /** Register a response interceptor; auto-ejected on uninstall. */
  response<R = unknown>(
    onFulfilled?:
      | ((response: AxiosResponse<R>) => AxiosResponse<R> | Promise<AxiosResponse<R>>)
      | null,
    onRejected?: ((error: unknown) => unknown) | null,
  ): void;

  /** Replace the axios adapter. The previous adapter is restored on uninstall. */
  adapter(adapter: AxiosAdapter): void;

  /** Append transformers to `axios.defaults.transformRequest`; spliced on uninstall. */
  transformRequest(...fns: AxiosRequestTransformer[]): void;

  /** Append transformers to `axios.defaults.transformResponse`; spliced on uninstall. */
  transformResponse(...fns: AxiosResponseTransformer[]): void;

  /** Custom cleanup callback for resources outside axios. Runs on uninstall. */
  cleanup(fn: PluginCleanup): void;
}

export interface Plugin {
  /** Unique id; reused by `core.eject(name)`. */
  name: string;

  /** Each plugin should do one thing. Order is determined by the caller via
   *  `use()` invocation order — there is no priority field. axios's native
   *  semantics apply: request interceptors run LIFO (last `use`d runs first),
   *  response interceptors run FIFO (first `use`d runs first). */
  install(ctx: PluginContext): PluginCleanup | void;
}

/** Snapshot returned by `core.plugins()` — for debugging and assertions. */
export interface PluginRecord {
  readonly name: string;
  readonly requestInterceptors: number;
  readonly responseInterceptors: number;
  readonly transformRequests: number;
  readonly transformResponses: number;
  readonly adapterReplaced: boolean;
  readonly cleanups: number;
}

/** `Core` constructor options. */
export interface CoreOptions extends ICommonOptions {
  /** Enables verbose plugin lifecycle / interceptor logging. Default `false`. */
  debug?: boolean;
  /** Optional sink — defaults to `console.*`. */
  logger?: PluginLogger;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Plugin runtime options (consumed inside interceptors / dispatch)
 * ═══════════════════════════════════════════════════════════════════════════ */

type HttpLogger = (config: IInnerOptions) => void;




export interface ICommonOptions {

}

export interface IPluginCommonRequestOptions {
  before?(config: InternalAxiosRequestConfig): any
  after?(config: InternalAxiosRequestConfig): any
}

export interface IPluginCommonResponseOptions {
  // before?(response): any
  // after?(config: HttpInternalRequestConfig): any
}

export interface IBaseOptions extends AxiosRequestConfig {
  debug?: boolean;
  logger?: HttpLogger;
}

export interface IMethodOptions extends IBaseOptions {
  loading?: boolean;
  silent?: boolean;
  retry?: TRetryOptions;
}

export interface IHttpOptions extends IMethodOptions, ICommonOptions {
  nullable?: boolean;
  wrap?: boolean;
  raw?: boolean;
}

export interface IInnerOptions {
  _debug?: boolean;
  _logger: HttpLogger;
}

interface IRetryObjectOptions {
  limit?: number;
  delay?:
  | number
  | ((now: number, limit: number, config: IInnerOptions) => number);
  should?(now: number, limit: number, config: IInnerOptions): boolean;
}

type TRetryOptions = boolean | number | null | undefined | IRetryObjectOptions;

export interface NormalizeOptions {
  enable?: boolean;
  predicate?(data: any, config: IHttpOptions): boolean;
}

export interface HttpInternalRequestConfig extends InternalAxiosRequestConfig {
  key: string | undefined
}

/* ═════════════════════════════════════════════════════════════════════════════
 *  HttpPrototype — single entry-point used by `Core<T>`.
 *
 *      class Core<T = unknown> implements HttpPrototype<T> { ... }
 *
 *  Pass the schema generic, get back the full `{ get, post, put, ... }` shape
 *  with PathRef-driven inference baked in. Everything below this line is a
 *  private implementation detail of that single export.
 *
 *  Schema shape (`model.MethodRefs`, the **method-major** index emitted by
 *  codegen — a static, pre-expanded product, not a TS-level inversion):
 *      { [method]: { [path]: [response: R, request: [payload: P] | []] } }
 *  (`model.PathRefs` stays path-major for openapi's own `Request`/`OpenApi`.)
 *
 *  IDE-perf choices:
 *    • No type-level inversion — `T[Mt][P]` is a direct O(1) literal-key access
 *      on the already-method-major schema (codegen did the inversion once).
 *    • `[X] extends [Y]` non-distributive guards prevent fan-out on unions.
 *    • Literal `P` is captured once on the wrap and reused across all three
 *      `HttpDispatch` overloads — payload/response inference runs once per
 *      call site, not once per overload.
 *    • The overload list is ordered raw → wrap → plain so the most flag-
 *      constrained signature is tried first; the resolver chain is only
 *      evaluated when needed.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Lower-cased `Method` literals. Internal to the resolver, exposed so callers
 *  can iterate the same key set if they need to (e.g. building a runtime map). */
export type HttpMethodLower = Lowercase<Method>;

/** The single helper `Core<T>` uses. */
export type HttpPrototype<T> = {
  [K in HttpMethodLower]: HttpWrap<T, K>;
};

/* ─── private helpers (not exported) ──────────────────────────────────────── */

/* `T` is the **method-major** schema (`model.MethodRefs`): `{ [method]: { [path]:
 * [response, request] } }`. Codegen already emitted this index statically, so
 * every per-call lookup is a direct literal-key access `T[Mt][P]` — no mapped /
 * conditional fan-out across ~1000 paths at type-check time. */

/** Strict path: only keys present under that method (no `(string & {})`).
 *  Unlisted URLs are a compile error — extend `model.MethodRefs` via a local
 *  `.d.ts` declaration merge during integration (see README). When `T` is not a
 *  `MethodRefs` subtype (e.g. `Core<unknown>`) the constraint relaxes to `string`. */
type LoosePath<T, Mt extends HttpMethodLower> = [T] extends [model.MethodRefs]
  ? Mt extends keyof T
    ? keyof T[Mt]
    : never
  : string;

/** `[response, request]` tuple for a path/method, or `never`. O(1) literal lookup. */
type EntryFor<T, Mt extends HttpMethodLower, P> = [T] extends [model.MethodRefs]
  ? Mt extends keyof T
    ? P extends keyof T[Mt]
      ? T[Mt][P]
      : never
    : never
  : never;

type ResponseFor<T, Mt extends HttpMethodLower, P> =
  EntryFor<T, Mt, P> extends readonly [infer R, ...unknown[]] ? R : unknown;

type PayloadFor<T, Mt extends HttpMethodLower, P> =
  EntryFor<T, Mt, P> extends readonly [unknown, infer Req]
  ? Req extends readonly [infer Pl, ...unknown[]]
  ? Pl
  : Req extends readonly []
  ? undefined
  : unknown
  : unknown;

/** True when generic was left at its `unknown`/`any` default. */
type IsLoose<T> = unknown extends T ? true : false;

/** Resolved payload — explicit `Q` wins, else infer from schema, else passthrough. */
type ResolvePayload<T, Mt extends HttpMethodLower, P, Q> = IsLoose<Q> extends true
  ? [EntryFor<T, Mt, P>] extends [never]
  ? Q
  : PayloadFor<T, Mt, P>
  : Q;

/** Resolved response — explicit `R` wins, else infer from schema, else passthrough. */
type ResolveResponse<T, Mt extends HttpMethodLower, P, R> = IsLoose<R> extends true
  ? [EntryFor<T, Mt, P>] extends [never]
  ? R
  : ResponseFor<T, Mt, P>
  : R;

/** Tuple builder so a payload can be required, optional, or `any`-passthrough. */
type Payload<Q, Rest extends unknown[]> = 0 extends 1 & Q
  ? [payload: Q, ...Rest]                      // Q = any → required
  : unknown extends Q
  ? [payload?: unknown, ...Rest]             // Q = unknown (default) → optional
  : [Q] extends [undefined | void]
  ? [payload?: undefined, ...Rest]           // empty `request: []` → no payload
  : [payload: Q, ...Rest];                   // Q = concrete → required

/** Three-way overloaded dispatch: raw / wrap / plain. */
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
  ): Promise<ApiResponse<ResolveResponse<T, Mt, P, R>>>;
  <R = unknown, Q = unknown>(
    ...args: Payload<
      ResolvePayload<T, Mt, P, Q>,
      [config?: IHttpOptions]
    >
  ): Promise<ResolveResponse<T, Mt, P, R>>;
}

/** Per-verb function. `<P extends ...>` preserves the literal so it propagates
 *  into `HttpDispatch`, letting payload/response resolve once per call site. */
type HttpWrap<T, Mt extends HttpMethodLower> = <P extends LoosePath<T, Mt>>(
  path: P,
  config?: IMethodOptions,
) => HttpDispatch<T, Mt, P>;


export type Primitive = string | number | boolean | symbol | bigint | undefined | null;

export type MaybeFun<T> = T | ((config: AxiosRequestConfig) => T)


/**虚值 */
export type Falsy = false | "" | null | undefined;