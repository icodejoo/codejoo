import { beforeEach, expect, it, vi } from "vitest";
import axpCache from "../../src/plugins/cache";
import { axpResponse, failureOf, messageOf, retryAfterOf, type IAxpResponse } from "../../src/response";
import { createTestClient } from "../helpers/client";
import { asyncCacheStore, settleAll, sourceClient } from "../helpers/source";

/** 刻意跨请求视图复用的显式缓存键。 */
const KEY = "failure-snapshot";
/** 消息往返使用的业务消息。 */
const MESSAGE = "cached-message";
/** 只在传输响应保留的重试头。 */
const AFTER = "2";
/** 继承消息的测试模式。 */
const INHERITED_MESSAGE = "inherited";
/** 默认类持久化失败时也使用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it.each([MESSAGE, null, "", undefined, 1, false, INHERITED_MESSAGE])(
  "[cache.opt.store] 快照字符串或 null 消息（含原型消息），JSON 往返后写回：%s",
  /** 无消息接口不被补业务字段，头事实不进入缓存。 */ async (message) => {
    const { store, entries } = asyncCacheStore();
    const factory = axpResponse<IAxpResponse>({
      /** 原始构造模拟任意消息形态，命中时使用缓存初始化字段。 */
      create(init) {
        const response: IAxpResponse = { ok: true, status: init.status ?? 200, code: typeof init.code === "number" ? init.code : 0, data: init.data ?? null };
        if (init.raw) {
          if (message === INHERITED_MESSAGE) Object.setPrototypeOf(response, { message: MESSAGE });
          else if (message !== undefined) Object.defineProperty(response, "message", { value: message, enumerable: true });
        } else if (init.message !== undefined) Object.defineProperty(response, "message", { value: init.message, enumerable: true });
        return response;
      },
    });
    const { api, net } = createTestClient<IAxpResponse>([axpCache<IAxpResponse>({ store })], { response: factory });
    net.on("get", KEY, /** 提供原始头，缓存只保存业务快照。 */ () => ({ headers: { "retry-after": AFTER } }));
    const config = { url: KEY, cache: { key: KEY }, wrap: true } as const;
    const [miss] = await settleAll(api.request(config));
    const [hit] = await settleAll(api.request(config));
    const snapshot = entries.get(KEY)!.snapshot;
    const expected = message === INHERITED_MESSAGE ? MESSAGE : typeof message === "string" || message === null ? message : undefined;
    expect(messageOf(hit)).toBe(expected);
    if (expected === undefined) expect(snapshot).not.toHaveProperty("message");
    else expect(snapshot.message).toBe(expected);
    expect(retryAfterOf(miss)).toBe(AFTER);
    expect(retryAfterOf(hit)).toBeUndefined();
    expect(snapshot).not.toHaveProperty("extra");
    expect(Object.getOwnPropertySymbols(snapshot)).toHaveLength(0);
    expect(net.totalStarted).toBe(1);
    api.dispose();
  },
);

it("[cache.opt.store][cache.cb.shouldCache] JSON 快照恢复失败事实，默认类无 extra，request 使用当前调用方", /** 失败标记独立于可序列化响应字段。 */ async () => {
  const { store, entries } = asyncCacheStore();
  const producer = vi.fn(/** 插件主动拒绝并返回内核构造的失败。 */ (ctx) => ctx.fail({ failure: "auth", reason: "expired", status: 200, code: 401 }));
  const h = sourceClient([axpCache({ store, shouldCache: /** 使用者允许持久化失败。 */ () => true }), { name: "failure-source", stage: "source", /** 缓存未命中时才合成。 */ handle: async (ctx) => producer(ctx) }]);
  const [miss] = await settleAll(h.send({ url: "/first", cache: { key: KEY } }));
  const [hit] = await settleAll(h.send({ url: "/second", cache: { key: KEY } }));
  expect(hit).not.toBe(miss);
  expect(hit).toMatchObject({ status: 200, code: 401, data: null, message: "", ok: false });
  expect(failureOf(hit)).toEqual({ type: "auth", reason: "expired" });
  expect(hit.request.url).toBe("/second");
  expect(hit.request).not.toBe(miss.request);
  expect(hit).not.toHaveProperty("raw");
  expect(hit).not.toHaveProperty("error");
  expect(entries.get(KEY)?.snapshot).toEqual({ status: 200, code: 401, data: null, message: "", failure: "auth", reason: "expired" });
  expect(entries.get(KEY)?.snapshot).not.toHaveProperty("extra");
  expect(producer).toHaveBeenCalledTimes(1);
});
