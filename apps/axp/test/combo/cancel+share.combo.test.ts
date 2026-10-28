import { beforeEach, expect, it, vi } from "vitest";
import axpCache, { clearCache } from "../../src/plugins/cache";
import axpShare from "../../src/plugins/share";
import { AXP_KINDS, type AxpResponse } from "../../src/response";
import type { AxpPlugin } from "../../src/types";
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
  const plugins = [axpShare(), ...(withCache ? [axpCache()] : [])];
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
  expect(h.calls[0].signal!.aborted).toBe(true);
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

/** 放在 share 内层（source 阶段、内置之后）的观察插件：记录它在内层看到的取消信号。 */
function innerObserver() {
  const seen: { /** 内层看到的信号。 */ signal: AbortSignal; /** 进入内层时是否已中止。 */ before: boolean; /** 内层等到结果后是否已中止。 */ after?: boolean }[] = [];
  const plugin: AxpPlugin<AxpResponse> = {
    name: "inner-observer",
    stage: "source",
    enforce: "post",
    async handle(ctx, next) {
      const record = { signal: ctx.signal, before: ctx.signal.aborted, after: undefined as boolean | undefined };
      seen.push(record);
      const response = await next();
      record.after = ctx.signal.aborted;
      return response;
    },
  };
  return { plugin, seen };
}

it("[cancel.req.signal × share.opt.policy] share 之内的 source 插件看到的是共享请求自己的信号：首发取消不连累跟随者在内层的处理", async () => {
  const calls: IWireCall[] = [];
  const { plugin, seen } = innerObserver();
  const h = sourceClient([axpShare(), plugin], {}, signalAdapter(calls));
  const leader = new AbortController();
  const first = h.send({ url: URL, share: true, signal: leader.signal });
  const follower = h.send({ url: URL, share: true });
  await vi.advanceTimersByTimeAsync(1);
  leader.abort();
  await vi.runAllTimersAsync();
  const [a, b] = await Promise.all([first, follower]);
  expect(a.kind).toBe(AXP_KINDS.CANCEL);
  expect(b.ok).toBe(true);
  expect(seen).toHaveLength(1);
  expect(seen[0].signal).toBe(calls[0].signal);
  expect(seen[0].signal).not.toBe(leader.signal);
  expect(seen[0]).toMatchObject({ before: false, after: false });
});

it("[cancel.req.signal × share.opt.policy] 全部订阅者都取消后，内层看到共享请求被中止；之后的新请求开启新一轮，内层信号重新是未中止的", async () => {
  const calls: IWireCall[] = [];
  const { plugin, seen } = innerObserver();
  const h = sourceClient([axpShare(), plugin], {}, signalAdapter(calls));
  const one = new AbortController();
  const two = new AbortController();
  const pending = [h.send({ url: URL, share: true, signal: one.signal }), h.send({ url: URL, share: true, signal: two.signal })];
  await vi.advanceTimersByTimeAsync(1);
  one.abort();
  two.abort();
  await vi.runAllTimersAsync();
  const results = await Promise.all(pending);
  expect(results.map((r) => r.kind)).toEqual([AXP_KINDS.CANCEL, AXP_KINDS.CANCEL]);
  expect(seen[0].after).toBe(true);
  const [fresh] = await Promise.all([h.send({ url: URL, share: true }), vi.runAllTimersAsync()]);
  expect(fresh.ok).toBe(true);
  expect(seen).toHaveLength(2);
  expect(seen[1]).toMatchObject({ before: false, after: false });
});
