import { beforeEach, expect, it, vi } from "vitest";
import { failureOf } from "../../src/response";
import { AuthFailureAction } from "../../src/plugins/auth";
import { authClient, businessAuthFailure, failure, guarded, REQUEST_URL, run, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";

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

it("[auth.fn.defaultAuthFailure][core.opt.statusOf] 有效状态把 HTTP 200 + code 401 路由到刷新并重放成功", /** 默认路由遵从客户端状态投影。 */ async () => {
  const h = authClient({}, [], { statusOf: /** 业务码承担有效状态。 */ (r) => Number(r.code) || r.status });
  h.net.on(
    "get",
    REQUEST_URL,
    guarded(/** 刷新后放行。 */ () => TOKEN_NEW, true),
  );
  const response = await run(h);
  expect(response).toMatchObject({ status: 200, code: 0, ok: true });
  expect(failureOf(response)).toBeUndefined();
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
  expect(h.net.totalStarted).toBe(2);
});

it("[auth.fn.defaultAuthFailure][core.opt.statusOf] 有效状态 403 走拒绝并保留 HTTP 200 和会话", /** 403 同样读取有效状态。 */ async () => {
  const h = authClient({}, [], { statusOf: /** 用业务码判定。 */ (r) => Number(r.code) });
  h.net.on("get", REQUEST_URL, /** HTTP 200 表达越权。 */ () => failure(403, true));
  const response = await run(h);
  expect(response.status).toBe(200);
  expect(failureOf(response)?.reason).toBe("denied");
  expect(h.tm.accessToken).toBe(TOKEN_OLD);
  expect(h.settings.onRefresh).not.toHaveBeenCalled();
});

it("[auth.cb.onFailure][core.opt.statusOf] 自定义 onFailure 优先于有效状态默认路由", /** 用户路由可以透传业务 401。 */ async () => {
  const h = authClient({ onFailure: /** 明确透传响应。 */ () => AuthFailureAction.Others }, [], { statusOf: /** 默认会判为刷新。 */ (r) => Number(r.code) });
  h.net.on("get", REQUEST_URL, /** 有效状态为 401。 */ () => failure(401, true));
  const response = await run(h);
  expect(response).toMatchObject({ status: 200, code: 401, ok: false });
  expect(failureOf(response)).toBeUndefined();
  expect(h.settings.onRefresh).not.toHaveBeenCalled();
  expect(h.tm.accessToken).toBe(TOKEN_OLD);
});
