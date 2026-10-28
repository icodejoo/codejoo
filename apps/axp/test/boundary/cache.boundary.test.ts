import { afterEach, beforeEach, expect, it, vi } from "vitest";
import axpCache, { clearCache, type IAxpCacheEntry, type ICacheOptions } from "../../src/plugins/cache";
import type { AxpResponse } from "../../src/response";
import { envelope, sourceClient } from "../helpers/source";

/** 缓存边界依赖有效期与到达顺序，统一用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
/** 还原被替换的全局。 */
afterEach(() => {
  vi.unstubAllGlobals();
});

/** 被缓存的接口。 */
const URL = "/cached";
/** 默认容量。 */
const DEFAULT_MAX = 500;
/** 慢请求延迟。 */
const SLOW = 30;
/** 快请求延迟。 */
const FAST = 5;

/** 建立路由按命中序号返回 `hit-N` 的缓存客户端。 */
function cachedClient(options: ICacheOptions<AxpResponse> = {}) {
  const cache = axpCache(options);
  const h = sourceClient([cache]);
  h.net.on("get", URL, (_config, hit) => envelope(`hit-${hit}`));
  return { ...h, cache };
}
/** 客户端类型。 */
type TClient = ReturnType<typeof cachedClient>;
/** 发出一个请求并推进假时钟直到落定。 */
async function call(h: TClient, config: Record<string, unknown> = {}) {
  const pending = h.send({ url: URL, ...config });
  await vi.runAllTimersAsync();
  return pending;
}
/** 发出一个预期抛出原始异常的请求，返回被抛出的值。 */
async function thrown(h: TClient, config: Record<string, unknown> = {}) {
  const caught = h.send({ url: URL, ...config }).then(
    /** 不应成功。 */ () => undefined,
    /** 记录被抛出的值。 */ (error: unknown) => error,
  );
  await vi.runAllTimersAsync();
  return caught;
}

it("[cache.fn.axpCache] 较慢的旧响应后到，不覆盖较新发起请求的结果", async () => {
  const h = cachedClient();
  h.net.on("get", URL, (_config, hit) => envelope(hit === 1 ? "old" : "new"));
  const slow = h.send({ url: URL, cache: true, latency: SLOW } as never);
  const fast = h.send({ url: URL, cache: true, latency: FAST } as never);
  await vi.runAllTimersAsync();
  expect([(await slow).data, (await fast).data]).toEqual(["old", "new"]);
  expect((await call(h, { cache: true })).data).toBe("new");
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[cache.fn.clearCache][cache.method.api] clear 之前发出的在途请求落定后不回写", async () => {
  const h = cachedClient();
  const pending = h.send({ url: URL, cache: true, latency: SLOW } as never);
  await vi.advanceTimersByTimeAsync(1);
  expect(clearCache(h.api)).toBe(0);
  await vi.runAllTimersAsync();
  expect((await pending).ok).toBe(true);
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(2);
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[cache.opt.max][cache.fn.axpCache] 条目被 LRU 淘汰后，更早发起的在途响应仍不回写（R2-2）", async () => {
  const h = cachedClient({ max: 2 });
  h.net.on("get", URL, (_config, hit) => envelope(hit === 1 ? "stale" : `hit-${hit}`));
  const stale = h.send({ url: URL, cache: { key: "k" }, latency: 50 } as never);
  await vi.advanceTimersByTimeAsync(1);
  const fresh = h.send({ url: URL, cache: { key: "k" }, latency: FAST } as never);
  await vi.advanceTimersByTimeAsync(FAST + 1);
  expect((await fresh).data).toBe("hit-2");
  // 其它 key 把 k 淘汰出容量为 2 的缓存。
  await call(h, { cache: { key: "x" } });
  await call(h, { cache: { key: "y" } });
  await vi.runAllTimersAsync();
  expect((await stale).data).toBe("stale");
  const before = h.net.calls("get", URL);
  expect((await call(h, { cache: { key: "k" } })).data).not.toBe("stale");
  expect(h.net.calls("get", URL) - before).toBe(1);
});

it("[cache.opt.max] max:1 只保留最后写入的一条", async () => {
  const h = cachedClient({ max: 1 });
  await call(h, { cache: { key: "a" } });
  await call(h, { cache: { key: "b" } });
  const before = h.net.calls("get", URL);
  await call(h, { cache: { key: "b" } });
  expect(h.net.calls("get", URL) - before).toBe(0);
  await call(h, { cache: { key: "a" } });
  expect(h.net.calls("get", URL) - before).toBe(1);
});

it.each([0, -5, Number.NaN])("[cache.opt.max] max=%s 回退默认容量 500，不会退化成只存一条", async (max) => {
  const h = cachedClient({ max });
  const keys = ["a", "b", "c"];
  for (const key of keys) {
    // oxlint-disable-next-line no-await-in-loop -- 依次写入三条。
    await call(h, { cache: { key } });
  }
  for (const key of keys) {
    // oxlint-disable-next-line no-await-in-loop -- 依次读取三条。
    await call(h, { cache: { key } });
  }
  expect(h.net.calls("get", URL)).toBe(keys.length);
  expect(DEFAULT_MAX).toBeGreaterThan(keys.length);
});

it("[cache.opt.max] max=Infinity 不限容量", async () => {
  const h = cachedClient({ max: Number.POSITIVE_INFINITY });
  for (let index = 0; index <= DEFAULT_MAX; index++) {
    // oxlint-disable-next-line no-await-in-loop -- 依次写入超过默认容量的条目。
    await call(h, { cache: { key: `k${index}` } });
  }
  await call(h, { cache: { key: "k0" } });
  expect(h.net.calls("get", URL)).toBe(DEFAULT_MAX + 1);
});

it.each([0, -1, Number.NaN])("[cache.opt.expires][cache.req.cache.expires] 有效期 %s 写入即过期，永不命中", async (expires) => {
  const h = cachedClient();
  await call(h, { cache: expires });
  await call(h, { cache: expires });
  await call(h, { cache: { expires } });
  expect(h.net.calls("get", URL)).toBe(3);
});

it("[cache.opt.expires] 有效期 Infinity 永不过期", async () => {
  const h = cachedClient({ expires: Number.POSITIVE_INFINITY });
  await call(h, { cache: true });
  vi.advanceTimersByTime(Number.MAX_SAFE_INTEGER / 2);
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(1);
});

it("[cache.opt.store] 第三方存储不处理过期（如 new Map）：过期条目由插件读取时再检查并删除，不会被返回", async () => {
  const map = new Map<string, IAxpCacheEntry<AxpResponse>>();
  const h = cachedClient({ store: map });
  await call(h, { cache: { expires: 100, key: "k" } });
  expect(map.size).toBe(1);
  vi.advanceTimersByTime(99);
  await call(h, { cache: { expires: 100, key: "k" } });
  expect(h.net.calls("get", URL)).toBe(1);
  vi.advanceTimersByTime(1);
  h.net.on("get", URL, () => ({ status: 500 }));
  const miss = await call(h, { cache: { expires: 100, key: "k" } });
  expect(miss.httpStatus).toBe(500);
  expect(map.size).toBe(0);
});

it("[cache.cb.shouldCache] 判定抛错按程序 bug 抛原始异常，同 key 后续仍能缓存", async () => {
  const bug = new Error("should-cache bug");
  let calls = 0;
  const h = cachedClient({
    shouldCache: () => {
      if (calls++ === 0) throw bug;
      return true;
    },
  });
  expect(await thrown(h, { cache: true })).toBe(bug);
  await call(h, { cache: true });
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[cache.cb.clone] 命中时 clone 抛错：原始异常透传，缓存条目保留", async () => {
  const bug = new Error("clone bug");
  const h = cachedClient();
  await call(h, { cache: true });
  expect(
    await thrown(h, {
      cache: {
        clone: () => {
          throw bug;
        },
      },
    }),
  ).toBe(bug);
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(1);
});

it("[cache.cb.clone] 未命中返回时 clone 抛错：原始异常透传，已写入的缓存原件保留", async () => {
  const bug = new Error("clone bug");
  const h = cachedClient();
  expect(
    await thrown(h, {
      cache: {
        clone: () => {
          throw bug;
        },
      },
    }),
  ).toBe(bug);
  const hit = await call(h, { cache: true });
  expect(hit.data).toBe("hit-1");
  expect(h.net.calls("get", URL)).toBe(1);
});

it("[cache.cb.clone] clone 返回 null：本次 data 为 null，缓存原件不受影响", async () => {
  const h = cachedClient();
  const first = await call(h, { cache: { clone: () => null } });
  expect(first.data).toBeNull();
  expect(first.ok).toBe(true);
  expect((await call(h, { cache: true })).data).toBe("hit-1");
});

it("[cache.cb.clone] 失败响应不经过 clone，原样返回", async () => {
  const clone = vi.fn((data: unknown) => data);
  const h = cachedClient();
  h.net.on("get", URL, () => ({ status: 500 }));
  const failed = await call(h, { cache: { clone } });
  expect(failed.httpStatus).toBe(500);
  expect(clone).not.toHaveBeenCalled();
});

it("[cache.req.cache.clone] deep 在没有 structuredClone 的环境里抛错且不发送请求，不悄悄共享 data", async () => {
  const h = cachedClient();
  vi.stubGlobal("structuredClone", undefined);
  const error = await thrown(h, { cache: { clone: "deep" } });
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("structuredClone");
  expect(h.net.calls("get", URL)).toBe(0);
});

it("[cache.fn.axpCache] key 为 null（不可哈希、key:false）且没有显式键时直接放行，不读不写", async () => {
  const h = cachedClient();
  const unhashable = { params: { id: new Map() } };
  await call(h, { cache: true, ...unhashable });
  await call(h, { cache: true, ...unhashable });
  await call(h, { cache: true, key: false });
  await call(h, { cache: true, key: false });
  expect(h.net.calls("get", URL)).toBe(4);
  expect(clearCache(h.api)).toBe(0);
});

it("[cache.req.cache.key] 显式缓存键优先于 key:false；空串与非字符串键退回 key 服务", async () => {
  const h = cachedClient();
  await call(h, { cache: { key: "explicit" }, key: false });
  await call(h, { cache: { key: "explicit" }, key: false });
  expect(h.net.calls("get", URL)).toBe(1);
  for (const key of ["", 123]) {
    const before = h.net.calls("get", URL);
    // oxlint-disable-next-line no-await-in-loop -- 同一客户端依次核对每种键。
    await call(h, { cache: { key: key as never }, params: { by: String(key) } });
    // oxlint-disable-next-line no-await-in-loop -- 同上。
    await call(h, { cache: { key: key as never }, params: { by: String(key) } });
    expect(h.net.calls("get", URL) - before).toBe(1);
  }
});

it("[cache.method.lifecycle] 卸载时在途请求仍返回，但旧响应不写入重新安装后的缓存", async () => {
  const h = cachedClient();
  const pending = h.send({ url: URL, cache: true, latency: SLOW } as never);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.api.eject("axp:cache")).toBe(true);
  h.api.use(h.cache);
  await vi.runAllTimersAsync();
  expect((await pending).ok).toBe(true);
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(2);
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[cache.method.api] 重复 clear 与 remove 安全；清空计数包含尚未惰性清理的过期条目", async () => {
  const h = cachedClient();
  const api = h.api.plugin(h.cache)!;
  await call(h, { cache: { expires: 10, key: "a" } });
  vi.advanceTimersByTime(10);
  expect(api.clear()).toBe(1);
  expect(api.clear()).toBe(0);
  expect(api.remove("a")).toBe(false);
});

it("[cache.opt.max][cache.fn.axpCache] 写入超过容量时顺带清扫过期条目，而不只是淘汰最久未用的", async () => {
  const h = cachedClient({ max: 2 });
  const api = h.api.plugin(h.cache)!;
  await call(h, { cache: { expires: 10, key: "a" } });
  await call(h, { cache: { expires: 10, key: "b" } });
  vi.advanceTimersByTime(10);
  await call(h, { cache: { key: "c" } });
  // 过期的 a、b 被一并清走，只剩新写入的 c；单纯 LRU 淘汰会留下 b 和 c 两条。
  expect(api.clear()).toBe(1);
});

it("[cache.method.lifecycle] 重名 use 被拒绝；eject 与 dispose 重复调用都安全，卸载后可用同一插件对象重装", async () => {
  const h = cachedClient();
  expect(() => h.api.use(h.cache)).toThrow(/Duplicate plugin/);
  expect(h.api.eject("axp:cache")).toBe(true);
  expect(h.api.eject("axp:cache")).toBe(false);
  h.api.use(h.cache);
  await call(h, { cache: true });
  await call(h, { cache: true });
  expect(h.net.calls("get", URL)).toBe(1);
  h.api.dispose();
  expect(() => h.api.dispose()).not.toThrow();
});
