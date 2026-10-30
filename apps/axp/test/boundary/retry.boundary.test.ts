import { failureOf } from "../../src/response";
/* eslint-disable no-await-in-loop -- 逐项推进假时钟以观测等待边界。 */
import { AxiosError } from "axios";
import { beforeEach, expect, it, vi } from "vitest";
import axpRetry, { type IRetryOptions } from "../../src/plugins/retry";
import { AxpResponse } from "../../src/response";
import type { AxpRequestConfig } from "../../src/types";
import { b3Client, POLLUTED_ONCE, pollutingBody, pollutingTransform, REQUEST_URL, run } from "../helpers/b3";

/** 延迟与封顶的观测窗口。 */
/** 断言回调末位收到当前请求的上下文。 */
const ctxOf = (url: string) => expect.objectContaining({ request: expect.objectContaining({ url }) });
const LOCAL_DELAY = 40;
const REMOTE_DELAY = 2000;
const CAP = 20;
/** 决策函数的原始故障。 */
const BUG = new Error("retry callback bug");
/** 等待测试使用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it.each(["cancel", "auth", "internal", "parse"] as const)(
  "[retry.priority.kind][retry.cb.shouldRetry] %s 永不调用 shouldRetry 或重试",
  /** 合成失败也经过内核异常边界。 */ async (kind) => {
    const shouldRetry = vi.fn(/** 不应覆盖失败类别否决。 */ () => true);
    const h = b3Client([axpRetry({ shouldRetry })]);
    const inner = vi.fn(/** 构造内核契约中的不可重试失败。 */ (ctx) => ctx.fail({ failure: kind, error: kind === "internal" ? BUG : undefined }));
    h.api.use({ name: "failure-kind", stage: "source", handle: inner });
    const pending = h.send().catch(/** 原始程序异常必须保留。 */ (error) => error);
    await vi.runAllTimersAsync();
    const result = await pending;
    if (kind === "internal") expect(result).toBe(BUG);
    else expect(failureOf(result)?.type).toBe(kind);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(shouldRetry).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "[retry.cb.delay][retry.req.retry.delay.callback][retry.cb.jitter] delay 参数与请求回调覆盖，请求级=%s",
  /** 回调看到一开始的次数、总预算和失败 R。 */ async (requestLevel) => {
    const fallback = vi.fn(/** 被请求覆盖时不调用。 */ () => REMOTE_DELAY);
    const delay = vi.fn(/** 指定本地等待时间。 */ () => LOCAL_DELAY);
    const jitter = vi.fn(/** 接收未经封顶的延迟。 */ (ms) => ms / 2);
    const h = b3Client([
      axpRetry({
        max: 1,
        delay: requestLevel ? fallback : delay,
        jitter: requestLevel ? undefined : jitter,
      }),
    ]);
    h.net.fallback(/** 每次相同失败。 */ () => ({ status: 500 }));
    const pending = h.send({ url: REQUEST_URL, retry: requestLevel ? { delay, jitter } : true });
    await vi.advanceTimersByTimeAsync(CAP - 1);
    expect(h.net.totalStarted).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    await pending;
    expect(h.net.totalStarted).toBe(2);
    expect(delay).toHaveBeenCalledWith(1, 1, expect.objectContaining({ status: 500 }), ctxOf(REQUEST_URL));
    expect(jitter).toHaveBeenCalledExactlyOnceWith(LOCAL_DELAY);
    if (requestLevel) expect(fallback).not.toHaveBeenCalled();
  },
);

it.each([
  ["delay", { delay: LOCAL_DELAY }, { delay: 0 }, 0],
  ["non-number", { delay: LOCAL_DELAY }, { delay: (): null => null }, 0],
  ["delayMax", { delay: LOCAL_DELAY }, { delayMax: 0 }, 0],
  ["jitter-zero", { delay: LOCAL_DELAY }, { jitter: true }, 0],
  ["jitter-half", { delay: LOCAL_DELAY, jitter: true }, {}, CAP],
  ["cap", { delay: REMOTE_DELAY }, { delayMax: CAP }, CAP],
  ["negative", { delay: -1 }, {}, 0],
  ["invalid-infinity", { delay: LOCAL_DELAY }, { jitter: (): number => Infinity }, LOCAL_DELAY],
  ["invalid-negative", { delay: LOCAL_DELAY }, { jitter: (): number => -1 }, LOCAL_DELAY],
  ["invalid-nan", { delay: LOCAL_DELAY }, { jitter: (): number => NaN }, LOCAL_DELAY],
  ["default-cap", { delay: Infinity }, {}, 10_000],
] as const)(
  "[retry.opt.delayMax][retry.req.retry.delay][retry.req.retry.jitter] %s 的实际等待",
  /** 零值不丢失，非法抖动回退原始值。 */ async (label, base, override, ms) => {
    vi.spyOn(Math, "random").mockReturnValue(label === "jitter-half" ? 0.5 : 0);
    const h = b3Client([axpRetry({ ...base, max: 1 } as IRetryOptions<AxpResponse>)]);
    h.net.fallback(/** 产生可重试错误。 */ () => ({ status: 500 }));
    const pending = h.send({ retry: override });
    if (ms > 0) {
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(h.net.totalStarted).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
    }
    await vi.runAllTimersAsync();
    await pending;
    expect(h.net.totalStarted).toBe(2);
  },
);

it.each(["delay", "jitter", "shouldRetry"] as const)(
  "[retry.callback.bug][retry.req.retry.shouldRetry][retry.req.retry.delay.callback][retry.req.retry.jitter.callback] %s 抛原始异常且不遗留 timer",
  /** 请求级判定优先，故障不回退插件策略。 */ async (field) => {
    const fallback = vi.fn(/** 不可回退。 */ () => false);
    const override = {
      [field]: /** 程序异常须由落定原样抛出。 */ () => {
        throw BUG;
      },
    };
    const h = b3Client([axpRetry({ delay: 0, shouldRetry: fallback })]);
    h.net.fallback(/** 首轮服务端错误。 */ () => ({ status: 500 }));
    const pending = h.send({ retry: { shouldRetry: () => true, ...override } }).catch(/** 尽早观察拒绝。 */ (error) => error);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(BUG);
    expect(fallback).not.toHaveBeenCalled();
    expect(h.net.totalStarted).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each([false, true])(
  "[retry.opt.respectRetryAfter][retry.opt.retryAfterMax][retry.opt.afterStatusCodes][retry.business.retryAfter] 数字秒优先且独立于本地上限，business=%s",
  /** Retry-After 不执行本地延迟与抖动，也不受 delayMax 影响。 */ async (business) => {
    const delay = vi.fn(/** 有合法服务端时间就不调用。 */ () => LOCAL_DELAY);
    const jitter = vi.fn(/** 服务端时间不叠加抖动。 */ () => 0);
    const h = b3Client([
      axpRetry({
        shouldRetry: business ? /** 使用者按业务码选择重试。 */ (r) => [408, 429, 500, 502, 503, 504].includes(Number(r.code)) : undefined,
        max: 1,
        delay,
        jitter,
        delayMax: 0,
        respectRetryAfter: business ? /** 使用者决定业务限流是否采信服务端时间。 */ (r) => r.code === 429 : true,
        afterStatusCodes: business ? [] : [429],
        retryAfterMax: REMOTE_DELAY,
      }),
    ]);
    h.net.fallback(
      /** 逻辑 429 可来自业务信封。 */ () => ({
        status: business ? 200 : 429,
        data: { code: business ? 429 : 0, data: null },
        headers: { "Retry-After": "2" },
      }),
    );
    const pending = h.send();
    await vi.advanceTimersByTimeAsync(REMOTE_DELAY - 1);
    expect(h.net.totalStarted).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    await pending;
    expect(h.net.totalStarted).toBe(2);
    expect(delay).not.toHaveBeenCalled();
    expect(jitter).not.toHaveBeenCalled();
  },
);

it("[retry.opt.respectRetryAfter] HTTP-date 按当前时钟计算", /** 日期头实际影响请求间隔。 */ async () => {
  vi.setSystemTime(new Date("2026-10-28T00:00:00Z"));
  const h = b3Client([axpRetry({ max: 1, delay: 0 })]);
  h.net.fallback(
    /** 服务端要求两秒后重试。 */ () => ({
      status: 503,
      headers: { "retry-after": new Date(Date.now() + REMOTE_DELAY).toUTCString() },
    }),
  );
  const pending = h.send();
  await vi.advanceTimersByTimeAsync(REMOTE_DELAY - 1);
  expect(h.net.totalStarted).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.runAllTimersAsync();
  await pending;
  expect(h.net.totalStarted).toBe(2);
});

it.each([
  [500, {}, {}, "2", LOCAL_DELAY],
  [429, { afterStatusCodes: [] }, {}, "2", LOCAL_DELAY],
  [429, {}, { afterStatusCodes: [] }, "2", LOCAL_DELAY],
  [429, { respectRetryAfter: false }, {}, "2", LOCAL_DELAY],
  [429, {}, { respectRetryAfter: false }, "2", LOCAL_DELAY],
  [429, { respectRetryAfter: false }, { respectRetryAfter: true }, "2", REMOTE_DELAY],
  [429, {}, {}, "invalid", LOCAL_DELAY],
  [429, {}, {}, undefined, LOCAL_DELAY],
  [429, {}, {}, "-1", 0],
  [429, {}, {}, "Thu, 01 Jan 1970 00:00:00 GMT", 0],
  [429, { retryAfterMax: 0 }, {}, "2", 0],
  [429, {}, { retryAfterMax: 0 }, "2", 0],
  [413, { statusCodes: [413] }, {}, "2", REMOTE_DELAY],
  [500, {}, { afterStatusCodes: [500] }, "2", REMOTE_DELAY],
] as const)(
  "[retry.req.retry.respectRetryAfter][retry.req.retry.afterStatusCodes][retry.req.retry.retryAfterMax] 状态 %i / 配置 %j / 覆盖 %j / 头 %s",
  /** 逻辑状态门控、无效头回退和零上限拒绝正等待。 */ async (status, base, request, header, ms) => {
    const delay = vi.fn(/** 合法头缺失时回退。 */ () => LOCAL_DELAY);
    const h = b3Client([axpRetry({ max: 1, delay, ...base })]);
    h.net.fallback(
      /** 保留服务端等待头。 */ () => ({
        status,
        headers: header === undefined ? {} : { "retry-after": header },
      }),
    );
    const pending = h.send({ retry: request });
    if (ms > 0) {
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(h.net.totalStarted).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
    }
    await vi.runAllTimersAsync();
    await pending;
    const stopped = ("retryAfterMax" in base && base.retryAfterMax === 0) || ("retryAfterMax" in request && request.retryAfterMax === 0);
    expect(h.net.totalStarted).toBe(stopped ? 1 : 2);
    expect(delay).toHaveBeenCalledTimes(ms === LOCAL_DELAY ? 1 : 0);
  },
);

it("[retry.result.last][retry.opt.max] max=0 和耗尽均保留成功/失败的最后响应身份", /** 不合成耗尽错误。 */ async () => {
  for (const status of [200, 500]) {
    for (const max of [0, 2]) {
      const shouldRetry = vi.fn(/** 即使成功也可继续至预算耗尽。 */ () => true);
      const h = b3Client([axpRetry({ max, delay: 0, shouldRetry })]);
      let last: unknown;
      h.api.use({
        name: "response-identity",
        taps: [
          {
            stage: "source",
            /** 记录真正最后一次的 R。 */ onResponse(r) {
              last = r;
            },
          },
        ],
      });
      h.net.fallback(
        /** 固定状态且业务数据随发送改变。 */ (_c, hit) => ({
          status,
          data: { code: status === 200 ? 0 : 500, data: hit },
        }),
      );
      const pending = h.send();
      await vi.runAllTimersAsync();
      expect(await pending).toBe(last);
      expect(h.net.totalStarted).toBe(max + 1);
      expect(shouldRetry).toHaveBeenCalledTimes(max);
    }
  }
});

it("[retry.priority.raw][retry.kind.default] 无响应无 request 的网络错误经工厂归一化后可重试", /** 旧 config 缺失不再阻止重试。 */ async () => {
  const h = b3Client([axpRetry({ max: 1, delay: 0 })]);
  h.net.fallback(
    /** 不给错误挂 config。 */ () => {
      throw new AxiosError("offline", AxiosError.ERR_NETWORK);
    },
  );
  const pending = h.send();
  await vi.runAllTimersAsync();
  expect(failureOf(await pending)?.type).toBe("network");
  expect(h.net.totalStarted).toBe(2);
});

it("[retry.kind.default][retry.priority.kind] 无 raw 的合成 HTTP 失败回退 delay", /** 没有原始头不会破坏逻辑状态重试。 */ async () => {
  const h = b3Client([axpRetry({ max: 1, delay: 0 })]);
  let count = 0;
  h.api.use({
    name: "synthetic-http",
    stage: "source",
    /** 构造没有 raw 的服务端失败。 */ async handle(ctx) {
      count++;
      return new AxpResponse({ status: 503, request: ctx.request });
    },
  });
  const pending = h.send({ url: REQUEST_URL } as AxpRequestConfig);
  await vi.runAllTimersAsync();
  expect((await pending).status).toBe(503);
  expect(count).toBe(2);
});

it.each(["signal", "cancelAll"] as const)(
  "[retry.fn.axpRetry][retry.cb.delay] 等待重试期间被取消（%s）：立刻以 cancel 结束，不空等满延迟，不再发送，不留定时器",
  /** 等待可被逻辑请求的取消信号打断。 */ async (how) => {
    const h = b3Client([axpRetry({ max: 2, delay: REMOTE_DELAY })]);
    let attempts = 0;
    h.api.use({
      name: "attempt-count",
      stage: "source",
      handle: /** 统计内层被进入的次数。 */ (_ctx, next) => (attempts++, next()),
    });
    h.net.fallback(/** 每次都可重试失败。 */ () => ({ status: 500 }));
    const controller = new AbortController();
    const pending = h.send({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(10);
    expect(h.net.totalStarted).toBe(1);
    if (how === "signal") controller.abort();
    else expect(h.api.cancelAll()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(failureOf(await pending)?.type).toBe("cancel");
    expect(h.net.totalStarted).toBe(1);
    expect(attempts).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("[retry.fn.axpRetry][retry.opt.respectRetryAfter] 服务端等待期间取消同样立即结束", /** Retry-After 的等待也可取消。 */ async () => {
  const h = b3Client([axpRetry({ max: 1, delay: 0 })]);
  h.net.fallback(/** 要求十秒后重试。 */ () => ({ status: 503, headers: { "retry-after": "10" } }));
  const pending = h.send();
  await vi.advanceTimersByTimeAsync(10);
  expect(h.api.cancelAll()).toBe(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(failureOf(await pending)?.type).toBe("cancel");
  expect(h.net.totalStarted).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("[retry.fn.axpRetry][retry.opt.methods][retry.opt.max] 重试时原地转换累积到重发与调用方请求体", /** 原地修改的代价随重试累积。 */ async () => {
  const bodies: unknown[] = [];
  const h = b3Client([axpRetry({ delay: 0, methods: ["post"] })]);
  h.net.on(
    "post",
    REQUEST_URL,
    /** 前两次失败，第三次成功。 */ (config, hit) => {
      bodies.push(config.data);
      return hit < 3 ? { status: 500 } : {};
    },
  );
  const data = pollutingBody();
  const result = await run(h, { method: "post", data, transformRequest: [pollutingTransform] });
  expect(result.ok).toBe(true);
  expect(bodies).toEqual([POLLUTED_ONCE, JSON.stringify({ items: [{ n: 2 }] }), JSON.stringify({ items: [{ n: 3 }] })]);
  expect(data).toEqual({ items: [{ n: 3 }] });
});
