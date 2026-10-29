import { AxiosError, AxiosHeaders, create as createAxios, type AxiosResponse } from "axios";
import { assert, expect, it, vi } from "vitest";
import { settle } from "../../src/client";
import { requestContext } from "../../src/context";
import { AxpResponse, axpResponse, AXP_FAILURES, failureOf, isAxpResponse, type AxpResponseInit } from "../../src/response";
import { createTransport } from "../../src/transport";
import { testContext } from "../helpers/context";

/** 原生数据测试的请求地址。 */
const URL = "/native";
/** 空槽的原生数据快照。 */
const EMPTY_NATIVE = { response: undefined, error: undefined };
/** 模拟离线异常的消息。 */
const OFFLINE = "offline";
/** 创建独立原生响应，避免跨用例共享可变配置。 */
function rawResponse(): AxiosResponse {
  return { status: 200, statusText: "", headers: {}, data: 1, config: { url: URL, headers: new AxiosHeaders() } };
}

it("[core.prop.native] 共享槽跨派生层可读，按身份配对且 fail 派生改绑", () => {
  const ctx = testContext();
  const child = requestContext(ctx, { url: URL });
  const raw = rawResponse();
  const response = new AxpResponse({ status: 200 });
  expect(ctx.native).toEqual(EMPTY_NATIVE);
  expect(ctx.nativeFor(response)).toBeUndefined();
  child.setNative(response, raw, undefined);
  expect(ctx.native.response).toBe(raw);
  expect(ctx.nativeFor(response)?.response).toBe(raw);
  const snapshot = ctx.native;
  expect(snapshot).not.toBe(ctx.native);
  const unrelated = ctx.fail({ status: 200 });
  expect(ctx.nativeFor(unrelated)).toBeUndefined();
  expect(ctx.nativeFor(ctx.fail({ from: unrelated }))).toBeUndefined();
  const copy = child.fail({ from: response });
  expect(ctx.nativeFor(response)).toBeUndefined();
  expect(ctx.nativeFor(copy)?.response).toBe(raw);
  const error = new AxiosError(OFFLINE);
  child.setNative(copy, undefined, error);
  expect(ctx.native.error).toBe(error);
  ctx.setNative(copy, raw, undefined);
  expect(child.native.error).toBeUndefined();
  child.clearNative();
  ctx.setNative(response, raw, error);
  expect(child.nativeFor(response)).toBeUndefined();
  expect(ctx.native).toEqual(EMPTY_NATIVE);
});

it.each([false, true])("[core.fn.createTransport] 异常记录原始 error 和可选 HTTP 响应，随后成功清除异常：%s", async (http) => {
  const ctx = testContext();
  const raw = rawResponse();
  const error = new AxiosError(OFFLINE, undefined, raw.config, undefined, http ? raw : undefined);
  const axios = createAxios();
  const request = vi.spyOn(axios, "request").mockRejectedValueOnce(error).mockResolvedValue(raw);
  const send = createTransport(axios, axpResponse());
  const failed = await send(ctx);
  expect(ctx.nativeFor(failed)).toEqual({ response: http ? raw : undefined, error });
  const success = await send(requestContext(ctx, { url: URL }));
  expect(ctx.nativeFor(failed)).toBeUndefined();
  expect(ctx.nativeFor(success)).toEqual({ response: raw, error: undefined });
  settle(success, ctx, {});
  expect(ctx.native).toEqual(EMPTY_NATIVE);
  await send(ctx);
  expect(ctx.native).toEqual(EMPTY_NATIVE);
  request.mockRejectedValue(error);
  await send(ctx);
  expect(ctx.native).toEqual(EMPTY_NATIVE);
});

it("[core.fn.createTransport] 非 Axios 异常也记录并与 internal 配对", async () => {
  const ctx = testContext();
  const error = new TypeError("adapter");
  const axios = createAxios();
  vi.spyOn(axios, "request").mockRejectedValue(error);
  const send = createTransport(axios, axpResponse());
  const response = await send(ctx);
  expect(ctx.nativeFor(response)).toEqual({ response: undefined, error });
  expect(() => settle(response, ctx, {})).toThrow(error);
  expect(ctx.native.error).toBeUndefined();
});

it.each(["return", "throw", "reject", "reject-throw", "internal"] as const)("[core.fn.settle] %s 路径都清空槽并拒绝后续写入", (path) => {
  const ctx = testContext(
    { raw: true },
    {
      ...axpResponse(),
      /** 使用普通响应对象，直接验证 JSON 的枚举行为。 */
      fail(init) {
        const response = new AxpResponse(init);
        return Object.create(response) as AxpResponse;
      },
    },
  );
  const raw = rawResponse();
  const error = new Error("settle");
  const response = path === "return" ? new AxpResponse({ status: 200 }) : ctx.fail({ failure: path === "internal" ? AXP_FAILURES.INTERNAL : AXP_FAILURES.NETWORK, error });
  ctx.setNative(response, raw, error);
  const reject = vi.fn(
    /** 确认转换器运行时仍能读取原生数据。 */ (result: AxpResponse) => {
      expect(ctx.native.response).toBe(raw);
      expect(result.raw).toBe(raw);
      if (path === "reject-throw") throw error;
      return error;
    },
  );
  /** 同时检查正常返回与同步抛出。 */
  const run = () => settle(response, ctx, path === "reject" || path === "reject-throw" ? { reject } : {});
  if (path === "return") {
    const result = run();
    assert(isAxpResponse(result));
    expect(result).not.toBe(response);
    expect(result.raw).toBe(raw);
    expect(result.error).toBe(error);
    expect(result.request).toBe(raw.config);
    for (const key of ["raw", "error", "request"]) {
      expect(Object.hasOwn(result, key)).toBe(true);
      expect(Object.keys(result)).not.toContain(key);
      expect(Object.prototype.propertyIsEnumerable.call(result, key)).toBe(false);
      if (key === "request") {
        const request = JSON.parse(JSON.stringify(result)).request;
        expect(request).not.toHaveProperty("headers");
        expect(request).not.toHaveProperty("data");
        expect(request).toEqual({ url: "/native" });
      } else {
        expect(JSON.stringify(result)).not.toContain(`"${key}"`);
      }
    }
  } else if (path === "throw") {
    let thrown: unknown;
    try {
      run();
    } catch (failure) {
      thrown = failure;
    }
    expect(thrown).not.toBe(response);
    expect(thrown).toMatchObject({ raw, error });
  } else expect(run).toThrow(error);
  expect(ctx.native).toEqual(EMPTY_NATIVE);
  ctx.setNative(response, raw, error);
  expect(ctx.nativeFor(response)).toBeUndefined();
});

it.each(["raw", "error", "context"] as const)("[core.req.raw] request 按原生响应、异常配置、当前上下文依次回退：%s", (source) => {
  const ctx = testContext({ url: URL, raw: true });
  const raw = rawResponse();
  const error = new AxiosError(OFFLINE, undefined, raw.config);
  const response = new AxpResponse({ status: 200 });
  if (source !== "context") ctx.setNative(response, source === "raw" ? raw : undefined, error);
  const result = settle(response, ctx, {});
  assert(isAxpResponse(result));
  expect(result.request).toBe(source === "context" ? ctx.request : raw.config);
  expect(result.raw).toBe(source === "raw" ? raw : undefined);
  expect(result.error).toBe(source === "context" ? undefined : error);
});

it("[core.req.raw] 副本工厂失败仍抛原始程序异常且清空原生槽", () => {
  const error = new TypeError("copy factory");
  const ctx = testContext(
    { raw: true },
    {
      ...axpResponse(),
      /** 仅在落定派生时模拟使用者工厂失败。 */
      fail() {
        throw error;
      },
    },
  );
  const response = new AxpResponse({ status: 200 });
  ctx.setNative(response, rawResponse(), undefined);
  expect(() => settle(response, ctx, {})).toThrow(error);
  expect(ctx.native).toEqual(EMPTY_NATIVE);
});

it.each([
  [true, "freeze"],
  [false, "freeze"],
  [true, "request"],
  [false, "request"],
] as const)("[core.req.raw] throws=%s 的 %s 副本附加失败转为 internal 并保留原始异常", (throws, mode) => {
  const factory = axpResponse();
  const fail = vi.fn(
    /** 冻结只发生在 raw 派生副本，internal 路径交给正常工厂。 */
    (init: AxpResponseInit<AxpResponse>, current: Parameters<typeof factory.fail>[1]) => {
      const response = factory.fail(init, current);
      if (init.from) {
        if (mode === "freeze") Object.freeze(response);
        else Object.defineProperty(response, "request", { configurable: false });
      }
      return response;
    },
  );
  const ctx = testContext({ raw: true, throws }, { ...factory, fail });
  const response = new AxpResponse({ status: 200 });
  const raw = rawResponse();
  ctx.setNative(response, raw, undefined);
  const reject = vi.fn();
  let thrown: unknown;
  try {
    settle(response, ctx, { reject });
  } catch (error) {
    thrown = error;
  }
  expect(fail).toHaveBeenCalledTimes(2);
  const init = fail.mock.calls[1][0];
  expect(init.failure).toBe(AXP_FAILURES.INTERNAL);
  expect(init.error).toBeInstanceOf(TypeError);
  expect(thrown).toBe(init.error);
  const recorded = fail.mock.results[1];
  assert(recorded.type === "return");
  const internal = recorded.value;
  expect(failureOf(internal)?.type).toBe(AXP_FAILURES.INTERNAL);
  expect(internal.error).toBe(thrown);
  expect(reject).not.toHaveBeenCalled();
  expect(ctx.native).toEqual(EMPTY_NATIVE);
  ctx.setNative(response, raw, undefined);
  expect(ctx.nativeFor(response)).toBeUndefined();
});

it.each([undefined, false])("[core.req.raw] raw=%s 时不读取原生配对快照", (raw) => {
  const ctx = testContext({ raw, wrap: true });
  const response = new AxpResponse({ status: 200 });
  ctx.setNative(response, rawResponse(), undefined);
  const nativeFor = vi.spyOn(ctx, "nativeFor");
  expect(settle(response, ctx, {})).toBe(response);
  expect(nativeFor).not.toHaveBeenCalled();
  expect(ctx.native).toEqual(EMPTY_NATIVE);
});
