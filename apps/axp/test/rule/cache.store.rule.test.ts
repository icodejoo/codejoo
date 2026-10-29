import { beforeEach, expect, it, vi } from "vitest";
import axpCache, { clearCache, removeCache } from "../../src/plugins/cache";
import { AxpResponse, axpResponse, isAxpResponse, type AxpResponseInit } from "../../src/response";
import { createTestClient } from "../helpers/client";
import { asyncCacheStore, countingCacheStore, envelope, requestRecorder, sourceClient } from "../helpers/source";

/** 存储有效期统一使用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

/** 缓存请求地址。 */
const URL = "/store";
/** 显式缓存键。 */
const KEY = "snapshot";
/** 固定请求选项。 */
const REQUEST = { url: URL, cache: { key: KEY }, wrap: true } as const;

/** 推进假网络计时器后取得落定结果。 */
async function settled<T>(pending: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return pending;
}

it("[cache.req.cache] 每次命中重建 R，使用当前请求并共享未 clone 的 data", async () => {
  const recorder = requestRecorder("pre");
  const h = sourceClient([recorder.plugin, axpCache()]);
  h.net.on("get", URL, () => envelope({ value: 1 }));
  const miss = await settled(h.send(REQUEST));
  const first = await settled(h.send({ ...REQUEST, headers: { caller: "one" } }));
  const second = await settled(h.send({ ...REQUEST, headers: { caller: "two" } }));
  expect(new Set([miss, first, second]).size).toBe(3);
  expect(first.request).toBe(recorder.seen[1]);
  expect(second.request).toBe(recorder.seen[2]);
  expect(second.request.headers).toMatchObject({ caller: "two" });
  expect(first.data).toBe(miss.data);
  expect(second.data).toBe(first.data);
  expect(first.raw).toBeUndefined();
  expect(first.error).toBeUndefined();
  expect(isAxpResponse(first)).toBe(true);
  expect(h.net.totalStarted).toBe(1);
});

/** 自定义响应同时包含数据字段与函数。 */
class SnapshotResponse extends AxpResponse {
  /** 追踪标识。 */
  traceId = "";
  /** 自有函数不能持久化。 */
  callback = () => "function";
  /** 覆盖成功判定，验证命中恢复 getter。 */
  get ok(): boolean {
    return this.code === 200;
  }
}

it("[cache.opt.store][core.fn.axpResponse] 扩展字段经 JSON 快照及 init 保留，不存基础引用、函数、符号或不可枚举字段", async () => {
  const { store, entries } = asyncCacheStore();
  const create = vi.fn(
    /** 网络结果取头，命中取 init；额外附加只允许排除的成员。 */ (init, raw) => {
      const response = Object.assign(new SnapshotResponse(init), { traceId: (init as AxpResponseInit<SnapshotResponse> & { traceId?: string }).traceId ?? String(raw?.headers["x-trace-id"] ?? "") });
      Object.defineProperty(response, "hidden", { value: "hidden" });
      Object.defineProperty(response, Symbol("symbol"), { value: "symbol", enumerable: true });
      return response;
    },
  ) satisfies NonNullable<Parameters<typeof axpResponse<SnapshotResponse>>[0]["create"]>;
  const h = createTestClient<SnapshotResponse>([axpCache<SnapshotResponse>({ store })], { response: axpResponse<SnapshotResponse>({ create }) });
  h.net.on("get", URL, () => ({ data: { code: 200, data: { value: 1 } }, headers: { "x-trace-id": "trace" } }));
  const miss = await settled(h.api.request(REQUEST));
  const hit = await settled(h.api.request(REQUEST));
  expect(hit).toBeInstanceOf(SnapshotResponse);
  expect(hit).not.toBe(miss);
  expect(hit).toMatchObject({ traceId: "trace", ok: true, status: 200 });
  expect(create.mock.calls[1][0]).toMatchObject({ traceId: "trace" });
  expect(create.mock.calls[1][1]).toBeUndefined();
  expect(entries.get(KEY)!.snapshot).toEqual({ code: 200, message: "", data: { value: 1 }, status: 200, extra: { traceId: "trace" } });
  h.api.dispose();
});

it("[cache.opt.store][cache.fn.removeCache][cache.fn.clearCache] 异步仓命中与未命中正常，管理 API 和辅助函数返回 Promise", async () => {
  const { store, entries } = asyncCacheStore();
  const cache = axpCache({ store });
  const h = sourceClient([cache]);
  h.net.on("get", URL, (_config, hit) => envelope(hit));
  expect((await settled(h.send(REQUEST))).data).toBe(1);
  expect((await settled(h.send(REQUEST))).data).toBe(1);
  const api = h.api.plugin(cache)!;
  const missing = api.remove("missing");
  expect(missing).toBeInstanceOf(Promise);
  expect(await missing).toBe(false);
  const removed = removeCache(h.api, KEY);
  expect(removed).toBeInstanceOf(Promise);
  expect(await removed).toBe(true);
  expect((await settled(h.send(REQUEST))).data).toBe(2);
  const cleared = clearCache(h.api);
  expect(cleared).toBeInstanceOf(Promise);
  expect(await cleared).toBe(1);
  expect(await api.clear()).toBe(0);
  expect(entries.size).toBe(0);
  expect((await settled(h.send(REQUEST))).data).toBe(3);
});

it.each([true, false])("[cache.method.api] clear 无返回值时回退到清空前 size，未提供 size 时记零（size=%s）", async (hasSize) => {
  const { store, entries } = countingCacheStore();
  const cache = axpCache({ store: { ...store, size: hasSize ? 7 : undefined } });
  const h = sourceClient([cache]);
  h.net.on("get", URL, () => envelope(1));
  await settled(h.send(REQUEST));
  expect(h.api.plugin(cache)!.clear()).toBe(hasSize ? 7 : 0);
  expect(entries.size).toBe(0);
});

it("[cache.opt.store] 默认响应快照没有 extra，也没有 raw、request、stack、error", async () => {
  const { store, entries } = countingCacheStore();
  const h = sourceClient([axpCache({ store })]);
  h.net.on("get", URL, () => envelope(1));
  await settled(h.send(REQUEST));
  expect(Object.keys(entries.get(KEY)!.snapshot).toSorted()).toEqual(["code", "data", "failure", "message", "reason", "status"]);
});

it("[cache.opt.store] 同步 get 的命中重建与未命中发网均不增加微任务", async () => {
  const { store, entries } = countingCacheStore();
  const create = vi.fn(/** 工厂调用时序用于确认命中同步快路径。 */ (init) => new AxpResponse(init));
  const h = createTestClient([axpCache({ store })], { response: axpResponse({ create }) });
  h.net.on("get", URL, () => envelope(1));
  entries.set(KEY, { snapshot: { status: 200, message: "", data: 7 }, expiresAt: 100 });
  const hit = h.api.request(REQUEST);
  expect(create).toHaveBeenCalledOnce();
  expect(h.net.totalStarted).toBe(0);
  expect((await hit).data).toBe(7);
  entries.clear();
  const miss = h.api.request(REQUEST);
  expect(h.net.totalStarted).toBe(1);
  expect((await settled(miss)).data).toBe(1);
  h.api.dispose();
});
