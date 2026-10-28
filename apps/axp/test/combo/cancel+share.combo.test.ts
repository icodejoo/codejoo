import { beforeEach, expect, it, vi } from "vitest";
import axpCache, { clearCache } from "../../src/plugins/cache";
import axpShare from "../../src/plugins/share";
import { AXP_KINDS, type AxpResponse } from "../../src/response";
import { signalAdapter, sourceClient, trackAbortListeners, type IWireCall } from "../helpers/source";

/** 取消时序统一用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 被共享的接口。 */
const URL = "/shared";
/** 并发调用方数量。 */
const CALLERS = 5;

/** 装好 share（可带 cache）与会响应取消的适配器。 */
function client(withCache = false) {
  const calls: IWireCall[] = [];
  const plugins = [axpShare<AxpResponse>(), ...(withCache ? [axpCache<AxpResponse>()] : [])];
  const h = sourceClient(plugins, {}, signalAdapter(calls));
  return { ...h, calls };
}

it("[cancel.fn.cancelAll × share.opt.policy] cancelAll 让同 key 的全部订阅者以 cancel 告终，底层被中止，pending 与监听归零", async () => {
  const listeners = trackAbortListeners();
  const h = client();
  const pending = Array.from({ length: CALLERS }, () => h.send({ url: URL, share: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(h.api.pending()).toBe(CALLERS);
  expect(h.api.cancelAll("route changed")).toBe(CALLERS);
  await vi.runAllTimersAsync();
  const results = await Promise.all(pending);
  expect(results.map((r) => r.kind)).toEqual(Array(CALLERS).fill(AXP_KINDS.CANCEL));
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0]!.signal!.aborted).toBe(true);
  expect(h.api.pending()).toBe(0);
  expect(listeners()).toBe(0);
  const [fresh] = await Promise.all([h.send({ url: URL, share: true }), vi.runAllTimersAsync()]);
  expect(fresh.ok).toBe(true);
  expect(h.calls).toHaveLength(2);
});

it("[cancel.fn.cancelAll × share.opt.policy] 共享结果已落定后 cancelAll 返回 0，不影响已拿到的结果", async () => {
  const h = client();
  const pending = [h.send({ url: URL, share: true }), h.send({ url: URL, share: true })];
  await vi.runAllTimersAsync();
  const results = await Promise.all(pending);
  expect(h.api.cancelAll()).toBe(0);
  expect(results.every((r) => r.ok)).toBe(true);
  expect(results[1]).toBe(results[0]);
});

it("[cancel.fn.cancelAll × share.opt.policy × cache.req.cache] 被取消的共享结果不进缓存，之后的请求重新发送", async () => {
  const h = client(true);
  const pending = Array.from({ length: 3 }, () => h.send({ url: URL, share: true, cache: true }));
  await vi.advanceTimersByTimeAsync(1);
  h.api.cancelAll();
  await vi.runAllTimersAsync();
  await Promise.all(pending);
  expect(clearCache(h.api)).toBe(0);
  const [again] = await Promise.all([h.send({ url: URL, share: true, cache: true }), vi.runAllTimersAsync()]);
  expect(again.ok).toBe(true);
  expect(h.calls).toHaveLength(2);
});
