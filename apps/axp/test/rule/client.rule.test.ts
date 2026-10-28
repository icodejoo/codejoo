import { describe, expect, it, vi } from "vitest";
import { createAxp } from "../../src/client";
import { axpResponse, type AxpResponse } from "../../src/response";
import type { AxpPlugin, HttpMethodLower } from "../../src/types";
import { assertInvariants, createTestClient } from "../helpers/client";

/** 无状态层。 */
const through: NonNullable<AxpPlugin<AxpResponse>["handle"]> = (_ctx, next) => next();
/** 全部运行期动词。 */
const METHODS: HttpMethodLower[] = [
  "get",
  "head",
  "options",
  "purge",
  "link",
  "unlink",
  "delete",
  "post",
  "put",
  "patch",
];
/** 数据回显 URL。 */
const URL = "/dispatch";

describe("客户端", /** 客户端的用例集合。 */ () => {
  it("[core.req.wrap][core.req.throws] 调用级覆盖方法级并以空值继承开关", /** 验证运行期有效选项。 */ async () => {
    const { api, net } = createTestClient();
    net.fallback(/** 返回业务数据。 */ () => ({ data: { code: 0, data: 1 } }));
    expect(await api.get(URL, { wrap: true })(undefined, { wrap: false })).toBe(1);
    expect(await api.get(URL, { wrap: true })(undefined, { wrap: undefined })).toMatchObject({
      data: 1,
    });
    expect(await api.get(URL, { throws: false })(undefined, { throws: true })).toBe(1);
    expect(await api.get(URL, { throws: false })(undefined, { throws: undefined })).toMatchObject({
      data: 1,
    });
    net.fallback(/** 返回 HTTP 失败。 */ () => ({ status: 500 }));
    await expect(
      api.get(URL, { throws: false })(undefined, { throws: true }),
    ).rejects.toMatchObject({ kind: "http" });
    expect(await api.get(URL, { throws: true })(undefined, { throws: false })).toMatchObject({
      kind: "http",
    });
  });
  it.each([401, 403, 500])(
    "[core.prop.status] 业务码 %s 映射逻辑状态",
    /** 业务码 401、403、500 各自映射为对应的逻辑状态。 */ async (code) => {
      const { api, net } = createTestClient();
      net.fallback(/** 返回带指定业务码的信封。 */ () => ({ data: { code, data: null } }));
      expect(await api.request({ url: URL, throws: false })).toMatchObject({
        status: code,
        kind: "biz",
        ok: false,
      });
    },
  );

  it.each(METHODS.map(/** 为每个动词生成一组参数。 */ (method) => ({ method })))(
    "[core.method.$method] $method 按 data/params 分派并默认解包",
    /** 按 data/params 分派并默认解包。 */ async ({ method }) => {
      const { api, net } = createTestClient();
      net.fallback(
        /** 回显方法、params 与 data，观察分派字段。 */ (config) => ({
          data: {
            code: 0,
            data: { method: config.method, params: config.params, data: config.data },
          },
        }),
      );
      const body = ["delete", "post", "put", "patch"].includes(method);
      const result = (await api[method](URL)({ id: 1 })) as {
        /** method 字段。 */ method: string;
        /** params 字段。 */ params?: unknown;
        /** data 字段。 */ data?: unknown;
      };
      expect(result.method).toBe(method);
      expect(body ? JSON.parse(result.data as string) : result.params).toEqual({ id: 1 });
    },
  );
  it.each([undefined, null, 0, ""])(
    "[core.method.verbs] 空/原始 payload %s 和配置覆盖顺序",
    /** 空值与原始值 payload 在配置覆盖顺序下行为一致。 */ async (payload) => {
      const { api, net } = createTestClient();
      net.fallback(
        /** 把 params 原样放进信封回显。 */ (config) => ({
          data: { code: 0, data: config.params },
        }),
      );
      expect(await api.get(URL)(payload)).toBe(payload);
      expect(
        await api.get(URL, { url: "/method", method: "head", params: "method" })(payload, {
          url: "/call",
          method: "options",
          params: "call",
        }),
      ).toBe("call");
      expect(net.log[net.log.length - 1]).toMatchObject({ method: "OPTIONS", url: "/call" });
    },
  );
  it("[core.method.request][core.req.wrap][core.req.throws][core.method.isResponse] 返回数据、响应及业务逻辑状态", /** 返回数据、响应及业务逻辑状态。 */ async () => {
    const { api, net } = createTestClient();
    net.fallback(
      /** 返回带追踪头的成功信封。 */ () => ({
        data: { code: 0, data: "value" },
        headers: { "x-trace-id": "id" },
      }),
    );
    expect(await api.request({ url: URL })).toBe("value");
    const wrapped = await api.get(URL)(undefined, { wrap: true });
    expect(wrapped.data).toBe("value");
    expect(wrapped.raw).toBeDefined();
    expect(api.isResponse(wrapped)).toBe(true);

    net.fallback(/** 返回 HTTP 500。 */ () => ({ status: 500, data: "server" }));
    await expect(api.get(URL)()).rejects.toMatchObject({ kind: "http", status: 500 });
  });
  it("[core.method.use][core.method.eject][core.method.plugin][core.method.inspect] 装卸、API 与一次性 setup/dispose", /** 装卸、API 与一次性 setup/dispose。 */ async () => {
    const setup = vi.fn(
      /** 每个客户端建立独立实例与 API。 */ () => ({ handle: through, api: { value: 1 }, dispose }),
    );
    const dispose = vi.fn();
    const plugin: AxpPlugin<AxpResponse, { /** value 字段。 */ value: number }> = {
      name: "dynamic",
      setup,
    };
    const { api } = createTestClient();
    expect(api.plugin(plugin)).toBeUndefined();
    api.use(plugin);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(api.inspect()).toEqual([{ stage: "attempt", name: plugin.name }]);
    expect(api.plugin(plugin)).toEqual({ value: 1 });
    await api.get(URL)();
    await api.get(URL)();
    expect(setup).toHaveBeenCalledTimes(1);
    expect(/** 重复安装同名插件应失败。 */ () => api.use(plugin)).toThrow("Duplicate");
    expect(api.eject("missing")).toBe(false);
    expect(api.eject(plugin.name)).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(api.inspect()).toEqual([]);
    api.use(plugin);
    api.dispose();
    api.dispose();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
  it("[core.opt.plugins] enable:false 不 setup、不进链、不暴露 API", /** enable:false 不 setup、不进链、不暴露 API。 */ () => {
    const setup = vi.fn();
    const plugin = { name: "disabled", enable: false, setup, handle: through };
    const { api } = createTestClient([plugin]);
    expect(setup).not.toHaveBeenCalled();
    expect(api.inspect()).toEqual([]);
    expect(api.plugin(plugin)).toBeUndefined();
  });
  it("[core.method.extend] 默认继承插件、状态独立且支持替换列表", /** 默认继承插件、状态独立且支持替换列表。 */ async () => {
    const plugin: AxpPlugin<AxpResponse, { count(): number }> = {
      name: "counter",
      /** 每个客户端独立计数。 */
      setup() {
        let count = 0;
        return {
          handle: /** 统计经过本层的请求数。 */ async (_ctx, next) => {
            count++;
            return next();
          },
          api: { count: /** 暴露当前客户端的计数。 */ () => count },
        };
      },
    };
    const { api } = createTestClient([plugin]);
    const child = api.extend();
    await child.get(URL)();
    expect(child.plugin(plugin)?.count()).toBe(1);
    expect(api.plugin(plugin)?.count()).toBe(0);
    expect(api.extend({}, { plugins: [] }).inspect()).toEqual([]);
    expect(api.extend({}, { plugins: "inherit" }).inspect()).toEqual(api.inspect());
  });
  it("[core.opt.debug] 关闭时空日志、开启传自定义 logger 并记录调用点", /** 关闭时空日志、开启传自定义 logger 并记录调用点。 */ async () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation(/** 屏蔽 console 输出，仅记录调用。 */ () => {});
    const plugin: AxpPlugin<AxpResponse> = {
      name: "log",
      /** 通过上下文日志器输出三个级别。 */ async handle(ctx, next) {
        ctx.log.log("request");
        ctx.log.warn("warning");
        ctx.log.error("error");
        return next();
      },
    };
    await createTestClient([plugin]).api.get(URL)();
    expect(spy).not.toHaveBeenCalled();
    const { api, net } = createTestClient([plugin], { debug: logger });
    net.fallback(/** 返回 HTTP 500。 */ () => ({ status: 500 }));
    await expect(api.get(URL)()).rejects.toMatchObject({
      stack: expect.stringContaining("client.rule.test.ts"),
    });
    expect(logger.log).toHaveBeenCalledExactlyOnceWith("request");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(createAxp({ debug: true }).pending()).toBe(0);
  });
  it("[core.method.pending] 落定后在途数归零", /** 落定后在途数归零。 */ async () => {
    const { api, events } = createTestClient();
    const pending = api.get(URL)();
    expect(api.pending()).toBe(1);
    await pending;
    events.settled.set(1, 1);
    assertInvariants(api, events);
  });
  it("[core.cb.reject] 适配可预期失败为 Error", /** 适配可预期失败为 Error。 */ async () => {
    const reject = vi.fn(
      /** 把失败响应转为带消息的 Error。 */ (response: AxpResponse) => new Error(response.message),
    );
    const { api, net } = createTestClient([], {
      reject,
      response: axpResponse({ expectJson: true }),
    });
    net.fallback(
      /** 返回声明为 HTML 的非空文本。 */ () => ({
        data: "<html>",
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(api.get(URL)()).rejects.toThrow("Invalid JSON");
    expect(reject).toHaveBeenCalledTimes(1);
    await api.get(URL)(undefined, { throws: false });
    expect(reject).toHaveBeenCalledTimes(1);
  });
});
