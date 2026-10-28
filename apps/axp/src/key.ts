import type { AxiosRequestConfig } from "axios";
import type { AxpRequestConfig } from "./types";
import { isBodyMethod } from "./methods";
import { isPlainObject } from "./utils";

/** key 服务配置，沿用旧 FNV 算法的过滤与采样规则。 */
export interface IKeyOptions {
  /** 豁免空值过滤的键名或值。 */
  ignores?: any[];
  /** 超长字符串只采首、中、尾；默认全量。 */
  sample?: boolean;
  /** 会话分区；空值不附加。 */
  scope?:
    | string
    | number
    | ((request: Readonly<AxpRequestConfig>) => string | number | null | undefined | void);
}
/** 默认 HTTP 方法。 */
export const DEFAULT_METHOD = "get";
/** 作用域分隔符。 */
const SCOPE_SEPARATOR = "#";

/** 计算请求指纹；不可哈希的请求返回 null。
 * @param request 当前不可变请求视图。
 * @param options 过滤、采样与会话分区配置。
 * @returns 显式 key、FNV 指纹或 null。
 * @example `requestKey({ method: 'get', url: '/pets', params: { page: 1 } })`
 */
export function requestKey(
  request: Readonly<AxpRequestConfig>,
  options: IKeyOptions = {},
): string | null {
  if (request.key === false) return null;
  let value: string;
  if (typeof request.key === "string") {
    value = request.key.trim();
    if (!value) return null;
  } else {
    const method = (request.method ?? DEFAULT_METHOD).toLowerCase();
    try {
      value = $key(
        {
          method,
          url: request.url,
          params: request.params,
          data: isBodyMethod(method) ? request.data : undefined,
        },
        options,
      );
    } catch (error) {
      if (error === KEY_UNSUPPORTED) return null;
      throw error;
    }
  }
  const scope = typeof options.scope === "function" ? options.scope(request) : options.scope;
  return scope === null ||
    scope === undefined ||
    scope === "" ||
    (typeof scope === "number" && Number.isNaN(scope))
    ? value
    : value + SCOPE_SEPARATOR + String(scope);
}

const FNV_PRIME = 16777619;
const FNV_OFFSET = 2166136261 >>> 0;
/* 第二条车道的种子（黄金比例常量）。两条 FNV-1a 用不同 offset 起步，
 * 轨迹相互独立 —— 一条碰撞不蕴含另一条碰撞，拼接后得到 ~64bit 抗碰撞强度。 */
const FNV_OFFSET_2 = 0x9e3779b1 >>> 0;
const CC_COMMA = 0x2c; // ','
const CC_COLON = 0x3a; // ':'
const CC_ARR = 0x61; // 'a'
const CC_OBJ = 0x6f; // 'o'
const SAMPLE_THRESHOLD = 64;
const SAMPLE_WINDOW = 8;
/** deep 哈希遇到无法可靠序列化的值时抛出的哨兵，由 $parse 捕获并放弃生成 key / sentinel thrown by deep hashing on values that can't be serialized reliably; caught by $parse, which then yields no key */
const KEY_UNSUPPORTED = Symbol("axp:key:unsupported");
const TAG_DATE = "[object Date]";
const TAG_URL_SEARCH_PARAMS = "[object URLSearchParams]";
const toTag = Object.prototype.toString;

/**
 * 非普通对象且没有可枚举字段（Date/Map/Set/Blob/FormData 等）：靠字段无法区分内容，不能当空值处理。
 *
 * Non-plain object without enumerable fields (Date/Map/Set/Blob/FormData, ...): fields can't tell contents apart, so it must not be treated as empty.
 */
function isOpaque(v: any): boolean {
  return !isPlainObject(v) && Object.keys(v).length === 0;
}

/**
 * 流式 FNV-1a 双车道——单 key 由两条独立种子的 32bit FNV 拼接成 ~64bit，把生日碰撞阈值从 ~7.7 万个 key 推到 ~50 亿，cache 误命中实际归零。
 *   - opts.ignores：deep 模式下让指定键/值豁免空值过滤
 *   - sample：仅对 >64 字符长串采样（默认 false=全量哈希，避免“中段差异”碰撞；仅超大 payload 场景开启）
 *   - 性能：对象层用可交换累加代替 `Object.keys().sort()`，省掉排序与分配开销
 *
 * Streaming FNV-1a, two lanes — a key concatenates two independently-seeded 32-bit FNV digests into ~64 bits, pushing the birthday-collision threshold from ~77K keys to ~5 billion.
 *   - opts.ignores: exempt specific keys/values from empty-value filtering in deep mode
 *   - sample: samples only strings >64 chars (default `false` = full hash, avoiding "middle-differs" collisions; only for huge payloads)
 *   - perf: object layer uses commutative accumulation instead of `Object.keys().sort()`, skipping sort/allocation overhead
 *
 * @internal exported for unit tests
 * @param opts 哈希选项，仅非 simple 模式生效 / hashing options, only used in non-simple mode
 * @returns 两条车道拼接成的 key（base36，`-` 分隔）/ the two lanes concatenated (base36, `-`-separated)
 */
export function $key(config: AxiosRequestConfig, opts?: IKeyOptions): string {
  const a = lane(config, opts, FNV_OFFSET);
  const b = lane(config, opts, FNV_OFFSET_2);
  // '-' 不属于 base36 字母表，作分隔避免 "1"+"23" 与 "12"+"3" 撞键
  return a.toString(36) + "-" + b.toString(36);
}

/**
 * 单条车道：从给定种子计算 32bit 摘要，两条车道结构相同、种子不同。
 *
 * A single lane: computes a 32-bit digest from the given seed; both lanes share the same structure and differ only in seed.
 *
 * @param seed 该车道的起始种子（两条车道各自独立）/ this lane's starting seed (independent per lane)
 */
function lane(config: AxiosRequestConfig, opts: IKeyOptions | undefined, seed: number): number {
  let h = seed;
  h = hash((config.method || "").toUpperCase(), h);
  h = hash("|", h);
  h = hash(config.url || "", h);

  // ignores 命中时会让本来"shallow 看似空"的容器实际产生贡献，必须跳过短路
  const skipShallow = !!opts?.ignores?.length;

  if (skipShallow || !isShallowEmpty(config.params)) {
    const r = deepHash(config.params, hash("|p", h), opts);
    if (r !== undefined) h = r;
  }
  if (skipShallow || !isShallowEmpty(config.data)) {
    const r = deepHash(config.data, hash("|d", h), opts);
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
  if (typeof v !== "object") return false;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!isDirectEmpty(v[i])) return false;
    }
    return true;
  }
  if (isOpaque(v)) return false;
  for (const k in v) {
    if (!isDirectEmpty(v[k])) return false;
  }
  return true;
}

/** 判断单个值是否"直接为空"（不递归容器内部，仅看自身形态）/ whether a value is "directly empty" (no recursion into containers, shape only) */
function isDirectEmpty(v: any): boolean {
  if (v == null || Number.isNaN(v)) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v !== "object") return false;
  if (Array.isArray(v)) return v.length === 0;
  for (const _ in v) return false;
  return !isOpaque(v);
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
 *   - FNV 计算保持旧算法；新增祖先集合把循环引用归入不可哈希值。
 *
 * Single-pass recursive hash + emptiness check: `undefined` means `target` as a whole is empty and the caller should roll back.
 *   - null/undefined/NaN → `undefined` (unless force-kept via `opts.ignores`); empty Buffer → `undefined`
 *   - recursively-empty containers (e.g. [[{}]], {a:{b:[]}}) → `undefined`
 *   - non-empty containers prefixed 'a'/'o', items separated by ',', object key/value separated by ':'
 *   - a key matching `opts.ignores` with an empty value is still force-kept via a placeholder
 *
 * @param h 父级传入的种子/累积哈希值 / seed/accumulator passed down from the parent
 * @returns 混合后的哈希值；`undefined` 表示 target 判空 / the mixed hash value; `undefined` means `target` is empty
 */
function deepHash(
  target: any,
  h: number,
  opts?: IKeyOptions,
  ancestors = new Set<object>(),
): number | undefined {
  if (target === null || typeof target !== "object") return hashValue(target, h, opts, ancestors);
  if (ancestors.has(target)) throw KEY_UNSUPPORTED;
  ancestors.add(target);
  try {
    return hashValue(target, h, opts, ancestors);
  } finally {
    ancestors.delete(target);
  }
}

/** 沿用旧算法计算一个值；递归时共享当前祖先集合。 */
function hashValue(
  target: any,
  h: number,
  opts: IKeyOptions | undefined,
  ancestors: Set<object>,
): number | undefined {
  // 顶部一次性 destructure：避免每层递归重复 ?. 链式查找
  const ignores = opts?.ignores;
  if (ignores?.length && ignores.includes(target)) {
    return hash("!" + safeStr(target), h);
  }
  // 默认过滤：null / undefined / NaN / 空串（trim 后）
  if (target == null || Number.isNaN(target)) return undefined;
  const t = typeof target;
  if (t === "string") return stringHash(target, h, opts);
  if (t !== "object") {
    // 与字符串同一套长度分帧，保持数字 1 与字符串 "1" 等价
    const str = String(target);
    return hash(str, hash(str.length + '"', h));
  }
  if (typeof target.byteLength === "number") {
    return target.byteLength === 0 ? undefined : hash("bin" + target.byteLength, h);
  }
  const tag = toTag.call(target);
  if (tag === TAG_DATE) return hash("D" + target.getTime(), h);
  if (tag === TAG_URL_SEARCH_PARAMS) return hash("U" + target.toString(), h);
  if (!Array.isArray(target) && isOpaque(target)) throw KEY_UNSUPPORTED;
  if (Array.isArray(target)) {
    // 数组：顺序有语义，保持顺序串行哈希（[1,2] ≠ [2,1]）
    let any = false;
    for (let i = 0; i < target.length; i++) {
      const r = deepHash(target[i], hashByte(any ? CC_COMMA : CC_ARR, h), opts, ancestors);
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
    // key 先混入长度前缀再哈希内容（长度分帧），避免 {'a:b':'c'} 与 {a:'b:c'} 这类分隔符碰撞
    const baseH = hashByte(CC_COLON, hash(key, hash(key.length + '"', hashByte(CC_OBJ, h))));
    let r: number | undefined;
    try {
      r = deepHash(target[key], baseH, opts, ancestors);
    } catch (e) {
      // 键名被 ignores 豁免时，其下无法序列化的值按“被忽略”处理
      if (e === KEY_UNSUPPORTED && hasIgnores && ignores!.includes(key)) r = undefined;
      else throw e;
    }
    // ignores 命中键名且 value 判空：注入占位符 '!E'，保证该 key 仍参与最终 hash
    if (r === undefined && hasIgnores && ignores!.includes(key)) {
      r = hash("!E", baseH);
    }
    if (r !== undefined) {
      acc = (acc + r) >>> 0;
      any = true;
    }
  }
  // 把可交换累加值并回父级 h，使“父级上下文”与“字段内容”都参与最终摘要
  return any ? hash("}", (h + acc) >>> 0) : undefined;
}

/** 把任意 falsy/特殊值转成稳定的短字符串标签 / converts any falsy/special value into a stable short string tag */
function safeStr(v: any): string {
  if (v === undefined) return "u";
  if (v === null) return "n";
  if (Number.isNaN(v)) return "NaN";
  if (v === "") return "e";
  return String(v);
}

/**
 * 字符串指纹：空串/全空白 → undefined（默认过滤，需保留请用 ignores）；默认全量 hash，杜绝“中段差异”碰撞；sample=true 且 >64 字符时首/中/尾各采 8 字符+总长度。
 *
 * String fingerprinting: empty/whitespace-only → `undefined` (filtered by default, use `ignores` to keep); full hash by default to avoid "middle-differs" collisions; when `sample` and length >64, samples 8 chars each from head/middle/tail plus total length.
 *
 * @returns 混合后的哈希值；`undefined` 表示字符串判空（trim 后为空）/ the mixed hash value; `undefined` means the string is empty after trimming
 */
function stringHash(s: string, h: number, opts?: IKeyOptions): number | undefined {
  const t = s.trim();
  const l = t.length;
  if (l === 0) return undefined;
  // 先混入长度前缀（长度分帧），避免 ['ab,c'] 与 ['ab','c'] 这类内容含分隔符的碰撞
  h = hash(l + '"', h);
  if (!opts?.sample || l <= SAMPLE_THRESHOLD) return hash(t, h);
  const mid = (l - SAMPLE_WINDOW) >> 1;
  h = hash(t.substring(0, SAMPLE_WINDOW), h);
  h = hash(t.substring(mid, mid + SAMPLE_WINDOW), h);
  h = hash(t.substring(l - SAMPLE_WINDOW), h);
  return hash("L" + l, h);
}
