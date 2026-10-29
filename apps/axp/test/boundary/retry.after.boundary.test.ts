import { beforeEach, expect, it, vi } from "vitest";
import axpRetry from "../../src/plugins/retry";
import type { AxpContext } from "../../src/context";
import { b3Client } from "../helpers/b3";

/** 服务端重试头名。 */
const HEADER = "retry-after";
/** 一小时，验证默认上限及 Infinity。 */
const HOUR = 3_600_000;
/** 三十秒，验证正常采信及自定义上限。 */
const HALF_MINUTE = 30_000;

beforeEach(/** 所有服务端等待通过假时钟推进。 */ () => vi.useFakeTimers());

it.each([
  { label: "默认拒绝一小时", seconds: 3600, cap: undefined, wait: null },
  { label: "默认等待三十秒", seconds: 30, cap: undefined, wait: HALF_MINUTE },
  { label: "默认接受恰好六十秒", seconds: 60, cap: undefined, wait: HALF_MINUTE * 2 },
  { label: "Infinity 等待一小时", seconds: 3600, cap: Infinity, wait: HOUR },
  { label: "自定义十秒拒绝三十秒", seconds: 30, cap: 10_000, wait: null },
  { label: "自定义三十秒接受边界", seconds: 30, cap: HALF_MINUTE, wait: HALF_MINUTE },
])(
  "[retry.opt.retryAfterMax] $label",
  /** 超限立即落定且没有 timer，未超限严格等待完整时长。 */ async ({ seconds, cap, wait }) => {
    const h = b3Client([axpRetry({ max: 1, retryAfterMax: cap })]);
    const delay = vi.fn();
    let first: unknown;
    h.api.use({
      name: "first-response",
      stage: "source",
      /** 保存首次失败身份。 */ async handle(_ctx, next) {
        const response = await next();
        first ??= response;
        return response;
      },
    });
    h.net.fallback(/** 首发失败，重试则成功。 */ (_config, hit) => ({ status: hit === 1 ? 503 : 200, headers: { [HEADER]: String(seconds) } }));
    const pending = h.send({ retry: { delay } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.net.totalStarted).toBe(1);
    if (wait === null) {
      expect(await pending).toBe(first);
      expect(vi.getTimerCount()).toBe(0);
    } else {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(h.net.totalStarted).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.runAllTimersAsync();
      expect((await pending).ok).toBe(true);
      expect(h.net.totalStarted).toBe(2);
    }
    expect(delay).not.toHaveBeenCalled();
  },
);

it("[retry.opt.retryAfterMax] HTTP 日期超过自定义上限时立即返回原响应", /** HTTP-date 与秒数采用相同的拒绝语义。 */ async () => {
  vi.setSystemTime(new Date("2026-10-29T00:00:00Z"));
  const h = b3Client([axpRetry({ retryAfterMax: HALF_MINUTE })]);
  h.net.fallback(/** 要求一小时之后重试。 */ () => ({ status: 503, headers: { [HEADER]: new Date(Date.now() + HOUR).toUTCString() } }));
  const pending = h.send();
  await vi.advanceTimersByTimeAsync(0);
  expect((await pending).status).toBe(503);
  expect(h.net.totalStarted).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("[core.method.canReplay][retry.opt.delay] 重试等待期间请求体被其它层发送后，下一次尝试前停止", /** 等待前后都需要检查共享发送记录。 */ async () => {
  const data = { pipe: vi.fn() };
  const h = b3Client([axpRetry({ max: 1, delay: HALF_MINUTE })]);
  let context!: AxpContext;
  let original: unknown;
  const inner = vi.fn(
    /** 首次失败尚未触网，允许进入重试等待。 */ async (ctx: AxpContext) => {
      context = ctx;
      return (original = ctx.fail({ ok: false, status: 503 }));
    },
  );
  h.api.use({ name: "deferred-send", stage: "source", handle: inner });
  const pending = h.send({ method: "put", data });
  await vi.advanceTimersByTimeAsync(0);
  expect(context.canReplay()).toBe(true);
  context.markBodySent(context.request.data);
  await vi.advanceTimersByTimeAsync(HALF_MINUTE);
  expect(await pending).toBe(original);
  expect(inner).toHaveBeenCalledTimes(1);
  expect(h.net.totalStarted).toBe(0);
});
