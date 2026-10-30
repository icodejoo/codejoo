import { AXP_FAILURE } from "../../src/response";
import { failureOf } from "../../src/response";
import { AxiosError, AxiosHeaders, type AxiosInstance, type AxiosRequestConfig } from "axios";
import { afterEach, assert, expect, it, vi } from "vitest";
import { axpResponse } from "../../src/response";
import { classifyError, createTransport } from "../../src/transport";
import { requestContext } from "../../src/context";
import { testContext } from "../helpers/context";

/** 每例恢复全局克隆函数。 */
afterEach(/** 每例恢复被替换的全局 structuredClone。 */ () => vi.unstubAllGlobals());
/** 仅模拟 request 函数，不建立 axios 实例。 */
function transport(defaults: AxiosRequestConfig = {}) {
  const request = vi.fn(
    /** 返回成功的假 axios 响应，并回显请求配置。 */ async (config: AxiosRequestConfig) => ({
      status: 200,
      statusText: "",
      data: 1,
      headers: {},
      config: { ...config, headers: new AxiosHeaders() },
    }),
  );
  const send = createTransport({ request, defaults } as unknown as AxiosInstance, axpResponse());
  return { send, request };
}
it("[core.fn.createTransport] 强制全状态放行，默认使用逻辑 signal", /** 强制全状态放行，默认使用逻辑 signal。 */ async () => {
  const { send, request } = transport();
  const ctx = testContext({
    validateStatus: /** 调用方的 validateStatus 应被传输层覆盖。 */ () => false,
  });
  const response = await send(ctx);
  const config = request.mock.calls[0][0];
  expect(config.signal).toBe(ctx.signal);
  expect(config.validateStatus!(500)).toBe(true);
  expect(ctx.native.response?.config.signal).toBe(ctx.signal);
  expect(response.request).toEqual({ method: undefined, url: undefined });
});
it("[core.req.signal] 显式传输 signal 优先，已取消不发送", /** 显式传输 signal 优先，已取消不发送。 */ async () => {
  const { send, request } = transport();
  const controller = new AbortController();
  const ctx = testContext({ signal: controller.signal });
  await send(ctx);
  expect(request.mock.calls[0][0].signal).toBe(controller.signal);
  controller.abort();
  expect(failureOf(await send(ctx))?.type).toBe("cancel");
  expect(request).toHaveBeenCalledTimes(1);
});
it.each([{ a: [1] }, [1], Object.assign(Object.create(null), { a: 1 }), "data", null, new Date(), new Blob(["body"])].map(/** 把候选请求体包成 each 参数。 */ (data) => ({ data })))(
  "[core.method.markReplayable] 标记前后所有请求体均保持引用：$data",
  /** 标记前后所有请求体均保持引用。 */ async ({ data }) => {
    const { send, request } = transport();
    const ctx = testContext({ data });
    await send(ctx);
    expect(request.mock.lastCall![0].data).toBe(data);
    ctx.markReplayable();
    await send(ctx);
    expect(request.mock.lastCall![0].data).toBe(data);
  },
);
it.each([false, true])(
  "[core.method.markReplayable] 克隆不可用或失败也不调用克隆、不 warn，missing=%s",
  /** 克隆不可用或失败也不调用克隆、不 warn。 */ async (missing) => {
    const { send, request } = transport();
    vi.stubGlobal(
      "structuredClone",
      missing
        ? undefined
        : /** 模拟 structuredClone 执行失败。 */ () => {
            throw new Error("clone");
          },
    );
    const data = { a: 1 };
    // 独立日志器：ctx.log 默认是全局共享的 NO_LOG，不能在其上 spy。
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const ctx = testContext({ data }, undefined, log);
    ctx.markReplayable();
    expect((await send(ctx)).ok).toBe(true);
    expect(request.mock.lastCall![0].data).toBe(data);
    expect(log.warn).not.toHaveBeenCalled();
  },
);
it("[core.fn.createTransport] 非 axios 的程序异常由传输自身兜底为 internal，保留原异常", /** 传输是管线最内层，自带异常边界，不依赖外层兜底。 */ async () => {
  const { send, request } = transport();
  const bug = new TypeError("adapter bug");
  request.mockRejectedValue(bug);
  expect(await send(testContext())).toMatchObject({ [AXP_FAILURE]: { type: "internal", error: bug } });
});
it("[core.fn.createTransport] axios 异常交给响应工厂", /** axios 异常交给响应工厂。 */ async () => {
  const { send, request } = transport();
  const error = new AxiosError("offline");
  request.mockRejectedValue(error);
  const ctx = testContext();
  const response = await send(ctx);
  expect(response).toMatchObject({ [AXP_FAILURE]: { type: "network" } });
  expect(response).not.toHaveProperty("error");
  expect(failureOf(response)?.error).toBeUndefined();
  expect(ctx.native.error).toBe(error);
});
it("[core.fn.createTransport] 未改动的纯对象默认 params 仍复制完整视图，headers 原样透传", /** 默认参数固定为视图，默认头继续以发送时为准。 */ async () => {
  const request = vi.fn(
    /** 回显请求配置。 */ async (config: AxiosRequestConfig) => ({
      status: 200,
      statusText: "",
      data: 1,
      headers: {},
      config: { ...config, headers: new AxiosHeaders() },
    }),
  );
  const send = createTransport(
    {
      request,
      defaults: { params: { tenant: "a" }, headers: { common: { Accept: "json" } } },
    } as unknown as AxiosInstance,
    axpResponse(),
  );
  const params = { tenant: "a" };
  const headers = new AxiosHeaders({ Accept: "json" });
  await send(testContext({ params, headers }));
  const config = request.mock.calls[0][0];
  expect(config.params).toEqual(params);
  expect(config.params).not.toBe(params);
  expect(config.headers).toBe(headers);
});

it("[core.req.defaults] method 与 baseURL 固定为视图，缺省 baseURL 发空串", /** 已修改的 defaults 不影响 key 对应的发送字段。 */ async () => {
  const { send, request } = transport({ method: "post", baseURL: "/changed", params: { page: 2, added: 1 } });
  const ctx = testContext({ method: "get", baseURL: "/original", params: { page: 1 } });
  await send(ctx);
  expect(request.mock.lastCall![0]).toMatchObject({ method: "get", baseURL: "/original", params: { page: 1, added: null } });
  await send(testContext({ method: "get" }));
  expect(request.mock.lastCall![0]).toMatchObject({ method: "get", baseURL: "", params: { page: null, added: null } });
});

it.each([undefined, new URLSearchParams("page=2")])(
  "[core.req.params] 非纯对象 defaults.params=%s 时不复制未修改的 params",
  /** 没有默认参数的常见路径保持原引用，也不增加 params 字段。 */ async (defaults) => {
    const { send, request } = transport({ params: defaults });
    const params = { page: 1 };
    await send(testContext({ params }));
    expect(request.mock.lastCall![0].params).toBe(params);
    await send(testContext());
    expect(request.mock.lastCall![0]).not.toHaveProperty("params");
  },
);

it("[core.req.params] 非纯对象默认参数下，补丁 params 仍取本层完整值", /** 补丁不可被原请求覆盖。 */ async () => {
  const { send, request } = transport({ params: new URLSearchParams("page=2") });
  const root = testContext({ params: { page: 1 } });
  const params = { page: 3 };
  await send(requestContext(root, { params }, { params }));
  expect(request.mock.lastCall![0].params).toBe(params);
});

it("[core.method.canReplay] 传输记录一次性请求体，再发时返回原始 Error 且不调用 axios", /** 兜底保护不依赖内置插件。 */ async () => {
  const { send, request } = transport();
  const data = { pipe: vi.fn() };
  const ctx = testContext({ data });
  await send(ctx);
  expect(ctx.canReplay()).toBe(false);
  const failure = await send(ctx);
  expect(failureOf(failure)?.type).toBe("internal");
  const error = failureOf(failure)?.error;
  assert(error instanceof Error);
  expect(error.message).toBe("一次性请求体已发送，不能重放；重放前请先检查 ctx.canReplay()");
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  [Object.assign(new AxiosError("invalid JSON", AxiosError.ERR_BAD_RESPONSE), { name: "SyntaxError" }), "parse"],
  [Object.assign(new AxiosError("invalid JSON", AxiosError.ERR_BAD_RESPONSE), { cause: new SyntaxError("json") }), "parse"],
  [new AxiosError("maxContentLength size of 10 exceeded", AxiosError.ERR_BAD_RESPONSE), "parse"],
  [new AxiosError("stream has been aborted", AxiosError.ERR_BAD_RESPONSE), "network"],
  [Object.assign(new AxiosError("broken stream", AxiosError.ERR_BAD_RESPONSE), { cause: new Error("socket") }), "network"],
] as const)(
  "[core.fn.classifyError] ERR_BAD_RESPONSE 按具体事实分类 %s → %s",
  /** 解析与断流不能混淆。 */ (error, type) => {
    expect(classifyError(error)).toBe(type);
  },
);

it.each([false, true])(
  "[core.method.markReplayable][core.prop.debug] 发送成功或失败都检查修改，同一对象只提示一次 reject=%s",
  /** 模拟 axios 内原地改动共享数组。 */ async (reject) => {
    const { send, request } = transport();
    const data = { items: [0] };
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const ctx = testContext({ data }, undefined, log, true);
    ctx.markReplayable();
    request.mockImplementation(
      /** 每次发送均修改入参。 */ async (config) => {
        config.data.items.push(1);
        if (reject) throw new AxiosError("offline");
        return { status: 200, statusText: "", data: 1, headers: {}, config: { ...config, headers: new AxiosHeaders() } };
      },
    );
    await send(ctx);
    await send(ctx);
    expect(data.items).toEqual([0, 1, 1]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledExactlyOnceWith("[axp] 发送中请求体被原地修改（拦截器/transformRequest/调用方）；重放将携带修改，转换请返回新对象");
  },
);

it.each([
  { data: [1], replay: true },
  { data: { a: 1 }, replay: true },
  { data: { fn: /** 不可哈希。 */ () => 1 }, replay: true },
  { data: "text", replay: true },
  { data: { a: 1 }, replay: false },
])(
  "[core.prop.debug] 不修改、不可哈希、特殊体或未声明重发时不告警 $data replay=$replay",
  /** debug 检查跳过不适用对象。 */ async ({ data, replay }) => {
    const { send } = transport();
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const ctx = testContext({ data }, undefined, log, true);
    if (replay) ctx.markReplayable();
    expect((await send(ctx)).ok).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
  },
);
