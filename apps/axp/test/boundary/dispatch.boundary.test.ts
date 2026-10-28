import { create as createAxios } from "axios";
import { afterEach, expect, it, vi } from "vitest";
import { createAxp } from "../../src/client";
import type { HttpMethodLower } from "../../src/types";
import { createTestClient } from "../helpers/client";

/** 全部运行期动词。 */
const METHODS: HttpMethodLower[] = ["get", "head", "options", "purge", "link", "unlink", "delete", "post", "put", "patch"];
/** 测试 URL。 */
const URL = "/dispatch-boundary";
/** 乱序测试并发数。 */
const CONCURRENCY = 20;
/** 各例恢复真实计时器。 */
afterEach(/** 每例恢复真实计时器。 */ () => vi.useRealTimers());

it.each(METHODS.map(/** 为每个动词生成一组参数。 */ (method) => ({ method })))(
  "[core.method.$method] $method 空 payload 与原始值均能完成",
  /** 空 payload 与原始值均能完成。 */ async ({ method }) => {
    const { api, net } = createTestClient();
    net.fallback(/** 返回成功信封，数据为 done。 */ () => ({ data: { code: 0, data: "done" } }));
    expect(await Promise.all([undefined, null, 0, ""].map(/** 对同一动词分别发送四种空值或原始值。 */ (payload) => api[method](URL)(payload)))).toEqual(["done", "done", "done", "done"]);
  },
);
it.each(METHODS.map(/** 为每个动词生成一组参数。 */ (method) => ({ method })))(
  "[core.method.$method] $method 传输 bug 保留原异常",
  /** 传输 bug 保留原异常。 */ async ({ method }) => {
    const bug = new TypeError("adapter");
    const api = createAxp({
      axios: createAxios({
        adapter: /** 模拟传输层程序异常。 */ async () => {
          throw bug;
        },
      }),
    });
    await expect(api[method](URL)()).rejects.toBe(bug);
    expect(api.pending()).toBe(0);
  },
);
it("[core.method.verbs][core.method.pending] 同一 dispatch 并发乱序成功失败互不串扰", /** 同一 dispatch 并发乱序成功失败互不串扰。 */ async () => {
  vi.useFakeTimers();
  const { api, net } = createTestClient();
  net.fallback(
    /** 按 id 奇偶返回成功或 400，制造乱序结果。 */ (config) => {
      const id = Number(config.params.id);
      return { status: id % 2 === 0 ? 200 : 400, data: { code: 0, data: id } };
    },
  );
  api.axios.interceptors.request.use(
    /** 处理用户拦截器。 */ (config) => {
      (
        config as {
          /** latency 字段。 */ latency?: number;
        }
      ).latency = CONCURRENCY - Number(config.params.id);
      return config;
    },
  );
  const dispatch = api.get(URL);
  const results = Promise.allSettled(Array.from({ length: CONCURRENCY }, /** 并发发起多个逻辑请求。 */ (_, id) => dispatch({ id })));
  expect(api.pending()).toBe(CONCURRENCY);
  await vi.runAllTimersAsync();
  (await results).forEach(
    /** 按 id 奇偶校验成功与失败互不串扰。 */ (result, id) => {
      if (id % 2 === 0) expect(result).toEqual({ status: "fulfilled", value: id });
      else
        expect(result).toMatchObject({
          status: "rejected",
          reason: { kind: "http", data: id, status: 400 },
        });
    },
  );
  expect(net.log[0].finishedAt).toBeGreaterThan(net.log[net.log.length - 1].finishedAt!);
  expect(api.pending()).toBe(0);
});
it("[core.fn.createAxp][core.method.extend] 默认实例独立，保留 axios 引用和 transitional，override adapter 可用", /** 默认实例独立，保留 axios 引用和 transitional，override adapter 可用。 */ async () => {
  const first = createAxp();
  const second = createAxp({});
  expect(first.axios).not.toBe(second.axios);
  const instance = createAxios({ transitional: { clarifyTimeoutError: false } });
  const api = createAxp({ axios: instance });
  expect(api.axios).toBe(instance);
  expect(api.axios.defaults.transitional?.clarifyTimeoutError).toBe(false);
  const child = api.extend({
    adapter: /** 返回带原始请求配置的成功响应。 */ async (config) => ({
      config,
      status: 200,
      statusText: "",
      data: "child",
      headers: {},
    }),
  });
  expect(await child.get(URL)()).toBe("child");
  const grandchild = child.extend();
  grandchild.axios.defaults.headers.common["X-Grandchild"] = "yes";
  expect(child.axios.defaults.headers.common["X-Grandchild"]).toBeUndefined();
  expect(first.cancelAll()).toBe(0);
});
it("[core.opt.debug] 默认 console sink 可用，logger 抛错按 bug 透传", /** 默认 console sink 可用，logger 抛错按 bug 透传。 */ async () => {
  const bug = new TypeError("logger");
  const log = vi.spyOn(console, "log").mockImplementation(/** 屏蔽 console 输出，仅记录调用。 */ () => {});
  const normal = createTestClient(
    [
      {
        name: "logger",
        /** 通过默认日志器输出一条日志。 */ async handle(ctx, next) {
          ctx.log.log("default");
          return next();
        },
      },
    ],
    { debug: true },
  );
  await normal.api.get(URL)();
  expect(log).toHaveBeenCalledWith("default");
  log.mockRestore();
  const broken = createTestClient(
    [
      {
        name: "logger",
        /** 通过自定义日志器输出会抛错的 warn。 */ async handle(ctx, next) {
          ctx.log.warn("bug");
          return next();
        },
      },
    ],
    {
      debug: {
        log: /** 吞掉 log 级别输出。 */ () => {},
        error: /** 吞掉 error 级别输出。 */ () => {},
        warn: /** warn 抛出程序异常，验证 logger 异常透传。 */ () => {
          throw bug;
        },
      },
    },
  );
  await expect(broken.api.get(URL)()).rejects.toBe(bug);
  expect(broken.api.pending()).toBe(0);
});
it.each([undefined, "", "reason"])(
  "[core.method.cancelAll] reason=%s 原样联动逻辑 signal",
  /** 取消原因原样传给逻辑 signal。 */ async (reason) => {
    let signal!: AbortSignal;
    const { api } = createTestClient([
      {
        name: "cancel-reader",
        /** 挂起直到逻辑请求被取消，并记录逻辑 signal。 */ async handle(ctx) {
          signal = ctx.signal;
          await new Promise<void>(
            /** 等待逻辑 signal 触发 abort。 */ (resolve) =>
              ctx.signal.addEventListener("abort", /** 取消后放行挂起的中间件。 */ () => resolve(), {
                once: true,
              }),
          );
          return ctx.fail({ kind: "cancel" });
        },
      },
    ]);
    const result = api.request({ throws: false });
    expect(api.cancelAll(reason)).toBe(1);
    expect((await result).kind).toBe("cancel");
    if (reason === undefined) expect(signal.reason).toMatchObject({ name: "AbortError" });
    else expect(signal.reason).toBe(reason);
  },
);
