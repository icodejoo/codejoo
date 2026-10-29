import { AXP_FAILURE } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import { defaultAuthFailure } from "../../src/plugins/auth";
import type { AxpContext } from "../../src/context";
import type { ITokenManager } from "../../src/objects/TokenManager";
import axpRetry from "../../src/plugins/retry";
import { AxpResponse, axpResponse, type AxpResponseInit } from "../../src/response";
import type { AxpOptions } from "../../src/types";
import { authClient, b3Client, failure, REQUEST_URL, run, TOKEN_NEW } from "../helpers/b3";

/** 重试等待时长。 */
const RETRY_WAIT = 100;
/** 用户鉴权回调内的业务码路由的映射：服务繁忙按 503，令牌过期按 401，越权按 403。 */
const CODE_STATUS: Record<string, number> = { BUSY: 503, TOKEN_EXPIRED: 401, FORBIDDEN: 403 };
/** 服务端回传的追踪头。 */
const TRACE_HEADER = "x-trace-id";
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 带追踪字段的自定义响应，业务路由由插件配置决定。 */
class BizResponse<D = unknown> extends AxpResponse<D> {
  /** 服务端追踪标识。 */
  traceId = "";
}
/** 创建保留扩展字段的响应工厂，派生时沿用来源的追踪标识。 */
function bizResponse() {
  return axpResponse<BizResponse>({
    /** 追踪标识取自来源或响应头。 */
    create: (init: AxpResponseInit<BizResponse>, raw) =>
      Object.assign(new BizResponse(init), {
        traceId: init.from?.traceId ?? String(raw?.headers[TRACE_HEADER] ?? ""),
      }),
  });
}
/** 使用者按字符串业务码路由鉴权，响应 status 始终为 HTTP 状态。 */
function codedAuthFailure(r: BizResponse, tm: ITokenManager, ctx: AxpContext<BizResponse>) {
  const routed = Object.create(r, { status: { value: CODE_STATUS[String(r.code)] ?? r.status } }) as BizResponse;
  return defaultAuthFailure(routed, tm, ctx);
}
/** 客户端选项：运行时用自定义响应，类型上仍按默认响应参与插件泛型。 */
function bizOptions(): AxpOptions {
  return { response: bizResponse() as never };
}
/** 业务码失败的路由结果，附带追踪头。 */
function coded(code: string, trace: string) {
  return { status: 200, data: { code, data: null }, headers: { [TRACE_HEADER]: trace } };
}

it("[retry.opt.statusCodes][retry.business.retryAfter] 配置 shouldRetry 后业务失败由 retry 处理：重试恢复后调用方直接拿到数据，不会先抛失败", /** D3：retry 先于落定看到 R。 */ async () => {
  const h = b3Client([axpRetry({ max: 2, delay: RETRY_WAIT, shouldRetry: /** 业务重试由使用者配置。 */ (r) => r.code === 500 })]);
  h.net.fallback(/** 前两次业务失败，第三次成功。 */ (_config, hit) => (hit < 3 ? failure(500, true) : { data: { code: 0, data: "payload" } }));
  const pending = h.api.request({ url: REQUEST_URL });
  await vi.runAllTimersAsync();
  expect(await pending).toBe("payload");
  expect(h.net.totalStarted).toBe(3);
});

it("[retry.opt.statusCodes][retry.cb.shouldRetry] 自定义 R 的 shouldRetry 按业务码 BUSY 重试，HTTP status 保持 200；shouldRetry 收到的是自定义 R", /** 插件泛型对任意 R 成立。 */ async () => {
  const seen: unknown[] = [];
  const h = b3Client(
    [
      axpRetry<BizResponse>({
        max: 1,
        delay: 0,
        shouldRetry: /** 观察判定拿到的响应类型，不改变默认判定。 */ (r) => {
          seen.push(r);
          return CODE_STATUS[String(r.code)] === 503;
        },
      }) as never,
    ],
    bizOptions(),
  );
  h.net.fallback(/** 首次繁忙，其后成功。 */ (_config, hit) => (hit === 1 ? coded("BUSY", "t-busy") : { data: { code: 0, data: "ok" } }));
  const result = await run(h);
  expect(result.ok).toBe(true);
  expect(h.net.totalStarted).toBe(2);
  expect(seen[0]).toBeInstanceOf(BizResponse);
  expect(seen[0]).toMatchObject({ traceId: "t-busy", status: 200 });
});

it("[auth.cb.onRefresh][auth.reason.expired] 自定义 R 的 onFailure 按业务码 TOKEN_EXPIRED 路由 → 刷新后重放成功；刷新失败时落定的 auth 响应仍是自定义 R，且保留追踪标识", /** 合成响应经工厂，扩展字段不丢。 */ async () => {
  const refreshed = authClient({ onFailure: codedAuthFailure as never }, [], bizOptions());
  refreshed.net.on("get", REQUEST_URL, /** 旧 token 得到过期码，新 token 成功。 */ (config) => (config.headers.get("Authorization") === TOKEN_NEW ? {} : coded("TOKEN_EXPIRED", "t-401")));
  expect((await run(refreshed)).ok).toBe(true);
  expect(refreshed.settings.onRefresh).toHaveBeenCalledTimes(1);

  const expired = authClient({ onFailure: codedAuthFailure as never, onRefresh: /** 刷新失败。 */ () => false }, [], bizOptions());
  expired.net.fallback(/** 始终过期码。 */ () => coded("TOKEN_EXPIRED", "t-401"));
  const expiredResult = await run(expired);
  expect(expiredResult).toBeInstanceOf(BizResponse);
  expect(expiredResult).toMatchObject({ status: 200, traceId: "t-401", [AXP_FAILURE]: { type: "auth", reason: "expired" } });

  const denied = authClient({ onFailure: codedAuthFailure as never }, [], bizOptions());
  denied.net.fallback(/** 越权码。 */ () => coded("FORBIDDEN", "t-403"));
  const deniedResult = await run(denied);
  expect(deniedResult).toBeInstanceOf(BizResponse);
  expect(deniedResult).toMatchObject({ status: 200, traceId: "t-403", [AXP_FAILURE]: { type: "auth", reason: "denied" } });
});

it("[auth.reason.unauthenticated][retry.priority.kind] 无 from 的合成响应（本地无 token、等待重试时取消）同样经工厂：是自定义 R，扩展字段存在", /** ctx.fail 合成的响应带扩展字段。 */ async () => {
  const unauthenticated = authClient({ onFailure: codedAuthFailure as never }, [], bizOptions());
  unauthenticated.tm.clear();
  const local = await run(unauthenticated);
  expect(local).toBeInstanceOf(BizResponse);
  expect(local).toMatchObject({ traceId: "", [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });

  const waiting = authClient({ onFailure: codedAuthFailure as never }, [axpRetry({ max: 1, delay: RETRY_WAIT })], bizOptions());
  waiting.net.fallback(/** 可重试失败。 */ () => failure(500));
  const pending = waiting.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(RETRY_WAIT / 2);
  expect(waiting.api.cancelAll()).toBe(1);
  await vi.runAllTimersAsync();
  const cancelled = await pending;
  expect(cancelled).toBeInstanceOf(BizResponse);
  expect(cancelled).toMatchObject({ traceId: "", [AXP_FAILURE]: { type: "cancel" } });
});
