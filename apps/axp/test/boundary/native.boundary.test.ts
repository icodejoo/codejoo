import { AxiosHeaders, create as createAxios, type AxiosResponse } from "axios";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { settle } from "../../src/client";
import { requestContext, type AxpContext } from "../../src/context";
import TokenManager from "../../src/objects/TokenManager";
import axpAuth, { AuthFailureAction } from "../../src/plugins/auth";
import axpCache from "../../src/plugins/cache";
import axpMock from "../../src/plugins/mock";
import axpRetry from "../../src/plugins/retry";
import axpShare from "../../src/plugins/share";
import { axpResponse, failureOf, isAxpResponse, type AxpResponse } from "../../src/response";
import { createTransport } from "../../src/transport";
import type { AxpPlugin } from "../../src/types";
import { createTestClient } from "../helpers/client";
import { testContext } from "../helpers/context";
import { settleAll } from "../helpers/source";

/** 真实接口地址。 */
const URL = "/native-boundary";
/** 探测服务器。 */
const MOCK = "http://native-mock";
/** 探测接口地址。 */
const PROBE = `${MOCK}${URL}`;
/** 制造并发窗口的延迟。 */
const LATENCY = 10;
/** 共享槽的空快照。 */
const EMPTY_NATIVE = { response: undefined, error: undefined };
/** 每次传输独立的原始响应，供身份断言使用。 */
function rawResponse(status = 200): AxiosResponse {
  return { status, statusText: "", headers: {}, data: { value: status }, config: { url: URL, headers: new AxiosHeaders() } };
}
/** 每例独立控制网络完成时间。 */
beforeEach(() => {
  vi.useFakeTimers();
});
/** 恢复真实时钟。 */
afterEach(() => {
  vi.useRealTimers();
});

it("[core.req.raw] 缓存命中无配对数据；mock 探测回落后命中缓存不会附上探测响应", async () => {
  const seen: { /** 最近一次传输尝试的状态。 */ native: AxpContext["native"]; /** 本次返回响应的配对状态。 */ paired: AxpContext["native"] | undefined }[] = [];
  const observer: AxpPlugin = {
    name: "pair-observer",
    stage: "outer",
    /** 在 settle 前同时观察最新尝试与配对数据。 */
    async handle(ctx, next) {
      const response = await next();
      seen.push({ native: ctx.native, paired: ctx.nativeFor(response) });
      return response;
    },
  };
  const { api, net } = createTestClient([observer, axpMock({ enable: true, mockUrl: MOCK }), axpCache()]);
  net.on("get", PROBE, /** 强制探测回落。 */ () => ({ status: 404 }));
  const [first] = await settleAll(api.request<AxpResponse>({ url: URL, cache: true, raw: true }));
  const [cached] = await settleAll(api.request<AxpResponse>({ url: URL, cache: true, raw: true }));
  const [fallback] = await settleAll(api.request<AxpResponse>({ url: URL, cache: true, mock: true, raw: true }));
  expect(first.raw?.config.url).toBe(URL);
  expect(cached.raw).toBeUndefined();
  expect(cached.error).toBeUndefined();
  expect(fallback.raw).toBeUndefined();
  expect(fallback.error).toBeUndefined();
  expect(fallback.request.url).toBe(URL);
  expect(seen[1]).toEqual({ native: EMPTY_NATIVE, paired: undefined });
  expect(seen[2].native.response?.config.url).toBe(PROBE);
  expect(seen[2].paired).toBeUndefined();
  expect(net.calls("get", URL)).toBe(1);
  expect(net.calls("get", PROBE)).toBe(1);
  api.dispose();
});

it("[core.req.raw] auth 本地拒绝没有原生响应和异常", async () => {
  const tokenManager = new TokenManager();
  tokenManager.clear();
  const { api, net } = createTestClient([axpAuth({ tokenManager, onRefresh: vi.fn(), onAccessExpired: vi.fn() })]);
  const response = await api.request({ url: URL, raw: true, throws: false });
  expect(failureOf(response)?.type).toBe("auth");
  expect(response.raw).toBeUndefined();
  expect(response.error).toBeUndefined();
  expect(response.request.url).toBe(URL);
  expect(net.totalStarted).toBe(0);
  api.dispose();
});

it("[core.req.raw] retry 多次尝试只附加最后一次传输的原始响应", async () => {
  const { api } = createTestClient([axpRetry({ max: 2, delay: 0 })]);
  const first = rawResponse(503);
  const second = rawResponse(503);
  const last = rawResponse();
  const request = vi.spyOn(api.axios, "request").mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(last);
  const [result] = await settleAll(api.request<AxpResponse>({ url: URL, raw: true }));
  expect(request).toHaveBeenCalledTimes(3);
  expect(result.raw).toBe(last);
  expect(result.raw).not.toBe(first);
  expect(result.raw).not.toBe(second);
  expect(result.error).toBeUndefined();
  api.dispose();
});

it.each(["refresh", "denied"] as const)("[core.req.raw] auth %s 经 fail 派生后仍配对原始 401", async (route) => {
  const tokenManager = new TokenManager();
  tokenManager.set("native-token");
  const onRefresh = vi.fn(/** 明确刷新失败。 */ () => false);
  const onAccessExpired = vi.fn();
  const onAccessDenied = vi.fn();
  const { api } = createTestClient([
    axpAuth({
      tokenManager,
      onRefresh,
      onAccessExpired,
      onAccessDenied,
      /** 让 401 也覆盖显式 denied 的派生路径。 */
      onFailure: () => (route === "denied" ? AuthFailureAction.Deny : AuthFailureAction.Refresh),
    }),
  ]);
  const raw = rawResponse(401);
  const request = vi.spyOn(api.axios, "request").mockResolvedValue(raw);
  const result = await api.request({ url: URL, raw: true, throws: false });
  expect(result.raw).toBe(raw);
  expect(result.error).toBeUndefined();
  expect(failureOf(result)).toEqual({ type: "auth", reason: route === "denied" ? "denied" : "expired" });
  expect(request).toHaveBeenCalledTimes(1);
  expect(onRefresh).toHaveBeenCalledTimes(route === "refresh" ? 1 : 0);
  expect(onAccessExpired).toHaveBeenCalledTimes(route === "refresh" ? 1 : 0);
  expect(onAccessDenied).toHaveBeenCalledTimes(route === "denied" ? 1 : 0);
  tokenManager.clear();
  api.dispose();
});

it("[core.req.raw] 缓存未命中并 clone 后保留本次传输配对，命中则无原生响应", async () => {
  const { api } = createTestClient([axpCache({ clone: "shallow" })]);
  const raw = rawResponse();
  const request = vi.spyOn(api.axios, "request").mockResolvedValue(raw);
  const result = await api.request<AxpResponse>({ url: URL, cache: true, raw: true });
  expect(result.raw).toBe(raw);
  expect(result.data).toEqual(raw.data);
  expect(result.data).not.toBe(raw.data);
  const cached = await api.request<AxpResponse>({ url: URL, cache: true, raw: true });
  expect(cached.raw).toBeUndefined();
  expect(cached.data).toEqual(result.data);
  expect(cached.data).not.toBe(result.data);
  expect(request).toHaveBeenCalledTimes(1);
  api.dispose();
});

it.each(["end", "race"] as const)("[core.req.raw] share %s 共享结果先到时不借用别人的 raw，迟到传输不能重开已落定槽", async (policy) => {
  const contexts: AxpContext[] = [];
  const completed: AxpResponse[] = [];
  const { api } = createTestClient([
    {
      name: "late-native-observer",
      stage: "outer",
      /** 保留各逻辑请求的根上下文。 */
      async handle(ctx, next) {
        contexts.push(ctx);
        return next();
      },
    },
    axpShare({ policy }),
    {
      name: "transport-completion-observer",
      stage: "source",
      /** 即使共享结果已经落定，也等待自己的真实传输完成。 */
      async handle(_ctx, next) {
        const response = await next();
        completed.push(response);
        return response;
      },
    },
  ]);
  const late = rawResponse(201);
  const winner = rawResponse();
  let release!: (response: AxiosResponse) => void;
  const delayed = new Promise<AxiosResponse>((resolve) => {
    release = resolve;
  });
  const request = vi.spyOn(api.axios, "request").mockReturnValueOnce(delayed).mockResolvedValueOnce(winner);
  const config = { url: URL, share: true, raw: true };
  const first = api.request<AxpResponse>(config);
  const second = api.request<AxpResponse>(config);
  const [result, own] = await Promise.all([first, second]);
  expect(request).toHaveBeenCalledTimes(2);
  expect(completed).toHaveLength(1);
  expect(result.raw).toBeUndefined();
  expect(own.raw).toBe(winner);
  expect(result.data).toBe(own.data);
  expect(result.raw).not.toBe(late);
  for (const ctx of contexts) expect(ctx.native).toEqual(EMPTY_NATIVE);
  release(late);
  await vi.advanceTimersByTimeAsync(0);
  expect(completed).toHaveLength(2);
  for (const ctx of contexts) {
    expect(ctx.native).toEqual(EMPTY_NATIVE);
    expect(ctx.nativeFor(completed[1])).toBeUndefined();
  }
  expect(result.raw).toBeUndefined();
  expect(own.raw).toBe(winner);
  api.dispose();
});

it.each(["aborted", "replay"] as const)("[core.req.raw] 传输前 %s 提前返回不写槽，也不与上一次响应配对", async (path) => {
  const controller = new AbortController();
  const body = { /** 一次性流的标识，本例不真正消费流。 */ pipe() {} };
  const ctx = testContext({ url: URL, raw: true, throws: false, signal: controller.signal, data: body });
  const raw = rawResponse();
  const axios = createAxios();
  const request = vi.spyOn(axios, "request").mockResolvedValue(raw);
  const send = createTransport(axios, axpResponse());
  const previous = await send(ctx);
  expect(ctx.nativeFor(previous)?.response).toBe(raw);
  if (path === "aborted") controller.abort();
  const response = await send(requestContext(ctx, ctx.request));
  expect(request).toHaveBeenCalledTimes(1);
  expect(ctx.native.response).toBe(raw);
  expect(ctx.nativeFor(response)).toBeUndefined();
  expect(response.raw).toBeUndefined();
  if (path === "aborted") {
    const result = settle(response, ctx, {});
    assert(isAxpResponse(result));
    expect(result.raw).toBeUndefined();
    expect(failureOf(result)?.type).toBe("cancel");
  } else {
    expect(failureOf(response)?.type).toBe("internal");
    assert(response.error instanceof Error);
    expect(() => settle(response, ctx, {})).toThrow(response.error);
  }
  expect(ctx.native).toEqual(EMPTY_NATIVE);
});

it.each([false, true])("[core.req.raw] share 跟随者不继承领导者 native，领导者提前落定后迟到传输不再写入：%s", async (cancel) => {
  const contexts: AxpContext[] = [];
  const { api, net } = createTestClient([
    {
      name: "share-observer",
      stage: "outer",
      /** 捕获每个逻辑请求独立的上下文。 */
      async handle(ctx, next) {
        contexts.push(ctx);
        return next();
      },
    },
    axpShare(),
  ]);
  const controller = new AbortController();
  const config = { url: URL, share: true, raw: true, throws: false, latency: LATENCY };
  const leader = api.request<AxpResponse>({ ...config, signal: controller.signal });
  const follower = api.request<AxpResponse>(config);
  if (cancel) {
    controller.abort();
    const cancelled = await leader;
    expect(failureOf(cancelled)?.type).toBe("cancel");
    expect(contexts[0].native).toEqual(EMPTY_NATIVE);
  }
  const [first, second] = await settleAll(leader, follower);
  expect(first).not.toBe(second);
  expect(first.raw?.config.url).toBe(cancel ? undefined : URL);
  expect(second.raw).toBeUndefined();
  expect(second.error).toBeUndefined();
  expect(second.ok).toBe(true);
  expect(net.calls("get", URL)).toBe(1);
  expect(contexts).toHaveLength(2);
  for (const ctx of contexts) expect(ctx.native).toEqual(EMPTY_NATIVE);
  api.dispose();
});
