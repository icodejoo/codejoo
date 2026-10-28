import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AxpContext } from "../../src/context";
import axpNotify from "../../src/plugins/notify";
import { AXP_KINDS, AxpResponse } from "../../src/response";
import { AXP_STAGES } from "../../src/pipeline";
import type { AxpPlugin, AxpRequestConfig } from "../../src/types";
import { assertInvariants, createTestClient, recordEvents } from "../helpers/client";
import {
  REQUEST_TAG_HEADER,
  assertNextNeverRejects,
  countRefresh,
  createChainProbe,
  createInvariantHarness,
  createNotifyRecorder,
  drainTimers,
  trackSignalListeners,
  type INotifyRecorder,
  type IInvariantHarness,
  type IInvariantHarnessOptions,
} from "../helpers/invariants";

/** 探针位置总数：每个阶段的 pre 与 post。 */
const PROBE_COUNT = AXP_STAGES.length * 2;
/** 最外层探针的名字。 */
const OUTERMOST_PROBE = "probe:outer:pre";
/** 本文件里统一使用的 POST 地址。 */
const POST_URL = "/invariant/post";
/** 在途时间足够长的假网络请求，留出中途取消的窗口。 */
const SLOW = { latency: 50 } as AxpRequestConfig;
/** 空操作监听。 */
function noop(): void {}
/** 不挂任何请求的客户端，只用来满足 assertInvariants 的参数。 */
const { api: idle } = createTestClient([]);
/** 按 ctx.id 构造的上下文替身，notify 记录器只读 id 与 request.silent。 */
function ctxOf(id: number, silent = false): AxpContext<AxpResponse> {
  return { id, request: { silent } } as unknown as AxpContext<AxpResponse>;
}
/** 与 notify 插件相同的调用序列：先 stringify，非空再 notify。 */
function fire(
  recorder: INotifyRecorder,
  ctx: AxpContext<AxpResponse>,
  response: AxpResponse,
): void {
  const message = recorder.stringify(response, ctx);
  if (message) recorder.notify(message, response);
}
/** 在 attempt 阶段把请求发两次，第二次的请求体由 second 决定，模拟 retry 重放。 */
function replay(first: unknown, second: unknown): AxpPlugin<AxpResponse> {
  return {
    name: "replay",
    stage: "attempt",
    /** 两次 next 各带一份请求体补丁。 */
    async handle(ctx, next) {
      ctx.markReplayable();
      await next({ data: first });
      return next({ data: second });
    },
  };
}

/** 待回收的夹具。 */
const harnesses: IInvariantHarness[] = [];

/** 创建夹具并登记回收。 */
function harness(
  plugins: readonly AxpPlugin<AxpResponse, any>[] = [],
  config: IInvariantHarnessOptions<AxpResponse> = {},
): IInvariantHarness {
  const h = createInvariantHarness(plugins, config);
  harnesses.push(h);
  return h;
}

/** 假时钟下的自测，不做真实等待。 */
beforeEach(() => {
  vi.useFakeTimers();
});
/** 回收夹具并还原时钟。 */
afterEach(() => {
  for (const h of harnesses.splice(0)) h.dispose();
  vi.useRealTimers();
});

describe("[invariants.fn.createInvariantHarness] 无故障时通过 I1–I7", () => {
  it("请求落定一次、十个探针都经手、发送带标识", /** 正常路径的观测数据完整。 */ async () => {
    const h = harness();
    const request = h.launch({ url: "/ok" });
    await h.drain();
    h.assertAll();
    expect(request.outcome).toBe("resolved");
    expect(h.chain.signals.size).toBe(1);
    expect(h.chain.calls.size).toBe(PROBE_COUNT);
    expect(
      [...h.chain.calls.values()].every(/** 每个位置恰好经手一次。 */ (count) => count === 1),
    ).toBe(true);
    expect(h.sends.map(/** 取标识。 */ (send) => send.tag)).toEqual([request.tag]);
  });
  it("probes: false 时不挂探针", /** 需要核对 inspect 顺序的用例可关掉探针。 */ async () => {
    const h = harness([], { probes: false });
    expect(h.api.inspect()).toEqual([]);
    h.launch({ url: "/ok" });
    await h.drain();
    expect(h.chain.calls.size).toBe(0);
  });
});

describe("[invariants.fn.assertSettledOnce] I1", () => {
  it("请求一直不落定时报错，而不是挂起用例", /** 以排空后的落定计数判断，不等待请求本身。 */ async () => {
    const hang: AxpPlugin<AxpResponse> = {
      name: "hang",
      handle: /** 永不返回。 */ () => new Promise(noop),
    };
    const h = harness([hang]);
    h.launch({ url: "/ok" });
    await h.drain();
    expect(() => h.assertAll()).toThrow(/恰好落定一次/);
  });
});

describe("[invariants.fn.trackSignalListeners] I3", () => {
  it("同身份重复注册只算一条，注销后清零，restore 还原原型方法", /** 与 DOM 的去重语义一致。 */ () => {
    const signal = new AbortController().signal;
    const tracker = trackSignalListeners(signal);
    signal.addEventListener("abort", noop);
    signal.addEventListener("abort", noop);
    expect(tracker.live()).toBe(1);
    signal.addEventListener("abort", noop, true);
    expect(tracker.live()).toBe(2);
    signal.removeEventListener("abort", noop);
    signal.removeEventListener("abort", noop, true);
    expect(tracker.live()).toBe(0);
    tracker.restore();
    expect(Object.prototype.hasOwnProperty.call(signal, "addEventListener")).toBe(false);
  });
  it("一次性监听在信号中止后视为已释放", /** 事件触发时监听被自动摘除，不会调用 remove。 */ () => {
    const controller = new AbortController();
    const tracker = trackSignalListeners(controller.signal);
    controller.signal.addEventListener("abort", noop, { once: true });
    expect(tracker.live()).toBe(1);
    controller.abort();
    expect(tracker.live()).toBe(0);
  });
  it("逻辑请求 signal 上遗留监听时报错", /** 插件加了监听却没摘。 */ async () => {
    const leak: AxpPlugin<AxpResponse> = {
      name: "leak",
      /** 登记监听后不清理。 */ async handle(ctx, next) {
        ctx.signal.addEventListener("abort", noop);
        return next();
      },
    };
    const h = harness([leak]);
    h.launch({ url: "/ok" });
    await h.drain();
    expect(() => h.assertAll()).toThrow(/逻辑请求 signal/);
  });
  it("逻辑请求 signal 上成对注册注销，或一次性监听遇到取消，都不报错", /** 合规的清理方式。 */ async () => {
    const tidy: AxpPlugin<AxpResponse> = {
      name: "tidy",
      /** 成对注册注销，再挂一个遇取消才触发的一次性监听。 */ async handle(ctx, next) {
        ctx.signal.addEventListener("abort", noop);
        ctx.signal.removeEventListener("abort", noop);
        ctx.signal.addEventListener("abort", noop, { once: true });
        return next();
      },
    };
    const h = harness([tidy]);
    h.launch({ ...SLOW, url: "/ok" });
    await vi.advanceTimersByTimeAsync(10);
    h.api.cancelAll();
    await h.drain();
    expect(() => h.assertAll()).not.toThrow();
  });
  it("调用方 signal 上遗留监听时报错", /** launch 在发起前就已追踪该 signal。 */ async () => {
    const controller = new AbortController();
    const h = harness();
    h.launch({ url: "/ok", signal: controller.signal });
    controller.signal.addEventListener("abort", noop);
    await h.drain();
    expect(() => h.assertAll()).toThrow(/调用方 signal/);
  });
});

describe("[invariants.fn.createNotifyRecorder] I4", () => {
  /** 真实的失败响应：HTTP 500、无消息。 */
  const failure = new AxpResponse({ httpStatus: 500 });

  it("按逻辑请求分别计数：同一个响应对象被两个请求各通知一次不算重复", /** share 跟随者的场景。 */ () => {
    const events = recordEvents();
    const recorder = createNotifyRecorder(events);
    fire(recorder, ctxOf(1), failure);
    fire(recorder, ctxOf(2), failure);
    expect([...events.notify]).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(() => assertInvariants(idle, events)).not.toThrow();
  });
  it("同一个逻辑请求通知两次时 I4 失败", /** 重复通知被抓到。 */ () => {
    const events = recordEvents();
    const recorder = createNotifyRecorder(events);
    fire(recorder, ctxOf(1), failure);
    fire(recorder, ctxOf(1), failure);
    expect(() => assertInvariants(idle, events)).toThrow();
  });
  it("成功、取消、silent 不通知，其余用 message 或 kind+status", /** 与 notify 默认规则一致。 */ () => {
    const recorder = createNotifyRecorder(recordEvents());
    expect(recorder.stringify(new AxpResponse({ httpStatus: 200 }), ctxOf(1))).toBe("");
    expect(recorder.stringify(new AxpResponse({ kind: AXP_KINDS.CANCEL }), ctxOf(1))).toBe("");
    expect(recorder.stringify(failure, ctxOf(1, true))).toBe("");
    expect(recorder.stringify(failure, ctxOf(1))).toBe("http 500");
    expect(
      recorder.stringify(new AxpResponse({ httpStatus: 500, message: "boom" }), ctxOf(1)),
    ).toBe("boom");
  });
  it("接入真实 notify 插件：一个失败请求恰好记一次", /** 记录器与插件的调用顺序吻合。 */ async () => {
    const events = recordEvents();
    const h = harness([axpNotify<AxpResponse>(createNotifyRecorder(events))], { events });
    h.net.fallback(/** 恒失败。 */ () => ({ status: 500 }));
    h.launch({ url: "/fail", throws: false });
    await h.drain();
    h.assertAll();
    expect([...events.notify.values()]).toEqual([1]);
  });
});

describe("[invariants.fn.countRefresh] I5", () => {
  it("串行刷新各自成轮，每轮一次，通过", /** 两次刷新之间没有重叠。 */ async () => {
    const events = recordEvents();
    const refresh = countRefresh(events, async () => "ok");
    await refresh();
    await refresh();
    expect([...events.refresh]).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(() => assertInvariants(idle, events)).not.toThrow();
  });
  it("重叠刷新落在同一轮，I5 失败", /** 并发 401 却调了两次 onRefresh。 */ async () => {
    const events = recordEvents();
    let release!: () => void;
    const gate = new Promise<void>(/** 暂存放行函数。 */ (resolve) => (release = resolve));
    const refresh = countRefresh(events, () => gate);
    const first = refresh();
    const second = refresh();
    release();
    await Promise.all([first, second]);
    expect([...events.refresh]).toEqual([[1, 2]]);
    expect(() => assertInvariants(idle, events)).toThrow();
  });
  it("透传参数与返回值，刷新抛错时也释放在途计数", /** 失败的一轮不会吞掉下一轮。 */ async () => {
    const events = recordEvents();
    const refresh = countRefresh(events, async (value: number) => {
      if (value < 0) throw new Error("fail");
      return value * 2;
    });
    expect(await refresh(2)).toBe(4);
    await expect(refresh(-1)).rejects.toThrow("fail");
    expect(await refresh(1)).toBe(2);
    expect([...events.refresh.keys()]).toEqual([1, 2, 3]);
  });
});

describe("[invariants.fn.createChainProbe] I6", () => {
  /** 探针里不会用到的上下文替身：只有 id、signal 与 fail。 */
  const stubCtx = {
    id: 1,
    signal: new AbortController().signal,
    fail: /** 按初始化对象造响应。 */ (init: object) => ({ ...init }),
  } as unknown as AxpContext<AxpResponse>;

  it("next 拒绝时累加 rejectedNext，并以 internal 收口", /** 内核保证不会发生，这里直接给探针一个会拒绝的 next。 */ async () => {
    const events = recordEvents();
    const chain = createChainProbe(events);
    const outermost = chain.plugins.find(
      /** 找最外层探针。 */ (plugin) => plugin.name === OUTERMOST_PROBE,
    )!;
    const result = await outermost.handle!(stubCtx, () => Promise.reject(new Error("boom")));
    expect(result.kind).toBe(AXP_KINDS.INTERNAL);
    expect(events.rejectedNext).toBe(1);
    expect(() => assertNextNeverRejects(chain, events)).toThrow(/reject/);
  });
  it("next 同步抛错也算拒绝", /** 不是 Promise 的失败方式。 */ async () => {
    const events = recordEvents();
    const chain = createChainProbe(events);
    const outermost = chain.plugins.find(
      /** 找最外层探针。 */ (plugin) => plugin.name === OUTERMOST_PROBE,
    )!;
    await outermost.handle!(stubCtx, () => {
      throw new Error("sync");
    });
    expect(events.rejectedNext).toBe(1);
  });
  it("中间件抛错被内核转成 internal，探针记下原始异常，assertAll 报错", /** 受控流程里出现 internal 说明某层有 bug。 */ async () => {
    const boom = new Error("plugin bug");
    const buggy: AxpPlugin<AxpResponse> = {
      name: "buggy",
      /** 总是抛错。 */ handle: () => {
        throw boom;
      },
    };
    const h = harness([buggy]);
    const request = h.launch({ url: "/ok" });
    await h.drain();
    expect(request.outcome).toBe("rejected");
    expect(request.value).toBe(boom);
    expect(h.chain.internalErrors).toEqual([boom]);
    expect(() => h.assertAll()).toThrow(/internal/);
  });
});

describe("[invariants.fn.assertSendsConsistent] I7", () => {
  it("重发请求体与首发一致时通过，两次发送共用同一标识", /** 正常重放。 */ async () => {
    const h = harness([replay({ a: 1 }, { a: 1 })]);
    const request = h.launch({ method: "post", url: POST_URL });
    await h.drain();
    h.assertAll();
    expect(h.sends).toHaveLength(2);
    expect(h.sends.map(/** 取标识。 */ (send) => send.tag)).toEqual([request.tag, request.tag]);
  });
  it("重发请求体与首发不一致时报错", /** 重放时请求体被改动。 */ async () => {
    const h = harness([replay({ a: 1 }, { a: 2 })]);
    h.launch({ method: "post", url: POST_URL });
    await h.drain();
    expect(() => h.assertAll()).toThrow(/重发的请求体/);
  });
  it("不同逻辑请求之间请求体不同不算违规", /** 只比较同一标识。 */ async () => {
    const h = harness();
    h.launch({ method: "post", url: POST_URL, data: { a: 1 } });
    h.launch({ method: "post", url: POST_URL, data: { a: 2 } });
    await h.drain();
    expect(() => h.assertAll()).not.toThrow();
    expect(h.sends.map(/** 取标识。 */ (send) => send.tag)).toEqual(["req-1", "req-2"]);
  });
  it("调用方自带的同名标头会被覆盖为逻辑请求标识", /** 标识不可被调用方伪造。 */ async () => {
    const h = harness();
    const request = h.launch({ url: "/ok", headers: { [REQUEST_TAG_HEADER]: "forged" } });
    await h.drain();
    expect(h.sends[0].tag).toBe(request.tag);
  });
});

describe("[invariants.fn.drainTimers] 排空假时钟", () => {
  it("连续由微任务重排的定时器也会被排空", /** 定时器回调里又排了新的定时器。 */ async () => {
    const fired: number[] = [];
    setTimeout(
      /** 第一个定时器兑现后再排第二个。 */ () => {
        fired.push(1);
        queueMicrotask(
          /** 微任务里重排。 */ () => {
            setTimeout(/** 第二个定时器。 */ () => fired.push(2), 5);
          },
        );
      },
      5,
    );
    await drainTimers();
    expect(fired).toEqual([1, 2]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
