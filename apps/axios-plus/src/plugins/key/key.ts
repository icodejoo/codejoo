
import { AxiosRequestConfig } from 'axios';
import type { Plugin } from '../../plugin/types';
import {Type,  isRetry , lockName} from '../../helper';
import type { IKeyOptions, IKeyObject, KeyOpts } from './types';


export const name = 'key';


/**
 *
 * @returns 对请求生成唯一key，用于防抖、缓存等
 */
export default function key({ after, before, enable = true, fastMode, ignoreKeys, ignoreValues }: IKeyOptions = {}): Plugin {
    // 插件级默认（请求级未指定时回退到此）
    const defaults: IKeyObject = { fastMode, ignoreKeys, ignoreValues };
    return {
        name,
        install(ctx) {
            ctx.request(
                function $normalize(config) {
                    // 重试请求 key 已在首发时算好（method+url+params/data 是稳定输入），跳过节省一次哈希
                    if (isRetry(config)) return config;
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
export function $parse(config: AxiosRequestConfig, defaults?: IKeyObject): string | null {
    const build = config.key
    if (!build && build !== 0) return null
    // key:true → 默认 simple，插件级 fastMode 可覆盖；插件级 ignore 列表透传
    if (build === true) return $key(config, defaults?.fastMode ?? true, defaults)
    if (typeof build === 'number') return build.toString()
    if (typeof build === 'string') {
        // 'deep' 字符串强制 deep，但仍用插件级 ignore 列表
        if (build === 'deep') return $key(config, false, defaults)
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
        )
    }
    return null;
}


const FNV_PRIME = 16777619;
const FNV_OFFSET = 2166136261 >>> 0;
const CC_COMMA = 0x2c;  // ','
const CC_COLON = 0x3a;  // ':'
const CC_ARR = 0x61;    // 'a'
const CC_OBJ = 0x6f;    // 'o'
const SAMPLE_THRESHOLD = 64;
const SAMPLE_WINDOW = 8;


/**
 * 流式 FNV-1a，单遍递归同时完成 hash 和判空
 *   - simple：仅 method + url
 *   - deep（默认）：method + url + 完整 params + 完整 data
 *   - opts.ignoreValues / opts.ignoreKeys：在 deep 模式下让指定值/键豁免空值过滤
 * @internal exported for unit tests
 */
export function $key(config: AxiosRequestConfig, simple = true, opts?: KeyOpts): string {
    let h = FNV_OFFSET;
    h = hash((config.method || '').toUpperCase(), h);
    h = hash('|', h);
    h = hash(config.url || '', h);

    if (simple) return h.toString(36);

    // ignoreKeys/ignoreValues 会让本来"shallow 看似空"的容器实际产生贡献，必须跳过短路
    const skipShallow = !!(opts?.ignoreKeys?.length || opts?.ignoreValues?.length);

    if (skipShallow || !isShallowEmpty(config.params)) {
        const r = deepHash(config.params, hash('|p', h), opts);
        if (r !== undefined) h = r;
    }
    if (skipShallow || !isShallowEmpty(config.data)) {
        const r = deepHash(config.data, hash('|d', h), opts);
        if (r !== undefined) h = r;
    }
    return h.toString(36);
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
    if (Type.isArray(v)) {
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
    if (Type.isArray(v)) return v.length === 0;
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
function deepHash(target: any, h: number, opts?: KeyOpts): number | undefined {
    // 顶部一次性 destructure：避免每层递归重复 ?. 链式查找
    const ignoreValues = opts?.ignoreValues;
    if (ignoreValues?.length && matchesIgnoreValue(target, ignoreValues)) {
        return hash('!' + safeStr(target), h);
    }
    // 默认过滤：null / undefined / NaN / 空串（trim 后）
    if (target == null || Number.isNaN(target)) return undefined;
    const t = typeof target;
    if (t === 'string') return stringHash(target, h);
    if (t !== 'object') return hash(String(target), h);
    if (typeof target.byteLength === 'number') {
        return target.byteLength === 0 ? undefined : hash('bin' + target.byteLength, h);
    }
    if (Type.isArray(target)) {
        let any = false;
        for (let i = 0; i < target.length; i++) {
            const r = deepHash(target[i], hashByte(any ? CC_COMMA : CC_ARR, h), opts);
            if (r !== undefined) {
                h = r;
                any = true;
            }
        }
        return any ? h : undefined;
    }
    const keys = Object.keys(target).sort();
    const forceKeys = opts?.ignoreKeys;
    const hasForceKeys = !!forceKeys?.length;
    let any = false;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const baseH = hashByte(CC_COLON, hash(key, hashByte(any ? CC_COMMA : CC_OBJ, h)));
        let r = deepHash(target[key], baseH, opts);
        // ignoreKeys 命中且 value 判空：注入占位符 '!E'，保证该 key 仍参与最终 hash
        if (r === undefined && hasForceKeys && forceKeys!.includes(key)) {
            r = hash('!E', baseH);
        }
        if (r !== undefined) {
            h = r;
            any = true;
        }
    }
    return any ? h : undefined;
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
 *   - ≤ 64 字符：全量 hash（覆盖 UUID/常见 ID/短 query 值，零信息损失）
 *   - > 64 字符：首/中/尾各采 8 字符 + 总长度（24 字符样本 + 长度防同结构 ID 碰撞）
 */
function stringHash(s: string, h: number): number | undefined {
    const t = s.trim();
    const l = t.length;
    if (l === 0) return undefined;
    if (l <= SAMPLE_THRESHOLD) return hash(t, h);
    const mid = (l - SAMPLE_WINDOW) >> 1;
    h = hash(t.substring(0, SAMPLE_WINDOW), h);
    h = hash(t.substring(mid, mid + SAMPLE_WINDOW), h);
    h = hash(t.substring(l - SAMPLE_WINDOW), h);
    return hash('L' + l, h);
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(key)` 在 minify 后仍能识别
lockName(key, name);
