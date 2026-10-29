import { UI_OBSERVER } from "../helpers/ui";
import { create as createAxios, type AxiosRequestConfig } from "axios";
import { expect, expectTypeOf, it, vi } from "vitest";
import { createAxp } from "../../src/client";
import * as entry from "../../src/index";
import type { MaybePromise, ICacheOptions, IMockOptions, ISharedOptions, SharePolicy } from "../../src/index";
import axpCache, { clearCache, removeCache, type ICacheApi } from "../../src/plugins/cache";
import { axpResponse, type AxpResponseInit } from "../../src/response";
import { createMemoryStore } from "../../src/plugins/cache-store";
import axpMock from "../../src/plugins/mock";
import axpShare from "../../src/plugins/share";
import type { AxpPlugin, AxpRequestOptions } from "../../src/types";
import { createTestClient, TestResponse } from "../helpers/client";
import { makeNetwork } from "../helpers/network";
import { envelope, requestRecorder, sourceClient } from "../helpers/source";

/** 从 init 或传输头重建自定义响应。 */
function customResponse() {
  return axpResponse<TestResponse>({
    /** 命中时没有 raw，使用快照扩展字段。 */
    create: (init, raw) => Object.assign(new TestResponse(init), { traceId: (init as AxpResponseInit<TestResponse> & { traceId?: string }).traceId ?? init.from?.traceId ?? String(raw?.headers["x-trace-id"] ?? "") }),
  });
}

/** 被缓存和共享的接口。 */
const URL = "/pets";

it("[mock.type.options][share.type.options][cache.type.options] 旧入口类型名保留，插件透传自定义 R，请求扩展只写在 AxpRequestOptions 上", /** 仅编译的公开契约。 */ () => {
  /** 不执行真实网络的用法样例。 */
  function contracts() {
    // 单独定义成变量时手写泛型；内联在 plugins 数组里时从上下文推断 R。
    const cache = axpCache<TestResponse>({
      expires: 1,
      clone: "deep",
      shouldCache: /** 写入判定同样收到 R。 */ (r) => {
        expectTypeOf(r).toEqualTypeOf<TestResponse>();
        return r.ok;
      },
      store: createMemoryStore(),
    });
    const api = createAxp<unknown, TestResponse>({
      response: customResponse(),
      plugins: [
        axpMock({
          enable: true,
          mockUrl: "http://mock",
          fallbackWhen: /** 上下文推断保留扩展字段。 */ (r) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            return r.traceId === "";
          },
        }),
        axpShare({ policy: "race", methods: ["get"] }),
        cache,
      ],
    });
    void api.request({ cache: true, share: true, mock: true });
    void api.request({ cache: 60_000, share: "race", mock: { mockUrl: "http://m", enable: false } });
    void api.request({
      cache: { expires: null, key: "k", clone: "shallow", shouldCache: (r) => r.ok },
      share: { policy: "end", enable: undefined },
      mock: { fallbackWhen: (r) => r.status === 404 },
    });
    void api.request({ cache: false, share: null, mock: false });
    // @ts-expect-error cache 不接受字符串。
    void api.request({ cache: "yes" });
    // @ts-expect-error cache 不接受函数。
    void api.request({ cache: () => true });
    // @ts-expect-error 显式缓存键必须是字符串。
    void api.request({ cache: { key: 1 } });
    // @ts-expect-error share 策略 none 已删除，关闭请用 false。
    void api.request({ share: "none" });
    // @ts-expect-error share 不接受动态函数。
    void api.request({ share: () => "start" });
    // @ts-expect-error mock 对象不再有 mock 字段，关闭请用 false 或 enable:false。
    void api.request({ mock: { mock: true } });
    // @ts-expect-error mock 不接受动态函数。
    void api.request({ mock: () => true });
    // @ts-expect-error 旧的 storage 预留选项已删除，持久化走 store。
    axpCache({ storage: { getItem: () => null } });
    // @ts-expect-error 旧的 memory 预留选项已删除。
    axpCache({ memory: true });
    // @ts-expect-error 缓存仓仍必须提供全部存储方法。
    axpCache<TestResponse>({ store: { get: async () => undefined } });
    // @ts-expect-error axios 原生配置不再扩展 mock。
    const axiosMock: AxiosRequestConfig = { mock: true };
    void axiosMock;
    const options: AxpRequestOptions = { cache: 1, share: "start", mock: { mockUrl: "x" } };
    void options;
    expectTypeOf(cache).toEqualTypeOf<AxpPlugin<TestResponse, ICacheApi>>();
    expectTypeOf(api.plugin(cache)).toEqualTypeOf<ICacheApi | undefined>();
    expectTypeOf(removeCache).returns.toEqualTypeOf<MaybePromise<boolean>>();
    expectTypeOf(clearCache).returns.toEqualTypeOf<MaybePromise<number>>();
    expectTypeOf(removeCache(api, "k")).toEqualTypeOf<MaybePromise<boolean>>();
    expectTypeOf(clearCache(api)).toEqualTypeOf<MaybePromise<number>>();
    expectTypeOf<ICacheOptions>().toExtend<{ /** 容量。 */ max?: number }>();
    expectTypeOf<IMockOptions>().toExtend<{ /** 基址。 */ mockUrl?: string }>();
    expectTypeOf<ISharedOptions>().toExtend<{ /** 策略。 */ policy?: SharePolicy }>();
    expectTypeOf<SharePolicy>().toEqualTypeOf<"start" | "end" | "race">();
  }
  expect(contracts).toBeTypeOf("function");
});

it("[cache.fn.axpCache][mock.fn.axpMock][share.fn.axpShare] 旧入口仍导出这些名字", () => {
  for (const name of ["axpCache", "removeCache", "clearCache", "axpMock", "axpShare"] as const) {
    expect(entry[name]).toBeTypeOf("function");
  }
});

it("[mock.prop.stage][share.prop.stage][cache.prop.stage] source 阶段固定次序 mock → share → cache，与注册顺序无关，自定义 pre/post 包在两侧", () => {
  const pre = requestRecorder("pre");
  const post = requestRecorder("post");
  const h = sourceClient([axpCache(), post.plugin, axpShare(), pre.plugin, axpMock({ enable: true })]);
  expect(h.api.inspect().filter(/** 排除夹具自身的上下文观测层。 */ (item) => item.name !== UI_OBSERVER)).toEqual([
    { stage: "source", name: "recorder-pre" },
    { stage: "source", name: "axp:mock" },
    { stage: "source", name: "axp:share" },
    { stage: "source", name: "axp:cache" },
    { stage: "source", name: "recorder-post" },
  ]);
});

it("[cache.method.lifecycle][share.method.lifecycle] 同一个插件对象装到两个客户端、extend 继承的子客户端，各自状态独立", async () => {
  const cache = axpCache();
  const share = axpShare();
  const first = createTestClient([share, cache]);
  const second = createTestClient([share, cache]);
  for (const h of [first, second]) {
    h.net.on("get", URL, (_config, hit) => envelope(`hit-${hit}`));
  }
  const options = { url: URL, method: "get", cache: true, wrap: true } as const;
  await first.api.request(options);
  await first.api.request(options);
  await second.api.request(options);
  expect(first.net.calls("get", URL)).toBe(1);
  expect(second.net.calls("get", URL)).toBe(1);
  const child = first.api.extend();
  expect(child.inspect().filter(/** 排除夹具自身的上下文观测层。 */ (item) => item.name !== UI_OBSERVER)).toEqual(first.api.inspect().filter(/** 排除夹具自身的上下文观测层。 */ (item) => item.name !== UI_OBSERVER));
  expect(clearCache(child)).toBe(0);
  expect(removeCache(first.api, "none")).toBe(false);
  expect(clearCache(first.api)).toBe(1);
  expect(clearCache(second.api)).toBe(1);
  first.api.dispose();
  second.api.dispose();
});

it("[cache.opt.clone][cache.fn.axpCache] 自定义 R：clone 命中派生的响应保留扩展字段与来源", async () => {
  const h = createTestClient<TestResponse>([axpCache<TestResponse>({ clone: "deep" })], {
    response: customResponse(),
  });
  h.net.on("get", URL, () => ({
    ...envelope({ list: [1] }),
    headers: { "x-trace-id": "trace-1" },
  }));
  const options = { url: URL, cache: true, wrap: true } as const;
  const miss = await h.api.request(options);
  const hit = await h.api.request(options);
  expect(hit).toBeInstanceOf(TestResponse);
  expect((hit as TestResponse).traceId).toBe("trace-1");
  expect(hit).not.toBe(miss);
  expect(hit.data).toEqual({ list: [1] });
  expect(hit.request).not.toBe(miss.request);
  expect(hit.request.url).toBe(URL);
  expect(h.net.calls("get", URL)).toBe(1);
  h.api.dispose();
});

it("[cache.fn.axpCache] axios 实例的 adapter 是数组时同样可用，二次同 key 命中缓存", async () => {
  const net = makeNetwork();
  net.on("get", URL, () => envelope("ok"));
  const axios = createAxios({ adapter: [net.adapter] });
  const h = createTestClient([axpCache()], { axios });
  const options = { url: URL, cache: true, wrap: true } as const;
  await h.api.request(options);
  const hit = await h.api.request(options);
  expect(hit.ok).toBe(true);
  expect(net.calls("get", URL)).toBe(1);
  h.api.dispose();
});

it("[share.method.lifecycle][cache.method.lifecycle] 任意顺序卸载：剩余插件继续生效，全部摘除后不会复活已卸载的插件", async () => {
  vi.useFakeTimers();
  for (const order of [
    ["axp:cache", "axp:share"],
    ["axp:share", "axp:cache"],
  ]) {
    const h = sourceClient([axpShare(), axpCache()]);
    h.net.on("get", URL, (_config, hit) => envelope(`hit-${hit}`));
    /** 同时发两个同 key 请求并推进假时钟，返回两次落定的结果。 */
    const burst = async () => {
      const pending = [h.send({ url: URL, share: true, cache: true, latency: 5 } as never), h.send({ url: URL, share: true, cache: true, latency: 5 } as never)];
      await vi.runAllTimersAsync();
      return Promise.all(pending);
    };
    // oxlint-disable-next-line no-await-in-loop -- 同一客户端依次卸载并核对网络次数。
    await burst();
    expect(h.net.calls("get", URL)).toBe(1);
    expect(h.api.eject(order[0])).toBe(true);
    // oxlint-disable-next-line no-await-in-loop -- 同上。
    await burst();
    // 先卸 cache：share 仍合并成一次；先卸 share：cache 仍命中，不再触网。
    expect(h.net.calls("get", URL)).toBe(order[0] === "axp:cache" ? 2 : 1);
    expect(h.api.eject(order[1])).toBe(true);
    const before = h.net.calls("get", URL);
    // oxlint-disable-next-line no-await-in-loop -- 同上。
    await burst();
    // 全部卸载：两个请求各自直达网络，缓存与共享都没有复活。
    expect(h.net.calls("get", URL) - before).toBe(2);
    expect(h.api.inspect().filter(/** 排除夹具自身的上下文观测层。 */ (item) => item.name !== UI_OBSERVER)).toEqual([]);
  }
});
