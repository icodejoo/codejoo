import { beforeEach, expect, it, vi } from "vitest";
import axpCache from "../../src/plugins/cache";
import type { IAxpFreshnessBarrier } from "../../src/plugins/cache-store";
import { envelope, sourceClient } from "../helpers/source";

/** 记录本文件每个缓存实例创建的屏障，用来白盒检查记录是否收敛。 */
const created = vi.hoisted(() => ({ barriers: [] as IAxpFreshnessBarrier[] }));
vi.mock("../../src/plugins/cache-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/plugins/cache-store")>();
  return {
    ...actual,
    /** 与原实现一致，只是留一份引用供测试探测。 */
    createFreshnessBarrier: () => {
      const barrier = actual.createFreshnessBarrier();
      created.barriers.push(barrier);
      return barrier;
    },
  };
});

/** 每个用例从干净的屏障列表开始，并用假时钟控制到达顺序。 */
beforeEach(() => {
  created.barriers.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

/** 被缓存的接口。 */
const URL = "/cached";
/** 探测用票据：序号最小、没有经历过清理。记录不存在时可写，残留任何已写入记录时不可写。 */
const PROBE_TICKET = 1;

/** 装好 cache，返回客户端与它的屏障。 */
function cachedClient(max?: number) {
  const h = sourceClient([axpCache({ max })]);
  h.net.on("get", URL, (_config, hit) => envelope(`hit-${hit}`));
  return { ...h, barrier: created.barriers[0] };
}
/** 发出请求并推进假时钟直到落定。 */
async function call(h: ReturnType<typeof cachedClient>, config: Record<string, unknown>) {
  const pending = h.send({ url: URL, ...config }).catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  return pending;
}

it("[cache.fn.axpCache][cache.method.barrier] 请求结束后屏障不残留记录：写入、拒绝写入、判定抛错与命中都一样", async () => {
  const bug = new Error("should-cache bug");
  const h = cachedClient();
  await call(h, { cache: { key: "written" } });
  await call(h, { cache: { key: "written" } });
  await call(h, { cache: { key: "rejected", shouldCache: () => false } });
  await call(h, {
    cache: {
      key: "throws",
      shouldCache: () => {
        throw bug;
      },
    },
  });
  for (const key of ["written", "rejected", "throws"]) {
    expect(h.barrier.canWrite(key, PROBE_TICKET)).toBe(true);
  }
});

it("[cache.fn.axpCache][cache.method.barrier] 在途期间保留写入序号（含条目被淘汰后），全部落定后回收", async () => {
  const h = cachedClient(1);
  const older = h.send({ url: URL, cache: { key: "k" }, latency: 50 } as never);
  await vi.advanceTimersByTimeAsync(1);
  const newer = h.send({ url: URL, cache: { key: "k" }, latency: 5 } as never);
  await vi.advanceTimersByTimeAsync(6);
  await newer;
  // 较新的请求已写入：在途的旧请求仍被挡住，记录必须还在。
  expect(h.barrier.canWrite("k", PROBE_TICKET)).toBe(false);
  // 容量为 1，另一个 key 的写入把 k 淘汰出缓存，屏障记录仍要保留。
  const other = h.send({ url: URL, cache: { key: "other" } });
  await vi.advanceTimersByTimeAsync(1);
  await other;
  expect(h.barrier.canWrite("k", PROBE_TICKET)).toBe(false);
  await vi.runAllTimersAsync();
  await older;
  expect(h.barrier.canWrite("k", PROBE_TICKET)).toBe(true);
  expect(h.barrier.canWrite("other", PROBE_TICKET)).toBe(true);
});
