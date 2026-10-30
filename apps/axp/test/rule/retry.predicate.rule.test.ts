import { AxpResponse } from "../../src/response";
import { AxiosError } from "axios";
import { beforeEach, expect, it, vi } from "vitest";
import axpRetry from "../../src/plugins/retry";
import { AXP_FAILURE, failureOf } from "../../src/response";
import { b3Client, REQUEST_URL } from "../helpers/b3";

/** 服务端要求等待的毫秒数。 */
/** 断言回调末位收到当前请求的上下文。 */
const ctxOf = (url: string) => expect.objectContaining({ request: expect.objectContaining({ url }) });
const REMOTE_DELAY = 2000;
/** 十秒头对应的实际等待毫秒数。 */
const TEN_SECONDS = 10_000;
/** 每个请求独立使用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it.each([true, false])(
  "[retry.opt.respectRetryAfter] 判定函数=%s 独立决定采信，忽略 afterStatusCodes",
  /** HTTP 200 的业务风格由使用者配置两种判定。 */ async (respect) => {
    const predicate = vi.fn(/** 使用者采信业务限流的服务端等待。 */ (r) => r.code === 429 && respect);
    const h = b3Client([axpRetry({ max: 1, delay: 10, afterStatusCodes: [], shouldRetry: /** 用户按业务码重试。 */ (r) => r.code === 429, respectRetryAfter: predicate })]);
    h.net.fallback(/** 首次业务限流，随后成功。 */ (_config, hit) => ({ status: 200, data: { code: hit === 1 ? 429 : 0, data: null }, headers: { "Retry-After": "2" } }));
    const pending = h.send({ url: REQUEST_URL });
    await vi.advanceTimersByTimeAsync(10);
    expect(h.net.totalStarted).toBe(respect ? 1 : 2);
    await vi.advanceTimersByTimeAsync(REMOTE_DELAY - 10);
    await vi.runAllTimersAsync();
    expect((await pending).ok).toBe(true);
    expect(predicate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 200, code: 429 }), ctxOf(REQUEST_URL));
  },
);

it("[retry.req.retry.respectRetryAfter] 请求级判定覆盖插件布尔配置", /** 判定函数不依赖默认状态表。 */ async () => {
  const h = b3Client([axpRetry({ max: 1, delay: 0, respectRetryAfter: false })]);
  h.net.fallback(/** 持续 500 携带服务端时间。 */ () => ({ status: 500, headers: { "Retry-After": "2" } }));
  const pending = h.send({ retry: { respectRetryAfter: /** 请求级主动采信。 */ () => true, afterStatusCodes: [] } });
  await vi.advanceTimersByTimeAsync(REMOTE_DELAY - 1);
  expect(h.net.totalStarted).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.runAllTimersAsync();
  expect((await pending).status).toBe(500);
  expect(h.net.totalStarted).toBe(2);
});

it("[retry.opt.respectRetryAfter] 判定函数抛错时原样抛程序异常", /** 判定类回调异常由内核按 internal 落定。 */ async () => {
  const bug = new Error("respect predicate");
  const h = b3Client([
    axpRetry({
      max: 1,
      respectRetryAfter: /** 模拟判定错误。 */ () => {
        throw bug;
      },
    }),
  ]);
  h.net.fallback(/** 可重试的 HTTP 状态。 */ () => ({ status: 500 }));
  const pending = h.send();
  const rejected = expect(pending).rejects.toBe(bug);
  await vi.runAllTimersAsync();
  await rejected;
  expect(h.net.totalStarted).toBe(1);
});

it("[retry.opt.statusCodes] 未配置 shouldRetry 时业务码 500 不参与默认状态表", /** HTTP 200 保持默认不重试。 */ async () => {
  const h = b3Client([axpRetry({ max: 2, delay: 0 })]);
  h.net.fallback(/** 业务失败但 HTTP 成功。 */ () => ({ status: 200, data: { code: 500, data: null } }));
  const pending = h.send();
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ status: 200, code: 500, ok: false });
  expect(h.net.totalStarted).toBe(1);
});

it.each([
  { header: "100", cap: 50_000, wait: false },
  { header: "10", cap: 50_000, wait: true },
  { header: "100", cap: 50, wait: false },
  { header: "10", cap: 50, wait: false },
])(
  "[retry.opt.respectRetryAfter][retry.opt.retryAfterMax] 拦截器抛出的 network 响应携带头 $header，上限 $cap 毫秒",
  /** 上限仍以毫秒计；50 秒允许十秒头，字面值 50 则两种头都超限。 */ async ({ header, cap, wait }) => {
    const respect = vi.fn(/** 函数式采信不受 HTTP 状态表限制。 */ () => true);
    const delay = vi.fn(/** 有服务端头时不得使用本地退避。 */ () => 0);
    const h = b3Client([axpRetry({ max: 1, respectRetryAfter: respect, retryAfterMax: cap, afterStatusCodes: [], delay })]);
    h.net.fallback(/** 实际 HTTP 请求成功，第一轮由响应拦截器抛错。 */ () => ({ status: 200, headers: { "Retry-After": header } }));
    let first = true;
    h.api.axios.interceptors.response.use(
      /** 首轮抛带 response 的 AxiosError，后续允许成功落定。 */ (response) => {
        if (first) {
          first = false;
          throw new AxiosError("interceptor network", AxiosError.ERR_NETWORK, response.config, undefined, response);
        }
        return response;
      },
    );
    const pending = h.send({ url: REQUEST_URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.net.totalStarted).toBe(1);
    expect(respect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ [AXP_FAILURE]: { type: "network" } }), ctxOf(REQUEST_URL));
    if (wait) {
      await vi.advanceTimersByTimeAsync(TEN_SECONDS - 1);
      expect(h.net.totalStarted).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.net.totalStarted).toBe(2);
      // 十秒到期只保证第二次请求已发出；假网络还通过 setTimeout(0) 交付响应。
      await vi.runAllTimersAsync();
      expect((await pending).ok).toBe(true);
      expect(h.net.totalStarted).toBe(2);
    } else {
      expect(failureOf(await pending)?.type).toBe("network");
      expect(h.net.totalStarted).toBe(1);
    }
    expect(delay).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each([false, true])(
  "[core.opt.statusOf][retry.opt.statusCodes] HTTP 200 + code 503 仅配置有效状态后重试 mapped=%s",
  /** HTTP 状态仍保持 200，extend 继承回调。 */ async (mapped) => {
    const statusOf = mapped ? /** 业务码作为有效状态。 */ (r: AxpResponse) => (r.status === 200 && r.code !== 0 ? Number(r.code) : r.status) : undefined;
    const h = b3Client([axpRetry({ max: 1, delay: 0 })], { statusOf });
    h.net.fallback(/** 持续业务 503。 */ () => ({ data: { code: 503, data: null } }));
    const child = h.api.extend();
    const pending = child.get(REQUEST_URL)(undefined, { throws: false });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: 200, code: 503 });
    expect(h.net.totalStarted).toBe(mapped ? 2 : 1);
    child.dispose();
  },
);

it("[core.opt.statusOf][retry.cb.shouldRetry] 显式判定与函数 respectRetryAfter 优先，不调用 statusOf", /** 覆盖两个默认判定的调用路径。 */ async () => {
  const statusOf = vi.fn(
    /** 默认回调不能执行。 */ () => {
      throw new Error("unused status");
    },
  );
  const h = b3Client([axpRetry({ max: 1, delay: 0, shouldRetry: /** 显式重试。 */ () => true, respectRetryAfter: /** 显式忽略服务端头。 */ () => false })], { statusOf });
  h.net.fallback(/** 业务失败。 */ () => ({ data: { code: 503, data: null } }));
  const pending = h.send();
  await vi.runAllTimersAsync();
  expect((await pending).status).toBe(200);
  expect(h.net.totalStarted).toBe(2);
  expect(statusOf).not.toHaveBeenCalled();
});

it("[core.opt.statusOf] 判定回调抛错按 internal 抛原异常", /** 沿用层异常边界。 */ async () => {
  const bug = new Error("status bug");
  const h = b3Client([axpRetry({ delay: 0 })], {
    statusOf: /** 模拟程序错误。 */ () => {
      throw bug;
    },
  });
  const pending = h.send();
  const rejected = expect(pending).rejects.toBe(bug);
  await vi.runAllTimersAsync();
  await rejected;
  expect(h.net.totalStarted).toBe(1);
});

it("[core.opt.statusOf][retry.opt.respectRetryAfter] 布尔形态按有效状态采信 Retry-After", /** HTTP 200 的业务 503 也遵循服务端等待时间。 */ async () => {
  const h = b3Client([axpRetry({ max: 1, delay: 0 })], { statusOf: /** 将业务失败映射为 503。 */ (r) => (r.code === 503 ? 503 : r.status) });
  h.net.fallback(/** 带服务端重试时间的业务失败。 */ () => ({ data: { code: 503, data: null }, headers: { "Retry-After": "2" } }));
  const pending = h.send();
  await vi.advanceTimersByTimeAsync(REMOTE_DELAY - 1);
  expect(h.net.totalStarted).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.net.totalStarted).toBe(2);
  await vi.runAllTimersAsync();
  expect((await pending).status).toBe(200);
});
