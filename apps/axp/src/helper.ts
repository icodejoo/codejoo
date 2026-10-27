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



/** adapter 链上的一层：`wrap` 只调用一次，`next` 会随链重建而重新指向下一层 / one layer of the adapter chain */
interface AdapterLayer {
    /** 下一层（更靠近底层）；重建链时更新 */
    next: AxiosAdapter;
    /** 已被移除后变为直通 */
    removed: boolean;
    /** 本层对外暴露的 adapter */
    fn: AxiosAdapter;
}

/** 某个 axios 实例上的 adapter 层状态 */
interface AdapterChain {
    /** 最底层（未被任何插件包装）的 adapter */
    base: AxiosAdapter;
    /** 按安装顺序排列，后装的在外层 */
    layers: AdapterLayer[];
    /** 当前链顶，用于探测 `defaults.adapter` 是否被外部替换 */
    top: AxiosAdapter;
}

/** 每个 axios 实例当前的 adapter 链 */
const adapterChains = new WeakMap<AxiosInstance, AdapterChain>();

/** 按当前层列表重连各层的 next，并返回链顶 */
function relinkChain(chain: AdapterChain): AxiosAdapter {
    let below = chain.base;
    for (const layer of chain.layers) {
        layer.next = below;
        below = layer.fn;
    }
    chain.top = below;
    return below;
}

/**
 * 在 axios 实例的 adapter 上叠加一层包装，返回只移除“这一层”的函数。各层可按任意顺序移除，
 * 其余层保持生效，也不会把已移除的层复活。
 *
 * @param axios 目标实例
 * @param wrap 层工厂，只会被调用一次；`prev` 始终指向当前下一层，须通过它转调而不是缓存旧引用
 * @returns 移除本层的函数（可重复调用）
 * @example
 * const off = wrapAdapter(ax, (prev) => (config) => prev(config));
 * off();
 */
export function wrapAdapter(axios: AxiosInstance, wrap: (prev: AxiosAdapter) => AxiosAdapter): () => void {
    let chain = adapterChains.get(axios);
    // defaults.adapter 被外部替换过：以当前值作为新的底层，旧链自成一体不再干预
    if (!chain || axios.defaults.adapter !== chain.top) {
        const base = resolveAdapter(axios);
        chain = { base, layers: [], top: base };
        adapterChains.set(axios, chain);
    }
    const own = chain;
    const layer = { removed: false } as AdapterLayer;
    layer.next = own.top;
    const inner = wrap((config) => layer.next(config));
    layer.fn = (config) => (layer.removed ? layer.next(config) : inner(config));
    own.layers.push(layer);
    axios.defaults.adapter = relinkChain(own);

    return () => {
        if (layer.removed) return;
        layer.removed = true;
        const wasTop = axios.defaults.adapter === own.top;
        own.layers.splice(own.layers.indexOf(layer), 1);
        const top = relinkChain(own);
        if (!wasTop) return;
        axios.defaults.adapter = top;
        if (!own.layers.length && adapterChains.get(axios) === own) adapterChains.delete(axios);
    };
}

/**
 * 取实例未被插件包装的底层 adapter；没有任何包装层时等同于 `resolveAdapter`。
 *
 * @param axios 目标实例
 * @returns 底层 adapter
 */
export function getBaseAdapter(axios: AxiosInstance): AxiosAdapter {
    const chain = adapterChains.get(axios);
    if (chain && axios.defaults.adapter === chain.top) return chain.base;
    return resolveAdapter(axios);
}

// ───────────── 单次尝试：原始请求体 + 尝试钩子 ─────────────

/** 保存逻辑请求原始 data 的 config 键（可枚举字符串键，能熬过 mergeConfig）。 */
const RAW_KEY = 'axp:rawRequest';

/**
 * 是否为普通对象或数组（可安全结构化克隆的纯数据）。
 * FormData/Blob/ArrayBuffer/URLSearchParams/字符串等不算：它们要么不可变，要么克隆会丢信息或开销大，保持引用。
 */
function isPlainData(data: unknown): data is object {
    if (Array.isArray(data)) return true;
    if (data === null || typeof data !== 'object') return false;
    const proto = Object.getPrototypeOf(data);
    return proto === Object.prototype || proto === null;
}

/** 深拷贝纯数据；非纯数据、环境不支持或拷贝失败时退回原引用。 */
function cloneData<T>(data: T): T {
    if (!isPlainData(data) || typeof structuredClone !== 'function') return data;
    try { return structuredClone(data); } catch { return data; }
}

/** 记录原始 data 的 transformRequest 首项；纯对象/数组存独立快照，防止后续 transform 原地改写。 */
function captureRaw(this: object, data: unknown): unknown {
    (this as Record<string, unknown>)[RAW_KEY] = { data: cloneData(data) };
    return data;
}

/**
 * 让 config 在 transformRequest 执行前记下原始 data（已含 filter/repath 等前置改写），
 * 供重发/重放还原；幂等，可被多个插件重复调用。
 *
 * @param config 请求拦截器阶段的 config
 */
export function captureRawRequest(config: AxiosRequestConfig): void {
    const list = asArray(config.transformRequest as unknown as AxiosRequestConfig['transformRequest'] & object);
    if (list.includes(captureRaw as never)) return;
    config.transformRequest = [captureRaw as never, ...list];
}

/**
 * 还原原始请求体：返回浅拷贝，data 换回 transformRequest 之前的值；没捕获过则原样拷贝。
 *
 * @param config 上一次尝试用过的 config
 * @returns 可再次发送的 config 副本
 */
export function withRawRequest<C extends AxiosRequestConfig>(config: C): C {
    const raw = (config as Record<string, unknown>)[RAW_KEY] as { data: unknown } | undefined;
    return raw ? { ...config, data: cloneData(raw.data) } : { ...config };
}

/** 单次尝试钩子：请求准备 + 响应路由，由 auth 这类插件登记。 */
export interface AttemptHook {
    /** 请求侧准备（注入凭证、等待刷新）；抛错表示这次尝试被拒。 */
    onRequest(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig>;
    /** 响应侧路由（成功分支）。 */
    onResponse(response: AxiosResponse): Promise<AxiosResponse>;
    /** 响应侧路由（失败分支）。 */
    onError(error: unknown): Promise<AxiosResponse>;
}

/** 按实例登记的尝试钩子。 */
const attemptHooks = new WeakMap<AxiosInstance, AttemptHook[]>();

/** 不带任何拦截器的裸实例，所有单次尝试共用。 */
const bareRunner = axiosLib.create();

/**
 * 登记单次尝试钩子。
 *
 * @param axios 目标实例
 * @param hook 钩子
 * @returns 注销函数
 */
export function registerAttemptHook(axios: AxiosInstance, hook: AttemptHook): () => void {
    const list = attemptHooks.get(axios) ?? [];
    list.push(hook);
    attemptHooks.set(axios, list);
    return () => {
        const i = list.indexOf(hook);
        if (i >= 0) list.splice(i, 1);
        if (!list.length && attemptHooks.get(axios) === list) attemptHooks.delete(axios);
    };
}

/**
 * 以裸实例执行一次网络尝试：还原原始请求体 → 依次跑已登记钩子的请求准备 → 发送 →
 * 依次走钩子的响应路由。不经过 notify/normalize 等最终处理，也不消耗 retry 预算。
 *
 * @param axios 登记过钩子的实例
 * @param config 上一次尝试用过的 config（可附带需恢复的请求级开关）
 * @returns 本次尝试的响应；失败时 reject
 */
export function runAttempt(axios: AxiosInstance, config: AxiosRequestConfig): Promise<AxiosResponse> {
    const hooks = (attemptHooks.get(axios) ?? []).slice();
    const next = withRawRequest(config);
    let p: Promise<AxiosResponse> = (async () => {
        let cfg = next as InternalAxiosRequestConfig;
        for (const h of hooks) cfg = await h.onRequest(cfg);
        return bareRunner.request(cfg);
    })();
    for (const h of hooks) p = p.then(h.onResponse, h.onError);
    return p;
}
