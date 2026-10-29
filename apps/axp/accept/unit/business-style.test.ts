import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxpResponse, AuthFailureAction, type AxpContext } from "@codejoo/axp";
import { businessStyleOptions, createClient, type ClientHandle } from "../lib/client-factory.ts";
import { DEFAULT_RETRY_STATUSES, HEADER_STYLE } from "../lib/constants.ts";
import { TokenStore } from "../lib/tokens.ts";

/** HTTP 成功状态。 */
const HTTP_OK = 200;
/** 业务未授权码。 */
const UNAUTHORIZED = 401;
/** 当前令牌。 */
const TOKEN = "Bearer current";
/** 已被替换的注入令牌。 */
const OLD_TOKEN = "Bearer old";
/** 本地退避毫秒数。 */
const LOCAL_DELAY = 10;
/** 服务端 Retry-After 对应的毫秒数。 */
const REMOTE_DELAY = 2000;
/** 业务限流码。 */
const RATE_LIMITED = 429;

/** 构造保留请求风格快照的业务响应。 */
function response(code: number, style = "business", status = HTTP_OK): AxpResponse {
  return new AxpResponse({ status, code, request: { headers: { [HEADER_STYLE]: style } } });
}

/** 构造只带请求风格的最小 ctx 桩；isBusiness 读用户发起的 originRequest，不依赖完整上下文。 */
function styleCtx(style = "business", params?: Record<string, unknown>, extra: Record<string, unknown> = {}, members: Record<string, unknown> = {}): AxpContext {
  const request = { headers: { [HEADER_STYLE]: style }, params, ...extra };
  return { request, originRequest: request, ...members } as unknown as AxpContext;
}

/** 创建仅装 retry 的真实客户端；测试用 axios adapter 决定每次返回值。 */
function retryClient(style: "http" | "business", respect?: boolean, statuses?: number[]): ClientHandle {
  return createClient({
    adapter: "http",
    baseURL: "http://test.invalid",
    plugins: { retry: { max: 1, delay_ms: LOCAL_DELAY, respect_retry_after: respect, statuses } },
    tokens: new TokenStore(),
    hooks: { loading: vi.fn(), notify: vi.fn(), refresh: vi.fn(), expired: vi.fn(), denied: vi.fn(), unauthenticated: vi.fn() },
    getStyle: () => style,
    runId: "business-policy",
  });
}

/** 所有涉及插件策略的自测使用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});
/** 还原调用方时钟。 */
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("业务风格的使用者配置", () => {
  it("[auth.cb.onFailure] 纯 http 场景不添加任何业务风格配置", () => {
    expect(businessStyleOptions({ getStyle: () => "http" })).toEqual({ auth: {}, retry: {} });
  });

  it.each([
    [undefined, TOKEN, AuthFailureAction.Expired],
    [TOKEN, OLD_TOKEN, AuthFailureAction.Replay],
    [TOKEN, TOKEN, AuthFailureAction.Refresh],
  ])("[auth.cb.onFailure] 业务 401：当前令牌=%s、注入令牌=%s → %s", async (current, injected, action) => {
    const tokens = new TokenStore();
    tokens.setAccessHeader(current);
    const ctx = styleCtx("business", undefined, {}, { get: vi.fn(() => injected) });
    const route = businessStyleOptions({ getStyle: () => "business" }).auth.onFailure!;
    const r = response(UNAUTHORIZED);
    expect(await route(r, tokens, ctx)).toBe(action);
    expect(r.status).toBe(HTTP_OK);
  });

  it("[auth.cb.onFailure] 业务 403 拒绝，其余业务码透传；HTTP 401/403 仍走默认路由", async () => {
    const tokens = new TokenStore();
    tokens.setAccessHeader(TOKEN);
    const ctx = styleCtx("business", undefined, {}, { get: () => TOKEN });
    const httpCtx = styleCtx("http", undefined, {}, { get: () => TOKEN });
    const route = businessStyleOptions({ getStyle: () => "business" }).auth.onFailure!;
    expect(await route(response(403), tokens, ctx)).toBe(AuthFailureAction.Deny);
    expect(await route(response(500), tokens, ctx)).toBe(AuthFailureAction.Others);
    expect(await route(response(UNAUTHORIZED, "http"), tokens, httpCtx)).toBe(AuthFailureAction.Others);
    expect(await route(response(0, "http", UNAUTHORIZED), tokens, httpCtx)).toBe(AuthFailureAction.Refresh);
    expect(await route(response(0, "http", 403), tokens, httpCtx)).toBe(AuthFailureAction.Deny);
  });

  it("[retry.opt.shouldRetry] 场景未配置状态码时与中立默认列表一致，其余交还默认规则", () => {
    const retry = businessStyleOptions({ getStyle: () => "business" }).retry.shouldRetry!;
    const ctx = styleCtx();
    const httpCtx = styleCtx("http");
    for (const code of DEFAULT_RETRY_STATUSES) expect(retry(response(code), 1, ctx)).toBe(true);
    for (const code of [0, UNAUTHORIZED, 403, 408, 413, 418, 429, 1001]) expect(retry(response(code), 1, ctx)).toBeUndefined();
    expect(retry(response(500, "http"), 1, httpCtx)).toBeUndefined();
  });

  it("[retry.opt.shouldRetry] 插件自定义 [418] 时仅业务 418 返回 true，业务 500 交还默认规则", () => {
    const retry = businessStyleOptions({ getStyle: () => "business" }, [418]).retry.shouldRetry!;
    const ctx = styleCtx();
    const httpCtx = styleCtx("http");
    expect(retry(response(418), 1, ctx)).toBe(true);
    expect(retry(response(500), 1, ctx)).toBeUndefined();
    expect(retry(response(418, "http"), 1, httpCtx)).toBeUndefined();
  });

  it.each([
    { requestRetry: { statusCodes: [500] }, retry418: undefined, retry500: true },
    { requestRetry: { statusCodes: [] }, retry418: undefined, retry500: undefined },
    { requestRetry: { max: 1 }, retry418: true, retry500: undefined },
    { requestRetry: true, retry418: true, retry500: undefined },
    { requestRetry: 1, retry418: true, retry500: undefined },
  ])("[retry.req.retry.statusCodes] 请求配置 $requestRetry 优先，无列表时沿用插件 [418]", ({ requestRetry, retry418, retry500 }) => {
    const retry = businessStyleOptions({ getStyle: () => "business" }, [418]).retry.shouldRetry!;
    const ctx = styleCtx("business", undefined, { retry: requestRetry });
    expect(retry(response(418), 1, ctx)).toBe(retry418);
    expect(retry(response(500), 1, ctx)).toBe(retry500);
  });

  it.each([
    { pluginStatuses: [418], requestStatuses: undefined, code: 418, hits: 2 },
    { pluginStatuses: [418], requestStatuses: undefined, code: 500, hits: 1 },
    { pluginStatuses: [418], requestStatuses: [500], code: 500, hits: 2 },
    { pluginStatuses: [418], requestStatuses: [500], code: 418, hits: 1 },
    { pluginStatuses: [418], requestStatuses: [], code: 418, hits: 1 },
    ...DEFAULT_RETRY_STATUSES.map((code) => ({ pluginStatuses: undefined, requestStatuses: undefined, code, hits: 2 })),
    { pluginStatuses: undefined, requestStatuses: undefined, code: 408, hits: 1 },
    { pluginStatuses: undefined, requestStatuses: undefined, code: 429, hits: 1 },
    { pluginStatuses: undefined, requestStatuses: undefined, code: 418, hits: 1 },
  ])("[retry.opt.shouldRetry][retry.req.retry.statusCodes] 业务 $code：插件=$pluginStatuses、请求=$requestStatuses，发送 $hits 次", async ({ pluginStatuses, requestStatuses, code, hits }) => {
    const client = retryClient("business", undefined, pluginStatuses);
    const adapter = vi.fn(
      /** 首次业务失败，若重试则成功。 */ async (config) => ({
        config,
        status: HTTP_OK,
        statusText: "OK",
        headers: {},
        data: { code: adapter.mock.calls.length === 1 ? code : 0, data: null },
      }),
    );
    client.axios.defaults.adapter = adapter;
    try {
      const pending = client.send({ id: "business-statuses", path: "/x", options: { retry: { statuses: requestStatuses } } }, {});
      const settled = hits === 2 ? expect(pending).resolves.toBeNull() : expect(pending).rejects.toMatchObject({ status: HTTP_OK, code });
      await vi.runAllTimersAsync();
      await settled;
      expect(adapter).toHaveBeenCalledTimes(hits);
    } finally {
      client.dispose();
    }
  });

  it.each([
    { status: HTTP_OK, code: 418, hits: 1 },
    { status: 418, code: 0, hits: 2 },
    { status: 500, code: 0, hits: 1 },
  ])("[retry.opt.shouldRetry] http 风格使用插件 [418] 的 HTTP 状态规则：HTTP $status、业务 $code，发送 $hits 次", async ({ status, code, hits }) => {
    const client = retryClient("http", undefined, [418]);
    const adapter = vi.fn(
      /** 首次返回指定 HTTP 状态，若重试则成功。 */ async (config) => ({
        config,
        status: adapter.mock.calls.length === 1 ? status : HTTP_OK,
        statusText: "test",
        headers: {},
        data: { code: adapter.mock.calls.length === 1 ? code : 0, data: null },
      }),
    );
    client.axios.defaults.adapter = adapter;
    try {
      const pending = client.send({ id: "http-statuses", path: "/x" }, {});
      const settled = hits === 2 ? expect(pending).resolves.toBeNull() : expect(pending).rejects.toMatchObject({ status });
      await vi.runAllTimersAsync();
      await settled;
      expect(adapter).toHaveBeenCalledTimes(hits);
    } finally {
      client.dispose();
    }
  });

  it("[retry.opt.respectRetryAfter] 仅业务 413/429/503 采信；HTTP 分支保留默认状态表", () => {
    const respect = businessStyleOptions({ getStyle: () => "business" }).retry.respectRetryAfter;
    if (typeof respect !== "function") throw new Error("应提供 Retry-After 判定函数");
    for (const code of [413, 429, 503]) expect(respect(response(code), styleCtx())).toBe(true);
    for (const code of [0, 408, 500, 502, 504]) expect(respect(response(code), styleCtx())).toBe(false);
    expect(respect(response(429, "http"), styleCtx("http"))).toBe(false);
    expect(respect(response(0, "http", 503), styleCtx("http"))).toBe(true);
  });

  it("[auth.cb.onFailure][retry.opt.shouldRetry] 风格切换按请求快照分流，query 风格覆盖头", async () => {
    let style: "http" | "business" = "http";
    const policy = businessStyleOptions({ getStyle: () => style, styleChanges: true });
    style = "business";
    const old = response(500, "http");
    const query = new AxpResponse({ status: HTTP_OK, code: 500 });
    expect(policy.retry.shouldRetry!(old, 1, styleCtx("http"))).toBeUndefined();
    expect(policy.retry.shouldRetry!(query, 1, styleCtx("http", { style }))).toBe(true);
    expect(policy.retry.shouldRetry!(new AxpResponse({ status: HTTP_OK, code: 500 }), 1, { request: {}, originRequest: {} } as unknown as AxpContext)).toBe(true);
    const tokens = new TokenStore();
    expect(await policy.auth.onFailure!(response(UNAUTHORIZED, "http"), tokens, styleCtx("http"))).toBe(AuthFailureAction.Others);
  });

  it.each([
    [undefined, undefined, REMOTE_DELAY],
    [true, true, REMOTE_DELAY],
    [true, false, LOCAL_DELAY],
    [false, undefined, LOCAL_DELAY],
    [false, true, REMOTE_DELAY],
  ])("[retry.opt.respectRetryAfter][retry.req.retry.respectRetryAfter] 插件=%s、请求=%s 时业务限流等待 %sms", async (pluginRespect, requestRespect, delay) => {
    const client = retryClient("business", pluginRespect, [RATE_LIMITED]);
    let hits = 0;
    client.axios.defaults.adapter = /** 首次业务限流，重试成功。 */ async (config) => ({
      config,
      status: HTTP_OK,
      statusText: "OK",
      headers: { "retry-after": "2" },
      data: { code: ++hits === 1 ? RATE_LIMITED : 0, data: null },
    });
    const pending = client.send({ id: "retry-after", path: "/x", options: requestRespect === undefined ? undefined : { retry: { respect_retry_after: requestRespect } } }, {});
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(hits).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    expect(hits).toBe(2);
    client.dispose();
  });

  it("[retry.opt.shouldRetry] http 风格的 HTTP 200 加业务码 429 不触发业务重试", async () => {
    const client = retryClient("http");
    const adapter = vi.fn(/** 始终是 HTTP 成功、业务失败。 */ async (config) => ({ config, status: HTTP_OK, statusText: "OK", headers: {}, data: { code: RATE_LIMITED, data: null } }));
    client.axios.defaults.adapter = adapter;
    const rejected = expect(client.send({ id: "http", path: "/x" }, {})).rejects.toMatchObject({ status: HTTP_OK, code: RATE_LIMITED });
    await vi.runAllTimersAsync();
    await rejected;
    expect(adapter).toHaveBeenCalledTimes(1);
    client.dispose();
  });
});
