import { AXP_FAILURE } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import axpRetry from "../../src/plugins/retry";
import type { AxpRequestConfig } from "../../src/types";
import { b3Client, failure, REQUEST_URL, run } from "../helpers/b3";

/** 重试等待时长。 */
const RETRY_WAIT = 100;
/** 让一次尝试在途一段时间，便于在传输中取消。 */
const SLOW = { latency: 50 } as AxpRequestConfig;
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it("[core.method.cancelAll][retry.opt.max] 重试等待期间 cancelAll 能中止（返回 1），请求以 cancel 告终，之后没有在途请求", /** 逻辑请求的取消贯穿重试等待。 */ async () => {
  const h = b3Client([axpRetry({ max: 2, delay: RETRY_WAIT })]);
  h.net.fallback(/** 持续可重试失败。 */ () => failure(500));
  const pending = h.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(RETRY_WAIT / 2);
  expect(h.api.pending()).toBe(1);
  expect(h.api.cancelAll()).toBe(1);
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ ok: false, [AXP_FAILURE]: { type: "cancel" } });
  expect(h.net.totalStarted).toBe(1);
  expect(h.api.pending()).toBe(0);
  expect(h.api.cancelAll()).toBe(0);
});

it("[core.method.cancelAll][retry.opt.max] 重试最终成功后逻辑请求被释放（cancelAll 返回 0）", /** 成功落定即注销。 */ async () => {
  const h = b3Client([axpRetry({ max: 2, delay: RETRY_WAIT })]);
  h.net.fallback(/** 第一次失败，第二次成功。 */ (_config, hit) => (hit < 2 ? failure(500) : {}));
  expect((await run(h)).ok).toBe(true);
  expect(h.net.totalStarted).toBe(2);
  expect(h.api.pending()).toBe(0);
  expect(h.api.cancelAll()).toBe(0);
});

it("[core.method.cancelAll][retry.priority.kind] 尝试在途时被取消：得到 cancel 类别，不会被当作可重试失败", /** cancel 类别否决重试。 */ async () => {
  const h = b3Client([axpRetry({ max: 2, delay: 0 })]);
  h.net.fallback(/** 若被重试也只会得到失败。 */ () => failure(500));
  const pending = h.send({ url: REQUEST_URL, ...SLOW });
  await vi.advanceTimersByTimeAsync(10);
  expect(h.api.cancelAll()).toBe(1);
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
  expect(h.net.totalStarted).toBe(1);
});
