import { beforeEach, expect, it, vi } from "vitest";
import { failureOf } from "../../src/response";
import { authClient, businessAuthFailure, guarded, REQUEST_URL, run, TOKEN_NEW } from "../helpers/b3";

/** 鉴权场景共用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it.each([false, true])(
  "[auth.cb.onFailure] 显式配置业务码路由=%s 决定业务 401 是否刷新",
  /** HTTP 状态保留 200，业务鉴权仅由用户回调决定。 */ async (configured) => {
    const h = authClient({ onFailure: configured ? businessAuthFailure : undefined });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(/** 刷新后服务端认可新 token。 */ () => TOKEN_NEW, true),
    );
    const response = await run(h);
    expect(response.status).toBe(200);
    expect(response.ok).toBe(configured);
    expect(response.code).toBe(configured ? 0 : 401);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(configured ? 1 : 0);
    expect(h.net.totalStarted).toBe(configured ? 2 : 1);
    expect(failureOf(response)).toBeUndefined();
  },
);
