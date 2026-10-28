import { AxiosError, AxiosHeaders, type AxiosInstance, type AxiosRequestConfig } from "axios";
import { afterEach, expect, it, vi } from "vitest";
import { axpResponse } from "../../src/response";
import { createTransport } from "../../src/transport";
import { testContext } from "../helpers/context";

/** 每例恢复全局克隆函数。 */
afterEach(/** 每例恢复被替换的全局 structuredClone。 */ () => vi.unstubAllGlobals());
/** 仅模拟 request 函数，不建立 axios 实例。 */
function transport() {
  const request = vi.fn(
    /** 返回成功的假 axios 响应，并回显请求配置。 */ async (config: AxiosRequestConfig) => ({
      status: 200,
      statusText: "",
      data: 1,
      headers: {},
      config: { ...config, headers: new AxiosHeaders() },
    }),
  );
  const send = createTransport(
    { request, defaults: {} } as unknown as AxiosInstance,
    axpResponse(),
  );
  return { send, request };
}
it("[core.fn.createTransport] 强制全状态放行，默认使用逻辑 signal", /** 强制全状态放行，默认使用逻辑 signal。 */ async () => {
  const { send, request } = transport();
  const ctx = testContext({
    validateStatus: /** 调用方的 validateStatus 应被传输层覆盖。 */ () => false,
  });
  const response = await send(ctx);
  const config = request.mock.calls[0]![0];
  expect(config.signal).toBe(ctx.signal);
  expect(config.validateStatus!(500)).toBe(true);
  expect(response.request).toMatchObject({ signal: ctx.signal });
});
it("[core.req.signal] 显式传输 signal 优先，已取消不发送", /** 显式传输 signal 优先，已取消不发送。 */ async () => {
  const { send, request } = transport();
  const controller = new AbortController();
  const ctx = testContext({ signal: controller.signal });
  await send(ctx);
  expect(request.mock.calls[0]![0].signal).toBe(controller.signal);
  controller.abort();
  expect((await send(ctx)).kind).toBe("cancel");
  expect(request).toHaveBeenCalledTimes(1);
});
it.each(
  [
    { a: [1] },
    [1],
    Object.assign(Object.create(null), { a: 1 }),
    "data",
    null,
    new Date(),
    new Blob(["body"]),
  ].map(/** 把候选请求体包成 each 参数。 */ (data) => ({ data })),
)(
  "[core.method.markReplayable] 标记后仅克隆数组与纯对象，原始值和特殊体保持引用：$data",
  /** 标记后仅克隆数组与纯对象，原始值和特殊体保持引用。 */ async ({ data }) => {
    const { send, request } = transport();
    const ctx = testContext({ data });
    await send(ctx);
    expect(request.mock.lastCall![0].data).toBe(data);
    ctx.markReplayable();
    await send(ctx);
    if (
      Array.isArray(data) ||
      (data && Object.getPrototypeOf(data) === Object.prototype) ||
      (data && Object.getPrototypeOf(data) === null)
    )
      expect(request.mock.lastCall![0].data).not.toBe(data);
    else expect(request.mock.lastCall![0].data).toBe(data);
  },
);
it.each([false, true])(
  "[core.method.markReplayable] 克隆不可用或失败回退引用并 warn，missing=%s",
  /** 克隆不可用或失败回退引用并 warn。 */ async (missing) => {
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
    expect(log.warn).toHaveBeenCalledTimes(1);
  },
);
it("[core.fn.createTransport] 非 axios 的程序异常由传输自身兜底为 internal，保留原异常", /** 传输是管线最内层，自带异常边界，不依赖外层兜底。 */ async () => {
  const { send, request } = transport();
  const bug = new TypeError("adapter bug");
  request.mockRejectedValue(bug);
  expect(await send(testContext())).toMatchObject({ kind: "internal", error: bug });
});
it("[core.fn.createTransport] axios 异常交给响应工厂", /** axios 异常交给响应工厂。 */ async () => {
  const { send, request } = transport();
  const error = new AxiosError("offline");
  request.mockRejectedValue(error);
  expect(await send(testContext())).toMatchObject({ kind: "network", error });
});
it("[core.fn.createTransport] 各层未改动 params / headers 时原样透传，不做二次合并掩码", /** 多数请求只付一次 mergeConfig，不再逐请求比对默认头。 */ async () => {
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
  const config = request.mock.calls[0]![0];
  expect(config.params).toBe(params);
  expect(config.headers).toBe(headers);
});
