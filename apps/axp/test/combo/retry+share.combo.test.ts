import { beforeEach, expect, it, vi } from "vitest";
import axpRetry from "../../src/plugins/retry";
import axpShare from "../../src/plugins/share";
import { AXP_KINDS, type AxpResponse } from "../../src/response";
import { failure } from "../helpers/b3";
import { envelope, settleAll, sourceClient } from "../helpers/source";

/** 被共享且可重试的接口。 */
const URL = "/pets";
/** 并发调用方数量。 */
const CALLERS = 5;
/** 一轮网络往返的延迟，让同一轮的调用方都停在共享条目上。 */
const LATENCY = 10;
/** 重试等待时长：上一轮落定后，要等这么久才开始下一轮。 */
const DELAY = 10;
/** 服务端故障的 HTTP 状态。 */
const HTTP_ERROR = 500;
/** 前这么多次发送故障，其后恢复。 */
const FAILED_SENDS = 1;
/** 不开 share 的并发调用方数量。 */
const NO_SHARE_CALLERS = 2;
/** 一次重试预算，足以覆盖"首发失败，第二轮成功"。 */
const ONE_RETRY = 1;
/** 两次重试预算，足以覆盖"耗尽"。 */
const TWO_RETRIES = 2;
/** 首发失败再重试成功，共两轮。 */
const ROUNDS_AFTER_RETRY = 2;
/** 成功时的响应数据。 */
const DATA = "ok";
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 装好 retry 与 share；counter 站在 retry 之内，统计每个调用方进入的尝试轮数。 */
function client(max: number) {
  const attempts = vi.fn();
  const h = sourceClient([
    axpRetry<AxpResponse>({ max, delay: DELAY }),
    axpShare<AxpResponse>(),
    {
      name: "attempt-count",
      stage: "attempt",
      /** 位于 retry 之内，每个调用方每轮尝试进入一次。 */
      handle: (_ctx, next) => {
        attempts();
        return next();
      },
    },
  ]);
  return { ...h, attempts };
}
/** 同 key 并发发出调用方请求。 */
function burst(h: ReturnType<typeof client>, count = CALLERS) {
  return Array.from({ length: count }, () =>
    h.send({ url: URL, share: true, latency: LATENCY } as never),
  );
}

it.each([false, true])(
  "[retry.opt.max × share.req.share] 并发同 key：每一轮尝试只发一次网络请求，重试时各调用方重新合并到新一轮共享，最终拿到同一个结果（business=%s）",
  /** 共享以一次尝试为单位，retry 在 share 外层。 */ async (business) => {
    const h = client(ONE_RETRY);
    h.net.on(
      "get",
      URL,
      /** 第一轮失败，第二轮成功。 */ (_config, hit) =>
        hit <= FAILED_SENDS ? failure(HTTP_ERROR, business) : envelope(DATA),
    );
    const results = await settleAll(...burst(h));
    expect(results.every(/** 全部成功。 */ (r) => r.ok)).toBe(true);
    expect(new Set(results).size).toBe(1);
    expect(h.net.totalStarted).toBe(ROUNDS_AFTER_RETRY);
    expect(h.attempts).toHaveBeenCalledTimes(CALLERS * ROUNDS_AFTER_RETRY);
    // 两轮不重叠：第一轮落定之后第二轮才开始，说明每轮各自合并，而不是复用同一个条目。
    const [first, second] = h.net.log;
    expect(first!.finishedAt).toBeLessThan(second!.startedAt);
  },
);

it("[retry.opt.max × share.req.share] 重试耗尽：每轮仍只发一次（共 max+1 次），所有调用方拿到同一个失败结果", /** 失败结果也是共享的。 */ async () => {
  const h = client(TWO_RETRIES);
  h.net.on("get", URL, /** 一直失败。 */ () => failure(HTTP_ERROR));
  const results = await settleAll(...burst(h));
  expect(h.net.totalStarted).toBe(TWO_RETRIES + 1);
  expect(h.attempts).toHaveBeenCalledTimes(CALLERS * (TWO_RETRIES + 1));
  expect(results.map(/** 取类别。 */ (r) => r.kind)).toEqual(Array(CALLERS).fill(AXP_KINDS.HTTP));
  expect(new Set(results).size).toBe(1);
  expect(results[0]).toMatchObject({ ok: false, status: HTTP_ERROR });
});

it("[retry.opt.max × share.req.share] 请求级 share:false 在每次重试里都保留：各调用方各发各的，没有合并（承接旧用例）", /** 重试各轮读到的仍是同一份请求级开关。 */ async () => {
  const h = client(ONE_RETRY);
  h.net.on(
    "get",
    URL,
    /** 各调用方的首发都失败，其后成功。 */ (_config, hit) =>
      hit <= NO_SHARE_CALLERS ? failure(HTTP_ERROR) : envelope(DATA),
  );
  const results = await settleAll(
    ...Array.from({ length: NO_SHARE_CALLERS }, () =>
      h.send({ url: URL, share: false, latency: LATENCY } as never),
    ),
  );
  expect(results.every(/** 全部成功。 */ (r) => r.ok)).toBe(true);
  expect(h.net.totalStarted).toBe(NO_SHARE_CALLERS * ROUNDS_AFTER_RETRY);
});

it.each([
  // 退避窗口里取消：首发调用方没有进入第二轮，其余调用方各进两轮。
  ["重试等待期间", DELAY / 2, (CALLERS - 1) * ROUNDS_AFTER_RETRY + 1],
  // 第二轮在途时取消：首发调用方已进入第二轮，所以每个调用方都是两轮。
  ["第二轮共享在途时", DELAY + 1, CALLERS * ROUNDS_AFTER_RETRY],
] as const)(
  "[retry.opt.max × share.req.share][cancel.fn.cancelAll] %s首发调用方取消：只有它以 cancel 告终，其余调用方照常合并到同一轮并成功",
  /** 取消只离开自己，不连累共享，也不影响别人的重试。 */ async (_label, abortAfter, attempts) => {
    const h = client(ONE_RETRY);
    h.net.on(
      "get",
      URL,
      /** 第一轮失败，第二轮成功。 */ (_config, hit) =>
        hit <= FAILED_SENDS ? failure(HTTP_ERROR) : envelope(DATA),
    );
    const leader = new AbortController();
    const pending = [
      h.send({ url: URL, share: true, latency: LATENCY, signal: leader.signal } as never),
      ...burst(h, CALLERS - 1),
    ];
    // 第一轮在 LATENCY 时落定，退避到 LATENCY + DELAY；取消时刻相对第一轮落定计算。
    await vi.advanceTimersByTimeAsync(LATENCY + abortAfter);
    leader.abort();
    const results = await settleAll(...pending);
    expect(results[0]).toMatchObject({ kind: AXP_KINDS.CANCEL, ok: false });
    const followers = results.slice(1);
    expect(followers.every(/** 其余全部成功。 */ (r) => r.ok)).toBe(true);
    expect(new Set(followers).size).toBe(1);
    expect(h.net.totalStarted).toBe(ROUNDS_AFTER_RETRY);
    expect(h.attempts).toHaveBeenCalledTimes(attempts);
  },
);
