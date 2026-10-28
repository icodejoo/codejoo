import type { AxpKind, IAxpResponse } from '../../src/response.ts';
import { AXP_RESPONSE, AXP_KINDS } from '../../src/brand.ts';
import type { Style } from './constants.ts';

/** 鉴权原因及其优先顺序的唯一来源。 */
const AUTH_CLASSES = ['expired', 'denied', 'unauthenticated'] as const;

/** 具体错误类别里不带参数的固定取值（CONTRACT §7） */
const CLASS = {
  CANCELED: 'canceled',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  PARSE: 'parse',
} as const;

/** 类别 `unknown:` 里消息部分的最大长度 */
const UNKNOWN_MESSAGE_MAX = 80;

/** kind 到错误类别的直接对应（不需要再看别的字段的几类） */
const KIND_CLASS: Partial<Record<AxpKind, string>> = {
  [AXP_KINDS.CANCEL]: CLASS.CANCELED,
  [AXP_KINDS.TIMEOUT]: CLASS.TIMEOUT,
  [AXP_KINDS.NETWORK]: CLASS.NETWORK,
  [AXP_KINDS.PARSE]: CLASS.PARSE,
};

/** auth 响应里 `reason` 允许直接当类别的取值 */
const AUTH_REASON_CLASSES: ReadonlySet<string> = new Set(AUTH_CLASSES);

/** classify 的上下文 */
export interface ClassifyContext extends LegacyClassifyContext {
  /** 该请求发出时的响应风格（仅用于 status:<n> 的匹配，本函数不用） */
  style?: Style;
}

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
 * @param e 任意被抛出的值
 * @returns 是否为 IAxpResponse
 * @example hasAxpBrand(await api.get('/x').catch((e) => e)) // true
 */
export function hasAxpBrand(e: unknown): e is IAxpResponse {
  return typeof e === 'object' && e !== null && Reflect.get(e, AXP_RESPONSE) === true;
}

/**
 * 把抛出的 IAxpResponse 直接按字段归到错误类别，不看 message、不猜形状。
 * `cancel`→canceled，`timeout`→timeout，`network`→network，`parse`→parse；
 * `auth` 按 `reason`（expired / denied / unauthenticated）；`http`→`http:<httpStatus>`；`biz`→`business:<code>`。
 * 其余（`ok`、`internal`、认不出的 auth reason）都不该被抛出，记为 `unknown:`，意味着 axp 有 bug。
 * @param r 被抛出的归一化响应
 * @returns 具体错误类别
 * @example classifyResponse(r) // 'business:1001'
 */
export function classifyResponse(r: IAxpResponse): string {
  const direct = KIND_CLASS[r.kind];
  if (direct) return direct;
  switch (r.kind) {
    case AXP_KINDS.AUTH:
      return r.reason && AUTH_REASON_CLASSES.has(r.reason) ? r.reason : unknownClass(r.kind, r.reason ?? r.message);
    case AXP_KINDS.HTTP:
      return httpClass(r.httpStatus);
    case AXP_KINDS.BIZ:
      return businessClass(r.code);
    default:
      return unknownClass(r.kind, r.message);
  }
}

/**
 * 把客户端拿到的错误归到 CONTRACT §7 的错误类别（具体值，不含 `status:<n>`）。
 * 取值：`http:<n>`、`business:<code>`、`timeout`、`canceled`、`network`、`parse`、`denied`、`expired`、
 * `unauthenticated`；认不出来的返回 `unknown:<描述>`。
 * 判定顺序：**IAxpResponse（直接读 kind / reason）** > 〔过渡期旧形态：auth 标签 > auth 插件自身错误 >
 * 取消 > 解析 > ApiError > 有响应的状态码 > 超时 > 网络〕> `unknown:`。
 * 新架构下 axp 失败只会抛 IAxpResponse，走到 `unknown:` 就说明 axp 有 bug（程序异常原样抛出）。
 * @param err 抛出的错误
 * @param ctx 上下文（旧形态的 auth 标签）
 * @returns 具体错误类别
 * @example classifyError(thrownResponse) // 'http:500'
 */
export function classifyError(err: unknown, ctx: ClassifyContext = {}): string {
  if (hasAxpBrand(err)) return classifyResponse(err);
  return classifyLegacyError(err, ctx);
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
  if (expected === 'any') return true;
  const m = /^status:(\d{3})$/.exec(expected);
  if (m) return actual === (style === 'http' ? httpClass(m[1]) : businessClass(m[1]));
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

// ===== B7 删除区 =====

import { AUTH_DENIED_MESSAGE, AUTH_REFRESH_FAILED_MESSAGE } from './constants.ts';

/** 旧鉴权回调使用的请求标签。 */
export type AuthTag = (typeof AUTH_CLASSES)[number];

/** 标签按统一的鉴权原因次序判定。 */
const TAG_PRIORITY: readonly AuthTag[] = AUTH_CLASSES;

/** 旧形态请求携带的鉴权上下文。 */
interface LegacyClassifyContext {
  /** 回调上报的鉴权标签，新响应由 reason 提供。 */
  tags?: ReadonlySet<AuthTag>;
}

/** B7 删除：旧 API 形态。解析错误打的标记（由 client-factory 的 parseGuard 设置） */
export const PARSE_MARK = 'testkitParse';

/** B7 删除：旧 API 形态。网络类错误码（含 undici 的 cause.code） */
const NETWORK_CODES = new Set([
  'ERR_NETWORK', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'EHOSTUNREACH', 'ENETUNREACH',
]);
/** B7 删除：旧 API 形态。网络类错误消息关键词 */
const NETWORK_MESSAGE_RE = /network error|socket hang up|fetch failed|terminated|stream has been aborted|aborted|ECONNRESET|ECONNREFUSED|ENOTFOUND/i;
/** B7 删除：旧 API 形态。超时类错误消息关键词 */
const TIMEOUT_MESSAGE_RE = /timeout|timed out/i;

/** B7 删除：旧 API 形态。宽松的错误形状：axios 错误 / ApiError / 普通 Error / 任意值 */
interface ErrorLike {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
  cause?: { code?: string };
  response?: { status?: number; data?: unknown; code?: number | string };
  [k: string]: unknown;
}

/** B7 删除：旧 API 形态。读取 ErrorLike */
function asLike(e: unknown): ErrorLike {
  return (e && typeof e === 'object' ? e : { message: String(e) }) as ErrorLike;
}

/** B7 删除：旧 API 形态。是否为取消错误 */
function isCanceled(e: ErrorLike): boolean {
  return e.code === 'ERR_CANCELED' || e.name === 'CanceledError' || e.name === 'AbortError';
}

/** B7 删除：旧 API 形态。是否为旧 axp 的 ApiError（normalize 业务失败，response 是 AxpResponse） */
function isApiError(e: ErrorLike): boolean {
  return e.name === 'ApiError' && !!e.response && 'code' in e.response;
}

/** 旧 axp 与 axios 错误形状的过渡分类器。 */
function classifyLegacyError(err: unknown, ctx: ClassifyContext): string {
  for (const tag of TAG_PRIORITY) if (ctx.tags?.has(tag)) return tag;
  const e = asLike(err);
  const msg = String(e.message ?? '');
  if (msg.startsWith(AUTH_REFRESH_FAILED_MESSAGE)) return AUTH_CLASSES[0];
  if (msg.startsWith(AUTH_DENIED_MESSAGE)) return AUTH_CLASSES[2];
  if (isCanceled(e)) return CLASS.CANCELED;
  if (e[PARSE_MARK] === true) return CLASS.PARSE;
  if (isApiError(e)) {
    const r = e.response!;
    const status = Number(r.status ?? 0);
    return status >= 400 ? httpClass(status) : businessClass(r.code);
  }
  const status = e.response?.status ?? (typeof e.status === 'number' ? e.status : undefined);
  if (typeof status === 'number' && status >= 400) return httpClass(status);
  if (e.code === 'ETIMEDOUT' || (e.code === 'ECONNABORTED' && TIMEOUT_MESSAGE_RE.test(msg)) || (!e.response && TIMEOUT_MESSAGE_RE.test(msg))) return CLASS.TIMEOUT;
  const causeCode = e.cause?.code;
  if ((e.code && NETWORK_CODES.has(e.code)) || (causeCode && NETWORK_CODES.has(causeCode)) || NETWORK_MESSAGE_RE.test(msg) || e.code === 'ECONNABORTED') return CLASS.NETWORK;
  if (e.code === 'ERR_BAD_RESPONSE' || e.name === 'SyntaxError') return CLASS.PARSE;
  return unknownClass(e.name ?? 'Error', msg);
}
