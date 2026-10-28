import { beforeEach, expect, it, vi } from "vitest";
import axpCache, { clearCache, type IAxpCacheEntry } from "../../src/plugins/cache";
import axpShare, { type SharePolicy } from "../../src/plugins/share";
import type { AxpResponse } from "../../src/response";
import { envelope, sourceClient } from "../helpers/source";

/** 并发与有效期相关用例统一用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

/** 被共享并缓存的接口。 */
const URL = "/pets";
/** 并发调用方数量。 */
const CALLERS = 20;
/** 网络延迟。 */
const LATENCY = 10;
/** 较慢的网络延迟。 */
const SLOW = 30;

/** 装好 share 与带写入计数存储的 cache；路由按命中序号返回数据。 */
function client(policy: SharePolicy = "start", clone?: "deep") {
  const entries = new Map<string, IAxpCacheEntry<AxpResponse>>();
  const set = vi.fn(
    (key: string, entry: IAxpCacheEntry<AxpResponse>) => void entries.set(key, entry),
  );
  const store = {
    get: (key: string) => entries.get(key),
    set,
    delete: (key: string) => entries.delete(key),
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
  const h = sourceClient([
    axpShare<AxpResponse>({ policy }),
    axpCache<AxpResponse>({ store, clone }),
  ]);
  h.net.on("get", URL, (_config, hit) => envelope({ hit, list: [hit] }));
  return { ...h, set };
}
/** 推进假时钟直到所有请求落定。 */
async function settled<T>(...pending: Promise<T>[]): Promise<T[]> {
  await vi.runAllTimersAsync();
  return Promise.all(pending);
}

it("[share.opt.policy × cache.req.cache] 并发未命中只发一次网络，结果只写缓存一次，之后的请求命中缓存", async () => {
  const h = client();
  const results = await settled(
    ...Array.from({ length: CALLERS }, () =>
      h.send({ url: URL, share: true, cache: true, latency: LATENCY } as never),
    ),
  );
  expect(h.net.calls("get", URL)).toBe(1);
  expect(h.set).toHaveBeenCalledOnce();
  expect(new Set(results).size).toBe(1);
  const [hit] = await settled(h.send({ url: URL, cache: true }));
  expect(hit).toBe(results[0]);
  expect(h.net.calls("get", URL)).toBe(1);
});

it("[share.opt.policy × cache.cb.shouldCache] 失败结果被共享但不写缓存，之后的请求重新发送", async () => {
  const h = client();
  h.net.on("get", URL, (_config, hit) => (hit === 1 ? { status: 500 } : envelope("ok")));
  const failed = await settled(
    h.send({ url: URL, share: true, cache: true, latency: LATENCY } as never),
    h.send({ url: URL, share: true, cache: true, latency: LATENCY } as never),
  );
  expect(failed[0]!.httpStatus).toBe(500);
  expect(failed[1]).toBe(failed[0]);
  expect(h.set).not.toHaveBeenCalled();
  const [good] = await settled(h.send({ url: URL, share: true, cache: true }));
  expect(good!.data).toBe("ok");
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[share.opt.policy × cache.opt.clone] clone:deep 时首发与跟随者共享同一份拷贝，命中缓存则拿到新的拷贝，原件不被污染", async () => {
  const h = client("start", "deep");
  const [leader, follower] = await settled(
    h.send({ url: URL, share: true, cache: true, latency: LATENCY } as never),
    h.send({ url: URL, share: true, cache: true, latency: LATENCY } as never),
  );
  expect(follower).toBe(leader);
  (leader!.data as { list: unknown[] }).list.push("polluted");
  const [hit] = await settled(h.send({ url: URL, cache: true }));
  expect(hit).not.toBe(leader);
  expect((hit!.data as { list: unknown[] }).list).toEqual([1]);
});

it("[share.opt.policy × cache.fn.axpCache] end：两次都发网络，订阅者与缓存都以最新一次为准，较慢的旧响应不回写", async () => {
  const h = client("end");
  const [older, newer] = await settled(
    h.send({ url: URL, share: true, cache: true, latency: SLOW } as never),
    h.send({ url: URL, share: true, cache: true, latency: LATENCY } as never),
  );
  expect(h.net.calls("get", URL)).toBe(2);
  expect(newer).toBe(older);
  expect((newer!.data as { hit: number }).hit).toBe(2);
  const [hit] = await settled(h.send({ url: URL, cache: true }));
  expect((hit!.data as { hit: number }).hit).toBe(2);
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[share.opt.policy × cache.fn.axpCache] race：先成功的胜出并写缓存，较慢的成功不覆盖", async () => {
  const h = client("race");
  const [slow, fast] = await settled(
    h.send({ url: URL, share: true, cache: true, latency: SLOW } as never),
    h.send({ url: URL, share: true, cache: true, latency: LATENCY } as never),
  );
  expect(slow).toBe(fast);
  const [hit] = await settled(h.send({ url: URL, cache: true }));
  expect((hit!.data as { hit: number }).hit).toBe(2);
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[share.opt.policy × cache.fn.clearCache] 共享期间 clear：在途结果照常分发，但不回写缓存", async () => {
  const h = client();
  const pending = [
    h.send({ url: URL, share: true, cache: true, latency: LATENCY } as never),
    h.send({ url: URL, share: true, cache: true, latency: LATENCY } as never),
  ];
  await vi.advanceTimersByTimeAsync(1);
  clearCache(h.api);
  const [a, b] = await settled(...pending);
  expect([a!.ok, b!.ok]).toEqual([true, true]);
  expect(h.set).not.toHaveBeenCalled();
});

it("[share.opt.policy × cache.cb.shouldCache] 判定抛错：所有订阅者拿到原始异常，共享条目不挂起，下一轮可以继续", async () => {
  const bug = new Error("should-cache bug");
  const h = sourceClient([
    axpShare<AxpResponse>(),
    axpCache<AxpResponse>({
      shouldCache: () => {
        throw bug;
      },
    }),
  ]);
  h.net.on("get", URL, () => envelope("ok"));
  const caught = [
    h
      .send({ url: URL, share: true, cache: true, latency: LATENCY } as never)
      .catch((e: unknown) => e),
    h
      .send({ url: URL, share: true, cache: true, latency: LATENCY } as never)
      .catch((e: unknown) => e),
  ];
  await vi.runAllTimersAsync();
  expect(await Promise.all(caught)).toEqual([bug, bug]);
  expect(h.net.calls("get", URL)).toBe(1);
  // 条目没有残留：不带 cache 的下一轮请求照常发出并成功。
  const [next] = await settled(h.send({ url: URL, share: true }));
  expect(next!.ok).toBe(true);
  expect(h.net.calls("get", URL)).toBe(2);
});
