import { AxiosHeaders } from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type { PluginLogger, Primitive } from './types';

/**
 * 编译期常量：生产构建中 bundler 把 `process.env.NODE_ENV` 替换成字面量，
 * 本常量折叠成 `false`，`if (__DEV__) {...}` 整块被 DCE 掉；`typeof` 守卫防止
 * 浏览器未注入 `process` 时抛 ReferenceError。
 *
 * Compile-time constant: bundlers replace `process.env.NODE_ENV` with a literal
 * in production, folding this to `false` so `if (__DEV__) {...}` gets DCE'd;
 * the `typeof` guard avoids a ReferenceError when `process` isn't injected (browser).
 */
export const __DEV__: boolean =
    typeof process !== 'undefined' &&
    !!process.env &&
    process.env.NODE_ENV !== 'production';

/** 全项目日志命名空间标签 / Project-wide log namespace tag. */
export const NS = '[http-plugins]';

/** 空操作 logger，`debug` 关闭时使用 / No-op logger, used when `debug` is off. */
export const NOOP_LOGGER: PluginLogger = {
    log: () => { },
    warn: () => { },
    error: () => { },
};

/** 默认 logger，包装 `console.*` / Default logger, wraps `console.*`. */
export const CONSOLE_LOGGER: PluginLogger = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
};

/* Browser DevTools support `%c` CSS substitution; Node terminals support ANSI
 * SGR codes. Detect once at module load and pick the right path. */
const IS_BROWSER =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { document?: unknown }).document !== 'undefined';

const BROWSER_TAG_STYLE =
    'background:#2563eb;color:#fff;padding:1px 6px;border-radius:3px;font-weight:600';
const BROWSER_RESET_STYLE = '';

const ANSI_TAG = '\x1b[44;97m'; // bg blue, fg bright white
const ANSI_RESET = '\x1b[0m';

/**
 * 装饰一个 logger，使每行输出带上蓝底白字的 `tag` 前缀；遇到不支持 `%c`/ANSI 的
 * 输出目标会优雅降级，标签依然可读。
 *
 * Decorates a logger so every line is prefixed with `tag` in blue-bg/white-fg;
 * degrades gracefully on sinks that don't understand `%c`/ANSI.
 *
 * @param base 被装饰的原始 logger / the underlying logger
 * @param tag 前缀标签文本 / the tag text to prefix
 * @returns 新的 `PluginLogger`，其方法均带 `tag` 前缀 / a new tagged `PluginLogger`
 */
export function tagged(base: PluginLogger, tag: string): PluginLogger {
    if (IS_BROWSER) {
        const fmt = `%c${tag}%c`;
        return {
            log: (...a) => base.log(fmt, BROWSER_TAG_STYLE, BROWSER_RESET_STYLE, ...a),
            warn: (...a) => base.warn(fmt, BROWSER_TAG_STYLE, BROWSER_RESET_STYLE, ...a),
            error: (...a) => base.error(fmt, BROWSER_TAG_STYLE, BROWSER_RESET_STYLE, ...a),
        };
    }
    const colored = `${ANSI_TAG}${tag}${ANSI_RESET}`;
    return {
        log: (...a) => base.log(colored, ...a),
        warn: (...a) => base.warn(colored, ...a),
        error: (...a) => base.error(colored, ...a),
    };
}

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


/*
 * 类型守卫改为独立具名函数 —— 静态方法类是单一打包单元，bundler 无法摇掉未用方法；
 * 拆成独立 `export function` 后未引用者会被 tree-shaking 干净移除。
 * 仅 `isObject` / `isPrimitive` 当前被使用，其余按需保留供插件作者使用。
 *
 * Type guards are standalone named functions rather than static methods on a
 * class — a class is a single bundling unit bundlers can't shake; split into
 * `export function`s, unreferenced ones tree-shake away cleanly. Only
 * `isObject`/`isPrimitive` are used internally; the rest are kept for plugin authors.
 */

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

/** 是否为数组 / whether `val` is an array. */
export function isArray(val: unknown): val is any[] {
    return Array.isArray(val);
}

/** 是否为字符串 / whether `val` is a string. */
export function isString(val: unknown): val is string {
    return typeof val === 'string';
}

/** 是否为数字（含 NaN） / whether `val` is a number (including NaN). */
export function isNumber(val: unknown): val is number {
    return typeof val === 'number';
}

/** 是否为函数 / whether `val` is a function. */
export function isFunction(val: unknown): val is Function {
    return typeof val === 'function';
}

/** 是否为 Date 实例 / whether `val` is a Date instance. */
export function isDate(val: unknown): val is Date {
    return val instanceof Date;
}

/** 是否为 null / whether `val` is null. */
export function isNull(val: unknown): val is null {
    return val === null;
}

/** 是否为 undefined / whether `val` is undefined. */
export function isUndefined(val: unknown): val is undefined {
    return val === undefined;
}

/** 是否为 Map 实例 / whether `val` is a Map instance. */
export function isMap(val: unknown): val is Map<any, any> {
    return val instanceof Map;
}

/** 是否为 Set 实例 / whether `val` is a Set instance. */
export function isSet(val: unknown): val is Set<any> {
    return val instanceof Set;
}

/** 是否为原始值（null，或 typeof 非 object/function） / whether `val` is a primitive (null, or typeof isn't object/function). */
export function isPrimitive(val: unknown): val is Primitive {
    if (val === null) return true;
    const type = typeof val;
    return type !== 'object' && type !== 'function';
}

/**
 * 判断是否为本工具定义的“空值”：undefined、null 或 NaN；注意不同于 JS 的
 * truthy/falsy —— 不把 0/''/false 计入。
 *
 * Whether `val` counts as "empty" here: undefined, null, or NaN — note this
 * differs from JS truthy/falsy (does NOT treat 0/''/false as empty).
 *
 * @param val 待判断的值 / the value to check
 */
export function falsy(val: unknown): boolean {
    return val === void 0 || val === null || Number.isNaN(val);
}

/**
 * 返回新对象，过滤掉所有值为 null/undefined 的字段；不修改原对象。
 *
 * Returns a new object with all null/undefined-valued fields removed; does not mutate the original.
 *
 * @param obj 源对象 / the source object
 * @returns 过滤后的新对象（浅拷贝） / a new, shallow-copied object with empty fields removed
 */
export function filterObjectEmpty<T extends object>(obj: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => v != null) // v != null 同时过滤了 null 和 undefined
    ) as Partial<T>;
};


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

