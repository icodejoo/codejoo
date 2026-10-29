import { beforeEach, expect, it, vi } from "vitest";
import axpCache from "../../src/plugins/cache";
import { failureOf } from "../../src/response";
import { asyncCacheStore, settleAll, sourceClient } from "../helpers/source";

/** 刻意跨请求视图复用的显式缓存键。 */
const KEY = "failure-snapshot";
/** 默认类持久化失败时也使用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

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
  expect(hit.raw).toBeUndefined();
  expect(hit.error).toBeUndefined();
  expect(entries.get(KEY)?.snapshot).toEqual({ status: 200, code: 401, data: null, message: "", failure: "auth", reason: "expired" });
  expect(entries.get(KEY)?.snapshot).not.toHaveProperty("extra");
  expect(producer).toHaveBeenCalledTimes(1);
});
