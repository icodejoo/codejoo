import axiosLib, { AxiosHeaders } from 'axios';
import type { AxiosAdapter, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { PluginLogger, Primitive } from './types';

/** 默认 logger，包装 `console.*` / Default logger, wraps `console.*`. */
export const CONSOLE_LOGGER: PluginLogger = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
};

/**
 * 将 `value | value[] | undefined` 统一转换为新的 `value[]`。
 *
 * Coerces `value | value[] | undefined` into a fresh `value[]`.
 *
 * @param x 单个值、数组或 undefined / a single value, an array, or undefined
 * @returns 新数组；undefined 得空数组，数组得浅拷贝 / a fresh array (empty for undefined, a shallow copy for an array)
 */
export function asArray<X>(x: X | X[] | undefined): X[] {
    if (x == null) return [];
    return Array.isArray(x) ? [...x] : [x];
}

/**
 * 读自 `axios.defaults`（install 时）或某次请求的 `config`（运行时，经 axios 自身
 * merge 继承自 defaults）—— 由 `logger` 插件设置，供其它插件读取；未安装 `logger`
 * 时两字段均为 undefined，下方调用自动退化为空操作。
 *
 * Shape read off `axios.defaults` (install-time) or a per-request `config`
 * (runtime, inherited via axios's merge) — set by the `logger` plugin; without
 * it both fields are undefined and calls below no-op automatically.
 */
export interface LoggableSource {
    /** 是否开启调试日志，未设置视为关闭 / whether debug logging is on; unset = off. */
    debug?: boolean;
    /** 实际输出目标，未设置回退到 CONSOLE_LOGGER / the log sink; falls back to CONSOLE_LOGGER when unset. */
    logger?: PluginLogger;
}

/**
 * 仅在 source.debug 为真值时打印日志，读取 source.logger（缺省用 CONSOLE_LOGGER）。
 * source 通常是 axios.defaults（install 时）或某次请求的 config（运行时）。
 *
 * Logs only when `source.debug` is truthy, using `source.logger` (falls back to
 * `CONSOLE_LOGGER`). `source` is typically `axios.defaults` at install time, or a
 * per-request `config` at runtime.
 *
 * @param source 日志开关/输出目标来源，可能为 undefined（视为关闭） / source of the debug flag/sink; may be undefined (treated as disabled)
 * @param args 转发给 logger.log 的任意参数 / arbitrary args forwarded to logger.log
 */
export function pluginLog(source: LoggableSource | undefined, ...args: unknown[]): void {
    if (!source?.debug) return;
    (source.logger ?? CONSOLE_LOGGER).log(...args);
}

/**
 * 同 `pluginLog`，但调用 logger 的 `.warn`。
 *
 * Same as `pluginLog`, but calls the logger's `.warn`.
 *
 * @param source 日志开关/输出目标来源，可能为 undefined（视为关闭） / source of the debug flag/sink; may be undefined (treated as disabled)
 * @param args 转发给 logger.warn 的任意参数 / arbitrary args forwarded to logger.warn
 */
export function pluginWarn(source: LoggableSource | undefined, ...args: unknown[]): void {
    if (!source?.debug) return;
    (source.logger ?? CONSOLE_LOGGER).warn(...args);
}

/**
 * 同 `pluginLog`，但调用 logger 的 `.error`。
 *
 * Same as `pluginLog`, but calls the logger's `.error`.
 *
 * @param source 日志开关/输出目标来源，可能为 undefined（视为关闭） / source of the debug flag/sink; may be undefined (treated as disabled)
 * @param args 转发给 logger.error 的任意参数 / arbitrary args forwarded to logger.error
 */
export function pluginError(source: LoggableSource | undefined, ...args: unknown[]): void {
    if (!source?.debug) return;
    (source.logger ?? CONSOLE_LOGGER).error(...args);
}


/** `Object.prototype.toString` 的缓存引用 / cached ref to `Object.prototype.toString`. */
const _toString = Object.prototype.toString;
/** 返回值的内部 `[[Class]]` 标签（小写） / the value's internal `[[Class]]` tag (lowercased). */
function _stringify(val: unknown): string {
    return _toString.call(val).slice(8, -1).toLowerCase();
}

/** 是否为普通对象（非 null，非数组） / whether `val` is a plain object (not null, not an array). */
export function isObject(val: unknown): val is Record<string, any> {
    return _stringify(val) === 'object';
}

/** 是否为原始值（null，或 typeof 非 object/function） / whether `val` is a primitive (null, or typeof isn't object/function). */
export function isPrimitive(val: unknown): val is Primitive {
    if (val === null) return true;
    const type = typeof val;
    return type !== 'object' && type !== 'function';
}

/** 解析 adapter 时的默认候选列表 / default adapter candidates used when resolving. */
const DEFAULT_ADAPTERS = ['xhr', 'http', 'fetch'];

/**
 * 取得 axios 实例当前生效的 adapter 函数。`axios.create()` 出来的实例其
 * `defaults.adapter` 是 `['xhr','http','fetch']` 这类数组/字符串而非函数，adapter
 * 类插件直接当函数调会崩，统一经此归一化。
 *
 * Returns the adapter function currently in effect for an axios instance. A bare
 * `axios.create()` instance has an array/string `defaults.adapter` rather than a
 * function; adapter plugins must go through this instead of calling it directly.
 *
 * @param axios 目标 axios 实例 / the target axios instance
 * @returns 可直接调用的 adapter 函数 / a directly callable adapter function
 * @example
 * const prev = resolveAdapter(axios); // 之后 prev(config) 即可
 */
export function resolveAdapter(axios: AxiosInstance): AxiosAdapter {
    const a = axios.defaults.adapter;
    if (typeof a === 'function') return a;
    return axiosLib.getAdapter(a ?? DEFAULT_ADAPTERS);
}

/**
 * 调用 adapter，并把同步抛出的异常转成 rejection，保证调用方总能走 `.then/.catch`
 * 链路（否则 share 的条目会永不 settle、loading 计数会泄漏）。
 *
 * Calls an adapter, turning a synchronous throw into a rejection so callers can
 * always rely on the promise chain (otherwise share entries never settle and
 * loading counters leak).
 *
 * @param adapter 要调用的 adapter / the adapter to call
 * @param config 本次请求配置 / this request's config
 * @returns adapter 结果的 promise，同步异常表现为 rejection / the adapter's promise; a sync throw becomes a rejection
 */
export function callAdapter(adapter: AxiosAdapter, config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    return new Promise<AxiosResponse>((resolve) => resolve(adapter(config)));
}


/**
 * 克隆 `axios.defaults`，使其可以安全交给 `axios.create` 用于派生实例：可变容器
 * 复制一份，原始值/sink/函数按引用共享；`headers` 形状是 axios 特有的（按方法分组），
 * 所以多下探一层。
 *
 * Clones `axios.defaults` so it's safe to hand to `axios.create` for a derived
 * instance: mutable containers are duplicated, primitives/sinks/functions are
 * shared; `headers`'s per-method nested shape gets one extra level of walking.
 *
 * @param d 待克隆的 axios defaults / the axios defaults to clone
 */
export function cloneAxiosDefaults(d: AxiosRequestConfig): AxiosRequestConfig {
    return {
        ...d,
        headers: cloneAxiosHeaders(d.headers),
        params: d.params && typeof d.params === 'object' ? { ...d.params } : d.params,
        transformRequest: asArray(d.transformRequest),
        transformResponse: asArray(d.transformResponse),
        transitional: d.transitional ? { ...d.transitional } : d.transitional,
    };
}

/**
 * 克隆 `axios.defaults.headers`：`AxiosHeaders` 实例走自带拷贝构造；普通对象按
 * "按方法分组"的嵌套形状逐层浅拷贝，避免子实例改动污染父实例。
 *
 * Clones `axios.defaults.headers`: an `AxiosHeaders` instance uses its own copy
 * constructor; a plain object is shallow-cloned one level deep to match its
 * per-method nested shape, so child mutations never pollute the parent.
 *
 * @param h 待克隆的 headers / the headers to clone
 */
export function cloneAxiosHeaders(h: AxiosRequestConfig['headers']): AxiosRequestConfig['headers'] {
    if (h == null) return h;
    if (h instanceof AxiosHeaders) return new AxiosHeaders(h);
    // Per-method nested shape: { common: {...}, get: {...}, post: {...}, ... }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(h)) {
        const v = (h as Record<string, unknown>)[k];
        out[k] = v && typeof v === 'object' ? { ...(v as object) } : v;
    }
    return out as AxiosRequestConfig['headers'];
}

