import { expect, it, vi } from "vitest";
import { applyJitter, computeDelay, defaultDelay, DEFAULT_DELAY_MAX, DEFAULT_AFTER_STATUS_CODES, isRetryAfterEligible, retryAfterMs } from "../../src/plugins/retry-timing";

/** 限流逻辑状态。 */
const RATE_LIMIT_STATUS = 429;
/** 非默认采信头的状态。 */
const SERVER_ERROR_STATUS = 500;
/** 测试延迟。 */
const DELAY = 300;
/** 延迟上限。 */
const CAP = 1000;
/** 逻辑响应。 */
const RESPONSE = { status: RATE_LIMIT_STATUS };
/** 头名。 */
const HEADER = "retry-after";
/** HTTP 日期样例。 */
const DATE = "Wed, 21 Oct 2015 07:28:00 GMT";

it("[retry.fn.defaultDelay] 新默认指数退避与 10000ms 上限", () => {
  expect([1, 2, 3].map(defaultDelay)).toEqual([DELAY, DELAY * 2, DELAY * 4]);
  expect(DEFAULT_DELAY_MAX).toBe(10_000);
  expect(applyJitter(defaultDelay(7))).toBe(DEFAULT_DELAY_MAX);
});

it("[retry.fn.computeDelay] 常量原样返回，回调收到 attempt/max/泛型响应", () => {
  expect(computeDelay(DELAY, 1, 2, RESPONSE)).toBe(DELAY);
  const callback = vi.fn(() => DELAY);
  expect(computeDelay(callback, 1, 2, RESPONSE)).toBe(DELAY);
  expect(callback).toHaveBeenCalledExactlyOnceWith(1, 2, RESPONSE);
});

it("[retry.fn.applyJitter] 缺省不抖动，true 使用注入或默认随机源，自定义回调收到原始延迟", () => {
  expect(applyJitter(DELAY)).toBe(DELAY);
  expect(applyJitter(DELAY, true, CAP, () => 0.5)).toBe(DELAY / 2);
  const random = vi.spyOn(Math, "random").mockReturnValue(0.25);
  try {
    expect(applyJitter(DELAY, true)).toBe(DELAY / 4);
  } finally {
    random.mockRestore();
  }
  const jitter = vi.fn(() => CAP * 2);
  expect(applyJitter(DELAY, jitter, CAP)).toBe(CAP);
  expect(jitter).toHaveBeenCalledExactlyOnceWith(DELAY);
  expect(applyJitter(DELAY, undefined, CAP)).toBe(DELAY);
});

it("[retry.fn.isRetryAfterEligible] 默认逻辑状态、自定义集合与总开关", () => {
  expect(DEFAULT_AFTER_STATUS_CODES).toEqual([413, RATE_LIMIT_STATUS, 503]);
  for (const status of DEFAULT_AFTER_STATUS_CODES) expect(isRetryAfterEligible(status)).toBe(true);
  expect(isRetryAfterEligible(SERVER_ERROR_STATUS)).toBe(false);
  expect(isRetryAfterEligible(undefined)).toBe(false);
  expect(isRetryAfterEligible(RESPONSE.status, [])).toBe(false);
  expect(isRetryAfterEligible(RESPONSE.status, [RESPONSE.status], false)).toBe(false);
  expect(isRetryAfterEligible(SERVER_ERROR_STATUS, [SERVER_ERROR_STATUS])).toBe(true);
});

it("[retry.fn.retryAfterMs] 普通头与 get 访问器解析数字秒并独立封顶", () => {
  expect(retryAfterMs({ [HEADER]: "2" }, Infinity)).toBe(CAP * 2);
  expect(retryAfterMs({ [HEADER]: 2 }, CAP)).toBe(CAP);
  const get = vi.fn(() => "1.5");
  expect(retryAfterMs({ get, [HEADER]: "3" }, Infinity)).toBe(CAP * 1.5);
  expect(get).toHaveBeenCalledExactlyOnceWith(HEADER);
  expect(retryAfterMs({ [HEADER]: "20" }, Infinity)).toBeGreaterThan(DEFAULT_DELAY_MAX);
});

it("[retry.fn.retryAfterMs] HTTP-date 使用注入时钟或默认 Date.now", () => {
  const timestamp = Date.parse(DATE);
  expect(retryAfterMs({ [HEADER]: DATE }, Infinity, () => timestamp - CAP)).toBe(CAP);
  expect(retryAfterMs({ [HEADER]: DATE }, DELAY, () => timestamp - CAP)).toBe(DELAY);
  const now = vi.spyOn(Date, "now").mockReturnValue(timestamp - CAP);
  try {
    expect(retryAfterMs({ [HEADER]: DATE }, Infinity)).toBe(CAP);
  } finally {
    now.mockRestore();
  }
});
