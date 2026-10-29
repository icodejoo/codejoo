import { failureOf } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import axpCache from "../../src/plugins/cache";
import axpRetry from "../../src/plugins/retry";
import { failure } from "../helpers/b3";
import { countingCacheStore, envelope, requestRecorder, settleAll, sourceClient } from "../helpers/source";

/** 被缓存且可重试的接口。 */
const URL = "/pets";
/** 请求级显式缓存键，沿用旧用例的写法。 */
const CACHE_KEY = "retry-cache";
/** 成功时的响应数据。 */
const DATA = "ok";
/** 一次重试预算，足以覆盖"失败一次再成功"。 */
const ONE_RETRY = 1;
/** 两次重试预算，足以覆盖"耗尽"。 */
const TWO_RETRIES = 2;
/** 首发失败再重试成功，网络共发送两次。 */
const SENDS_AFTER_RETRY = 2;
/** 服务端故障的 HTTP 状态。 */
const HTTP_ERROR = 500;
/** 前这么多次发送故障，其后恢复。 */
const FAILED_SENDS = 1;
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 装好 retry 与带写入计数存储的 cache；recorder 站在 cache 之前，每个进入 source 阶段的尝试记一条。 */
function client(max: number, business = false) {
  const cache = countingCacheStore();
  const attempts = requestRecorder("pre");
  const h = sourceClient([axpRetry({ max, delay: 0, shouldRetry: business ? /** 使用者按业务码重试。 */ (r) => r.code === 500 : undefined }), axpCache({ store: cache.store }), attempts.plugin]);
  return { ...h, cache, attempts: attempts.seen };
}

it.each([false, true])(
  "[retry.opt.max × cache.req.cache.key] 失败后重试成功的那次写入缓存，之前的失败不写，后续请求命中缓存且只走一次尝试（business=%s）",
  /** 缓存在 retry 之内：每次尝试都先问缓存，只有最终成功才写。 */ async (business) => {
    const h = client(ONE_RETRY, business);
    h.net.on("get", URL, /** 首发失败，其后成功。 */ (_config, hit) => (hit <= FAILED_SENDS ? failure(HTTP_ERROR, business) : envelope(DATA)));
    const [first] = await settleAll(h.send({ url: URL, cache: { key: CACHE_KEY } }));
    expect(first.ok).toBe(true);
    expect(h.net.calls("get", URL)).toBe(SENDS_AFTER_RETRY);
    expect(h.attempts).toHaveLength(SENDS_AFTER_RETRY);
    expect(h.cache.set).toHaveBeenCalledTimes(1);
    expect([...h.cache.entries.values()].map(/** 只缓存重试成功的快照。 */ (e) => e.snapshot)).toEqual([
      { code: first.code, message: first.message, data: first.data, status: first.status, failure: failureOf(first)?.type, reason: failureOf(first)?.reason },
    ]);
    const [hit] = await settleAll(h.send({ url: URL, cache: { key: CACHE_KEY } }));
    expect(hit).not.toBe(first);
    expect(hit.data).toEqual(first.data);
    expect(hit.request).toBe(h.attempts.at(-1));
    expect(h.net.calls("get", URL)).toBe(SENDS_AFTER_RETRY);
    // 命中只占一次尝试：没有进入重试循环，也没有追加网络请求。
    expect(h.attempts).toHaveLength(SENDS_AFTER_RETRY + 1);
  },
);

it("[retry.opt.max × cache.req.cache] 重试耗尽仍失败：每一轮失败都不写缓存，之后的请求重新触网，恢复后才缓存", /** 失败结果从不进缓存。 */ async () => {
  const h = client(TWO_RETRIES);
  h.net.on("get", URL, /** 一直失败。 */ () => failure(HTTP_ERROR));
  const [failed] = await settleAll(h.send({ url: URL, cache: true }));
  expect(failed).toMatchObject({ ok: false, status: HTTP_ERROR });
  expect(h.net.calls("get", URL)).toBe(TWO_RETRIES + 1);
  expect(h.cache.set).not.toHaveBeenCalled();
  expect(h.cache.entries.size).toBe(0);
  h.net.on("get", URL, /** 服务恢复。 */ () => envelope(DATA));
  const [recovered] = await settleAll(h.send({ url: URL, cache: true }));
  expect(recovered.ok).toBe(true);
  expect(h.net.calls("get", URL)).toBe(TWO_RETRIES + 2);
  expect(h.cache.set).toHaveBeenCalledTimes(1);
});

it("[retry.opt.max × cache.req.cache] 请求级 cache:false：每次尝试都绕过缓存，重试成功的结果也不写入", /** 请求级关闭对每轮尝试都生效。 */ async () => {
  const h = client(ONE_RETRY);
  h.net.on("get", URL, /** 首发失败，其后成功。 */ (_config, hit) => (hit <= FAILED_SENDS ? failure(HTTP_ERROR) : envelope(DATA)));
  const [r] = await settleAll(h.send({ url: URL, cache: false }));
  expect(r.ok).toBe(true);
  expect(h.net.calls("get", URL)).toBe(SENDS_AFTER_RETRY);
  expect(h.cache.set).not.toHaveBeenCalled();
});
