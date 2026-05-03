import type { AxiosRequestConfig, AxiosResponse, Method } from 'axios';
import type ApiResponse from '../objects/ApiResponse';
import type { PluginLogger } from '../plugin/types';


/**
 * Anything that exposes a `.name` string — `Plugin` itself, or a plugin
 * factory function (whose `.name` is its declaration name, by JS convention).
 * `Core.eject` accepts all three forms via this single key.
 */
export type Named = { readonly name: string };


/* ═══════════════════════════════════════════════════════════════════════════
 *  Core options
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Per-plugin global options that plugins can extend via `declare module`. */
export interface ICommonOptions {
}

/** `Core` constructor options. */
export interface CoreOptions extends ICommonOptions {
    /** Enables verbose plugin lifecycle / interceptor logging. Default `false`. */
    debug?: boolean;
    /** Optional sink — defaults to `console.*`. */
    logger?: PluginLogger;
}

export interface IBaseOptions extends AxiosRequestConfig {
    debug?: boolean;
}

export interface IMethodOptions extends IBaseOptions {
    loading?: boolean;
    silent?: boolean;
}

export interface IHttpOptions extends IMethodOptions, ICommonOptions {
    /** 单次允许 ApiResponse.data 为 null/undefined（覆盖 normalize 插件级 nullable）*/
    nullable?: boolean;
    /** 单次允许 ApiResponse.data 为空容器 `{}` / `[]` / `''`（覆盖 normalize 插件级 emptyable）*/
    emptyable?: boolean;
    wrap?: boolean;
    raw?: boolean;
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
 *  Schema shape (`model.PathRefs`):
 *      { [path]: { [method]: [response: R, request: [payload: P] | []] } }
 *
 *  IDE-perf choices:
 *    • `_Indexed<T>` is a one-shot cached alias so deeper helpers don't redo the
 *      `T extends model.PathRefs` check on every reference.
 *    • `[X] extends [Y]` non-distributive guards prevent fan-out on unions.
 *    • Literal `P` is captured once on the wrap and reused across all three
 *      `HttpDispatch` overloads — payload/response inference runs once per
 *      call site, not once per overload.
 *    • The overload list is ordered raw → wrap → plain so the most flag-
 *      constrained signature is tried first; the resolver chain is only
 *      evaluated when needed.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Lower-cased `Method` literals. */
export type HttpMethodLower = Lowercase<Method>;

/** The single helper `Core<T>` uses. */
export type HttpPrototype<T> = {
    [K in HttpMethodLower]: HttpWrap<T, K>;
};


/* ─── private helpers (not exported through index) ────────────────────────── */

/* Method-major inversion of `model.PathRefs`. Computed once per `T`, cached by
 * the compiler — turns the path-major schema
 *     { '/pet': { post: [...], put: [...] }, ... }
 * into
 *     { post: { '/pet': [...] }, put: { '/pet': [...] }, ... }
 * so every per-call lookup degrades to a literal-key access on a small object,
 * not a mapped+conditional fan-out across all `keyof T` (≈ 1000 paths). */
type _Indexed<T> = [T] extends [model.PathRefs]
    ? {
        [Mt in HttpMethodLower]: {
            [K in keyof T as Mt extends keyof T[K] ? K & string : never]: T[K][Mt &
            keyof T[K]];
        };
    }
    : never;

/** Strict path: only keys present in the pre-filtered table (no `(string & {})`).
 *  Unlisted URLs are a compile error — extend `model.PathRefs` via a local
 *  `.d.ts` declaration merge during integration (see README). When `T` is not a
 *  `PathRefs` subtype (e.g. `Core<unknown>`) the constraint relaxes to `string`. */
type LoosePath<T, Mt extends HttpMethodLower> = [_Indexed<T>] extends [never]
    ? string
    : keyof _Indexed<T>[Mt];

/** `[response, request]` tuple for a path/method, or `never`. O(1) literal lookup. */
type EntryFor<T, Mt extends HttpMethodLower, P> = [_Indexed<T>] extends [never]
    ? never
    : P extends keyof _Indexed<T>[Mt]
    ? _Indexed<T>[Mt][P]
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
    ? [payload?: unknown, ...Rest]               // Q = unknown (default) → optional
    : [Q] extends [undefined | void]
    ? [payload?: undefined, ...Rest]             // empty `request: []` → no payload
    : [payload: Q, ...Rest];                     // Q = concrete → required

/** Three-way overloaded dispatch: raw / wrap / plain. */
export interface HttpDispatch<T, Mt extends HttpMethodLower, P> {
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
export type HttpWrap<T, Mt extends HttpMethodLower> = <P extends LoosePath<T, Mt>>(
    path: P,
    config?: IMethodOptions,
) => HttpDispatch<T, Mt, P>;


export type HttpResponse = AxiosResponse<ApiResponse> 