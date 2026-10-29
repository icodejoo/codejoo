import type { AxpRequestConfig } from "./types";
import { isBodyMethod, normalizeMethod } from "./methods";
import { hasOwn as sharedHasOwn, isPlainObject, toTag as sharedToTag } from "./utils";

/** 请求指纹的会话分区配置。 */
export interface IKeyOptions {
  /** 会话分区；回调接收当前请求，null、undefined、空串和 NaN 不附加分区。 */
  scope?: string | number | ((request: Readonly<AxpRequestConfig>) => string | number | null | undefined | void);
}
/** 作用域分隔符。 */
const SCOPE_SEPARATOR = "#";
/** 最终摘要使用的进制。 */
const KEY_RADIX = 36;
/** FNV 每步混合使用的素数。 */
const FNV_PRIME = 16777619;
/** 第一车道的初始种子。 */
const FNV_OFFSET = 2166136261 >>> 0;
/** 第二车道使用独立种子。 */
const FNV_OFFSET_2 = 0x9e3779b1 >>> 0;
/** 字符串类型标记。 */
const CC_STRING = "s".charCodeAt(0);
/** 数字类型标记。 */
const CC_NUMBER = "n".charCodeAt(0);
/** 大整数类型标记。 */
const CC_BIGINT = "i".charCodeAt(0);
/** 真值类型标记。 */
const CC_TRUE = "t".charCodeAt(0);
/** 假值类型标记。 */
const CC_FALSE = "f".charCodeAt(0);
/** null 值标记。 */
const CC_NULL = "N".charCodeAt(0);
/** undefined 数组元素标记。 */
const CC_UNDEFINED = "u".charCodeAt(0);
/** 数组类型标记。 */
const CC_ARRAY = "a".charCodeAt(0);
/** 对象类型标记。 */
const CC_OBJECT = "o".charCodeAt(0);
/** 对象累加结束标记。 */
const CC_CLOSE_OBJECT = "}".charCodeAt(0);
/** 查询参数片段标记。 */
const CC_PARAMS = "p".charCodeAt(0);
/** 请求体片段标记。 */
const CC_DATA = "d".charCodeAt(0);
/** 长度分帧结束标记。 */
const CC_QUOTE = '"'.charCodeAt(0);
/** 日期值标记。 */
const CC_DATE = "D".charCodeAt(0);
/** 查询串值标记。 */
const CC_SEARCH = "U".charCodeAt(0);
/** 二进制类型标记。 */
const CC_BINARY = "b".charCodeAt(0);
/** 十进制数位基数。 */
const DECIMAL_BASE = 10;
/** 数字零的字符编码。 */
const CC_ZERO = "0".charCodeAt(0);
/** 二进制全量哈希的最大字节数。 */
const BINARY_HASH_LIMIT = 65_536;
/** 不可哈希值的内部信号，仅入口转成 null。 */
const KEY_UNSUPPORTED = Symbol("axp:key:unsupported");
/** 日期类型标签。 */
const TAG_DATE = "[object Date]";
/** 查询串类型标签。 */
const TAG_URL_SEARCH_PARAMS = "[object URLSearchParams]";
/** 二进制缓冲区类型标签。 */
const TAG_ARRAY_BUFFER = "[object ArrayBuffer]";
/** 共享缓冲区类型标签。 */
const TAG_SHARED_ARRAY_BUFFER = "[object SharedArrayBuffer]";
/** 热路径局部绑定，方便内联。 */
const toTag = sharedToTag;
/** 自有字段判断的热路径绑定。 */
const hasOwn = sharedHasOwn;

/** 请求内复用的双车道摘要和递归路径。 */
interface HashState {
  /** 第一车道当前摘要。 */
  h1: number;
  /** 第二车道当前摘要。 */
  h2: number;
  /** 当前递归路径，用于循环检测。 */
  ancestors: object[];
}

/** 计算请求指纹；对象的 undefined 字段等同于没有，null 参与哈希（JSON 请求体会发送 null），其余值带类型和长度分帧。
 * @param request 当前不可变请求视图；只有请求体方法的 data 参与指纹。
 * @param options 会话分区配置。
 * @returns 原样的显式 key、双车道 FNV 指纹，或关闭/不可哈希时的 null。
 * @example `requestKey({ method: 'get', url: '/pets', params: { page: 1 } }, { scope: 'account' })`
 */
export function requestKey(request: Readonly<AxpRequestConfig>, options: IKeyOptions = {}): string | null {
  if (request.key === false) return null;
  let value: string;
  if (typeof request.key === "string") {
    value = request.key;
    if (!value) return null;
  } else {
    const method = normalizeMethod(request.method);
    const baseURL = request.baseURL;
    let url = request.url;
    // 与 axios buildFullPath / combineURLs 一致。
    if (typeof baseURL === "string" && baseURL && (!/^([a-z][a-z\d+\-.]*:)?\/\//i.test(url ?? "") || request.allowAbsoluteUrls === false)) {
      url = url ? baseURL.replace(/\/?\/$/, "") + "/" + url.replace(/^\/+/, "") : baseURL;
    }
    const state: HashState = {
      /** 第一车道种子。 */ h1: FNV_OFFSET,
      /** 第二车道种子。 */ h2: FNV_OFFSET_2,
      /** 每个请求独立检测循环。 */ ancestors: [],
    };
    try {
      hashText(method, state);
      hashText(url ?? "", state);
      if (request.params != null) {
        hashByte(CC_PARAMS, state);
        deepHash(request.params, state);
      }
      if (isBodyMethod(method) && request.data != null) {
        hashByte(CC_DATA, state);
        deepHash(request.data, state);
      }
    } catch (error) {
      if (error === KEY_UNSUPPORTED) return null;
      throw error;
    }
    value = state.h1.toString(KEY_RADIX) + "-" + state.h2.toString(KEY_RADIX);
  }
  const scope = typeof options.scope === "function" ? options.scope(request) : options.scope;
  return scope == null || scope === "" || Number.isNaN(scope) ? value : value + SCOPE_SEPARATOR + String(scope);
}

/** 按长度分帧后一次读取原文，同时推进两条车道。 */
function hashText(str: string, state: HashState): void {
  const length = str.length;
  hashFrame(length, state);
  // 循环内保持有符号 32 位，避免摘要在整数与浮点表示之间反复转换。
  let h1 = state.h1 | 0;
  let h2 = state.h2 | 0;
  for (let i = 0; i < length; i++) {
    const code = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, FNV_PRIME);
    h2 = Math.imul(h2 ^ code, FNV_PRIME);
  }
  state.h1 = h1 >>> 0;
  state.h2 = h2 >>> 0;
}

/** 把单个编码同时混入两条车道。 */
function hashByte(code: number, state: HashState): void {
  state.h1 = Math.imul(state.h1 ^ code, FNV_PRIME) >>> 0;
  state.h2 = Math.imul(state.h2 ^ code, FNV_PRIME) >>> 0;
}

/** 直接混入十进制长度和终止标记，避免分配分帧字符串。 */
function hashFrame(length: number, state: HashState): void {
  let divisor = 1;
  while (divisor <= length / DECIMAL_BASE) divisor *= DECIMAL_BASE;
  do {
    const digit = Math.floor(length / divisor);
    hashByte(CC_ZERO + digit, state);
    length -= digit * divisor;
    divisor /= DECIMAL_BASE;
  } while (divisor >= 1);
  hashByte(CC_QUOTE, state);
}

/** 按类型混入值；数组保留空元素，对象只跳过 undefined 字段，null 参与哈希。 */
function deepHash(target: any, state: HashState): void {
  const type = typeof target;
  if (type === "string") {
    hashByte(CC_STRING, state);
    hashText(target, state);
  } else if (type === "number" || type === "bigint") {
    hashByte(type === "number" ? CC_NUMBER : CC_BIGINT, state);
    hashText(String(target), state);
  } else if (type === "boolean") {
    hashByte(target ? CC_TRUE : CC_FALSE, state);
  } else if (target == null) {
    hashByte(target === null ? CC_NULL : CC_UNDEFINED, state);
  } else if (type === "object") {
    const ancestors = state.ancestors;
    if (ancestors.indexOf(target) !== -1) throw KEY_UNSUPPORTED;
    ancestors.push(target);
    if (Array.isArray(target)) {
      hashByte(CC_ARRAY, state);
      hashFrame(target.length, state);
      for (let i = 0; i < target.length; i++) deepHash(target[i], state);
    } else if (isPlainObject(target)) {
      hashObject(target, state);
    } else {
      hashSpecial(target, state);
    }
    ancestors.pop();
  } else {
    throw KEY_UNSUPPORTED;
  }
}

/** 对象自有字段可交换累加，省去排序；空对象仍贡献摘要。 */
function hashObject(target: Record<string, any>, state: HashState): void {
  hashByte(CC_OBJECT, state);
  const h1 = state.h1;
  const h2 = state.h2;
  let acc1 = 0;
  let acc2 = 0;
  for (const key in target) {
    if (!hasOwn(target, key)) continue;
    const value = target[key];
    if (value === undefined) continue;
    state.h1 = h1;
    state.h2 = h2;
    hashText(key, state);
    deepHash(value, state);
    acc1 = (acc1 + state.h1) >>> 0;
    acc2 = (acc2 + state.h2) >>> 0;
  }
  state.h1 = (h1 + acc1) >>> 0;
  state.h2 = (h2 + acc2) >>> 0;
  hashByte(CC_CLOSE_OBJECT, state);
}

/** 特殊对象按值处理；二进制只读取视图窗口，不透明对象拒绝生成指纹。 */
function hashSpecial(target: any, state: HashState): void {
  const tag = toTag(target);
  if (tag === TAG_DATE) {
    hashByte(CC_DATE, state);
    hashText(String(target.getTime()), state);
  } else if (tag === TAG_URL_SEARCH_PARAMS) {
    hashByte(CC_SEARCH, state);
    hashText(target.toString(), state);
  } else if (ArrayBuffer.isView(target) || tag === TAG_ARRAY_BUFFER || tag === TAG_SHARED_ARRAY_BUFFER) {
    const length = target.byteLength;
    if (length > BINARY_HASH_LIMIT) throw KEY_UNSUPPORTED;
    const bytes = ArrayBuffer.isView(target) ? new Uint8Array(target.buffer, target.byteOffset, length) : new Uint8Array(target);
    hashByte(CC_BINARY, state);
    hashFrame(length, state);
    for (let index = 0; index < length; index++) hashByte(bytes[index], state);
  } else {
    throw KEY_UNSUPPORTED;
  }
}
