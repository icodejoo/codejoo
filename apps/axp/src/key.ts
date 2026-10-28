import type { AxiosRequestConfig } from "axios";
import type { AxpRequestConfig } from "./types";
import { isBodyMethod, normalizeMethod } from "./methods";
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
/** 作用域分隔符。 */
const SCOPE_SEPARATOR = "#";
/** 最终摘要使用的进制。 */
const KEY_RADIX = 36;

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
    const method = normalizeMethod(request.method);
    try {
      value = $key(
        {
          /** 规范化请求方法。 */ method,
          /** 请求地址。 */ url: request.url,
          /** 查询参数。 */ params: request.params,
          /** 仅请求体方法参与 data 指纹。 */ data: isBodyMethod(method) ? request.data : undefined,
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

/** FNV 每步混合使用的素数。 */
const FNV_PRIME = 16777619;
/** 第一车道的初始种子。 */
const FNV_OFFSET = 2166136261 >>> 0;
/** 第二车道使用黄金比例种子，保持独立轨迹。 */
const FNV_OFFSET_2 = 0x9e3779b1 >>> 0;
/** 数组后续元素分隔。 */
const CC_COMMA = ",".charCodeAt(0);
/** 对象键值分隔。 */
const CC_COLON = ":".charCodeAt(0);
/** 数组首元素标记。 */
const CC_ARR = "a".charCodeAt(0);
/** 对象字段标记。 */
const CC_OBJ = "o".charCodeAt(0);
/** 请求片段分隔。 */
const CC_PIPE = "|".charCodeAt(0);
/** 查询参数片段标记。 */
const CC_PARAMS = "p".charCodeAt(0);
/** 请求体片段标记。 */
const CC_DATA = "d".charCodeAt(0);
/** 长度分帧结束标记。 */
const CC_QUOTE = '"'.charCodeAt(0);
/** 对象累加结束标记。 */
const CC_CLOSE_OBJ = "}".charCodeAt(0);
/** 豁免值前缀。 */
const CC_IGNORE = "!".charCodeAt(0);
/** 豁免空字段占位。 */
const EMPTY_FIELD = "!E";
/** 日期值前缀。 */
const CC_DATE = "D".charCodeAt(0);
/** 查询串值前缀。 */
const CC_SEARCH = "U".charCodeAt(0);
/** 采样总长度前缀。 */
const CC_LENGTH = "L".charCodeAt(0);
/** 十进制数位基数。 */
const DECIMAL_BASE = 10;
/** 数字零的字符编码。 */
const CC_ZERO = "0".charCodeAt(0);
/** 触发长串采样的长度。 */
const SAMPLE_THRESHOLD = 64;
/** 首中尾各自的采样宽度。 */
const SAMPLE_WINDOW = 8;
/** 二进制长度前缀。 */
const BINARY_PREFIX = "bin";
/** 深度哈希无法可靠处理时抛出，由请求指纹入口转成 null。 */
const KEY_UNSUPPORTED = Symbol("axp:key:unsupported");
/** 日期类型标签。 */
const TAG_DATE = "[object Date]";
/** 查询串类型标签。 */
const TAG_URL_SEARCH_PARAMS = "[object URLSearchParams]";
/** 读取对象的标准类型标签。 */
const toTag = Object.prototype.toString;
/** 读取字段自身归属，保留无原型字典语义。 */
const hasOwn = Object.prototype.hasOwnProperty;

/** 请求内复用的两条独立 FNV 车道。 */
interface HashState {
  /** 第一车道当前摘要。 */
  h1: number;
  /** 第二车道当前摘要。 */
  h2: number;
  /** 当前请求的过滤和采样选项。 */
  opts?: IKeyOptions;
  /** 当前递归路径，用于循环检测和豁免回滚。 */
  ancestors: object[];
}

/** 特殊对象没有可枚举字段时，不能按普通空对象过滤。 */
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
  const state: HashState = {
    /** 第一车道种子。 */ h1: FNV_OFFSET,
    /** 第二车道种子。 */ h2: FNV_OFFSET_2,
    /** 请求内共享的哈希配置。 */ opts,
    /** 查询和请求体复用同一祖先栈。 */ ancestors: [],
  };
  hash((config.method || "").toUpperCase(), state);
  hashByte(CC_PIPE, state);
  hash(config.url || "", state);
  hashPart(config.params, CC_PARAMS, state);
  hashPart(config.data, CC_DATA, state);
  return state.h1.toString(KEY_RADIX) + "-" + state.h2.toString(KEY_RADIX);
}

/** 给非空请求片段加前缀；深层为空时回滚两条车道。 */
function hashPart(value: any, marker: number, state: HashState): void {
  const skipShallow = !!state.opts?.ignores?.length;
  if (!skipShallow && isShallowEmpty(value)) return;
  const h1 = state.h1;
  const h2 = state.h2;
  hashByte(CC_PIPE, state);
  hashByte(marker, state);
  if (!deepHash(value, state)) {
    state.h1 = h1;
    state.h2 = h2;
  }
}

/** 浅查一层空容器，保留旧入口的快速短路规则。 */
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

/** 判断单值自身是否为空，不递归其容器内容。 */
function isDirectEmpty(v: any): boolean {
  if (v == null || Number.isNaN(v)) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v !== "object") return false;
  if (Array.isArray(v)) return v.length === 0;
  for (const _ in v) return false;
  return !isOpaque(v);
}

/** 一次读取字符串区间，同时推进两条车道，采样无需切片。 */
function hash(str: string, state: HashState, start = 0, end = str.length): void {
  let h1 = state.h1;
  let h2 = state.h2;
  for (let i = start; i < end; i++) {
    const code = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, FNV_PRIME);
    h2 = Math.imul(h2 ^ code, FNV_PRIME);
  }
  state.h1 = h1 >>> 0;
  state.h2 = h2 >>> 0;
}

/** 把单个字符编码同时混入两条车道。 */
function hashByte(code: number, state: HashState): void {
  state.h1 = Math.imul(state.h1 ^ code, FNV_PRIME) >>> 0;
  state.h2 = Math.imul(state.h2 ^ code, FNV_PRIME) >>> 0;
}

/** 按从高到低的十进制数位混入长度，避免创建分帧字符串。 */
function hashLength(length: number, state: HashState): void {
  let divisor = 1;
  while (divisor <= length / DECIMAL_BASE) divisor *= DECIMAL_BASE;
  do {
    const digit = Math.floor(length / divisor);
    hashByte(CC_ZERO + digit, state);
    length -= digit * divisor;
    divisor /= DECIMAL_BASE;
  } while (divisor >= 1);
}

/** 混入长度和引号，保持旧字符串与字段名的分帧。 */
function hashFrame(length: number, state: HashState): void {
  hashLength(length, state);
  hashByte(CC_QUOTE, state);
}

/** 共享祖先栈检测循环；异常栈清理由可恢复的对象字段边界负责。 */
function deepHash(target: any, state: HashState): boolean {
  if (target === null || typeof target !== "object") return hashValue(target, state);
  const ancestors = state.ancestors;
  if (ancestors.indexOf(target) !== -1) throw KEY_UNSUPPORTED;
  ancestors.push(target);
  const present = hashValue(target, state);
  ancestors.pop();
  return present;
}

/** 单次判空、读取和递归同时更新两车道；返回值表示是否贡献摘要。 */
function hashValue(target: any, state: HashState): boolean {
  if (state.opts?.ignores?.includes(target)) {
    hashByte(CC_IGNORE, state);
    hash(safeStr(target), state);
    return true;
  }
  if (target == null || Number.isNaN(target)) return false;
  const type = typeof target;
  if (type === "string") return stringHash(target, state);
  if (type !== "object") {
    const str = String(target);
    hashFrame(str.length, state);
    hash(str, state);
    return true;
  }
  if (typeof target.byteLength === "number") {
    if (target.byteLength === 0) return false;
    hash(BINARY_PREFIX, state);
    hash(String(target.byteLength), state);
    return true;
  }
  const tag = toTag.call(target);
  if (tag === TAG_DATE) {
    hashByte(CC_DATE, state);
    hash(specialText(target.getTime()), state);
    return true;
  }
  if (tag === TAG_URL_SEARCH_PARAMS) {
    hashByte(CC_SEARCH, state);
    hash(specialText(target.toString()), state);
    return true;
  }
  const array = Array.isArray(target);
  if (!array && isOpaque(target)) throw KEY_UNSUPPORTED;
  return array ? hashArray(target, state) : hashObject(target, state);
}

/** 正常数字使用显式转换；自定义返回值保留加号的默认提示及 Symbol 异常。 */
function specialText(value: any): string {
  return typeof value === "number" ? String(value) : "" + value;
}

/** 依次混入数组元素，空元素恢复两条车道。 */
function hashArray(target: any[], state: HashState): boolean {
  let any = false;
  for (let i = 0; i < target.length; i++) {
    const h1 = state.h1;
    const h2 = state.h2;
    hashByte(any ? CC_COMMA : CC_ARR, state);
    if (deepHash(target[i], state)) any = true;
    else {
      state.h1 = h1;
      state.h2 = h2;
    }
  }
  return any;
}

/** 可交换累加自有字段，豁免字段失败时恢复祖先栈。 */
function hashObject(target: Record<string, any>, state: HashState): boolean {
  const ancestors = state.ancestors;
  const h1 = state.h1;
  const h2 = state.h2;
  let acc1 = 0;
  let acc2 = 0;
  let any = false;
  for (const key in target) {
    if (!hasOwn.call(target, key)) continue;
    state.h1 = h1;
    state.h2 = h2;
    hashByte(CC_OBJ, state);
    hashFrame(key.length, state);
    hash(key, state);
    hashByte(CC_COLON, state);
    const base1 = state.h1;
    const base2 = state.h2;
    const depth = ancestors.length;
    const ignored = state.opts?.ignores?.includes(key);
    let present: boolean;
    try {
      present = deepHash(target[key], state);
    } catch (error) {
      // 豁免字段恢复完整祖先路径，避免被放弃的子树污染后续兄弟字段。
      if (error !== KEY_UNSUPPORTED || !ignored) throw error;
      ancestors.length = depth;
      present = false;
    }
    if (!present && ignored) {
      state.h1 = base1;
      state.h2 = base2;
      hash(EMPTY_FIELD, state);
      present = true;
    }
    if (present) {
      acc1 = (acc1 + state.h1) >>> 0;
      acc2 = (acc2 + state.h2) >>> 0;
      any = true;
    }
  }
  state.h1 = (h1 + acc1) >>> 0;
  state.h2 = (h2 + acc2) >>> 0;
  if (any) hashByte(CC_CLOSE_OBJ, state);
  return any;
}

/** 为豁免的空值生成旧算法的稳定标签。 */
function safeStr(v: any): string {
  if (v === undefined) return "u";
  if (v === null) return "n";
  if (Number.isNaN(v)) return "NaN";
  if (v === "") return "e";
  return String(v);
}

/** trim 只执行一次；长串按首中尾区间采样，保持原 UTF-16 编码语义。 */
function stringHash(s: string, state: HashState): boolean {
  const trimmed = s.trim();
  const length = trimmed.length;
  if (length === 0) return false;
  hashFrame(length, state);
  if (!state.opts?.sample || length <= SAMPLE_THRESHOLD) {
    hash(trimmed, state);
  } else {
    const mid = (length - SAMPLE_WINDOW) >> 1;
    hash(trimmed, state, 0, SAMPLE_WINDOW);
    hash(trimmed, state, mid, mid + SAMPLE_WINDOW);
    hash(trimmed, state, length - SAMPLE_WINDOW);
    hashByte(CC_LENGTH, state);
    hashLength(length, state);
  }
  return true;
}
