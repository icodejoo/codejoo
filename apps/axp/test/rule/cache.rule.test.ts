import { UI_OBSERVER } from "../helpers/ui";
import { failureOf } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import axpCache, { clearCache, removeCache, type ICacheOptions, type IAxpCacheEntry, type IAxpCacheStore } from "../../src/plugins/cache";
import type { AxpResponse } from "../../src/response";
import { envelope, sourceClient } from "../helpers/source";

/** 缓存规则依赖有效期推进，统一用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

/** 插件名称。 */
const NAME = "axp:cache";
/** 被缓存的接口。 */
const URL = "/cached";
/** 默认有效期。 */
const DEFAULT_TTL = 60_000;

/** 建立路由按命中序号返回 `hit-N` 的缓存客户端，并返回插件以便取管理 API。 */
function cachedClient(options: ICacheOptions<AxpResponse> = {}) {
  const cache = axpCache(options);
  const h = sourceClient([cache]);
  h.net.on("get", URL, (_config, hit) => envelope({ hit, list: [{ n: hit }] }));
  return { ...h, cache };
}
/** 发出一个请求并推进假时钟直到落定。 */
async function call(h: ReturnType<typeof cachedClient>, config: Record<string, unknown> = {}) {
  const pending = h.send({ url: URL, ...config });
  await vi.runAllTimersAsync();
  return pending;
}

it("[cache.prop.name][cache.opt.enable] 名称为 axp:cache（不随选项变化）；enable:false 不进链，也不能被请求级重新打开", async () => {
  for (const options of [{}, { enable: false }, { enable: undefined, max: 1 }]) {
    expect(axpCache(options).name).toBe(NAME);
  }
  const off = cachedClient({ enable: false });
  expect(off.api.inspect().filter(/** 排除夹具自身的上下文观测层。 */ (item) => item.name !== UI_OBSERVER)).toEqual([]);
  await call(off, { cache: true });
  await call(off, { cache: true });
  expect(off.net.calls("get", URL)).toBe(2);
  expect(
    cachedClient()
      .api.inspect()
      .filter(/** 排除夹具自身的上下文观测层。 */ (item) => item.name !== UI_OBSERVER),
  ).toEqual([{ stage: "source", name: NAME }]);
});

it("[cache.req.cache] 首发未命中打网络，二发命中不触网并重建 R（data 共享引用）", async () => {
  const h = cachedClient();
  const first = await call(h, { cache: true });
  const second = await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(1);
  expect(second).not.toBe(first);
  expect(second.data).toBe(first.data);
  expect(second.ok).toBe(true);
  expect((first.data as { hit: number }).hit).toBe(1);
});

it("[cache.req.cache] 请求没写 cache、false、null、enable:false、函数与其它非法值都不缓存", async () => {
  const h = cachedClient();
  for (const cache of [undefined, false, null, { enable: false }, "yes", [], () => true]) {
    const before = h.net.calls("get", URL);
    // oxlint-disable-next-line no-await-in-loop -- 同一客户端依次核对每种写法的发送次数。
    await call(h, { cache: cache as never });
    // oxlint-disable-next-line no-await-in-loop -- 同上。
    await call(h, { cache: cache as never });
    expect(h.net.calls("get", URL) - before).toBe(2);
  }
});

it("[cache.fn.axpCache] 命中不重跑 transformResponse（缓存的是判定后的响应）", async () => {
  const transform = vi.fn((data: unknown) => data);
  const cache = axpCache();
  const h = sourceClient([cache], {}, { transformResponse: [transform] });
  h.net.on("get", URL, () => envelope(1));
  const pending = h.send({ url: URL, cache: true });
  await vi.runAllTimersAsync();
  await pending;
  const hit = h.send({ url: URL, cache: true });
  await vi.runAllTimersAsync();
  await hit;
  expect(transform).toHaveBeenCalledTimes(1);
  expect(h.net.calls("get", URL)).toBe(1);
});

it("[cache.opt.expires] 默认有效期 60 秒：到期前命中，恰好到期重新发请求", async () => {
  const h = cachedClient();
  await call(h, { cache: true });
  vi.advanceTimersByTime(DEFAULT_TTL - 1);
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(1);
  vi.advanceTimersByTime(1);
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[cache.opt.expires][cache.req.cache.expires] 请求级有效期（数字或对象）覆盖插件级，插件级覆盖默认", async () => {
  const h = cachedClient({ expires: 1000 });
  await call(h, { cache: true });
  vi.advanceTimersByTime(1000);
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(2);
  for (const cache of [5000, { expires: 5000 }]) {
    const before = h.net.calls("get", URL);
    // oxlint-disable-next-line no-await-in-loop -- 同一客户端依次推进假时钟。
    await call(h, { cache, key: `k-${JSON.stringify(cache)}` });
    vi.advanceTimersByTime(4999);
    // oxlint-disable-next-line no-await-in-loop -- 同上。
    await call(h, { cache, key: `k-${JSON.stringify(cache)}` });
    expect(h.net.calls("get", URL) - before).toBe(1);
    vi.advanceTimersByTime(1);
    // oxlint-disable-next-line no-await-in-loop -- 同上。
    await call(h, { cache, key: `k-${JSON.stringify(cache)}` });
    expect(h.net.calls("get", URL) - before).toBe(2);
  }
});

it("[cache.opt.methods] 默认只缓存 get 与 head，POST 即使请求级开启也不缓存", async () => {
  const h = cachedClient();
  h.net.on("post", URL, (_config, hit) => envelope(`post-${hit}`));
  h.net.on("head", URL, (_config, hit) => envelope(`head-${hit}`));
  await call(h, { method: "post", data: { a: 1 }, cache: true });
  await call(h, { method: "post", data: { a: 1 }, cache: true });
  await call(h, { method: "head", cache: true });
  await call(h, { method: "head", cache: true });
  expect(h.net.calls("post", URL)).toBe(2);
  expect(h.net.calls("head", URL)).toBe(1);
});

it("[cache.opt.methods] methods 可改为包含 POST（大小写不敏感），请求体参与 key；不在表里的 get 不缓存", async () => {
  const h = cachedClient({ methods: ["POST"] });
  h.net.on("post", URL, (_config, hit) => envelope(`post-${hit}`));
  const a1 = await call(h, { method: "post", data: { a: 1 }, cache: true });
  const a2 = await call(h, { method: "post", data: { a: 1 }, cache: true });
  const b = await call(h, { method: "post", data: { a: 2 }, cache: true });
  expect(a2).not.toBe(a1);
  expect(a2.data).toBe(a1.data);
  expect(b.data).toBe("post-2");
  await call(h, { cache: true });
  await call(h, { cache: true });
  expect(h.net.calls("post", URL)).toBe(2);
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[cache.cb.shouldCache] 默认只缓存 r.ok：HTTP 失败与业务失败不缓存，成功后恢复缓存", async () => {
  const h = cachedClient();
  h.net.on("get", URL, (_config, hit) => {
    if (hit === 1) return { status: 500 };
    if (hit === 2) return { status: 200, data: { code: 500, data: null, message: "biz" } };
    return envelope(`ok-${hit}`);
  });
  expect((await call(h, { cache: true })).status).toBe(500);
  const failure = await call(h, { cache: true });
  expect(failure.ok).toBe(false);
  expect(failureOf(failure)).toBeUndefined();
  const good = await call(h, { cache: true });
  const again = await call(h, { cache: true });
  expect(again).not.toBe(good);
  expect(again.data).toBe(good.data);
  expect(h.net.calls("get", URL)).toBe(3);
});

it("[cache.cb.shouldCache][cache.req.cache.shouldCache] 判定收到 R；请求级覆盖插件级，自定义可缓存失败", async () => {
  const pluginLevel = vi.fn((_response: unknown) => false);
  const h = cachedClient({ shouldCache: pluginLevel });
  await call(h, { cache: true });
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(2);
  expect(pluginLevel).toHaveBeenCalledTimes(2);
  expect(pluginLevel.mock.calls[0][0]).toMatchObject({ ok: true });
  h.net.on("get", URL, () => ({ status: 500 }));
  const requestLevel = vi.fn((r: { status: number }) => r.status === 500);
  const failed = await call(h, { cache: { shouldCache: requestLevel }, key: "fail" });
  const hit = await call(h, { cache: { shouldCache: requestLevel }, key: "fail" });
  expect(hit).not.toBe(failed);
  expect(hit.data).toBe(failed.data);
  expect(hit.ok).toBe(false);
  expect(requestLevel).toHaveBeenCalledOnce();
});

it("[cache.opt.clone][cache.req.cache.clone] 默认共享引用：就地修改命中的 data 会污染后续命中", async () => {
  const h = cachedClient();
  const first = await call(h, { cache: true });
  (first.data as { list: unknown[] }).list.push("polluted");
  const second = await call(h, { cache: true });
  expect((second.data as { list: unknown[] }).list).toHaveLength(2);
});

it("[cache.opt.clone][cache.req.cache.clone] shallow 隔离顶层，嵌套仍共享", async () => {
  const h = cachedClient();
  const first = await call(h, { cache: { clone: "shallow" } });
  const second = await call(h, { cache: { clone: "shallow" } });
  expect(second.data).not.toBe(first.data);
  expect((second.data as { list: unknown[] }).list).toBe((first.data as { list: unknown[] }).list);
  expect(second.ok).toBe(true);
  expect(h.net.calls("get", URL)).toBe(1);
});

it("[cache.opt.clone][cache.req.cache.clone] deep 完整隔离，就地改任意层都不污染缓存", async () => {
  const h = cachedClient();
  const first = await call(h, { cache: { clone: "deep" } });
  (first.data as { list: { n: number }[] }).list[0].n = -1;
  const second = await call(h, { cache: { clone: "deep" } });
  expect((second.data as { list: { n: number }[] }).list[0].n).toBe(1);
  (second.data as { list: unknown[] }).list.push("x");
  const third = await call(h, { cache: { clone: "deep" } });
  expect((third.data as { list: unknown[] }).list).toHaveLength(1);
});

it("[cache.cb.clone][cache.req.cache.clone] 函数策略调用自定义拷贝，命中与返回都经过它", async () => {
  const clone = vi.fn((data: unknown) => ({ ...(data as object), cloned: true }));
  const h = cachedClient();
  const miss = await call(h, { cache: { clone } });
  const hit = await call(h, { cache: { clone } });
  expect(clone).toHaveBeenCalledTimes(2);
  expect(miss.data).toMatchObject({ cloned: true });
  expect(hit.data).toMatchObject({ cloned: true });
  expect(hit).not.toBe(miss);
});

it("[cache.opt.clone] 插件级 clone 对 cache:true 同样生效，请求级覆盖插件级", async () => {
  const h = cachedClient({ clone: "deep" });
  const first = await call(h, { cache: true });
  const second = await call(h, { cache: true });
  expect(second.data).not.toBe(first.data);
  const shared = await call(h, { cache: { clone: (data: unknown) => data } });
  const sharedAgain = await call(h, { cache: { clone: (data: unknown) => data } });
  expect(sharedAgain.data).toBe(shared.data);
});

it("[cache.req.cache.key] 显式缓存键让不同地址共用一条缓存，不经过 key 服务", async () => {
  const h = cachedClient();
  h.net.on("get", "/other", () => envelope("other"));
  const first = await call(h, { cache: { key: "same" } });
  const second = await call(h, { url: "/other", cache: { key: "same" } });
  expect(second).not.toBe(first);
  expect(second.data).toBe(first.data);
  expect(h.net.calls("get", "/other")).toBe(0);
});

it("[cache.fn.removeCache][cache.fn.clearCache][cache.method.api] client.plugin 暴露 remove 与 clear；removeCache、clearCache 同效", async () => {
  const h = cachedClient();
  const api = h.api.plugin(h.cache)!;
  h.net.on("get", "/b", () => envelope("b"));
  await call(h, { cache: { key: "a" } });
  await call(h, { url: "/b", cache: { key: "b" } });
  expect(api.remove("a")).toBe(true);
  expect(api.remove("a")).toBe(false);
  await call(h, { cache: { key: "a" } });
  expect(h.net.calls("get", URL)).toBe(2);
  expect(removeCache(h.api, "b")).toBe(true);
  expect(removeCache(h.api, "b")).toBe(false);
  expect(clearCache(h.api)).toBe(1);
  expect(api.clear()).toBe(0);
  await call(h, { cache: { key: "a" } });
  expect(h.net.calls("get", URL)).toBe(3);
});

it("[cache.fn.removeCache][cache.fn.clearCache] 客户端没装 cache（或 enable:false）时返回 false 与 0", async () => {
  const bare = sourceClient([]);
  expect(removeCache(bare.api, "a")).toBe(false);
  expect(clearCache(bare.api)).toBe(0);
  const off = cachedClient({ enable: false });
  expect(removeCache(off.api, "a")).toBe(false);
  expect(clearCache(off.api)).toBe(0);
  expect(off.api.plugin(off.cache)).toBeUndefined();
});

it("[cache.opt.max] 超出容量按 LRU 淘汰最久未使用的条目，命中会刷新顺序", async () => {
  const h = cachedClient({ max: 2 });
  for (const key of ["a", "b"]) {
    // oxlint-disable-next-line no-await-in-loop -- 依次写入保证淘汰顺序。
    await call(h, { cache: { key } });
  }
  await call(h, { cache: { key: "a" } });
  await call(h, { cache: { key: "c" } });
  const before = h.net.calls("get", URL);
  await call(h, { cache: { key: "a" } });
  await call(h, { cache: { key: "c" } });
  expect(h.net.calls("get", URL) - before).toBe(0);
  await call(h, { cache: { key: "b" } });
  expect(h.net.calls("get", URL) - before).toBe(1);
});

it("[cache.opt.store] 注入的同步存储按 key 读写，插件存储快照，卸载时不清空调用方的存储", async () => {
  const entries = new Map<string, IAxpCacheEntry>();
  const set = vi.fn((key: string, entry: IAxpCacheEntry) => void entries.set(key, entry));
  const store: IAxpCacheStore = {
    get: vi.fn((key: string) => entries.get(key)),
    set,
    delete: (key) => entries.delete(key),
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
  const h = cachedClient({ store, max: 1 });
  const first = await call(h, { cache: { key: "a" } });
  await call(h, { cache: { key: "b" } });
  expect(store.size).toBe(2);
  expect(entries.get("a")!.snapshot.data).toBe(first.data);
  expect(set).toHaveBeenCalledTimes(2);
  expect(h.api.eject(NAME)).toBe(true);
  expect(store.size).toBe(2);
});

it("[cache.method.lifecycle] 卸载自己创建的存储后 API 清空；eject 后请求不再缓存", async () => {
  const h = cachedClient();
  const api = h.api.plugin(h.cache)!;
  await call(h, { cache: true });
  expect(h.api.eject(NAME)).toBe(true);
  expect(api.clear()).toBe(0);
  await call(h, { cache: true });
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(3);
});

it("[cache.req.cache][cache.fn.axpCache] 不修改调用方的请求对象，选项原样保留在请求上", async () => {
  const h = cachedClient();
  const config = { url: URL, cache: { expires: 5000, key: "k" }, wrap: true } as const;
  const snapshot = JSON.stringify(config);
  const missing = h.api.request(config);
  await vi.runAllTimersAsync();
  await missing;
  await h.api.request(config);
  expect(JSON.stringify(config)).toBe(snapshot);
  expect(h.requests[0].cache).toEqual(config.cache);
  expect(h.requests[1].cache).toEqual(config.cache);
});

it("[cache.opt.storage][cache.opt.memory] 已删除的 storage、memory 选项不再有任何作用，持久化走 store", async () => {
  const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
  for (const memory of [true, false, null]) {
    const h = cachedClient({ storage, memory } as never);
    // oxlint-disable-next-line no-await-in-loop -- 同一组存储依次核对三种 memory 取值。
    await call(h, { cache: true });
    // oxlint-disable-next-line no-await-in-loop -- 同上。
    await call(h, { cache: true });
    expect(h.net.calls("get", URL)).toBe(1);
  }
  for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
});
