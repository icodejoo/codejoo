import { AXP_FAILURE } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import axpLoading from "../../src/plugins/loading";
import axpRetry from "../../src/plugins/retry";
import { b3Client, failure, REQUEST_URL, run } from "../helpers/b3";
import { loadingRecorder } from "../helpers/ui";

/** 默认回调的事件标签。 */
const LOADING_LABEL = "main";
/** 重试等待时长，足以在其间观察显示状态。 */
const RETRY_WAIT = 100;
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 装好 loading 与 retry 的客户端。 */
function loadingRetryClient(max = 2, business = false) {
  const h = b3Client([axpRetry({ max, delay: RETRY_WAIT, shouldRetry: business ? /** 使用者显式允许业务重试。 */ (r) => r.code === 500 : undefined })]);
  const loading = vi.fn(loadingRecorder(h.events));
  h.api.use(axpLoading({ loading }));
  return { ...h, loading };
}

it.each([200, 500])(
  "[loading.cb.loading][retry.opt.max] retry 最终 %i：等待期间保持显示，最终只有一对回调",
  /** 重试都在同一对显示/隐藏之内。 */ async (final) => {
    const h = loadingRetryClient();
    h.net.fallback(/** 前两次失败，最后一次按目标状态。 */ (_config, hit) => (hit < 3 || final !== 200 ? failure(500) : {}));
    const pending = h.send({ url: REQUEST_URL });
    await vi.advanceTimersByTimeAsync(RETRY_WAIT / 2);
    expect(h.events.loading.get(LOADING_LABEL)).toEqual([true]);
    await vi.advanceTimersByTimeAsync(RETRY_WAIT);
    expect(h.events.loading.get(LOADING_LABEL)).toEqual([true]);
    await vi.runAllTimersAsync();
    expect((await pending).ok).toBe(final === 200);
    expect(h.net.totalStarted).toBe(3);
    expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
  },
);

it("[loading.req.loading][retry.opt.max] loading:false 跨重试始终不参与计数", /** 请求级关闭不受重试影响。 */ async () => {
  const h = loadingRetryClient();
  h.net.fallback(/** 持续失败直到耗尽。 */ () => failure(500));
  expect((await run(h, { loading: false })).ok).toBe(false);
  expect(h.net.totalStarted).toBe(3);
  expect(h.loading).not.toHaveBeenCalled();
});

it.each(["business", "cancel"] as const)(
  "[loading.cb.loading][retry.opt.max] 重试等待期间遇到 %s 结局：loading 都正确隐藏",
  /** 业务失败耗尽与等待中取消。 */ async (ending) => {
    const h = loadingRetryClient(1, true);
    h.net.fallback(/** business 风格的 HTTP 200 + 500 业务码。 */ () => failure(500, true));
    const pending = h.send({ url: REQUEST_URL });
    await vi.advanceTimersByTimeAsync(RETRY_WAIT / 2);
    if (ending === "cancel") expect(h.api.cancelAll()).toBe(1);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: false, status: ending === "cancel" ? 0 : 200, ...(ending === "cancel" ? { [AXP_FAILURE]: { type: "cancel" } } : { code: 500 }) });
    expect(h.net.totalStarted).toBe(ending === "cancel" ? 1 : 2);
    expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
  },
);
