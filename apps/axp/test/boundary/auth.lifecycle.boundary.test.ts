import { AXP_FAILURE } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import type { AxpRequestPatch } from "../../src/types";
import { authClient, deferred, failure, REQUEST_URL } from "../helpers/b3";

/** 异步边界使用可控假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it("[auth.cb.ready] 异步 ready 期间登出：本地拒绝并通知一次，不发出无凭证请求", async () => {
  const gate = deferred<AxpRequestPatch>();
  const h = authClient({ ready: () => gate.promise });
  h.net.on("get", REQUEST_URL, () => ({ data: { code: 0, data: "ok" } }));
  const pending = h.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(0);
  h.tm.clear();
  gate.resolve({});
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
  expect(h.net.totalStarted).toBe(0);
  expect(h.settings.onAccessDenied).toHaveBeenCalledTimes(1);
});

it("[auth.refresh] dispose 后在途刷新迟到失败：不清会话、不触发过期通知", async () => {
  const gate = deferred<boolean>();
  const h = authClient({ onRefresh: () => gate.promise });
  h.net.on("get", REQUEST_URL, () => failure(401));
  const pending = h.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  h.api.dispose();
  gate.resolve(false);
  await vi.runAllTimersAsync();
  await pending;
  expect(h.tm.accessToken).toBeDefined();
  expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
});
