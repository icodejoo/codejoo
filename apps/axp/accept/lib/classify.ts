import type { AxpFailureType, IAxpFailure, IAxpResponse } from "../../src/response.ts";
import { AXP_RESPONSE, AXP_FAILURE, AXP_FAILURES } from "../../src/brand.ts";
import type { Style } from "./constants.ts";

/** 鉴权类别的取值：与 auth 失败响应的 `reason` 一一对应 */
const AUTH_CLASSES = ["expired", "denied", "unauthenticated"] as const;

/** 具体错误类别里不带参数的固定取值（CONTRACT §7） */
const CLASS = {
  CANCELED: "canceled",
  TIMEOUT: "timeout",
  NETWORK: "network",
  PARSE: "parse",
} as const;

/** 类别 `unknown:` 里消息部分的最大长度 */
const UNKNOWN_MESSAGE_MAX = 80;
/** 抛出的东西没有名称时，`unknown:` 类别里用的名称 */
const UNKNOWN_DEFAULT_NAME = "Error";

/** 失败标记到错误类别的直接对应。 */
const FAILURE_CLASS: Partial<Record<AxpFailureType, string>> = {
  [AXP_FAILURES.CANCEL]: CLASS.CANCELED,
  [AXP_FAILURES.TIMEOUT]: CLASS.TIMEOUT,
  [AXP_FAILURES.NETWORK]: CLASS.NETWORK,
  [AXP_FAILURES.PARSE]: CLASS.PARSE,
};
/** HTTP 成功区间，右端不含。 */
const HTTP_SUCCESS_START = 200;
/** HTTP 成功区间的终点。 */
const HTTP_SUCCESS_END = 300;

/** auth 响应里 `reason` 允许直接当类别的取值 */
const AUTH_REASON_CLASSES: ReadonlySet<string> = new Set(AUTH_CLASSES);

/** 拼 `http:<状态码>` 类别 */
function httpClass(status: number | string): string {
  return `http:${status}`;
}

/** 拼 `business:<业务码>` 类别 */
function businessClass(code: unknown): string {
  return `business:${String(code)}`;
}

/** 拼 `unknown:<名称>:<消息>` 兜底类别，消息截到固定长度 */
function unknownClass(name: string, message: string): string {
  return `unknown:${name}:${message.slice(0, UNKNOWN_MESSAGE_MAX)}`;
}

/**
 * 按共享品牌判断是不是归一化响应（等价于 src 的 `isAxpResponse`，不依赖 instanceof）。
 * 品牌来自 src 的叶子模块 brand.ts，本文件因此不需要打包产物，dry-run 与分类单测都能直接加载。
 * @param e 任意被抛出的值
 * @returns 是否为 IAxpResponse
 * @example hasAxpBrand(await api.get('/x')().catch((e) => e)) // true
 */
export function hasAxpBrand(e: unknown): e is IAxpResponse<unknown, string | number> {
  return typeof e === "object" && e !== null && Reflect.get(e, AXP_RESPONSE) === true;
}

/**
 * 把抛出的 IAxpResponse 直接按字段归到错误类别，不看 message、不猜形状。
 * `cancel`→canceled，`timeout`→timeout，`network`→network，`parse`→parse；
 * `auth` 按隐藏标记的 reason；无标记的失败按 HTTP status 区分 HTTP 与业务码失败。
 * 其余（`ok`、`internal`、认不出的 auth reason）都不该被抛出，记为 `unknown:`，意味着 axp 有 bug。
 * @param r 被抛出的归一化响应
 * @returns 具体错误类别
 * @example classifyResponse(r) // 'business:1001'
 */
export function classifyResponse(r: IAxpResponse<unknown, string | number>): string {
  const failure = Reflect.get(r, AXP_FAILURE) as IAxpFailure | undefined;
  const direct = failure && FAILURE_CLASS[failure.type];
  if (direct) return direct;
  if (failure) {
    if (failure.type === AXP_FAILURES.AUTH && failure.reason && AUTH_REASON_CLASSES.has(failure.reason)) return failure.reason;
    return unknownClass(failure.type, failure.reason ?? r.message ?? "");
  }
  if (r.ok || r.status === 0) return unknownClass(r.ok ? "ok" : "response", r.message ?? "");
  return r.status >= HTTP_SUCCESS_START && r.status < HTTP_SUCCESS_END ? businessClass(r.code) : httpClass(r.status);
}

/**
 * 把客户端拿到的错误归到 CONTRACT §7 的错误类别（具体值，不含 `status:<n>`）。
 * 取值：`http:<n>`、`business:<code>`、`timeout`、`canceled`、`network`、`parse`、`denied`、`expired`、
 * `unauthenticated`；不是 IAxpResponse 的一律返回 `unknown:<名称>:<消息>`。
 * 新架构下 axp 的失败只会抛 IAxpResponse，走到 `unknown:` 就说明 axp 有 bug（程序异常原样抛出）。
 * @param err 抛出的错误
 * @returns 具体错误类别
 * @example classifyError(thrownResponse) // 'http:500'
 */
export function classifyError(err: unknown): string {
  if (hasAxpBrand(err)) return classifyResponse(err);
  const like = (typeof err === "object" && err !== null ? err : { message: String(err) }) as { name?: unknown; message?: unknown };
  const name = typeof like.name === "string" ? like.name : UNKNOWN_DEFAULT_NAME;
  return unknownClass(name, typeof like.message === "string" ? like.message : "");
}

/**
 * 判断实际错误类别是否满足预期里的某个类别。
 * `status:<n>` 与风格无关：http 风格匹配 `http:<n>`，business 风格匹配 `business:<n>`；`any` 匹配任何失败。
 * @param expected 预期类别
 * @param actual classifyError 的结果
 * @param style 该请求发出时的响应风格
 * @example errorMatches('status:401', 'business:401', 'business') // true
 */
export function errorMatches(expected: string, actual: string, style: Style): boolean {
  if (expected === "any") return true;
  const m = /^status:(\d{3})$/.exec(expected);
  if (m) return actual === (style === "http" ? httpClass(m[1]) : businessClass(m[1]));
  return expected === actual;
}

/**
 * 判断实际错误类别是否满足预期数组（任一即可）。
 * @param expected 单个类别或类别数组
 * @param actual 实际类别
 * @param style 风格
 */
export function errorMatchesAny(expected: string | string[], actual: string, style: Style): boolean {
  return (Array.isArray(expected) ? expected : [expected]).some((x) => errorMatches(x, actual, style));
}
