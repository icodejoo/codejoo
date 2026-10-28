import { beforeEach, expect, it, vi } from "vitest";
import axpRetry from "../../src/plugins/retry";
import { AxpResponse, axpResponse, type AxpResponseInit } from "../../src/response";
import type { AxpResponse as DefaultResponse } from "../../src/response";
import type { AxpOptions } from "../../src/types";
import { authClient, b3Client, failure, REQUEST_URL, run, TOKEN_NEW } from "../helpers/b3";

/** 重试等待时长。 */
const RETRY_WAIT = 100;
/** 业务码到逻辑状态的映射：服务繁忙按 503，令牌过期按 401，越权按 403。 */
const CODE_STATUS: Record<string, number> = { BUSY: 503, TOKEN_EXPIRED: 401, FORBIDDEN: 403 };
/** 服务端回传的追踪头。 */
const TRACE_HEADER = "x-trace-id";
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 业务码决定逻辑状态的自定义响应，带扩展字段。 */
class BizResponse<D = unknown> extends AxpResponse<D> {
  /** 服务端追踪标识。 */
  traceId = "";
  /** 字符串业务码按映射表升级为逻辑状态，其余沿用默认规则。 */
  get status(): number {
    return (typeof this.code === "string" && CODE_STATUS[this.code]) || super.status;
  }
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
/** 客户端选项：运行时用自定义响应，类型上仍按默认响应参与插件泛型。 */
function bizOptions(): AxpOptions {
  return { response: bizResponse() as never };
}
/** 业务码失败的路由结果，附带追踪头。 */
function coded(code: string, trace: string) {
  return { status: 200, data: { code, data: null }, headers: { [TRACE_HEADER]: trace } };
}

it("[retry.opt.statusCodes][retry.business.retryAfter] business 失败（HTTP 200 + 业务码 500）由 retry 先处理：重试恢复后调用方直接拿到数据，不会先抛失败", /** D3：retry 先于落定看到 R。 */ async () => {
  const h = b3Client([axpRetry<DefaultResponse>({ max: 2, delay: RETRY_WAIT })]);
  h.net.fallback(
    /** 前两次业务失败，第三次成功。 */ (_config, hit) =>
      hit < 3 ? failure(500, true) : { data: { code: 0, data: "payload" } },
  );
  const pending = h.api.request({ url: REQUEST_URL });
  await vi.runAllTimersAsync();
  expect(await pending).toBe("payload");
  expect(h.net.totalStarted).toBe(3);
});

it("[retry.opt.statusCodes][retry.cb.shouldRetry] 自定义 R 的逻辑状态驱动重试：业务码 BUSY 映射为 503 即使 HTTP 是 200 也会重试；shouldRetry 收到的是自定义 R", /** 插件泛型对任意 R 成立。 */ async () => {
  const seen: unknown[] = [];
  const h = b3Client(
    [
      axpRetry<BizResponse>({
        max: 1,
        delay: 0,
        shouldRetry: /** 观察判定拿到的响应类型，不改变默认判定。 */ (r) => {
          seen.push(r);
          return undefined;
        },
      }) as never,
    ],
    bizOptions(),
  );
  h.net.fallback(
    /** 首次繁忙，其后成功。 */ (_config, hit) =>
      hit === 1 ? coded("BUSY", "t-busy") : { data: { code: 0, data: "ok" } },
  );
  const result = await run(h);
  expect(result.ok).toBe(true);
  expect(h.net.totalStarted).toBe(2);
  expect(seen[0]).toBeInstanceOf(BizResponse);
  expect(seen[0]).toMatchObject({ status: 503, traceId: "t-busy", httpStatus: 200 });
});

it("[auth.cb.onRefresh][auth.reason.expired] 自定义 R 的逻辑状态驱动鉴权：业务码 TOKEN_EXPIRED 映射为 401 → 刷新后重放成功；刷新失败时落定的 auth 响应仍是自定义 R，且保留追踪标识", /** 合成响应经工厂，扩展字段不丢。 */ async () => {
  const refreshed = authClient({}, [], bizOptions());
  refreshed.net.on(
    "get",
    REQUEST_URL,
    /** 旧 token 得到过期码，新 token 成功。 */ (config) =>
      config.headers.get("Authorization") === TOKEN_NEW ? {} : coded("TOKEN_EXPIRED", "t-401"),
  );
  expect((await run(refreshed)).ok).toBe(true);
  expect(refreshed.settings.onRefresh).toHaveBeenCalledTimes(1);

  const expired = authClient({ onRefresh: /** 刷新失败。 */ () => false }, [], bizOptions());
  expired.net.fallback(/** 始终过期码。 */ () => coded("TOKEN_EXPIRED", "t-401"));
  const expiredResult = await run(expired);
  expect(expiredResult).toBeInstanceOf(BizResponse);
  expect(expiredResult).toMatchObject({
    kind: "auth",
    reason: "expired",
    status: 401,
    traceId: "t-401",
  });

  const denied = authClient({}, [], bizOptions());
  denied.net.fallback(/** 越权码。 */ () => coded("FORBIDDEN", "t-403"));
  const deniedResult = await run(denied);
  expect(deniedResult).toBeInstanceOf(BizResponse);
  expect(deniedResult).toMatchObject({
    kind: "auth",
    reason: "denied",
    status: 403,
    traceId: "t-403",
  });
});

it("[auth.reason.unauthenticated][retry.priority.kind] 无 from 的合成响应（本地无 token、等待重试时取消）同样经工厂：是自定义 R，扩展字段存在", /** ctx.fail 合成的响应带扩展字段。 */ async () => {
  const unauthenticated = authClient({}, [], bizOptions());
  unauthenticated.tm.clear();
  const local = await run(unauthenticated);
  expect(local).toBeInstanceOf(BizResponse);
  expect(local).toMatchObject({ kind: "auth", reason: "unauthenticated", traceId: "" });

  const waiting = authClient(
    {},
    [axpRetry<DefaultResponse>({ max: 1, delay: RETRY_WAIT })],
    bizOptions(),
  );
  waiting.net.fallback(/** 可重试失败。 */ () => failure(500));
  const pending = waiting.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(RETRY_WAIT / 2);
  expect(waiting.api.cancelAll()).toBe(1);
  await vi.runAllTimersAsync();
  const cancelled = await pending;
  expect(cancelled).toBeInstanceOf(BizResponse);
  expect(cancelled).toMatchObject({ kind: "cancel", traceId: "" });
});
