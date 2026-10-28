import { beforeEach, expect, it, vi } from "vitest";
import axpShare, { type ISharedOptions } from "../../src/plugins/share";
import { AXP_KINDS, type AxpResponse } from "../../src/response";
import type { AxpPlugin } from "../../src/types";
import { customResponse, TestResponse } from "../helpers/client";
import {
  customSourceClient,
  envelope,
  signalAdapter,
  sourceClient,
  trackAbortListeners,
  type IWireCall,
} from "../helpers/source";

/** 共享边界依赖精确的超时与到达顺序，统一用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 被共享的接口。 */
const URL = "/shared";
/** 较短的订阅者超时。 */
const SHORT = 20;
/** 较长的订阅者超时。 */
const LONG = 40;
/** 装好 share 与会响应取消的适配器。 */
function signalClient(options: ISharedOptions = {}) {
  const calls: IWireCall[] = [];
  const h = sourceClient([axpShare<AxpResponse>(options)], {}, signalAdapter(calls));
  return { ...h, calls };
}
/** 推进假时钟直到所有请求落定。 */
async function settled<T>(...pending: Promise<T>[]): Promise<T[]> {
  await vi.runAllTimersAsync();
  return Promise.all(pending);
}

it("[share.opt.policy][share.fn.subscribe] start 首发取消只结束自己，跟随者仍拿到结果，底层信号不是首发的也不被中止", async () => {
  const h = signalClient();
  const leader = new AbortController();
  const a = h.send({ url: URL, share: true, signal: leader.signal });
  const b = h.send({ url: URL, share: true });
  leader.abort();
  const [first, second] = await settled(a, b);
  expect(first.kind).toBe(AXP_KINDS.CANCEL);
  expect(second.ok).toBe(true);
  expect(second.data).toBe("done-1");
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0]!.signal).not.toBe(leader.signal);
  expect(h.calls[0]!.signal!.aborted).toBe(false);
});

it("[share.opt.policy][share.fn.subscribe] start 全部订阅者都取消才中止底层，新请求开启新一轮", async () => {
  const h = signalClient();
  const one = new AbortController();
  const two = new AbortController();
  const a = h.send({ url: URL, share: true, signal: one.signal });
  const b = h.send({ url: URL, share: true, signal: two.signal });
  one.abort();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.calls[0]!.signal!.aborted).toBe(false);
  two.abort();
  const [first, second] = await settled(a, b);
  expect([first.kind, second.kind]).toEqual([AXP_KINDS.CANCEL, AXP_KINDS.CANCEL]);
  expect(h.calls[0]!.signal!.aborted).toBe(true);
  const [fresh] = await settled(h.send({ url: URL, share: true }));
  expect(fresh!.data).toBe("done-2");
  expect(h.calls).toHaveLength(2);
});

it("[share.opt.policy] start 首发取消后新来的订阅者仍复用同一个请求", async () => {
  const h = signalClient();
  const leader = new AbortController();
  const a = h.send({ url: URL, share: true, signal: leader.signal });
  const b = h.send({ url: URL, share: true });
  leader.abort();
  await vi.advanceTimersByTimeAsync(1);
  const late = h.send({ url: URL, share: true });
  const [first, second, third] = await settled(a, b, late);
  expect(first.kind).toBe(AXP_KINDS.CANCEL);
  expect(second).toBe(third);
  expect(second.data).toBe("done-1");
  expect(h.calls).toHaveLength(1);
});

it("[share.fn.axpShare] 到达共享层时逻辑信号已中止：直接 cancel，不创建条目也不触网", async () => {
  const h = signalClient();
  const controller = new AbortController();
  h.api.use({
    name: "abort-first",
    stage: "prepare",
    /** 在 prepare 阶段中止调用方信号，再交给内层。 */
    async handle(_ctx, next) {
      controller.abort();
      return next();
    },
  });
  const r = await h.send({ url: URL, share: true, signal: controller.signal });
  expect(r.kind).toBe(AXP_KINDS.CANCEL);
  expect(h.calls).toHaveLength(0);
});

it("[share.fn.subscribe] 跟随者按自己的 timeout 退出：它以 timeout 告终，首发与共享请求不受影响", async () => {
  const h = signalClient();
  const a = h.send({ url: URL, share: true });
  const b = h.send({ url: URL, share: true, timeout: SHORT });
  const [first, follower] = await settled(a, b);
  expect(follower.kind).toBe(AXP_KINDS.TIMEOUT);
  expect(follower.ok).toBe(false);
  expect(follower.message).toContain(`${SHORT}ms`);
  expect(first.data).toBe("done-1");
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0]!.signal!.aborted).toBe(false);
});

it("[share.fn.subscribe] 首发的 timeout 不连累跟随者：共享请求的 axios 超时被取消，跟随者没有超时就等到结果", async () => {
  const h = signalClient();
  const a = h.send({ url: URL, share: true, timeout: SHORT });
  const b = h.send({ url: URL, share: true });
  const [leader, follower] = await settled(a, b);
  expect(leader.kind).toBe(AXP_KINDS.TIMEOUT);
  expect(follower.data).toBe("done-1");
  expect(h.calls[0]!.timeout).toBe(0);
});

it("[share.fn.subscribe] 分批超时：只在全部订阅者都离开后才中止底层，新请求开启新一轮", async () => {
  const h = signalClient();
  const a = h.send({ url: URL, share: true, timeout: SHORT });
  const b = h.send({ url: URL, share: true, timeout: LONG });
  await vi.advanceTimersByTimeAsync(SHORT);
  expect(h.calls[0]!.signal!.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(LONG - SHORT);
  expect(h.calls[0]!.signal!.aborted).toBe(true);
  const [first, second] = await settled(a, b);
  expect([first.kind, second.kind]).toEqual([AXP_KINDS.TIMEOUT, AXP_KINDS.TIMEOUT]);
  const [fresh] = await settled(h.send({ url: URL, share: true }));
  expect(fresh!.data).toBe("done-2");
});

it("[share.fn.subscribe] 非法 timeout（NaN、负数）按无超时处理，不装计时器", async () => {
  const h = signalClient();
  const [a, b] = await settled(
    h.send({ url: URL, share: true, timeout: Number.NaN }),
    h.send({ url: URL, share: true, timeout: -1 }),
  );
  expect([a.ok, b.ok]).toEqual([true, true]);
});

it("[share.fn.subscribe] 订阅落定后清除计时器与 abort 监听（共享结果、取消、超时三种离开方式）", async () => {
  const listeners = trackAbortListeners();
  const h = sourceClient([axpShare<AxpResponse>()]);
  h.net.on("get", URL, () => envelope("x"));
  const cancel = new AbortController();
  const pending = [
    h.send({ url: URL, share: true, timeout: 1000, latency: 50 } as never),
    h.send({ url: URL, share: true, timeout: 1000, latency: 50, signal: cancel.signal } as never),
    h.send({ url: URL, share: true, timeout: 10 } as never),
  ];
  cancel.abort();
  const results = await settled(...pending);
  expect(results.map((r) => r.kind)).toEqual([AXP_KINDS.OK, AXP_KINDS.CANCEL, AXP_KINDS.TIMEOUT]);
  expect(listeners()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("[share.fn.$createEntry] 旧一轮迟到的结果不会落定或删除同 key 的新一轮", async () => {
  const h = sourceClient([axpShare<AxpResponse>()]);
  h.net.on("get", URL, (_config, hit) => envelope(`hit-${hit}`));
  const one = new AbortController();
  const first = h.send({ url: URL, share: true, latency: 30, signal: one.signal } as never);
  await vi.advanceTimersByTimeAsync(5);
  one.abort();
  await vi.advanceTimersByTimeAsync(5);
  // 第一轮全部离开后，适配器仍在途（假网络不响应 signal）；此时开启第二轮。
  const second = h.send({ url: URL, share: true, latency: 30 } as never);
  const third = h.send({ url: URL, share: true, latency: 30 } as never);
  const results = await settled(first, second, third);
  expect(results[0]!.kind).toBe(AXP_KINDS.CANCEL);
  expect(results[1]).toBe(results[2]);
  expect(results[1]!.data).toBe("hit-2");
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[share.method.lifecycle] 卸载后在途轮次的订阅者全部取消也能正常收尾", async () => {
  const h = signalClient();
  const one = new AbortController();
  const a = h.send({ url: URL, share: true, signal: one.signal });
  const b = h.send({ url: URL, share: true });
  expect(h.api.eject("axp:share")).toBe(true);
  one.abort();
  h.api.cancelAll();
  const [first, second] = await settled(a, b);
  expect([first.kind, second.kind]).toEqual([AXP_KINDS.CANCEL, AXP_KINDS.CANCEL]);
  expect(h.calls[0]!.signal!.aborted).toBe(true);
});

it("[share.fn.axpShare] 共享以一次尝试为单位：retry 在外层，每轮同 key 只发一次，各调用方重试时合并到新一轮", async () => {
  const retryOnce: AxpPlugin<AxpResponse> = {
    name: "retry-once",
    stage: "attempt",
    /** 测试用的单次重试：失败后再走一次内层。 */
    async handle(_ctx, next) {
      const first = await next();
      return first.ok ? first : next();
    },
  };
  const h = sourceClient([axpShare<AxpResponse>(), retryOnce]);
  h.net.on("get", URL, (_config, hit) => (hit === 1 ? { status: 500 } : envelope(`hit-${hit}`)));
  const [a, b] = await settled(
    h.send({ url: URL, share: true, latency: 10 } as never),
    h.send({ url: URL, share: true, latency: 10 } as never),
  );
  expect(h.net.calls("get", URL)).toBe(2);
  expect([a.ok, b.ok]).toEqual([true, true]);
  expect(a).toBe(b);
});

it("[share.opt.policy][share.fn.subscribe] end 与 race 的订阅者全部取消：各自以 cancel 收尾，没有共享控制器可中止", async () => {
  for (const policy of ["end", "race"] as const) {
    const h = sourceClient([axpShare<AxpResponse>({ policy })]);
    h.net.on("get", URL, () => envelope("x"));
    const one = new AbortController();
    const two = new AbortController();
    const a = h.send({ url: URL, share: true, latency: 20, signal: one.signal } as never);
    const b = h.send({ url: URL, share: true, latency: 20, signal: two.signal } as never);
    one.abort();
    two.abort();
    // oxlint-disable-next-line no-await-in-loop -- 两种策略依次核对，避免共用假网络。
    const [first, second] = await settled(a, b);
    expect([first.kind, second.kind]).toEqual([AXP_KINDS.CANCEL, AXP_KINDS.CANCEL]);
    // oxlint-disable-next-line no-await-in-loop -- 取消后同 key 的新请求应重新开始。
    const [fresh] = await settled(h.send({ url: URL, share: true }));
    expect(fresh!.ok).toBe(true);
  }
});

it("[share.fn.axpShare] 自定义 R：share 合成的取消与超时响应也带扩展字段", async () => {
  const h = customSourceClient<TestResponse>([axpShare<TestResponse>()], {
    response: customResponse(),
  });
  h.net.on("get", URL, () => envelope("x"));
  const controller = new AbortController();
  const [cancelled, timedOut, shared] = await Promise.all([
    h.send({ url: URL, share: true, latency: 50, signal: controller.signal } as never),
    h.send({ url: URL, share: true, timeout: 10 } as never),
    h.send({ url: URL, share: true } as never),
    Promise.resolve()
      .then(() => controller.abort())
      .then(() => vi.runAllTimersAsync()),
  ]);
  expect([cancelled, timedOut, shared].every((r) => r instanceof TestResponse)).toBe(true);
  expect([cancelled.kind, timedOut.kind, shared.kind]).toEqual([
    AXP_KINDS.CANCEL,
    AXP_KINDS.TIMEOUT,
    AXP_KINDS.OK,
  ]);
});

it("[share.method.lifecycle] 重名 use 被拒绝；eject 重复调用安全，卸载后可用同一插件对象重装", async () => {
  const plugin = axpShare<AxpResponse>();
  const h = sourceClient([plugin]);
  h.net.on("get", URL, () => envelope("x"));
  expect(() => h.api.use(plugin)).toThrow(/Duplicate plugin/);
  expect(h.api.eject("axp:share")).toBe(true);
  expect(h.api.eject("axp:share")).toBe(false);
  h.api.use(plugin);
  await settled(h.send({ url: URL, share: true }), h.send({ url: URL, share: true }));
  expect(h.net.calls("get", URL)).toBe(1);
});

it.each(["start", "end", "race"] as const)(
  "[share.opt.policy][share.fn.axpShare] %s：整轮内层都出现程序 bug 时所有订阅者拿到原始异常，条目不残留，修复后下一次请求恢复正常",
  async (policy) => {
    const bug = new Error("inner bug");
    let armed = true;
    const bomb: AxpPlugin<AxpResponse> = {
      name: "bomb",
      stage: "source",
      enforce: "post",
      /** 武装期间每次都抛出程序异常。 */
      async handle(_ctx, next) {
        if (armed) throw bug;
        return next();
      },
    };
    const h = sourceClient([axpShare<AxpResponse>({ policy }), bomb]);
    h.net.on("get", URL, () => envelope("ok"));
    const caught = [
      h.send({ url: URL, share: true }).catch((error: unknown) => error),
      h.send({ url: URL, share: true }).catch((error: unknown) => error),
    ];
    await vi.runAllTimersAsync();
    expect(await Promise.all(caught)).toEqual([bug, bug]);
    armed = false;
    const [again] = await settled(h.send({ url: URL, share: true }));
    expect(again!.ok).toBe(true);
  },
);

it("[share.opt.policy] end 与 race 中只有部分调用撞上程序 bug：订阅者仍拿到成功结果，不被个别尝试的 bug 连累", async () => {
  for (const policy of ["end", "race"] as const) {
    let armed = true;
    const bomb: AxpPlugin<AxpResponse> = {
      name: "bomb",
      stage: "source",
      enforce: "post",
      /** 只让第一次调用抛出程序异常。 */
      async handle(_ctx, next) {
        if (armed) {
          armed = false;
          throw new Error("one attempt bug");
        }
        return next();
      },
    };
    const h = sourceClient([axpShare<AxpResponse>({ policy }), bomb]);
    h.net.on("get", URL, () => envelope("ok"));
    // oxlint-disable-next-line no-await-in-loop -- 两种策略依次核对。
    const [a, b] = await settled(
      h.send({ url: URL, share: true }),
      h.send({ url: URL, share: true }),
    );
    expect([a!.ok, b!.ok]).toEqual([true, true]);
  }
});

it("[share.fn.subscribe] 首发在订阅前被内层同步取消，以 cancel 落定，不会漏掉 abort 而返回 ok", async () => {
  const controller = new AbortController();
  /** 排在 share 内层、同步取消调用方的中间件，模拟同步的 axios 请求拦截器。 */
  const aborter: AxpPlugin<AxpResponse> = {
    name: "sync-aborter",
    stage: "source",
    enforce: "post",
    handle(_ctx, next) {
      controller.abort();
      return next();
    },
  };
  const h = sourceClient([axpShare<AxpResponse>(), aborter]);
  h.net.on("get", "/shared-abort", () => envelope("ok"));
  const response = h.send({ url: "/shared-abort", share: true, signal: controller.signal });
  await vi.runAllTimersAsync();
  expect((await response).kind).toBe(AXP_KINDS.CANCEL);
});
