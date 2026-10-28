import { CanceledError, type AxiosAdapter } from "axios";
import { expect, it, vi } from "vitest";
import { axpResponse, type AxpResponse } from "../../src/response";
import type { AxpPlugin, AxpStage } from "../../src/types";
import { createTestClient, customResponse, type TestResponse } from "../helpers/client";

/** 测试 URL。 */
const URL = "/boundary";

it.each(["response", "error"] as const)(
  "[core.opt.response] %s 工厂回调抛错且 fail 再抛错时仍保留首次程序异常",
  /** 响应或错误入口的工厂回调抛错，且 fail 再抛错时仍保留首次程序异常。 */ async (source) => {
    const original = new TypeError("first factory failure");
    const secondary = new TypeError("broken fail");
    const factory = {
      ...axpResponse(),
      fail: /** 模拟 fail 构造时再次抛错。 */ () => {
        throw secondary;
      },
      ...(source === "response"
        ? {
            fromResponse: /** 模拟收到响应后归一化时抛错。 */ () => {
              throw original;
            },
          }
        : {
            fromError: /** 模拟异常分类时抛错。 */ () => {
              throw original;
            },
          }),
    };
    let observed: unknown;
    const { api } = createTestClient(
      [
        {
          name: "observer",
          /** 观察内层 next 最终得到的响应。 */ async handle(_ctx, next) {
            const response = await next();
            observed = response;
            return response;
          },
        },
      ],
      { response: factory },
    );
    if (source === "error")
      api.axios.defaults.adapter = /** 模拟传输层程序异常。 */ async () => {
        throw new Error("transport");
      };
    await expect(api.request({ url: URL, throws: false })).rejects.toBe(original);
    expect(observed).toMatchObject({ kind: "internal", error: original });
    expect(api.pending()).toBe(0);
  },
);
/** 暂停执行以制造链变更的在途窗口。 */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>(
    /** 保存 resolve，由测试决定何时放行。 */ (resolve) => {
      open = resolve;
    },
  );
  return { promise, open };
}
it("[core.method.eject][core.method.dispose] 在途请求保持原链快照，下一请求使用新链", /** 在途请求保持原链快照，下一请求使用新链。 */ async () => {
  const wait = gate();
  const seen: string[] = [];
  const dispose = vi.fn();
  const plugin: AxpPlugin<AxpResponse> = {
    name: "snapshot",
    setup: /** 为每个客户端登记独立的清理函数。 */ () => ({ dispose }),
    /** 等待放行后记录旧链被执行。 */ async handle(_ctx, next) {
      await wait.promise;
      seen.push("old");
      return next();
    },
  };
  const { api } = createTestClient([plugin]);
  const pending = api.get(URL)();
  api.eject(plugin.name);
  api.use({
    name: "new",
    /** 记录新链被执行。 */ async handle(_ctx, next) {
      seen.push("new");
      return next();
    },
  });
  wait.open();
  await pending;
  await api.get(URL)();
  expect(seen).toEqual(["old", "new"]);
  expect(dispose).toHaveBeenCalledTimes(1);
  api.dispose();
  expect(/** 销毁后的客户端不能再装插件。 */ () => api.use(plugin)).toThrow("disposed");
  await expect(api.get(URL)()).rejects.toThrow("disposed");
});
it("[core.method.extend] headers/params/transforms/transitional 不污染父实例", /** headers/params/transforms/transitional 不污染父实例。 */ () => {
  const { api } = createTestClient();
  api.axios.defaults.headers.common["X-Parent"] = "parent";
  api.axios.defaults.params = { page: 1 };
  const child = api.extend();
  child.axios.defaults.headers.common["X-Parent"] = "child";
  child.axios.defaults.params.page = 2;
  (child.axios.defaults.transformResponse as unknown[]).push(/** 给子实例追加转换器，验证不污染父实例。 */ () => 1);
  child.axios.defaults.transitional!.clarifyTimeoutError = true;
  expect(api.axios.defaults.headers.common["X-Parent"]).toBe("parent");
  expect(api.axios.defaults.params.page).toBe(1);
  expect(child.axios.defaults.transformResponse).not.toHaveLength((api.axios.defaults.transformResponse as unknown[]).length);
  const override = api.extend({ headers: { "X-Child": "only" } });
  expect(override.axios.defaults.headers["X-Child"]).toBe("only");
  expect(api.axios.defaults.headers["X-Child"]).toBeUndefined();
});
it("[core.opt.plugins] 同一对象装两个客户端重新 setup，动态非法阶段清理实例", /** 同一对象装两个客户端重新 setup，动态非法阶段清理实例。 */ () => {
  const setup = vi.fn(/** 最小有状态插件，仅用来统计 setup 次数。 */ () => ({}));
  const plugin = { name: "shared-object", setup };
  createTestClient([plugin]);
  createTestClient([plugin]);
  expect(setup).toHaveBeenCalledTimes(2);
  const dispose = vi.fn();
  const { api } = createTestClient();
  expect(
    /** 动态非法阶段应使 use 失败。 */ () =>
      api.use({
        name: "invalid",
        setup: /** 返回含未知阶段 tap 的实例，并带清理函数。 */ () => ({
          dispose,
          taps: [{ stage: "invalid" as AxpStage }],
        }),
      }),
  ).toThrow("Unknown");
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(api.inspect()).toEqual([]);
  expect(/** 初始化列表重名应失败。 */ () => createTestClient([{ name: "a" }, { name: "a" }])).toThrow("Duplicate");
});
it("[core.method.use] 静态非法阶段与重名在 setup 之前被拒绝，不产生副作用", /** 校验失败的插件不应执行 setup，已装插件保持不变。 */ () => {
  const setup = vi.fn(/** 统计 setup 是否被调用。 */ () => ({}));
  const { api } = createTestClient([{ name: "kept", handle: /** 占位中间件。 */ (_ctx, next) => next() }]);
  expect(
    /** 静态声明了未知阶段的插件。 */ () =>
      api.use({
        name: "bad-stage",
        stage: "invalid" as AxpStage,
        handle: (_ctx, next) => next(),
        setup,
      }),
  ).toThrow("Unknown");
  expect(/** 与已装插件重名。 */ () => api.use({ name: "kept", setup })).toThrow("Duplicate");
  expect(setup).not.toHaveBeenCalled();
  expect(api.inspect().map(/** 取链内插件名。 */ ({ name }) => name)).toEqual(["kept"]);
});
it.each(["transform", "interceptor", "middleware"] as const)(
  "[core.fn.createAxp] %s bug 原样透传，throws:false 不吞",
  /** 转换器、拦截器或中间件里的 bug 原样透传，throws:false 也不吞。 */ async (source) => {
    const bug = new TypeError("original");

    let observed: unknown;
    const outer: AxpPlugin<AxpResponse> = {
      name: "observer",
      stage: "outer",
      /** 观察内层 next 最终得到的响应。 */ async handle(_ctx, next) {
        const response = await next();
        observed = response;
        return response;
      },
    };
    const { api } = createTestClient([
      outer,
      ...(source === "middleware"
        ? [
            {
              name: "bug",
              handle: /** 中间件抛出程序异常。 */ async () => {
                throw bug;
              },
            },
          ]
        : []),
    ]);
    if (source === "transform")
      api.axios.defaults.transformResponse = /** 模拟 transformResponse 抛出程序异常。 */ () => {
        throw bug;
      };
    if (source === "interceptor")
      api.axios.interceptors.request.use(
        /** 处理用户拦截器。 */ () => {
          throw bug;
        },
      );
    await expect(api.get(URL)(undefined, { throws: false })).rejects.toBe(bug);
    expect(observed).toMatchObject({ kind: "internal", error: bug });
    expect(api.pending()).toBe(0);
  },
);
it("[core.cb.reject] reject 自身抛错保留身份，且已清理在途请求", /** reject 自身抛错保留身份，且已清理在途请求。 */ async () => {
  const bug = new TypeError("reject");
  const { api, net } = createTestClient([], {
    reject: /** 模拟 reject 转换器抛出程序异常。 */ () => {
      throw bug;
    },
  });
  net.fallback(/** 返回 HTTP 500。 */ () => ({ status: 500 }));
  await expect(api.get(URL)()).rejects.toBe(bug);
  expect(api.pending()).toBe(0);
});
it("[core.method.cancelAll][core.req.signal] 用户取消与批量取消、重复取消计数和监听清理", /** 用户取消与批量取消、重复取消计数和监听清理。 */ async () => {
  /** 仅由 signal 结束的传输，无定时器。 */
  const adapter: AxiosAdapter = (config) =>
    new Promise(
      /** adapter 挂起，直到收到取消信号。 */ (_resolve, reject) => {
        config.signal!.addEventListener!("abort", /** 收到取消信号后以 CanceledError 拒绝。 */ () => reject(new CanceledError()));
      },
    );
  const { api } = createTestClient([], {}, adapter);
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const first = api.request({ url: URL, signal: controller.signal, throws: false });
  const second = api.request({ url: URL, throws: false });
  expect(api.pending()).toBe(2);
  controller.abort("user");
  expect(api.cancelAll("batch")).toBe(1);
  expect(api.cancelAll()).toBe(0);
  expect((await first).kind).toBe("cancel");
  expect((await second).kind).toBe("cancel");
  expect(api.pending()).toBe(0);
  expect(add).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});
it("[core.req.signal] 已中止直接落定且扩展响应字段存在，不执行插件/传输", /** 已中止直接落定且扩展响应字段存在，不执行插件/传输。 */ async () => {
  const controller = new AbortController();
  controller.abort();
  const handle = vi.fn();
  const adapter = vi.fn();
  const { api } = createTestClient<TestResponse>([{ name: "never", handle }], { response: customResponse() }, adapter);
  const response = await api.request({ signal: controller.signal, throws: false });
  expect(response).toMatchObject({ kind: "cancel", traceId: "" });
  expect(handle).not.toHaveBeenCalled();
  expect(adapter).not.toHaveBeenCalled();
  expect(api.pending()).toBe(0);
});
it("[core.method.pending][core.req.signal] 配置 getter 抛错后注销请求并移除用户监听", /** 验证构造失败清理。 */ async () => {
  const { api } = createTestClient();
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const bug = new TypeError("config getter");
  await expect(
    api.request({
      signal: controller.signal,
      /** 在配置展开期间模拟用户 getter 失败。 */
      get url(): string {
        throw bug;
      },
    }),
  ).rejects.toBe(bug);
  expect(api.pending()).toBe(0);
  expect(add).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0]![1]);
});
it("[core.method.dispose] 销毁中止在途请求并清理所有实例", /** 销毁中止在途请求并清理所有实例。 */ async () => {
  const wait = gate();
  const dispose = vi.fn();
  const { api } = createTestClient([
    {
      name: "wait",
      setup: /** 登记清理函数以观察卸载。 */ () => ({ dispose }),
      /** 等待放行后继续内层。 */ async handle(_ctx, next) {
        await wait.promise;
        return next();
      },
    },
  ]);
  const pending = api.request({ url: URL, throws: false });
  api.dispose();
  wait.open();
  expect((await pending).kind).toBe("cancel");
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(api.pending()).toBe(0);
});
