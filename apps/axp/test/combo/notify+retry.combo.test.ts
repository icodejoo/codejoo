import { failureOf } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import axpNotify from "../../src/plugins/notify";
import axpRetry from "../../src/plugins/retry";
import type { AxpResponse } from "../../src/response";
import { b3Client, failure, REQUEST_URL, run } from "../helpers/b3";
import { notifyRecorder, legacyStringify } from "../helpers/ui";

/** 重试等待时长。 */
const RETRY_WAIT = 100;
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 装好 retry 与 notify 的客户端，notify 按逻辑请求计数。 */
function notifyRetryClient(max = 2, business = false) {
  const h = b3Client([axpRetry({ max, delay: RETRY_WAIT, shouldRetry: business ? /** 使用者显式允许业务重试。 */ (r) => r.code === 500 : undefined })]);
  const notify = vi.fn(notifyRecorder(h.events));
  h.api.use(axpNotify<AxpResponse>({ notify, stringify: legacyStringify }));
  return { ...h, notify };
}

it("[notify.cb.notify][retry.opt.max] 重试后恢复：不通知，中间失败的尝试不单独通知", /** 只有最终 R 才进入 notify。 */ async () => {
  const h = notifyRetryClient();
  h.net.fallback(/** 前两次失败，第三次恢复。 */ (_config, hit) => (hit < 3 ? failure(500) : {}));
  expect((await run(h)).ok).toBe(true);
  expect(h.net.totalStarted).toBe(3);
  expect(h.notify).not.toHaveBeenCalled();
});

it.each([
  ["HTTP 状态", false, "status 500"],
  ["business 风格", true, "status 200 code 500"],
] as const)(
  "[notify.cb.notify][retry.opt.max] 重试耗尽后最终失败才通知，恰好一次（%s）",
  /** 通知看到的是最后一次尝试的 R。 */ async (_style, business, message) => {
    const h = notifyRetryClient(2, business);
    h.net.fallback(/** 持续失败直到耗尽。 */ () => failure(500, business));
    const result = await run(h);
    expect(h.net.totalStarted).toBe(3);
    expect(h.notify).toHaveBeenCalledExactlyOnceWith(message, result);
  },
);

it("[notify.cb.notify][retry.opt.max] 等待重试期间被取消：取消不通知", /** cancel 类别被默认 stringify 忽略。 */ async () => {
  const h = notifyRetryClient();
  h.net.fallback(/** 持续失败。 */ () => failure(500));
  const pending = h.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(RETRY_WAIT / 2);
  expect(h.api.cancelAll()).toBe(1);
  await vi.runAllTimersAsync();
  expect(failureOf(await pending)?.type).toBe("cancel");
  expect(h.notify).not.toHaveBeenCalled();
});
