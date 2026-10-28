import { AxiosError } from "axios";
import { beforeEach, expect, it, vi } from "vitest";
import axpLoading from "../../src/plugins/loading";
import type { AxpResponse } from "../../src/response";
import { authClient, deferred, failure, guarded, REFRESH_TOKEN, REQUEST_URL, run, TOKEN_NEW } from "../helpers/b3";
import { loadingRecorder } from "../helpers/ui";

/** 默认回调的事件标签。 */
const LOADING_LABEL = "main";
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it("[loading.cb.loading][auth.cb.onRefresh] 刷新等待期间一直显示，排队的新请求并入同一次显示：全程只有一对回调", /** N10：loading 覆盖刷新等待。 */ async () => {
  const gate = deferred<void>();
  const h = authClient({
    onRefresh: /** 等门打开再换 token。 */ async (_r, tm) => {
      await gate.promise;
      tm.set(TOKEN_NEW, REFRESH_TOKEN);
    },
  });
  h.api.use(axpLoading<AxpResponse>({ loading: loadingRecorder(h.events) }));
  h.net.on(
    "get",
    REQUEST_URL,
    guarded(() => TOKEN_NEW),
  );
  const first = h.send({ url: REQUEST_URL });
  await vi.runAllTimersAsync();
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true]);
  const queued = h.send({ url: REQUEST_URL });
  await vi.runAllTimersAsync();
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true]);
  gate.resolve();
  await vi.runAllTimersAsync();
  expect((await first).ok).toBe(true);
  expect((await queued).ok).toBe(true);
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
});

it("[loading.cb.loading][auth.cb.onRefresh] 刷新失败收敛后同样隐藏：一对回调，结果为 auth/expired", /** 失败路径也成对。 */ async () => {
  const h = authClient({ onRefresh: () => false });
  h.api.use(axpLoading<AxpResponse>({ loading: loadingRecorder(h.events) }));
  h.net.on("get", REQUEST_URL, () => failure(401));
  expect(await run(h)).toMatchObject({ kind: "auth", reason: "expired" });
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
});

it.each([
  ["network", AxiosError.ERR_NETWORK],
  ["timeout", AxiosError.ETIMEDOUT],
] as const)(
  "[loading.cb.loading][auth.cb.onRefresh] 首发 401 后重放遇到 %s 失败也释放 loading，结果保留该失败类别",
  /** 重放失败不遗漏 false。 */ async (kind, code) => {
    const h = authClient();
    h.api.use(axpLoading<AxpResponse>({ loading: loadingRecorder(h.events) }));
    h.net.on(
      "get",
      REQUEST_URL,
      /** 首发 401，重放传输失败。 */ (_config, hit) => {
        if (hit === 1) return failure(401);
        throw new AxiosError("replay failed", code);
      },
    );
    expect(await run(h)).toMatchObject({ ok: false, kind });
    expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  },
);
