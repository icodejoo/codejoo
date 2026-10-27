import { AUTH_DENIED_MESSAGE, AUTH_REFRESH_FAILED_MESSAGE } from './constants.ts';
import type { Style } from './constants.ts';

/** 会话类标签：由 auth 回调给请求打上，优先级高于错误形状 */
export type AuthTag = 'expired' | 'denied' | 'unauthenticated';

/** 标签优先级：expired > denied > unauthenticated */
const TAG_PRIORITY: readonly AuthTag[] = ['expired', 'denied', 'unauthenticated'];

/** 解析错误打的标记（由 client-factory 的 parseGuard 设置） */
export const PARSE_MARK = 'testkitParse';

/** 网络类错误码（含 undici 的 cause.code） */
const NETWORK_CODES = new Set([
  'ERR_NETWORK', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'EHOSTUNREACH', 'ENETUNREACH',
]);
/** 网络类错误消息关键词 */
const NETWORK_MESSAGE_RE = /network error|socket hang up|fetch failed|terminated|stream has been aborted|aborted|ECONNRESET|ECONNREFUSED|ENOTFOUND/i;
/** 超时类错误消息关键词 */
const TIMEOUT_MESSAGE_RE = /timeout|timed out/i;

/** classify 的上下文 */
export interface ClassifyContext {
  /** 该请求发出时的响应风格（仅用于 status:<n> 的匹配，本函数不用） */
  style?: Style;
  /** auth 回调给该请求打的标签 */
  tags?: ReadonlySet<AuthTag>;
}

/** 宽松的错误形状：axios 错误 / ApiError / 普通 Error / 任意值 */
interface ErrorLike {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
  cause?: { code?: string };
  response?: { status?: number; data?: unknown; code?: number | string };
  [k: string]: unknown;
}

/** 读取 ErrorLike */
function asLike(e: unknown): ErrorLike {
  return (e && typeof e === 'object' ? e : { message: String(e) }) as ErrorLike;
}

/** 是否为取消错误 */
function isCanceled(e: ErrorLike): boolean {
  return e.code === 'ERR_CANCELED' || e.name === 'CanceledError' || e.name === 'AbortError';
}

/** 是否为 axp 的 ApiError（normalize 业务失败，response 是 AxpResponse） */
function isApiError(e: ErrorLike): boolean {
  return e.name === 'ApiError' && !!e.response && 'code' in e.response;
}

/**
 * 把 axp/axios 抛出的错误归到 CONTRACT §7 的错误类别（具体值，不含 `status:<n>`）。
 * 取值：`http:<n>`、`business:<code>`、`timeout`、`canceled`、`network`、`parse`、`denied`、`expired`、
 * `unauthenticated`；认不出来的返回 `unknown:<描述>`。
 * 判定顺序：auth 标签 > auth 插件自身错误 > 取消 > 解析 > ApiError > 有响应的状态码 > 超时 > 网络。
 * @param err 抛出的错误
 * @param ctx 上下文（auth 标签）
 * @returns 具体错误类别
 * @example classifyError(axiosErr) // 'http:500'
 */
export function classifyError(err: unknown, ctx: ClassifyContext = {}): string {
  for (const tag of TAG_PRIORITY) if (ctx.tags?.has(tag)) return tag;
  const e = asLike(err);
  const msg = String(e.message ?? '');
  if (msg.startsWith(AUTH_REFRESH_FAILED_MESSAGE)) return 'expired';
  if (msg.startsWith(AUTH_DENIED_MESSAGE)) return 'unauthenticated';
  if (isCanceled(e)) return 'canceled';
  if (e[PARSE_MARK] === true) return 'parse';
  if (isApiError(e)) {
    const r = e.response!;
    const status = Number(r.status ?? 0);
    return status >= 400 ? `http:${status}` : `business:${String(r.code)}`;
  }
  const status = e.response?.status ?? (typeof e.status === 'number' ? e.status : undefined);
  if (typeof status === 'number' && status >= 400) return `http:${status}`;
  if (e.code === 'ETIMEDOUT' || (e.code === 'ECONNABORTED' && TIMEOUT_MESSAGE_RE.test(msg)) || (!e.response && TIMEOUT_MESSAGE_RE.test(msg))) return 'timeout';
  const causeCode = e.cause?.code;
  if ((e.code && NETWORK_CODES.has(e.code)) || (causeCode && NETWORK_CODES.has(causeCode)) || NETWORK_MESSAGE_RE.test(msg) || e.code === 'ECONNABORTED') return 'network';
  if (e.code === 'ERR_BAD_RESPONSE' || e.name === 'SyntaxError') return 'parse';
  return `unknown:${e.name ?? 'Error'}:${msg.slice(0, 80)}`;
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
  if (m) return actual === (style === 'http' ? `http:${m[1]}` : `business:${m[1]}`);
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
