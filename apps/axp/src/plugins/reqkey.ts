
import type { AxiosRequestConfig } from 'axios';
import type { Plugin, IPluginCommonRequestOptions, MaybeFun } from '../types';



const name = 'reqkey'

/**
 *
 * @returns 对请求生成唯一key，用于防抖、缓存等
 */
export default function reqkey({ after, before, enable = true, fastMode, ignoreKeys, ignoreValues, sample }: IReqkeyOptions = {}): Plugin {
    // 插件级默认（请求级未指定时回退到此）
    const defaults: IReqkeyObject = { fastMode, ignoreKeys, ignoreValues, sample };
    return {
        name: name,
        install(ctx) {
            ctx.request(
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
        },
    };
}

/** 与 $parse 第一行同语义：判断用户是否在请求级显式启用了 key 生成 */
function isEnabled(k: unknown): boolean {
    if (k === 0) return true;
    if (!k) return false;
    if (typeof k === 'string') return k.trim() !== '';
    return true;
}

/**
 * @internal exported for unit tests
 *   - defaults：插件级默认配置；请求级未指定时回退到此
 *   - 优先级：请求级显式字段 > 插件级 defaults > 内置默认
 */
export function $parse(config: AxiosRequestConfig, defaults?: IReqkeyObject): string | null {
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
            {
                ignoreKeys: build.ignoreKeys ?? defaults?.ignoreKeys,
                ignoreValues: build.ignoreValues ?? defaults?.ignoreValues,
            },
            build.sample ?? defaults?.sample ?? false,
        )
    }
    return null;
}


/** @internal */
export interface KeyOpts {
    ignoreValues?: any[];
    ignoreKeys?: any[];
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
 * 流式 FNV-1a 双车道 —— 单 key 由两条独立种子的 32bit FNV 拼接成 ~64bit，
 * 把生日碰撞阈值从 ~7.7 万个 key 推到 ~50 亿，cache 误命中实际归零。
 *
 *   - simple：仅 method + url（去重/share 够用）
 *   - deep（默认）：method + url + 完整 params + 完整 data
 *   - opts.ignoreValues / opts.ignoreKeys：在 deep 模式下让指定值/键豁免空值过滤
 *   - sample：仅对 >64 字符的长字符串采样（默认 false=全量哈希，避免“中段差异”结构碰撞；
 *     仅在确有超大 payload 又能接受采样风险时开启）
 *
 * 性能：对象层用“可交换累加”代替 `Object.keys().sort()`，多参数场景去掉 O(k log k)
 * 排序与每层数组分配；即便跑两条车道，多 key 时总成本仍低于旧版“单遍 + 排序”。
 *
 * @internal exported for unit tests
 */
export function $key(config: AxiosRequestConfig, simple = true, opts?: KeyOpts, sample = false): string {
    const a = lane(config, simple, opts, sample, FNV_OFFSET);
    const b = lane(config, simple, opts, sample, FNV_OFFSET_2);
    // '-' 不属于 base36 字母表，作分隔避免 "1"+"23" 与 "12"+"3" 撞键
    return a.toString(36) + '-' + b.toString(36);
}

/** 单条车道：从给定种子计算 32bit 摘要。两条车道结构完全一致，只是种子不同。 */
function lane(config: AxiosRequestConfig, simple: boolean, opts: KeyOpts | undefined, sample: boolean, seed: number): number {
    let h = seed;
    h = hash((config.method || '').toUpperCase(), h);
    h = hash('|', h);
    h = hash(config.url || '', h);

    if (simple) return h;

    // ignoreKeys/ignoreValues 会让本来"shallow 看似空"的容器实际产生贡献，必须跳过短路
    const skipShallow = !!(opts?.ignoreKeys?.length || opts?.ignoreValues?.length);

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
 * 浅层判空（深度 1）：$key 入口快速短路
 *   - null / undefined → 空
 *   - [] / {} → 空
 *   - 所有 child 都是 null/undefined/[]/{} → 空（如 [{}] / {a:[]}）
 *   - 更深层嵌套（如 [[{}]]）不抓，留给 hashDeep 的 undefined 返回兜底
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

function isDirectEmpty(v: any): boolean {
    if (v == null || Number.isNaN(v)) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (typeof v !== 'object') return false;
    if (Array.isArray(v)) return v.length === 0;
    for (const _ in v) return false;
    return true;
}


/** FNV-1a 多字节累加 */
function hash(str: string, seed: number): number {
    let h = seed;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, FNV_PRIME);
    }
    return h >>> 0;
}

/** FNV-1a 单字节累加：避免 1 字符串走完整循环的开销 */
function hashByte(c: number, h: number): number {
    return Math.imul(h ^ c, FNV_PRIME) >>> 0;
}


/**
 * 单遍递归 hash + 判空：返回 undefined 表示 target 整体判空，调用方应回滚
 *   - null / undefined / NaN → undefined（除非命中 opts.ignoreValues 被强制保留）
 *   - 空 Buffer → undefined
 *   - 容器递归判空（如 [[{}]]、{a:{b:[]}}）→ undefined
 *   - 非空容器以 'a'/'o' 起头、',' 分隔 item、对象内 ':' 分隔 key/value
 *   - 对象迭代时若 key 命中 opts.ignoreKeys 但 value 是空，仍以占位符强制保留
 *   - 不再做循环引用保护与深度限制，调用方需保证 config 是无环可序列化的（与 axios 实际行为一致）
 */
function deepHash(target: any, h: number, opts?: KeyOpts, sample = false): number | undefined {
    // 顶部一次性 destructure：避免每层递归重复 ?. 链式查找
    const ignoreValues = opts?.ignoreValues;
    if (ignoreValues?.length && matchesIgnoreValue(target, ignoreValues)) {
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
    const forceKeys = opts?.ignoreKeys;
    const hasForceKeys = !!forceKeys?.length;
    let acc = 0;
    let any = false;
    for (const key in target) {
        if (!Object.prototype.hasOwnProperty.call(target, key)) continue;
        const baseH = hashByte(CC_COLON, hash(key, hashByte(CC_OBJ, h)));
        let r = deepHash(target[key], baseH, opts, sample);
        // ignoreKeys 命中且 value 判空：注入占位符 '!E'，保证该 key 仍参与最终 hash
        if (r === undefined && hasForceKeys && forceKeys!.includes(key)) {
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


/** ignoreValues 命中检测：=== 比较 + NaN 特例 */
function matchesIgnoreValue(target: any, list: any[]): boolean {
    const targetIsNaN = Number.isNaN(target);
    for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (v === target) return true;
        if (targetIsNaN && Number.isNaN(v)) return true;
    }
    return false;
}

/** 把任意 falsy/特殊值转成稳定的短字符串标签 */
function safeStr(v: any): string {
    if (v === undefined) return 'u';
    if (v === null) return 'n';
    if (Number.isNaN(v)) return 'NaN';
    if (v === '') return 'e';
    return String(v);
}


/**
 * 字符串指纹：
 *   - 空串/全空白：返回 undefined（默认过滤；若需保留请用 ignoreValues）
 *   - 默认（sample=false）：全量 hash —— 字节级 imul 循环对 HTTP 参数成本可忽略，
 *     彻底消除“仅中段不同的长串”这类结构碰撞（cache 误命中的主要来源）
 *   - sample=true 且 > 64 字符：首/中/尾各采 8 字符 + 总长度（24 字符样本，仅在
 *     确有超大 payload 且能接受采样风险时启用）
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

export interface IReqkeyOptions extends IPluginCommonRequestOptions, IReqkeyObject {

}


export interface IReqkeyObject {
    enable?: boolean
    /**
     * 是否启用简单模式。
     * - `true`: 仅使用method+url，性能最高
     * - `false`: 使用method+url+params+data，准确度最高
     * @default false
     */
    fastMode?: boolean
    /**
     * 哪些值不参与过滤
     */
    ignoreValues?: any[],
    /**
     * 哪些键不参与过滤
     */
    ignoreKeys?: any[]
    /**
     * 是否对超长字符串(>64)采样而非全量哈希。
     * - `false`(默认): 全量哈希，最高准确度，杜绝“中段差异”结构碰撞
     * - `true`: 仅采首/中/尾各 8 字符 + 长度，适合确有超大 payload 的极端性能场景
     * @default false
     */
    sample?: boolean
}


declare module "axios" {
    interface AxiosRequestConfig {
        key?: MaybeFun<'deep' | IReqkeyObject | number | null | undefined | void | boolean | ({} & string)>;
    }
    interface InternalAxiosRequestConfig {
        key?: string
    }
}