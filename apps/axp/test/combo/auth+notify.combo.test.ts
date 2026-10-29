import { businessAuthFailure } from "../helpers/b3";
import { AXP_FAILURE } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import type { IAuthOptions } from "../../src/plugins/auth";
import axpNotify from "../../src/plugins/notify";
import type { AxpResponse } from "../../src/response";
import { authClient, failure, guarded, REQUEST_URL, run, TOKEN_NEW } from "../helpers/b3";
import { notifyRecorder, legacyStringify } from "../helpers/ui";

/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 鉴权选项的覆盖写法。 */
type Override = Partial<IAuthOptions<AxpResponse>>;
/** 装好 auth 与 notify 的客户端，notify 按逻辑请求计数。 */
function notifyAuthClient(override: Override = {}) {
  const h = authClient(override);
  const notify = vi.fn(notifyRecorder(h.events));
  h.api.use(axpNotify<AxpResponse>({ notify, stringify: legacyStringify }));
  return { ...h, notify };
}

it.each([false, true])(
  "[notify.cb.notify][auth.cb.onRefresh] 刷新成功不通知：重放成功只落成功的最终结果（business=%s）",
  /** 中间的 401 不会单独通知。 */ async (business) => {
    const h = notifyAuthClient({ onFailure: business ? businessAuthFailure : undefined });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(() => TOKEN_NEW, business),
    );
    expect((await run(h)).ok).toBe(true);
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  },
);

const FAILURES: [string, number, Override, string, boolean][] = [
  ["过期", 401, { onRefresh: /** 刷新失败。 */ () => false }, "auth", false],
  ["越权", 403, {}, "auth", false],
  ["过期（business）", 401, { onRefresh: /** 刷新失败。 */ () => false }, "auth", true],
  ["越权（business）", 403, {}, "auth", true],
];
it.each(FAILURES)(
  "[notify.cb.notify][auth.reason.expired][auth.reason.denied] %s：最终失败才通知，恰好一次，消息来自最终的 auth 结果",
  /** 通知看到的是收敛后的 R。 */ async (_label, status, override, message, business) => {
    const h = notifyAuthClient({ onFailure: business ? businessAuthFailure : undefined, ...override });
    h.net.on("get", REQUEST_URL, () => failure(status, business));
    const result = await run(h);
    expect(h.notify).toHaveBeenCalledExactlyOnceWith(message, result);
  },
);

it("[notify.cb.notify][auth.reason.unauthenticated] 本地无 token：不触网，通知恰好一次", /** 本地拒绝同样是最终失败。 */ async () => {
  const h = notifyAuthClient();
  h.tm.clear();
  const result = await run(h);
  expect(h.net.totalStarted).toBe(0);
  expect(h.notify).toHaveBeenCalledExactlyOnceWith("auth", result);
});

it("[notify.cb.notify][auth.cb.onAccessExpired] 并发请求同时过期：每个逻辑请求各通知一次，onAccessExpired 只通知一次", /** I4：每逻辑请求 notify ≤ 1。 */ async () => {
  const h = notifyAuthClient({ onRefresh: () => false });
  h.net.on("get", REQUEST_URL, () => failure(401));
  const all = [h.send({ url: REQUEST_URL }), h.send({ url: REQUEST_URL }), h.send({ url: REQUEST_URL })];
  await vi.runAllTimersAsync();
  await Promise.all(all);
  expect(h.notify).toHaveBeenCalledTimes(3);
  expect(h.events.notify.size).toBe(3);
  expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
});

it("[notify.cb.notify][auth.cb.onAccessExpired] silent 请求：不通知用户，但会话过期的回调照常触发", /** 两类通知互不替代。 */ async () => {
  const h = notifyAuthClient({ onRefresh: () => false });
  h.net.on("get", REQUEST_URL, () => failure(401));
  expect(await run(h, { silent: true })).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
  expect(h.notify).not.toHaveBeenCalled();
  expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
});
