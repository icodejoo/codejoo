import { AXP_FAILURE } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import axpNotify from "../../src/plugins/notify";
import axpRetry from "../../src/plugins/retry";
import type { AxpResponse } from "../../src/response";
import { authClient, failure, REQUEST_URL, run } from "../helpers/b3";
import { notifyRecorder, legacyStringify } from "../helpers/ui";

/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it.each([
  [401, { [AXP_FAILURE]: { type: "auth", reason: "expired" } }, 2],
  [500, { ok: false, status: 500 }, 3],
] as const)(
  "[auth.cb.onAccessExpired][retry.opt.max][core.method.cancelAll][notify.cb.notify] 重放返回 %i：只通知一次、重试预算至多用一次，之后逻辑请求全部释放",
  /** 刷新重放不占预算，重放后的失败交给 retry 或 auth 收敛。 */ async (replayStatus, expected, sends) => {
    const h = authClient({}, [axpRetry({ max: 1, delay: 0 })]);
    const notify = vi.fn(notifyRecorder(h.events));
    h.api.use(axpNotify<AxpResponse>({ notify, stringify: legacyStringify }));
    h.net.on("get", REQUEST_URL, /** 首发 401，之后（重放与重试）都返回目标状态。 */ (_config, hit) => failure(hit === 1 ? 401 : replayStatus));
    const result = await run(h);
    expect(result).toMatchObject(expected);
    expect(h.net.totalStarted).toBe(sends);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(replayStatus === 401 ? 1 : 0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(h.api.pending()).toBe(0);
    expect(h.api.cancelAll()).toBe(0);
  },
);
