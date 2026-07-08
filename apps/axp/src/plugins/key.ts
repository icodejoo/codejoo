
import type { AxiosRequestConfig } from 'axios';
import type { Plugin, IPluginCommonRequestOptions, MaybeFun } from '../types';



const name = 'axp:key'

/**
 * 为每个请求生成稳定唯一的 key（写入 `config.key`），供 cache/share 等下游插件做去重/缓存标识。
 *
 * Generates a stable unique key per request (written to `config.key`) for downstream plugins (cache/share) to use as a dedup/cache id.
 *
 * @param options 插件级默认（`fastMode`/`ignores`/`sample`），可被请求级 `config.key` 覆盖；`before`/`after` 在 key 计算前后调用 / plugin-level defaults, overridable per-request via `config.key`; `before`/`after` hooks fire around key computation
 */
export default function axpKey({ after, before, enable = true, fastMode, ignores, sample }: IKeyOptions = {}): Plugin {
    // 插件级默认（请求级未指定时回退到此）
    const defaults: IKeyObject = { fastMode, ignores, sample };
    return {
        name: name,
        install(axios) {
            const id = axios.interceptors.request.use(
                /** 解析并写回 `config.key`，前后触发 `before`/`after` 钩子 / resolves and writes back `config.key`, firing `before`/`after` around it */
                function $normalize(config) {
                    before?.(config)
                    config.key = $parse(config as AxiosRequestConfig, defaults) ?? undefined
                    after?.(config)
                    return config
                },
                null,
                {
                    // 仅当请求显式设置了 key 才进入拦截器；与 $parse 顶部 falsy 早退条件一致
                    // （key=0 仍视为有效，不要被 !key 漏掉）
                    runWhen: (config) => enable && isEnabled(config.key),
                },
            );
            return () => { axios.interceptors.request.eject(id); };
        },
    };
}

/**
 * 与 `$parse` 首行同语义：请求是否显式启用了 key 生成（`key=0` 仍算启用，不能只判 `!key`）。
 *
 * Same check as `$parse`'s first line: whether key generation was explicitly enabled (`key=0` still counts, so a plain `!key` would wrongly skip it).
 */
function isEnabled(k: unknown): boolean {
    if (k === 0) return true;
    if (!k) return false;
    if (typeof k === 'string') return k.trim() !== '';
    return true;
}

/**
 * 解析 `config.key` 得到最终 key 字符串（`null` = 不生成）。优先级：请求级显式字段 > 插件级 defaults > 内置默认。
 *
 * Resolves `config.key` into the final key string (`null` = don't generate). Priority: explicit request field > plugin `defaults` > built-in default.
 *
 * @internal exported for unit tests
 * @param defaults 插件级默认配置 / plugin-level defaults
 */
export function $parse(config: AxiosRequestConfig, defaults?: IKeyObject): string | null {
    const build = config.key
    if (!build && build !== 0) return null
    // key:true → 默认 simple，插件级 fastMode 可覆盖；插件级 ignore 列表透传
    if (build === true) return $key(config, defaults?.fastMode ?? true, defaults, defaults?.sample ?? false)
    if (typeof build === 'number') return build.toString()
    if (typeof build === 'string') {
        // 'deep' 字符串强制 deep，但仍用插件级 ignore 列表
        if (build === 'deep') return $key(config, false, defaults, defaults?.sample ?? false)
        return build.trim() || null
    }
    if (typeof build === 'function') return build(config)?.toString() || null
    if (typeof build === 'object') {
        // 对象形式：请求级字段优先，插件级 defaults 兜底，最后内置默认（deep）
        return $key(
            config,
            build.fastMode ?? defaults?.fastMode ?? false,
            { ignores: build.ignores ?? defaults?.ignores },
            build.sample ?? defaults?.sample ?? false,
        )
    }
    return null;
}


/** @internal 内部哈希选项载体，供 `$key`/`deepHash` 使用 / internal hashing-options carrier for `$key`/`deepHash` */
export interface KeyOpts {
    /** 豁免空值过滤的键名或值——同一份列表，既按键名匹配也按值匹配（对齐 dioman `DiomanKey.ignores`）/ keys or values exempt from empty-value filtering — one list, matched against both names and values (mirrors dioman's `DiomanKey.ignores`) */
    ignores?: any[];
}


const FNV_PRIME = 16777619;
const FNV_OFFSET = 2166136261 >>> 0;
/* 第二条车道的种子（黄金比例常量）。两条 FNV-1a 用不同 offset 起步，
 * 轨迹相互独立 —— 一条碰撞不蕴含另一条碰撞，拼接后得到 ~64bit 抗碰撞强度。 */
const FNV_OFFSET_2 = 0x9e3779b1 >>> 0;
const CC_COMMA = 0x2c;  // ','
const CC_COLON = 0x3a;  // ':'
const CC_ARR = 0x61;    // 'a'
const CC_OBJ = 0x6f;    // 'o'
const SAMPLE_THRESHOLD = 64;
const SAMPLE_WINDOW = 8;


/**
 * 流式 FNV-1a 双车道——单 key 由两条独立种子的 32bit FNV 拼接成 ~64bit，把生日碰撞阈值从 ~7.7 万个 key 推到 ~50 亿，cache 误命中实际归零。
 *   - simple：仅 method+url（去重/share 够用）；deep（默认）：method+url+完整 params+完整 data
 *   - opts.ignores：deep 模式下让指定键/值豁免空值过滤
 *   - sample：仅对 >64 字符长串采样（默认 false=全量哈希，避免“中段差异”碰撞；仅超大 payload 场景开启）
 *   - 性能：对象层用可交换累加代替 `Object.keys().sort()`，省掉排序与分配开销
 *
 * Streaming FNV-1a, two lanes — a key concatenates two independently-seeded 32-bit FNV digests into ~64 bits, pushing the birthday-collision threshold from ~77K keys to ~5 billion.
 *   - simple: method+url only; deep (default): method+url+full params+full data
 *   - opts.ignores: exempt specific keys/values from empty-value filtering in deep mode
 *   - sample: samples only strings >64 chars (default `false` = full hash, avoiding "middle-differs" collisions; only for huge payloads)
 *   - perf: object layer uses commutative accumulation instead of `Object.keys().sort()`, skipping sort/allocation overhead
 *
 * @internal exported for unit tests
 * @param simple simple 模式（仅 method+url）；默认 true / simple mode (method+url only); default true
 * @param opts 哈希选项，仅非 simple 模式生效 / hashing options, only used in non-simple mode
 * @param sample 是否对长串采样而非全量哈希 / whether to sample long strings instead of full hashing
 * @returns 两条车道拼接成的 key（base36，`-` 分隔）/ the two lanes concatenated (base36, `-`-separated)
 */
export function $key(config: AxiosRequestConfig, simple = true, opts?: KeyOpts, sample = false): string {
    const a = lane(config, simple, opts, sample, FNV_OFFSET);
    const b = lane(config, simple, opts, sample, FNV_OFFSET_2);
    // '-' 不属于 base36 字母表，作分隔避免 "1"+"23" 与 "12"+"3" 撞键
    return a.toString(36) + '-' + b.toString(36);
}

/**
 * 单条车道：从给定种子计算 32bit 摘要，两条车道结构相同、种子不同。
 *
 * A single lane: computes a 32-bit digest from the given seed; both lanes share the same structure and differ only in seed.
 *
 * @param seed 该车道的起始种子（两条车道各自独立）/ this lane's starting seed (independent per lane)
 */
function lane(config: AxiosRequestConfig, simple: boolean, opts: KeyOpts | undefined, sample: boolean, seed: number): number {
    let h = seed;
    h = hash((config.method || '').toUpperCase(), h);
    h = hash('|', h);
    h = hash(config.url || '', h);

    if (simple) return h;

    // ignores 命中时会让本来"shallow 看似空"的容器实际产生贡献，必须跳过短路
    const skipShallow = !!opts?.ignores?.length;

    if (skipShallow || !isShallowEmpty(config.params)) {
        const r = deepHash(config.params, hash('|p', h), opts, sample);
        if (r !== undefined) h = r;
    }
    if (skipShallow || !isShallowEmpty(config.data)) {
        const r = deepHash(config.data, hash('|d', h), opts, sample);
        if (r !== undefined) h = r;
    }
    return h;
}


/**
 * 浅层判空（深度 1）：$key 入口快速短路。null/undefined/[]/{} → 空；所有 child 都是 null/undefined/[]/{} → 空（如 [{}]/{a:[]}）；更深嵌套（如 [[{}]]）不抓，留给 deepHash 的 undefined 兜底。
 *
 * Shallow (depth-1) emptiness check used as a fast short-circuit at the `$key` entry: catches null/undefined/[]/{} and children that are all empty (e.g. [{}]/{a:[]}); deeper nesting (e.g. [[{}]]) falls through to `deepHash`'s `undefined` return.
 */
function isShallowEmpty(v: any): boolean {
    if (v == null) return true;
    if (typeof v !== 'object') return false;
    if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
            if (!isDirectEmpty(v[i])) return false;
        }
        return true;
    }
    for (const k in v) {
        if (!isDirectEmpty(v[k])) return false;
    }
    return true;
}

/** 判断单个值是否"直接为空"（不递归容器内部，仅看自身形态）/ whether a value is "directly empty" (no recursion into containers, shape only) */
function isDirectEmpty(v: any): boolean {
    if (v == null || Number.isNaN(v)) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (typeof v !== 'object') return false;
    if (Array.isArray(v)) return v.length === 0;
    for (const _ in v) return false;
    return true;
}


/** FNV-1a 多字节累加：逐字符异或+乘法混合 / FNV-1a multi-byte accumulation: per-char XOR-then-multiply */
function hash(str: string, seed: number): number {
    let h = seed;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, FNV_PRIME);
    }
    return h >>> 0;
}

/** FNV-1a 单字节累加：避免为单字符构造字符串再走完整循环 / FNV-1a single-byte accumulation: skips building a 1-char string for the full loop */
function hashByte(c: number, h: number): number {
    return Math.imul(h ^ c, FNV_PRIME) >>> 0;
}


/**
 * 单遍递归 hash + 判空：返回 undefined 表示 target 整体判空，调用方应回滚。
 *   - null/undefined/NaN → undefined（除非命中 opts.ignores 被强制保留）；空 Buffer → undefined
 *   - 容器递归判空（如 [[{}]]、{a:{b:[]}}）→ undefined
 *   - 非空容器以 'a'/'o' 起头、',' 分隔 item、对象内 ':' 分隔 key/value
 *   - 对象迭代时若 key 命中 opts.ignores 但 value 是空，仍以占位符强制保留
 *   - 不做循环引用保护与深度限制，调用方需保证 config 无环可序列化（与 axios 实际行为一致）
 *
 * Single-pass recursive hash + emptiness check: `undefined` means `target` as a whole is empty and the caller should roll back.
 *   - null/undefined/NaN → `undefined` (unless force-kept via `opts.ignores`); empty Buffer → `undefined`
 *   - recursively-empty containers (e.g. [[{}]], {a:{b:[]}}) → `undefined`
 *   - non-empty containers prefixed 'a'/'o', items separated by ',', object key/value separated by ':'
 *   - a key matching `opts.ignores` with an empty value is still force-kept via a placeholder
 *   - no cycle protection or depth limit; caller must guarantee `config` is acyclic and serializable (matches axios's actual behavior)
 *
 * @param h 父级传入的种子/累积哈希值 / seed/accumulator passed down from the parent
 * @returns 混合后的哈希值；`undefined` 表示 target 判空 / the mixed hash value; `undefined` means `target` is empty
 */
function deepHash(target: any, h: number, opts?: KeyOpts, sample = false): number | undefined {
    // 顶部一次性 destructure：避免每层递归重复 ?. 链式查找
    const ignores = opts?.ignores;
    if (ignores?.length && matchesIgnoreValue(target, ignores)) {
        return hash('!' + safeStr(target), h);
    }
    // 默认过滤：null / undefined / NaN / 空串（trim 后）
    if (target == null || Number.isNaN(target)) return undefined;
    const t = typeof target;
    if (t === 'string') return stringHash(target, h, sample);
    if (t !== 'object') return hash(String(target), h);
    if (typeof target.byteLength === 'number') {
        return target.byteLength === 0 ? undefined : hash('bin' + target.byteLength, h);
    }
    if (Array.isArray(target)) {
        // 数组：顺序有语义，保持顺序串行哈希（[1,2] ≠ [2,1]）
        let any = false;
        for (let i = 0; i < target.length; i++) {
            const r = deepHash(target[i], hashByte(any ? CC_COMMA : CC_ARR, h), opts, sample);
            if (r !== undefined) {
                h = r;
                any = true;
            }
        }
        return any ? h : undefined;
    }
    // 对象：key 顺序无语义 —— 用可交换累加（加法）合并各字段子哈希，
    // 天然顺序无关，省掉 Object.keys().sort() 的排序与分配（多参数下是主要开销）。
    // 每个字段的子哈希都从同一父级 h 派生（与兄弟字段的顺序无关），保证
    // {a,b,c} ≡ {c,b,a}；key 仍并入子哈希，保证 {ab:1} ≠ {a:'b1'}。
    const hasIgnores = !!ignores?.length;
    let acc = 0;
    let any = false;
    for (const key in target) {
        if (!Object.prototype.hasOwnProperty.call(target, key)) continue;
        const baseH = hashByte(CC_COLON, hash(key, hashByte(CC_OBJ, h)));
        let r = deepHash(target[key], baseH, opts, sample);
        // ignores 命中键名且 value 判空：注入占位符 '!E'，保证该 key 仍参与最终 hash
        if (r === undefined && hasIgnores && ignores!.includes(key)) {
            r = hash('!E', baseH);
        }
        if (r !== undefined) {
            acc = (acc + r) >>> 0;
            any = true;
        }
    }
    // 把可交换累加值并回父级 h，使“父级上下文”与“字段内容”都参与最终摘要
    return any ? hash('}', (h + acc) >>> 0) : undefined;
}


/** ignores 值命中检测：=== 比较 + NaN 特例 / ignores value-match check: `===` comparison plus a NaN special case */
function matchesIgnoreValue(target: any, list: any[]): boolean {
    const targetIsNaN = Number.isNaN(target);
    for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (v === target) return true;
        if (targetIsNaN && Number.isNaN(v)) return true;
    }
    return false;
}

/** 把任意 falsy/特殊值转成稳定的短字符串标签 / converts any falsy/special value into a stable short string tag */
function safeStr(v: any): string {
    if (v === undefined) return 'u';
    if (v === null) return 'n';
    if (Number.isNaN(v)) return 'NaN';
    if (v === '') return 'e';
    return String(v);
}


/**
 * 字符串指纹：空串/全空白 → undefined（默认过滤，需保留请用 ignores）；默认全量 hash，杜绝“中段差异”碰撞；sample=true 且 >64 字符时首/中/尾各采 8 字符+总长度。
 *
 * String fingerprinting: empty/whitespace-only → `undefined` (filtered by default, use `ignores` to keep); full hash by default to avoid "middle-differs" collisions; when `sample` and length >64, samples 8 chars each from head/middle/tail plus total length.
 *
 * @returns 混合后的哈希值；`undefined` 表示字符串判空（trim 后为空）/ the mixed hash value; `undefined` means the string is empty after trimming
 */
function stringHash(s: string, h: number, sample: boolean): number | undefined {
    const t = s.trim();
    const l = t.length;
    if (l === 0) return undefined;
    if (!sample || l <= SAMPLE_THRESHOLD) return hash(t, h);
    const mid = (l - SAMPLE_WINDOW) >> 1;
    h = hash(t.substring(0, SAMPLE_WINDOW), h);
    h = hash(t.substring(mid, mid + SAMPLE_WINDOW), h);
    h = hash(t.substring(l - SAMPLE_WINDOW), h);
    return hash('L' + l, h);
}

/** `axpKey` 插件配置：通用生命周期钩子 + `IKeyObject` 的哈希字段 / `axpKey` options: common lifecycle hooks plus `IKeyObject`'s hashing fields */
export interface IKeyOptions extends IPluginCommonRequestOptions, IKeyObject {

}


export interface IKeyObject {
    /** 插件级总开关 / plugin-level master switch @default true */
    enable?: boolean
    /**
     * 是否启用简单模式：`true` 仅用 method+url（性能最高），`false` 用 method+url+params+data（准确度最高）
     *
     * Simple mode: `true` uses method+url only (fastest), `false` uses method+url+params+data (most accurate)
     * @default false
     */
    fastMode?: boolean
    /** 豁免空值过滤的键名或值（同一份列表，对齐 dioman `DiomanKey.ignores`）/ keys or values exempt from empty-value filtering (one list, mirrors dioman's `DiomanKey.ignores`) */
    ignores?: any[]
    /**
     * 是否对超长字符串(>64)采样而非全量哈希：`false`(默认) 全量哈希准确度最高，`true` 仅采首/中/尾各 8 字符+长度，适合超大 payload 场景
     *
     * Whether to sample overly long strings (>64 chars): `false` (default) full hash, most accurate; `true` samples head/middle/tail (8 chars each) + length, for extreme-performance/huge-payload cases
     * @default false
     */
    sample?: boolean
}


declare module "axios" {
    interface AxiosRequestConfig {
        /** 请求级 key 配置，缺省回退插件级 defaults / request-level key config, falls back to plugin defaults when omitted */
        key?: MaybeFun<'deep' | IKeyObject | number | null | undefined | void | boolean | ({} & string)>;
    }
    interface InternalAxiosRequestConfig {
        /** `$parse` 解析后的最终 key 字符串 / the final key string resolved by `$parse` */
        key?: string
    }
}