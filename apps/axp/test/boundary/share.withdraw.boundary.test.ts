import { failureOf } from "../../src/response";
import { AxiosError } from "axios";
import { beforeEach, expect, it, vi } from "vitest";
import axpShare, { type SharePolicy } from "../../src/plugins/share";
import { AXP_FAILURES } from "../../src/response";
import { envelope, settleAll, signalAdapter, sourceClient, type IWireCall } from "../helpers/source";

/** 撤回、响应到达和超时的顺序统一由假时钟控制。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 同一轮共享的接口。 */
const URL = "/withdraw";
/** 较早完成的请求延迟。 */
const SHORT = 10;
/** 较晚完成的请求延迟。 */
const LONG = 40;
/** 被测试的两种独立发送策略。 */
const POLICIES = ["end", "race"] as const;

/** 创建记录响应归属的共享客户端，假网络会在完成时才处理取消。 */
function client(policy: SharePolicy) {
  const h = sourceClient([axpShare({ policy })]);
  h.net.on("get", URL, /** 用发送序号识别响应归属。 */ (_config, hit) => envelope(hit));
  return h;
}

it("[share.opt.policy][share.req.share] end 最新者撤回时更早请求仍在途，回退并等待其自身结果", async () => {
  const h = client("end");
  const controller = new AbortController();
  const received = vi.fn();
  const first = h.send({ url: URL, share: true, latency: LONG } as never).then(received);
  const latest = h.send({ url: URL, share: true, latency: SHORT, signal: controller.signal } as never);
  controller.abort();
  await vi.advanceTimersByTimeAsync(SHORT);
  expect(failureOf(await latest)?.type).toBe(AXP_FAILURES.CANCEL);
  expect(received).not.toHaveBeenCalled();
  await settleAll(first);
  expect(received).toHaveBeenCalledWith(expect.objectContaining({ data: 1, ok: true }));
  const [fresh] = await settleAll(h.send({ url: URL, share: true }));
  expect(fresh.data).toBe(3);
});

it.each([
  [SHORT, SHORT * 2],
  [SHORT * 2, SHORT],
])("[share.opt.policy] end 最新者撤回，按序号保留最近的已完成结果（延迟 %s/%s）", async (firstDelay, secondDelay) => {
  const h = client("end");
  const controller = new AbortController();
  const first = h.send({ url: URL, share: true, latency: firstDelay } as never);
  const second = h.send({ url: URL, share: true, latency: secondDelay } as never);
  const latest = h.send({ url: URL, share: true, latency: LONG, signal: controller.signal } as never);
  await vi.advanceTimersByTimeAsync(SHORT * 2);
  controller.abort();
  const [a, b, c] = await settleAll(first, second, latest);
  expect(a).toBe(b);
  expect(a.data).toBe(2);
  expect(failureOf(c)?.type).toBe(AXP_FAILURES.CANCEL);
  const [fresh] = await settleAll(h.send({ url: URL, share: true }));
  expect(fresh.data).toBe(4);
});

it("[share.opt.policy] end 最新者撤回时，即使已有较新结果也优先等待更早的在途请求", async () => {
  const h = client("end");
  const controller = new AbortController();
  const first = h.send({ url: URL, share: true, latency: LONG * 2 } as never);
  const second = h.send({ url: URL, share: true, latency: SHORT } as never);
  const latest = h.send({ url: URL, share: true, latency: LONG, signal: controller.signal } as never);
  controller.abort();
  await vi.advanceTimersByTimeAsync(LONG);
  expect(failureOf(await latest)?.type).toBe(AXP_FAILURES.CANCEL);
  await vi.advanceTimersByTimeAsync(LONG);
  expect((await first).data).toBe(1);
  expect((await second).data).toBe(1);
  // 落定后新请求必须开启新轮次。
  const fresh = h.send({ url: URL, share: true, latency: LONG * 2 } as never);
  await vi.advanceTimersByTimeAsync(LONG);
  const follower = h.send({ url: URL, share: true, latency: LONG * 2 } as never);
  const [a, b] = await settleAll(fresh, follower);
  expect(a).toBe(b);
  expect(a.data).toBe(5);
});

it.each(POLICIES)("[share.opt.policy][share.req.share] %s 全部撤回都得到 cancel，之后同 key 重新发送", async (policy) => {
  const calls: IWireCall[] = [];
  const h = sourceClient([axpShare({ policy })], {}, signalAdapter(calls));
  const one = new AbortController();
  const two = new AbortController();
  const first = h.send({ url: URL, share: true, signal: one.signal });
  const second = h.send({ url: URL, share: true, signal: two.signal });
  two.abort();
  await vi.advanceTimersByTimeAsync(0);
  one.abort();
  const results = await settleAll(first, second);
  expect(results.map(/** 只检查各自取消结果。 */ (r) => failureOf(r)?.type)).toEqual([AXP_FAILURES.CANCEL, AXP_FAILURES.CANCEL]);
  const [fresh] = await settleAll(h.send({ url: URL, share: true }));
  expect(fresh.ok).toBe(true);
  expect(calls).toHaveLength(3);
});

it("[share.opt.policy] race 一个 500 后最后完成者撤回，其余调用方得到未撤回的 500", async () => {
  const h = client("race");
  h.net.on("get", URL, /** 首发失败，取消的后发不应覆盖它。 */ () => ({ status: 500 }));
  const controller = new AbortController();
  const first = h.send({ url: URL, share: true, latency: SHORT } as never);
  const last = h.send({ url: URL, share: true, latency: LONG, signal: controller.signal } as never);
  await vi.advanceTimersByTimeAsync(SHORT);
  controller.abort();
  const [failure, cancelled] = await settleAll(first, last);
  expect(failureOf(failure)?.type).toBe(undefined);
  expect(failure.status).toBe(500);
  expect(failure.ok).toBe(false);
  expect(failureOf(cancelled)?.type).toBe(AXP_FAILURES.CANCEL);
  h.net.on("get", URL, /** 清表后恢复正常响应。 */ () => envelope("fresh"));
  const [fresh] = await settleAll(h.send({ url: URL, share: true }));
  expect(fresh.data).toBe("fresh");
  expect(h.net.calls("get", URL)).toBe(3);
});

it("[share.opt.policy][core.method.cancelAll] race cancelAll 令全部请求取消并清表", async () => {
  const h = client("race");
  const first = h.send({ url: URL, share: true, latency: SHORT } as never);
  const last = h.send({ url: URL, share: true, latency: LONG } as never);
  expect(h.api.cancelAll()).toBe(2);
  const results = await settleAll(first, last);
  expect(results.map(/** 两个订阅者都以取消告终。 */ (r) => failureOf(r)?.type)).toEqual([AXP_FAILURES.CANCEL, AXP_FAILURES.CANCEL]);
  expect(h.api.pending()).toBe(0);
  const [fresh] = await settleAll(h.send({ url: URL, share: true }));
  expect(fresh.data).toBe(3);
});

it.each(POLICIES)("[share.opt.policy] %s 超时不算撤回：订阅者计时退出后，其请求仍正常参与", async (policy) => {
  const h = client(policy);
  h.net.on(
    "get",
    URL,
    /** 已超时离开的订阅者，其请求仍可提供胜出的成功响应。 */ (config, hit) => {
      expect(config.signal!.aborted).toBe(false);
      return hit === 1 ? { status: 500 } : envelope(hit);
    },
  );
  const first = h.send({ url: URL, share: true, latency: LONG * 2 } as never);
  const timedOut = h.send({ url: URL, share: true, timeout: SHORT, latency: LONG } as never);
  await vi.advanceTimersByTimeAsync(SHORT);
  expect(failureOf(await timedOut)?.type).toBe(AXP_FAILURES.TIMEOUT);
  const [a] = await settleAll(first);
  expect(a.ok).toBe(true);
  expect(a.data).toBe(2);
  const [fresh] = await settleAll(h.send({ url: URL, share: true }));
  expect(fresh.ok).toBe(true);
  expect(h.net.calls("get", URL)).toBe(3);
});

it.each(POLICIES)("[share.opt.policy] %s axios 层的 timeout 是真实结果，照常参与共享", async (policy) => {
  const h = client(policy);
  h.net.on(
    "get",
    URL,
    /** 在传输边界模拟 axios 超时错误。 */ () => {
      throw new AxiosError("adapter timeout", AxiosError.ETIMEDOUT);
    },
  );
  const [a, b] = await settleAll(h.send({ url: URL, share: true, latency: SHORT } as never), h.send({ url: URL, share: true, latency: LONG } as never));
  expect(a).toBe(b);
  expect(failureOf(a)?.type).toBe(AXP_FAILURES.TIMEOUT);
  h.net.on("get", URL, /** 超时收尾后下一轮可以重新成功。 */ () => envelope("fresh"));
  const [fresh] = await settleAll(h.send({ url: URL, share: true }));
  expect(fresh.data).toBe("fresh");
});

it.each(POLICIES)("[share.opt.policy] %s 未中止自身 signal 的 cancel 响应不是撤回", async (policy) => {
  const h = sourceClient([
    axpShare({ policy }),
    {
      name: "inner-cancel",
      stage: "source",
      /** 返回取消响应，但不取消调用方信号。 */
      async handle(ctx) {
        return ctx.fail({ failure: AXP_FAILURES.CANCEL });
      },
    },
  ]);
  const [a, b] = await settleAll(h.send({ url: URL, share: true }), h.send({ url: URL, share: true }));
  expect(a).toBe(b);
  expect(failureOf(a)?.type).toBe(AXP_FAILURES.CANCEL);
});
