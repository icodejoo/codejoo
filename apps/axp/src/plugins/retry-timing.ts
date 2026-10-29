import type { AxiosResponse } from "axios";
import type { AxpContext } from "../context";
import { waitAbortable } from "../utils";

/** 默认首轮退避毫秒数。 */
const BASE_DELAY = 300;
/** 指数退避倍数。 */
const BACKOFF_FACTOR = 2;
/** 秒到毫秒的换算倍数。 */
const MS_PER_SECOND = 1000;
/** Retry-After 头名。 */
export const RETRY_AFTER_HEADER = "retry-after";
/** 默认计算延迟上限（毫秒）。 */
export const DEFAULT_DELAY_MAX = 10_000;
/** 默认采信 Retry-After 的 HTTP 状态。 */
export const DEFAULT_AFTER_STATUS_CODES: readonly number[] = [413, 429, 503];

/**
 * 延迟策略；非数字返回值按零处理，异常原样抛出；末位 ctx 为当前请求上下文，旧的少参数回调照常可用。
 * @example const delay: TRetryDelay<string> = (attempt, max, r, ctx) => attempt * 300;
 */
export type TRetryDelay<R, C = AxpContext<any>> = number | ((attempt: number, max: number, response: R, ctx: C) => unknown);
/**
 * 抖动策略；非法返回值回退输入延迟，异常原样抛出。
 * @example const jitter: TRetryJitter = (ms) => ms / 2;
 */
export type TRetryJitter = true | ((ms: number) => number);
/**
 * 支持普通头对象和 Headers/AxiosHeaders 风格访问器。
 * @example const headers: IRetryAfterHeaders = { 'retry-after': '2' };
 */
export interface IRetryAfterHeaders {
  /** 优先采用的头访问器。 */
  get?: (name: string) => unknown;
  /** 普通对象头字段。 */
  [RETRY_AFTER_HEADER]?: unknown;
}

/**
 * 默认指数退避。
 * @param attempt 从 1 开始的重试次数。
 * @returns 未封顶的毫秒数。
 * @example defaultDelay(2); // 600
 */
export function defaultDelay(attempt: number): number {
  return BASE_DELAY * BACKOFF_FACTOR ** (attempt - 1);
}

/**
 * 计算原始延迟，不做封顶或抖动。
 * @param delay 数字或回调。
 * @param attempt 当前重试次数。
 * @param max 最大重试次数。
 * @param response 本次逻辑响应。
 * @param ctx 当前请求上下文，原样传给回调。
 * @typeParam C 上下文类型，默认任意响应类型的上下文。
 * @returns 数字结果，非数字为零；回调异常原样抛出。
 * @example computeDelay(defaultDelay, 1, 2, { status: 503 }, ctx);
 */
export function computeDelay<R, C = AxpContext<any>>(delay: TRetryDelay<R, C>, attempt: number, max: number, response: R, ctx: C): number {
  if (typeof delay === "number") return delay;
  const result = delay(attempt, max, response, ctx);
  return typeof result === "number" ? result : 0;
}

/**
 * 应用抖动后封顶，只处理本地计算的延迟。
 * @param ms 原始延迟。
 * @param jitter true 为 [0, ms) 均匀随机，自定义返回非法值则回退 ms。
 * @param delayMax 延迟上限，默认 10000。
 * @param random 可注入的 [0, 1) 随机源，默认 Math.random。
 * @returns 封顶后的非负延迟，NaN 与负数归 0；回调异常原样抛出。
 * @example applyJitter(300, true, 10000, () => 0.5); // 150
 */
export function applyJitter(ms: number, jitter?: TRetryJitter, delayMax = DEFAULT_DELAY_MAX, random = Math.random): number {
  let result = ms;
  if (jitter === true) result = random() * ms;
  else if (typeof jitter === "function") {
    const value = jitter(ms);
    result = Number.isFinite(value) && value >= 0 ? value : ms;
  }
  const capped = Math.min(delayMax, result);
  return capped > 0 ? capped : 0;
}

/**
 * 解析数字秒或 HTTP-date，沿用旧版 Number/Date.parse 兼容行为。
 * @param headers 普通头对象或提供 get 的头对象；缺省表示无头。
 * @param cap 服务端延迟上限，与 delayMax 独立；Infinity 表示永远照办。
 * @param now 当前毫秒时钟，默认 Date.now。
 * @returns 非负延迟，缺失或无法解析返回 undefined，超过上限返回 null（旧版为封顶后照样等待）。
 * @example retryAfterMs({ 'retry-after': '2' }, Infinity); // 2000
 */
export function retryAfterMs(headers: IRetryAfterHeaders | null | undefined, cap: number, now = Date.now): number | null | undefined {
  return parseRetryAfter(retryAfterHeader(headers), cap, now);
}

/** 提取原始重试头，优先使用 get，数字按秒数转为字符串。
 * @internal
 * @param headers 普通头对象或提供 get 的头对象。
 * @returns 原始头字符串，缺失或类型非法时为 undefined。
 * @example `retryAfterHeader({ 'retry-after': 2 }) // '2'`
 */
export function retryAfterHeader(headers: IRetryAfterHeaders | AxiosResponse["headers"] | null | undefined): string | undefined {
  const raw: unknown = typeof headers?.get === "function" ? headers.get(RETRY_AFTER_HEADER) : headers?.[RETRY_AFTER_HEADER];
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : undefined;
}

/** 按原始字符串解析数字秒或 HTTP-date，沿用 Number/Date.parse 语义。
 * @internal
 * @param raw 原始头字符串。
 * @param cap 服务端延迟上限（毫秒）。
 * @param now 当前毫秒时钟，仅有效日期头需要调用。
 * @returns 非负毫秒数，缺失或非法为 undefined，超限为 null。
 * @example `parseRetryAfter('2', Infinity) // 2000`
 */
export function parseRetryAfter(raw: string | undefined, cap: number, now = Date.now): number | null | undefined {
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  let ms: number;
  if (Number.isFinite(seconds)) ms = Math.max(0, seconds * MS_PER_SECOND);
  else {
    const timestamp = Date.parse(String(raw));
    if (Number.isNaN(timestamp)) return undefined;
    ms = Math.max(0, timestamp - now());
  }
  return ms > cap ? null : ms;
}

/**
 * 可取消等待；完成或中止均 resolve，并清理计时器和监听器。
 * @param ms 等待毫秒数；超过 setTimeout 上限时按上限等待。
 * @param signal 可选取消信号；已中止时立即完成。
 * @returns 等待结束的 Promise，不负责产生取消响应。
 * @example await waitFor(300, controller.signal);
 */
export function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  return waitAbortable<void>(undefined, signal, ms);
}
