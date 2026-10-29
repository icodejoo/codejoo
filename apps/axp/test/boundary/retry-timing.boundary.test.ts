import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyJitter, computeDelay, retryAfterMs, waitFor } from "../../src/plugins/retry-timing";

/** 一秒服务端延迟。 */
const ONE_SECOND_HEADER = "1";
/** 测试等待时间。 */
const DELAY = 300;
/** 测试预算。 */
const MAX = 2;
/** 响应占位。 */
const RESPONSE = { status: 503 };
/** 计算延迟时透传的上下文替身。 */
const CTX = {};
/** 头名。 */
const HEADER = "retry-after";
/** 取消事件名。 */
const ABORT_EVENT = "abort";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([undefined, null, false, "300", {}])("[retry.fn.computeDelay] 非数字回调返回 %s 视为零", (value) => {
  expect(computeDelay(() => value, 1, MAX, RESPONSE, CTX)).toBe(0);
});

it.each([0, -1, NaN, Infinity])("[retry.fn.computeDelay] 数字 %s 沿用旧计算语义不归一化", (value) => {
  expect(computeDelay(value, 1, MAX, RESPONSE, CTX)).toBe(value);
  expect(computeDelay(() => value, 1, MAX, RESPONSE, CTX)).toBe(value);
});

it.each([NaN, Infinity, -1])("[retry.fn.applyJitter] 非有限或负抖动 %s 回退原始延迟", (value) => {
  expect(applyJitter(DELAY, () => value, Infinity)).toBe(DELAY);
});

it.each([NaN, -1, -Infinity])("[retry.fn.applyJitter] 计算出的延迟 %s 归一化为 0", (value) => {
  expect(applyJitter(value)).toBe(0);
  expect(applyJitter(value, undefined, Infinity)).toBe(0);
});

it("[retry.fn.waitFor] 超过 setTimeout 上限的等待按上限计时，不会溢出成立即触发", async () => {
  let done = false;
  const waiting = waitFor(Infinity).then(() => (done = true));
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(2_147_483_647);
  await waiting;
  expect(done).toBe(true);
});

it("[retry.fn.applyJitter] 零随机源、零返回值和零上限均立即结束延迟", () => {
  expect(applyJitter(DELAY, true, Infinity, () => 0)).toBe(0);
  expect(applyJitter(DELAY, () => 0)).toBe(0);
  expect(applyJitter(DELAY, undefined, 0)).toBe(0);
});

it("[retry.fn.computeDelay][retry.fn.applyJitter] 回调 bug 原样抛出且无等待定时器", () => {
  const error = new Error("callback bug");
  /** 模拟用户回调异常。 */
  const fail = () => {
    throw error;
  };
  expect(() => computeDelay(fail, 1, MAX, RESPONSE, CTX)).toThrow(error);
  expect(() => applyJitter(DELAY, fail)).toThrow(error);
  try {
    computeDelay(fail, 1, MAX, RESPONSE, CTX);
  } catch (caught) {
    expect(caught).toBe(error);
  }
  try {
    applyJitter(DELAY, fail);
  } catch (caught) {
    expect(caught).toBe(error);
  }
  expect(vi.getTimerCount()).toBe(0);
});

it.each([undefined, null, {}, { [HEADER]: undefined }, { [HEADER]: null }, { [HEADER]: "invalid" }, { [HEADER]: Infinity }, { [HEADER]: true }, { [HEADER]: {} }])(
  "[retry.fn.retryAfterMs] 缺失和非法头 %j 返回 undefined",
  (headers) => {
    expect(retryAfterMs(headers, Infinity)).toBeUndefined();
  },
);

it.each(["0", "-1", "", "   "])("[retry.fn.retryAfterMs] 数字头 %j 返回零（沿用旧 Number 兼容行为）", (value) => {
  expect(retryAfterMs({ [HEADER]: value }, Infinity)).toBe(0);
});

it("[retry.fn.retryAfterMs] 过去日期返回零，正等待超过零上限返回 null，get 缺值不回退普通字段", () => {
  const date = new Date(0).toUTCString();
  expect(retryAfterMs({ [HEADER]: date }, Infinity, () => DELAY)).toBe(0);
  expect(retryAfterMs({ [HEADER]: ONE_SECOND_HEADER }, 0)).toBeNull();
  expect(retryAfterMs({ get: () => undefined, [HEADER]: ONE_SECOND_HEADER }, Infinity)).toBeUndefined();
});

it("[retry.fn.waitFor] 无信号时到期完成，提前 1ms 不完成并清空计时器", async () => {
  let completions = 0;
  const waiting = waitFor(DELAY).then(() => {
    return ++completions;
  });
  await vi.advanceTimersByTimeAsync(DELAY - 1);
  expect(completions).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  await waiting;
  expect(completions).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([true, false])("[retry.fn.waitFor] 等待完成（abort=%s）清理同一监听器与计时器", async (abort) => {
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  let completions = 0;
  const waiting = waitFor(DELAY, controller.signal).then(() => {
    return ++completions;
  });
  if (abort) {
    await vi.advanceTimersByTimeAsync(DELAY / MAX);
    expect(completions).toBe(0);
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
  } else await vi.advanceTimersByTimeAsync(DELAY);
  await waiting;
  expect(add).toHaveBeenCalledWith(ABORT_EVENT, expect.any(Function), { once: true });
  expect(remove).toHaveBeenCalledWith(ABORT_EVENT, add.mock.calls[0][1]);
  expect(vi.getTimerCount()).toBe(0);
  controller.abort();
  await vi.runAllTimersAsync();
  expect(completions).toBe(1);
});

it("[retry.fn.waitFor] 预先中止立即完成，不登记监听器或计时器", async () => {
  const controller = new AbortController();
  controller.abort();
  const add = vi.spyOn(controller.signal, "addEventListener");
  await waitFor(DELAY, controller.signal);
  expect(add).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
