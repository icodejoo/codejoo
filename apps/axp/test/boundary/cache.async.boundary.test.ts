import { AXP_FAILURE } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import axpCache, { clearCache, type IAxpCacheEntry } from "../../src/plugins/cache";
import type { AxpPlugin } from "../../src/types";
import { asyncCacheStore, envelope, sourceClient } from "../helpers/source";

/** 并发时序与有效期使用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

/** 显式缓存键。 */
const KEY = "async";
/** 网络请求地址。 */
const URL = "/async";
/** 缓存请求配置。 */
const REQUEST = { url: URL, cache: { key: KEY } } as const;
/** 存储错误。 */
const STORE_ERROR = new Error("store failed");

/** 手动控制一次等待，不依赖真实时间。 */
function gate() {
  let release!: () => void;
  const pending = new Promise<void>(
    /** 保存放行句柄。 */ (resolve) => {
      release = resolve;
    },
  );
  return { pending, release };
}

/** 建立首写可暂停的异步仓。 */
function queuedClient() {
  const { store, entries } = asyncCacheStore();
  const blocked = gate();
  const started = gate();
  const set = vi.fn(
    /** 首写暂停，后续写入立即完成。 */ async (key: string, entry: IAxpCacheEntry) => {
      if (set.mock.calls.length === 1) {
        started.release();
        await blocked.pending;
      }
      await store.set(key, entry);
    },
  );
  const h = sourceClient([axpCache({ store: { ...store, set } })]);
  h.net.on("get", URL, (_config, hit) => envelope(hit));
  return { ...h, entries, set, blocked, started };
}

/** 推进假网络计时器后取得落定结果。 */
async function settled<T>(pending: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return pending;
}

it("[cache.opt.store] 慢的旧写入先到，新的写入排队后覆盖旧结果", async () => {
  const h = queuedClient();
  const old = h.send(REQUEST);
  await vi.runAllTimersAsync();
  await h.started.pending;
  const fresh = h.send(REQUEST);
  await vi.runAllTimersAsync();
  expect(h.net.totalStarted).toBe(2);
  expect(h.set).toHaveBeenCalledTimes(1);
  h.blocked.release();
  expect((await old).data).toBe(1);
  expect((await fresh).data).toBe(2);
  expect(h.set).toHaveBeenCalledTimes(2);
  expect((await settled(h.send(REQUEST))).data).toBe(2);
});

it("[cache.opt.store] 新响应先写入，较慢返回的旧响应不能覆盖新结果", async () => {
  const { store, entries } = asyncCacheStore();
  const h = sourceClient([axpCache({ store })]);
  h.net.on("get", URL, (_config, hit) => envelope(hit));
  const old = h.send({ ...REQUEST, latency: 30 } as never);
  const fresh = h.send({ ...REQUEST, latency: 5 } as never);
  await vi.runAllTimersAsync();
  expect((await old).data).toBe(1);
  expect((await fresh).data).toBe(2);
  expect(entries.get(KEY)!.snapshot.data).toBe(2);
});

it.each(["clear", "dispose"] as const)("[cache.method.lifecycle] 写入排队期间 %s，队列中的写入被屏障挡住", async (action) => {
  const h = queuedClient();
  const old = h.send(REQUEST);
  await vi.runAllTimersAsync();
  await h.started.pending;
  const queued = h.send(REQUEST);
  await vi.runAllTimersAsync();
  if (action === "clear") expect(await clearCache(h.api)).toBe(0);
  else h.api.dispose();
  h.blocked.release();
  await Promise.all([old, queued]);
  expect(h.set).toHaveBeenCalledTimes(1);
  expect(h.entries.get(KEY)!.snapshot.data).toBe(1);
});

it.each(["get", "set", "delete", "clear"] as const)("[cache.opt.store] %s 同步抛错与 reject 被隔离且始终 console.error", async (method) => {
  const error = vi.spyOn(console, "error").mockImplementation(/** 屏蔽预期故障日志。 */ () => {});
  for (const async of [false, true]) {
    const { store, entries } = asyncCacheStore();
    entries.set(KEY, { snapshot: { status: 200, message: "", data: "expired" }, expiresAt: 0 });
    /** 分别模拟同步异常与异步拒绝。 */
    const fail = () => {
      if (async) return Promise.reject(STORE_ERROR);
      throw STORE_ERROR;
    };
    const h = sourceClient([axpCache({ store: { ...store, [method]: fail } })]);
    h.net.on("get", URL, () => envelope("network"));
    // oxlint-disable-next-line no-await-in-loop -- 依次核对同步和异步故障。
    expect((await settled(h.send(REQUEST))).data).toBe("network");
    if (method === "clear") {
      // oxlint-disable-next-line no-await-in-loop -- 依次核对管理 API。
      expect(await clearCache(h.api)).toBe(0);
    }
    expect(error).toHaveBeenLastCalledWith(`[axp:cache] ${method} failed`, STORE_ERROR);
  }
  expect(error).toHaveBeenCalledTimes(2);
  error.mockRestore();
});

it.each([false, true])("[cache.req.cache][core.req.signal] cache 前等待期间取消，放行后返回 cancel（异步 get=%s）", async (async) => {
  const { store, entries } = asyncCacheStore();
  const blocked = gate();
  const started = gate();
  const wait: AxpPlugin = {
    name: "wait-before-cache",
    stage: "source",
    enforce: "pre",
    /** 在 cache 之前停住，让调用方取消。 */
    async handle(_ctx, next) {
      started.release();
      await blocked.pending;
      return next();
    },
  };
  entries.set(KEY, { snapshot: { status: 200, code: 0, message: "", data: "hit" }, expiresAt: 100 });
  const h = sourceClient([wait, axpCache({ store: async ? store : { ...store, get: (key) => entries.get(key) } })]);
  const controller = new AbortController();
  const pending = h.send({ ...REQUEST, signal: controller.signal });
  await started.pending;
  controller.abort();
  blocked.release();
  expect(await pending).toMatchObject({ ok: false, [AXP_FAILURE]: { type: "cancel" } });
  expect(h.net.totalStarted).toBe(0);
});

it("[cache.opt.store][core.req.signal] 异步 get 挂起期间取消，返回命中后仍检查取消", async () => {
  const { store } = asyncCacheStore();
  const blocked = gate();
  const started = gate();
  const h = sourceClient([
    axpCache({
      store: {
        ...store,
        /** 等待取消后才交回命中。 */
        async get() {
          started.release();
          await blocked.pending;
          return { snapshot: { status: 200, message: "", data: "hit" }, expiresAt: 100 };
        },
      },
    }),
  ]);
  const controller = new AbortController();
  const pending = h.send({ ...REQUEST, signal: controller.signal });
  await started.pending;
  controller.abort();
  blocked.release();
  expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
  expect(h.net.totalStarted).toBe(0);
});
