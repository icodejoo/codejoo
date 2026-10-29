import { beforeEach, expect, it, vi } from "vitest";
import axpRetry from "../../src/plugins/retry";
import { b3Client, REQUEST_URL } from "../helpers/b3";

/** 服务端要求等待的毫秒数。 */
const REMOTE_DELAY = 2000;
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
    expect(predicate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 200, code: 429 }));
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
