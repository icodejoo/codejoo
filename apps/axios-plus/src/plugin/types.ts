import type {
    AxiosAdapter,
    AxiosInstance,
    AxiosInterceptorOptions,
    AxiosRequestTransformer,
    AxiosResponse,
    AxiosResponseTransformer,
    InternalAxiosRequestConfig,
} from 'axios';


/* ═══════════════════════════════════════════════════════════════════════════
 *  Plugin system — public types
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

    /**
     * 当前已安装插件名快照（按 use 顺序）。供本插件在 `install()` 阶段做依赖检查 ——
     * 比如 notification / retry / rethrow 都要求 `normalize` 必须先安装。
     *
     * 由于 PluginManager 是按 use 顺序顺序安装的，依赖只需在自己的 install() 里查
     * 就能"看见"前面已装的插件；后面才装的插件不会出现在这里。
     */
    plugins(): readonly string[];
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


/**
 * Optional `before` / `after` hooks shared by request-side plugins.
 * @deprecated Hooks were never wired beyond the `key` plugin and have no integration coverage.
 *             Prefer registering your own request interceptor — kept around only for
 *             back-compat with existing callers.
 */
export interface IPluginCommonRequestOptions {
    /** @deprecated Use `ctx.request(config => ...)` from your own plugin instead. */
    before?(config: InternalAxiosRequestConfig): any;
    /** @deprecated Use `ctx.request(config => ...)` from your own plugin instead. */
    after?(config: InternalAxiosRequestConfig): any;
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  Plugin manager internals
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Per-plugin internal record kept by `PluginManager`. Each registered side
 *  effect (interceptor id, transform fn, adapter swap) is tracked here so
 *  `eject` / `#refresh` can revert it deterministically.
 *  @internal not exported through `index.ts` */
export interface InternalRecord {
    plugin: Plugin;
    ctx: PluginContext;
    reqIds: number[];
    resIds: number[];
    addedReqTransforms: AxiosRequestTransformer[];
    addedResTransforms: AxiosResponseTransformer[];
    adapterReplaced: boolean;
    savedAdapter?: AxiosAdapter;
    userCleanups: PluginCleanup[];
    pluginCleanup?: PluginCleanup;
}
