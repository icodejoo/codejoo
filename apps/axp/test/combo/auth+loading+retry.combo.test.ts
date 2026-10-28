import { beforeEach, expect, it, vi } from "vitest";
import axpLoading from "../../src/plugins/loading";
import axpRetry from "../../src/plugins/retry";
import type { AxpResponse } from "../../src/response";
import {
  authClient,
  deferred,
  failure,
  guarded,
  REFRESH_TOKEN,
  REQUEST_URL,
  TOKEN_NEW,
} from "../helpers/b3";
import { loadingRecorder } from "../helpers/ui";

/** 默认回调的事件标签。 */
const LOADING_LABEL = "main";
/** 重试等待时长，足以在其间观察显示状态。 */
const RETRY_WAIT = 100;
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it("[loading.cb.loading][auth.cb.onRefresh][retry.opt.max] 500 → 重试等待 → 401 → 刷新等待 → 重放成功：每个等待阶段都保持显示，全程只有一对回调", /** N10：重试与刷新等待都在 loading 之内。 */ async () => {
  const gate = deferred<void>();
  const h = authClient(
    {
      onRefresh: /** 等门打开再换 token。 */ async (_r, tm) => {
        await gate.promise;
        tm.set(TOKEN_NEW, REFRESH_TOKEN);
      },
    },
    [axpRetry<AxpResponse>({ max: 1, delay: RETRY_WAIT })],
  );
  h.api.use(axpLoading<AxpResponse>({ loading: loadingRecorder(h.events) }));
  const route = guarded(() => TOKEN_NEW);
  h.net.on(
    "get",
    REQUEST_URL,
    /** 首发 500，其后按 token 放行。 */ (config, hit) =>
      hit === 1 ? failure(500) : route(config, hit),
  );
  const pending = h.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(RETRY_WAIT / 2);
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true]);
  await vi.advanceTimersByTimeAsync(RETRY_WAIT);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true]);
  gate.resolve();
  await vi.runAllTimersAsync();
  expect((await pending).ok).toBe(true);
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
});
