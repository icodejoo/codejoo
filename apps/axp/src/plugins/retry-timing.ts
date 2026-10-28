/** 默认首轮退避毫秒数。 */
const BASE_DELAY = 300;
/** 指数退避倍数。 */
const BACKOFF_FACTOR = 2;
/** 秒到毫秒的换算倍数。 */
const MS_PER_SECOND = 1000;
/** Retry-After 头名。 */
const RETRY_AFTER = "retry-after";
/** 取消事件名。 */
const ABORT_EVENT = "abort";
/** setTimeout 可接受的最大毫秒数，超出会被运行时当作溢出立即触发。 */
const MAX_TIMEOUT = 2_147_483_647;
/** 默认计算延迟上限（毫秒）。 */
export const DEFAULT_DELAY_MAX = 10_000;
/** 默认采信 Retry-After 的逻辑状态。 */
export const DEFAULT_AFTER_STATUS_CODES: readonly number[] = [413, 429, 503];

/**
 * 延迟策略；非数字返回值按零处理，异常原样抛出。
 * @example const delay: TRetryDelay<string> = (attempt) => attempt * 300;
 */
export type TRetryDelay<R> = number | ((attempt: number, max: number, response: R) => unknown);
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
  "retry-after"?: unknown;
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
 * @returns 数字结果，非数字为零；回调异常原样抛出。
 * @example computeDelay(defaultDelay, 1, 2, { status: 503 });
 */
export function computeDelay<R>(
  delay: TRetryDelay<R>,
  attempt: number,
  max: number,
  response: R,
): number {
  if (typeof delay === "number") return delay;
  const result = delay(attempt, max, response);
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
export function applyJitter(
  ms: number,
  jitter?: TRetryJitter,
  delayMax = DEFAULT_DELAY_MAX,
  random = Math.random,
): number {
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
 * 仅判断逻辑状态是否允许采信 Retry-After，不读取响应头。
 * @param status 逻辑状态码。
 * @param afterStatusCodes 允许的状态列表，默认 413/429/503。
 * @param respect 是否采信，默认 true。
 * @returns 是否允许解析服务端延迟。
 * @example isRetryAfterEligible(429); // true
 */
export function isRetryAfterEligible(
  status: number | undefined,
  afterStatusCodes: readonly number[] = DEFAULT_AFTER_STATUS_CODES,
  respect = true,
): boolean {
  return respect && typeof status === "number" && afterStatusCodes.includes(status);
}

/**
 * 解析数字秒或 HTTP-date，沿用旧版 Number/Date.parse 兼容行为。
 * @param headers 普通头对象或提供 get 的头对象；缺省表示无头。
 * @param cap 服务端延迟上限，与 delayMax 独立。
 * @param now 当前毫秒时钟，默认 Date.now。
 * @returns 非负封顶延迟，缺失或无法解析返回 undefined。
 * @example retryAfterMs({ 'retry-after': '2' }, Infinity); // 2000
 */
export function retryAfterMs(
  headers: IRetryAfterHeaders | null | undefined,
  cap: number,
  now = Date.now,
): number | undefined {
  const raw =
    typeof headers?.get === "function" ? headers.get(RETRY_AFTER) : headers?.[RETRY_AFTER];
  if (raw == null) return undefined;
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(cap, Math.max(0, seconds * MS_PER_SECOND));
  const timestamp = Date.parse(String(raw));
  if (Number.isNaN(timestamp)) return undefined;
  return Math.min(cap, Math.max(0, timestamp - now()));
}

/**
 * 可取消等待；完成或中止均 resolve，并清理计时器和监听器。
 * @param ms 等待毫秒数；超过 setTimeout 上限时按上限等待。
 * @param signal 可选取消信号；已中止时立即完成。
 * @returns 等待结束的 Promise，不负责产生取消响应。
 * @example await waitFor(300, controller.signal);
 */
export function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    /** 计时器与取消共用收尾逻辑。 */
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener(ABORT_EVENT, finish);
      // oxlint-disable-next-line promise/no-multiple-resolved -- 定时器与 abort 共用收尾；已清理两个触发源，不会重复落定。
      resolve();
    };
    const timer = setTimeout(finish, Math.min(ms, MAX_TIMEOUT));
    signal?.addEventListener(ABORT_EVENT, finish, { once: true });
  });
}
