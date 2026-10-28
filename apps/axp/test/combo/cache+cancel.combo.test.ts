import { beforeEach, expect, it, vi } from "vitest";
import axpCache from "../../src/plugins/cache";
import { AXP_KINDS, type AxpResponse } from "../../src/response";
import { signalAdapter, sourceClient, type IWireCall } from "../helpers/source";

/** 取消时序统一用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 被缓存的接口。 */
const URL = "/pets";

/** 装好 cache 与会响应取消的适配器。 */
function client() {
  const calls: IWireCall[] = [];
  const h = sourceClient([axpCache<AxpResponse>()], {}, signalAdapter(calls));
  return { ...h, calls };
}

it("[cancel.fn.cancelAll × cache.req.cache] 命中缓存的请求不留下在途登记：pending 与 cancelAll 都是 0", async () => {
  const h = client();
  const first = h.send({ url: URL, cache: true });
  await vi.runAllTimersAsync();
  await first;
  const hit = await h.send({ url: URL, cache: true });
  expect(hit.ok).toBe(true);
  expect(h.api.pending()).toBe(0);
  expect(h.api.cancelAll()).toBe(0);
  expect(h.calls).toHaveLength(1);
});

it("[cancel.fn.cancelAll × cache.req.cache] 取消在途的未命中请求：以 cancel 告终，不写缓存，之后重新发送", async () => {
  const h = client();
  const pending = h.send({ url: URL, cache: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(h.api.cancelAll()).toBe(1);
  await vi.runAllTimersAsync();
  expect((await pending).kind).toBe(AXP_KINDS.CANCEL);
  const again = h.send({ url: URL, cache: true });
  await vi.runAllTimersAsync();
  expect((await again).ok).toBe(true);
  expect(h.calls).toHaveLength(2);
});
