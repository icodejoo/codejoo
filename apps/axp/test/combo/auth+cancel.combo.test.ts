import { failureOf } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import axpLoading from "../../src/plugins/loading";
import axpNotify from "../../src/plugins/notify";
import type { AxpResponse } from "../../src/response";
import { authClient, deferred, failure, REFRESH_TOKEN, REQUEST_URL, TOKEN_NEW } from "../helpers/b3";
import { loadingRecorder, notifyRecorder } from "../helpers/ui";

/** 默认回调的事件标签。 */
const LOADING_LABEL = "main";
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it.each([true, false])(
  "[auth.cb.onRefresh][core.method.cancelAll] 刷新期间 cancelAll：等待者全部以 cancel 结束且不重放，loading 成对隐藏、cancel 不通知（刷新结果 %s）",
  /** I1/I2/I3/I4 在取消 + 刷新下成立。 */ async (success) => {
    const gate = deferred<boolean>();
    const h = authClient({
      onRefresh: /** 等门打开再按结果换 token。 */ async (_r, tm) => {
        const ok = await gate.promise;
        if (ok) tm.set(TOKEN_NEW, REFRESH_TOKEN);
        return ok;
      },
    });
    const notify = vi.fn(notifyRecorder(h.events));
    h.api.use(axpLoading({ loading: loadingRecorder(h.events) }));
    h.api.use(axpNotify<AxpResponse>({ notify }));
    h.net.on("get", REQUEST_URL, () => failure(401));
    const waiting = h.send({ url: REQUEST_URL });
    await vi.runAllTimersAsync();
    const queued = h.send({ url: REQUEST_URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.api.cancelAll()).toBe(2);
    await vi.runAllTimersAsync();
    expect(failureOf(await waiting)?.type).toBe("cancel");
    expect(failureOf(await queued)?.type).toBe("cancel");
    expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
    expect(notify).not.toHaveBeenCalled();
    gate.resolve(success);
    await vi.runAllTimersAsync();
    expect(h.net.totalStarted).toBe(1);
    expect(h.api.cancelAll()).toBe(0);
  },
);
