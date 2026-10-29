import { failureOf, messageOf } from "../../src/response";
/* eslint-disable no-await-in-loop -- 排空假时钟必须逐轮串行推进，并行没有意义。 */
import { AxiosHeaders, type AxiosAdapter } from "axios";
import { expect, vi } from "vitest";
import type { AxpContext } from "../../src/context";
import { AXP_STAGES } from "../../src/pipeline";
import { AXP_FAILURES, type AxpResponse, type IAxpResponse } from "../../src/response";
import type { AxpClient, AxpOptions, AxpPlugin, AxpRequestConfig, AxpStage } from "../../src/types";
import { assertInvariants, createTestClient, recordEvents, type ITestEvents } from "./client";
import type { makeNetwork } from "./network";

/** 逻辑请求在请求头里的标识名，I7 用它把同一逻辑请求的各次发送归组。 */
export const REQUEST_TAG_HEADER = "x-invariant-request";
/** 请求标识的前缀，拼上发起序号即为完整标识。 */
const REQUEST_TAG_PREFIX = "req-";
/** 探针插件名前缀，区别于内置的 axp: 前缀。 */
const PROBE_PREFIX = "probe";
/** 排空假时钟的最大轮数，防止自我重排的定时器造成死循环。 */
const DRAIN_ROUNDS = 20;
/** 探针的两个挂载位置，对应阶段内 enforce 的 pre / post。 */
const PROBE_POSITIONS = ["pre", "post"] as const;
/** 默认的请求地址前缀，调用方没给 url 时用发起序号补全。 */
const DEFAULT_URL_PREFIX = "/invariant/";

/** 计数加一，缺省从 0 起。 */
function bump<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

// ───────────────────────── I3：信号监听追踪 ─────────────────────────

/** 信号上登记的一条监听。 */
interface ISignalListenerRecord {
  /** 事件类型。 */ type: string;
  /** 回调引用。 */ listener: unknown;
  /** 是否捕获阶段，与类型、回调一起决定监听身份。 */ capture: boolean;
  /** 是否一次性监听。 */ once: boolean;
}
/** 监听追踪器：知道某个信号上还剩多少有效监听。 */
export interface ISignalListenerTracker {
  /** 仍有效的监听数；一次性监听在信号已中止后视为已触发并自动释放。 */
  live(): number;
  /** 还原信号原本的 addEventListener / removeEventListener。 */
  restore(): void;
}

/** 从 add/remove 的 options 参数里取出捕获与一次性标志。 */
function listenerFlags(options?: boolean | AddEventListenerOptions): {
  capture: boolean;
  once: boolean;
} {
  if (typeof options === "boolean") return { capture: options, once: false };
  return { capture: options?.capture ?? false, once: options?.once ?? false };
}

/** 包装信号的监听注册与注销，统计残留监听（I3）。
 * @param signal 要追踪的信号，调用方 signal 与逻辑请求 signal 都适用。
 * @returns 追踪器；用完调用 restore 还原信号。
 * @example `const tracker = trackSignalListeners(ac.signal); … expect(tracker.live()).toBe(0)`
 */
export function trackSignalListeners(signal: AbortSignal): ISignalListenerTracker {
  const records: ISignalListenerRecord[] = [];
  const add = signal.addEventListener.bind(signal) as (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void;
  const remove = signal.removeEventListener.bind(signal) as (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void;
  /** 按类型、回调、捕获标志找已登记的监听。 */
  const indexOf = (type: string, listener: unknown, capture: boolean) => records.findIndex((item) => item.type === type && item.listener === listener && item.capture === capture);
  Object.defineProperty(signal, "addEventListener", {
    configurable: true,
    writable: true,
    /** 与 DOM 一致：同身份的监听重复注册只算一条。 */
    value(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      const { capture, once } = listenerFlags(options);
      if (indexOf(type, listener, capture) < 0) records.push({ type, listener, capture, once });
      add(type, listener, options);
    },
  });
  Object.defineProperty(signal, "removeEventListener", {
    configurable: true,
    writable: true,
    /** 注销时同步删掉登记，没登记过的注销忽略。 */
    value(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
      const index = indexOf(type, listener, listenerFlags(options).capture);
      if (index >= 0) records.splice(index, 1);
      remove(type, listener, options);
    },
  });
  return {
    live: () => records.filter(/** 一次性监听在中止后已被事件循环摘除。 */ (item) => !(item.once && signal.aborted)).length,
    /** 删除自有属性，回到原型上的原始方法。 */
    restore() {
      Reflect.deleteProperty(signal, "addEventListener");
      Reflect.deleteProperty(signal, "removeEventListener");
    },
  };
}

/** 断言一批追踪器上都没有残留监听（I3）。
 * @param trackers 追踪器集合。
 * @param label 失败时说明监听挂在哪类信号上。
 * @example `assertSignalsReleased(chain.signals.values(), '逻辑请求 signal')`
 */
export function assertSignalsReleased(trackers: Iterable<ISignalListenerTracker>, label: string): void {
  for (const tracker of trackers) expect(tracker.live(), `${label}上有残留监听`).toBe(0);
}

// ───────────────────────── I6：next 探针 ─────────────────────────

/** 探针汇总：同时承担 I1（内核侧进出）、I3（逻辑 signal）和 I6（next 不拒绝）的观测。 */
export interface IChainProbe {
  /** 十个探针插件：每个阶段的 pre 与 post 各一个，直接并入 plugins。 */
  plugins: AxpPlugin<any>[];
  /** 各探针位置经手的 next 次数，用来确认探针确实挂在链上。 */
  calls: Map<string, number>;
  /** 最外层探针看到的、每个逻辑请求（按 ctx.id）进入管线的次数。 */
  entered: Map<number, number>;
  /** 最外层探针看到的、每个逻辑请求拿到响应的次数。 */
  exited: Map<number, number>;
  /** 链上出现过的 internal 响应所带的原始异常；脚本化流程里应为空。 */
  internalErrors: unknown[];
  /** 逻辑请求 signal 的监听追踪，按 ctx.id 索引。 */
  signals: Map<number, ISignalListenerTracker>;
}

/** 生成探针插件名。 */
function probeName(stage: AxpStage, position: (typeof PROBE_POSITIONS)[number]): string {
  return `${PROBE_PREFIX}:${stage}:${position}`;
}

/** 在每个阶段的 pre/post 位置各挂一个探针，记录 next 是否拒绝（I6）。
 * 探针本身不改请求和响应；next 一旦拒绝，累加 events.rejectedNext 并按 internal 收口，不让异常扩散。
 * 最外层探针额外记录每个逻辑请求的进出次数（I1）并追踪逻辑 signal 的监听（I3）。
 * @param events 事件记录，rejectedNext 由探针累加。
 * @returns 探针插件及观测数据。
 * @example `const chain = createChainProbe(events); createTestClient([...chain.plugins, ...plugins])`
 */
export function createChainProbe(events: ITestEvents): IChainProbe {
  const probe: IChainProbe = {
    plugins: [],
    calls: new Map(),
    entered: new Map(),
    exited: new Map(),
    internalErrors: [],
    signals: new Map(),
  };
  const seen = new WeakSet<object>();
  const outermost = probeName(AXP_STAGES[0], "pre");
  for (const stage of AXP_STAGES) {
    for (const enforce of PROBE_POSITIONS) {
      const name = probeName(stage, enforce);
      probe.plugins.push({
        name,
        stage,
        enforce,
        /** 透传 next；拒绝计入 I6，internal 响应只记一次。 */
        async handle(ctx, next) {
          bump(probe.calls, name);
          if (name === outermost) {
            bump(probe.entered, ctx.id);
            if (!probe.signals.has(ctx.id)) probe.signals.set(ctx.id, trackSignalListeners(ctx.signal));
          }
          let response: IAxpResponse;
          try {
            response = await next();
          } catch (error) {
            events.rejectedNext++;
            return ctx.fail({ failure: AXP_FAILURES.INTERNAL, error });
          }
          if (failureOf(response)?.type === AXP_FAILURES.INTERNAL && !seen.has(response)) {
            seen.add(response);
            probe.internalErrors.push(failureOf(response)?.error);
          }
          if (name === outermost) bump(probe.exited, ctx.id);
          return response;
        },
      });
    }
  }
  return probe;
}

/** 断言 next 从不拒绝，且脚本化流程里没有任何层抛出 bug（I6）。
 * @param chain 探针汇总。
 * @param events 事件记录。
 * @example `assertNextNeverRejects(chain, events)`
 */
export function assertNextNeverRejects(chain: IChainProbe, events: ITestEvents): void {
  expect(events.rejectedNext, "next() 不应 reject").toBe(0);
  // internal 不是 reject，但在受控流程里出现就说明某层抛了异常。
  expect(chain.internalErrors, "链上不应出现 internal 响应").toEqual([]);
}

// ───────────────────────── I1：逻辑请求落定 ─────────────────────────

/** 一次由测试发起的逻辑请求。 */
export interface ILogicalRequest {
  /** 发起序号，同时是 events.settled 的键。 */
  readonly id: number;
  /** 写在请求头里的标识，I7 据此归组各次发送。 */
  readonly tag: string;
  /** 请求使用的调用方 signal，可用来中途 abort。 */
  readonly signal: AbortSignal;
  /** 落定方式；尚未落定为 undefined。 */
  outcome?: "resolved" | "rejected";
  /** 落定值：成功是包装后的响应；失败是抛出的对象（可预期失败即 R）。 */
  value?: unknown;
  /** 落定后兑现，永不拒绝。 */
  readonly done: Promise<void>;
}

/** 断言每个已发起的逻辑请求恰好落定一次，且内核侧每个进入管线的请求恰好拿到一次响应（I1）。
 * @param requests 测试发起的逻辑请求。
 * @param events 事件记录，settled 由 launch 维护。
 * @param chain 探针汇总。
 * @example `assertSettledOnce(h.requests, h.events, h.chain)`
 */
export function assertSettledOnce(requests: readonly ILogicalRequest[], events: ITestEvents, chain: IChainProbe): void {
  for (const request of requests) {
    expect(events.settled.get(request.id), `逻辑请求 ${request.tag} 应恰好落定一次（0 表示一直没落定）`).toBe(1);
  }
  for (const [id, count] of chain.entered) {
    expect(count, `ctx.id=${id} 进入管线次数`).toBe(1);
    expect(chain.exited.get(id), `ctx.id=${id} 拿到响应的次数`).toBe(1);
  }
}

// ───────────────────────── I4：通知计数 ─────────────────────────

/** 按逻辑请求计数的通知回调。 */
export interface INotifyRecorder<R extends IAxpResponse = AxpResponse> {
  /** 记入当前逻辑请求的通知次数。 */
  notify(message: string, response: R): void;
  /** 与默认规则一致（成功、取消、silent 不通知），同时标记当前逻辑请求。 */
  stringify(response: R, ctx: AxpContext<R>): string;
}

/** 建立以 ctx.id 为身份的通知记录器（I4）。
 * 不能用响应对象或 response.request.signal 区分请求：share 的跟随者拿到的是首发的同一个响应。
 * notify 插件在同一同步段内先调 stringify 再调 notify，所以用 stringify 标记身份、notify 计数是安全的。
 * @param events 事件记录，notify 按 ctx.id 累计。
 * @returns 传给 axpNotify 的 notify 与 stringify。
 * @example `axpNotify(createNotifyRecorder(events))`
 */
export function createNotifyRecorder<R extends IAxpResponse = AxpResponse>(events: ITestEvents): INotifyRecorder<R> {
  let current = 0;
  return {
    /** 通知落在最近一次 stringify 标记的逻辑请求上。 */
    notify() {
      bump(events.notify, current);
    },
    /** 标记身份并复刻默认的跳过规则。 */
    stringify(response, ctx) {
      current = ctx.id;
      if (response.ok || failureOf(response)?.type === AXP_FAILURES.CANCEL || ctx.request.silent) return "";
      return messageOf(response) || failureOf(response)?.type || "status " + response.status + (response.code !== 0 ? " code " + response.code : "");
    },
  };
}

// ───────────────────────── I5：刷新次数 ─────────────────────────

/** 包装 onRefresh，按"刷新轮"统计调用次数（I5）。
 * 一轮 = 从没有刷新在跑到再次没有刷新在跑之间的全部调用；单飞刷新要求每轮只有一次。
 * @param events 事件记录，refresh 按轮次累计。
 * @param onRefresh 真正的刷新实现。
 * @returns 与原函数同参数的包装，作为 auth 的 onRefresh 使用。
 * @example `axpAuth({ onRefresh: countRefresh(events, async () => { tm.set('t1') }) })`
 */
export function countRefresh<A extends unknown[], T>(events: ITestEvents, onRefresh: (...args: A) => T): (...args: A) => Promise<Awaited<T>> {
  let round = 0;
  let inflight = 0;
  return /** 进入时登记所属轮次，结束后释放在途计数。 */ async (...args: A): Promise<Awaited<T>> => {
    if (inflight === 0) round++;
    inflight++;
    bump(events.refresh, round);
    try {
      return await onRefresh(...args);
    } finally {
      inflight--;
    }
  };
}

// ───────────────────────── I7：重发请求体一致 ─────────────────────────

/** 假 adapter 收到的一次发送。 */
export interface IRecordedSend {
  /** 逻辑请求标识；不是经 launch 发起的请求为 undefined。 */
  tag: string | undefined;
  /** 请求方法。 */
  method: string | undefined;
  /** 实际发送的地址。 */
  url: string | undefined;
  /** 经 axios 转换后的请求体。 */
  data: unknown;
}

/** 包装 adapter，把每次发送记进 sends（I7）。
 * @param inner 取得真正 adapter 的函数；延迟取值，便于先造 adapter 再造网络。
 * @param sends 接收记录的数组。
 * @returns 记录后转交 inner 的 adapter。
 * @example `recordSends(() => net.adapter, sends)`
 */
export function recordSends(inner: () => AxiosAdapter, sends: IRecordedSend[]): AxiosAdapter {
  return /** 先记账再转发，转发失败也已留痕。 */ (config) => {
    const tag = AxiosHeaders.from(config.headers).get(REQUEST_TAG_HEADER);
    sends.push({
      tag: typeof tag === "string" ? tag : undefined,
      method: config.method,
      url: config.url,
      data: config.data,
    });
    return inner()(config);
  };
}

/** 断言同一逻辑请求的各次发送请求体一致（I7）。
 * @param sends 全部发送记录。
 * @example `assertSendsConsistent(h.sends)`
 */
export function assertSendsConsistent(sends: readonly IRecordedSend[]): void {
  const first = new Map<string, IRecordedSend>();
  for (const send of sends) {
    if (send.tag === undefined) continue;
    const base = first.get(send.tag);
    if (base) expect(send.data, `逻辑请求 ${send.tag} 重发的请求体应与首发一致`).toEqual(base.data);
    else first.set(send.tag, send);
  }
}

// ───────────────────────── 组装 ─────────────────────────

/** 排空假时钟：反复执行全部定时器并冲刷微任务，直到没有待触发的定时器。
 * 须在 `vi.useFakeTimers()` 之后调用，不做任何真实等待。
 * @example `await drainTimers()`
 */
export async function drainTimers(): Promise<void> {
  for (let round = 0; round < DRAIN_ROUNDS; round++) {
    await vi.runAllTimersAsync();
    // 空推进只为冲刷微任务；微任务里可能又排了新定时器。
    await vi.advanceTimersByTimeAsync(0);
    if (vi.getTimerCount() === 0) return;
  }
}

/** 组装选项。 */
export interface IInvariantHarnessOptions<R extends IAxpResponse> {
  /** 共享的事件记录；插件回调需要提前绑定观测时先建好再传入。 */
  events?: ITestEvents;
  /** 传给 createAxp 的内核选项；不要带 axios，否则发送记录失效（I7）。 */
  options?: AxpOptions<R>;
  /** 是否挂载 next 探针，默认挂载；需要核对 inspect() 顺序的用例可以关掉。 */
  probes?: boolean;
}
/** 带全套不变量观测的测试夹具。 */
export interface IInvariantHarness<R extends IAxpResponse = AxpResponse> {
  /** 被测客户端。 */
  api: AxpClient<unknown, R>;
  /** 假网络，用 on/fallback 配路由。 */
  net: ReturnType<typeof makeNetwork>;
  /** 事件记录。 */
  events: ITestEvents;
  /** next 探针汇总。 */
  chain: IChainProbe;
  /** 假 adapter 收到的全部发送。 */
  sends: IRecordedSend[];
  /** 已发起的逻辑请求。 */
  requests: ILogicalRequest[];
  /** 发起一个逻辑请求并登记落定与监听；不会抛错，结果看返回记录。 */
  launch(config?: AxpRequestConfig): ILogicalRequest;
  /** 排空假时钟并冲刷微任务。 */
  drain(): Promise<void>;
  /** 一次性检查 I1–I7；调用前应先 drain。 */
  assertAll(): void;
  /** 还原信号并销毁客户端。 */
  dispose(): void;
}

/** 建立带 I1–I7 观测的夹具：假网络 + 探针 + 发送记录 + 逻辑请求登记。
 * @param plugins 被测插件。
 * @param config 事件记录、内核选项与探针开关。
 * @returns 夹具；用完调用 dispose。
 * @example
 * ```ts
 * vi.useFakeTimers();
 * const h = createInvariantHarness([axpLoading({ loading })]);
 * h.launch({ url: '/ok' });
 * await h.drain();
 * h.assertAll();
 * h.dispose();
 * ```
 */
export function createInvariantHarness<R extends IAxpResponse = AxpResponse>(plugins: readonly AxpPlugin<R, any>[] = [], config: IInvariantHarnessOptions<R> = {}): IInvariantHarness<R> {
  const events = config.events ?? recordEvents();
  const chain = createChainProbe(events);
  const sends: IRecordedSend[] = [];
  let network: AxiosAdapter | undefined;
  const fixture = createTestClient<R>(
    [...(config.probes === false ? [] : chain.plugins), ...plugins],
    config.options,
    recordSends(/** 假网络建好后才有 adapter，调用时再取。 */ () => network!, sends),
  );
  network = fixture.net.adapter;
  const { api } = fixture;
  const requests: ILogicalRequest[] = [];
  const userSignals = new Map<AbortSignal, ISignalListenerTracker>();
  /** 逻辑 signal 与调用方 signal 上仍有效的监听总数。 */
  const liveListeners = () => [...chain.signals.values(), ...userSignals.values()].reduce((sum, tracker) => sum + tracker.live(), 0);
  return {
    api,
    net: fixture.net,
    events,
    chain,
    sends,
    requests,
    /** 登记落定计数与监听追踪后发起请求。 */
    launch(request = {}) {
      const id = requests.length + 1;
      const tag = `${REQUEST_TAG_PREFIX}${id}`;
      const signal = request.signal ?? new AbortController().signal;
      if (!userSignals.has(signal)) userSignals.set(signal, trackSignalListeners(signal));
      events.settled.set(id, 0);
      const record: ILogicalRequest = {
        id,
        tag,
        signal,
        done: api
          .request({
            url: `${DEFAULT_URL_PREFIX}${id}`,
            ...request,
            signal,
            headers: new AxiosHeaders(request.headers as ConstructorParameters<typeof AxiosHeaders>[0]).set(REQUEST_TAG_HEADER, tag),
            wrap: true,
          })
          .then(
            /** 成功落定。 */ (value) => settle("resolved", value),
            /** 失败落定，包括 internal 抛出的原始异常。 */ (error: unknown) => settle("rejected", error),
          ),
      };
      /** 每次落定计一次；同一逻辑请求重复落定会让 I1 失败。 */
      function settle(outcome: "resolved" | "rejected", value: unknown): void {
        bump(events.settled, id);
        record.outcome = outcome;
        record.value = value;
      }
      requests.push(record);
      return record;
    },
    drain: drainTimers,
    /** 先用带说明的断言报错，再交给既有 assertInvariants 复核 I2–I6 的原始记录。 */
    assertAll() {
      assertSettledOnce(requests, events, chain);
      assertSignalsReleased(chain.signals.values(), "逻辑请求 signal");
      assertSignalsReleased(userSignals.values(), "调用方 signal");
      assertNextNeverRejects(chain, events);
      assertSendsConsistent(sends);
      events.listeners = liveListeners();
      assertInvariants(api as unknown as AxpClient, events);
    },
    /** 先还原信号，再销毁客户端。 */
    dispose() {
      for (const tracker of [...chain.signals.values(), ...userSignals.values()]) tracker.restore();
      api.dispose();
    },
  };
}
