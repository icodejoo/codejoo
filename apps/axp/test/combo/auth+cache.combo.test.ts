import { businessAuthFailure } from "../helpers/b3";
import { AXP_FAILURE } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import axpCache, { clearCache } from "../../src/plugins/cache";
import { authClient, deferred, failure, guarded, REFRESH_TOKEN, REQUEST_URL, run, TOKEN_NEW } from "../helpers/b3";
import { countingCacheStore, settleAll } from "../helpers/source";

/** 请求级显式缓存键，沿用旧用例的写法。 */
const CACHE_KEY = "auth-cache";
/** 刷新窗口里同时在途的请求数。 */
const CALLERS = 3;
/** 一轮网络往返的延迟，让并发请求都停在传输层。 */
const LATENCY = 10;
/** 首发 401 加重放成功，一条请求共发送两次。 */
const SENDS_PER_REFRESH = 2;
/** 刷新失败的请求只发送了首发那一次。 */
const EXPIRED_SENDS = 1;
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it("[auth.cb.ready][cache.req.cache][core.req.signal] 缓存预热后，异步 ready 挂起时取消以 cancel 落定，不返回缓存命中", /** 取消在进入缓存之前生效。 */ async () => {
  const gate = deferred<void>();
  let waiting = false;
  const h = client(false, {
    ready: /** 预热后挂起凭证准备。 */ async (tm) => {
      if (waiting) await gate.promise;
      return { headers: { Authorization: tm.accessToken } };
    },
  });
  expect((await run(h, { cache: true })).ok).toBe(true);
  waiting = true;
  const controller = new AbortController();
  const pending = h.send({ url: REQUEST_URL, cache: true, signal: controller.signal });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
  expect(h.api.pending()).toBe(0);
  expect(h.events.listeners).toBe(0);
  gate.resolve();
  await vi.runAllTimersAsync();
  expect(h.net.totalStarted).toBe(SENDS_PER_REFRESH);
  expect(h.cache.set).toHaveBeenCalledTimes(1);
});

/** 装好 auth 与带写入计数存储的 cache；服务端只认新 token。 */
function client(business = false, overrides: Parameters<typeof authClient>[0] = {}) {
  const cache = countingCacheStore();
  const h = authClient({ onFailure: business ? businessAuthFailure : undefined, ...overrides }, [axpCache({ store: cache.store })]);
  h.net.on(
    "get",
    REQUEST_URL,
    guarded(() => TOKEN_NEW, business),
  );
  return { ...h, cache };
}

it.each([false, true])(
  "[auth.cb.onRefresh × cache.req.cache] 401 → 刷新 → 重放成功的那次写入缓存，后续同 key 请求命中缓存，不再触网也不再刷新（business=%s）",
  /** 缓存在 auth 之内：首发的 401 不入缓存，重放的 200 才入。 */ async (business) => {
    const h = client(business);
    const first = await run(h, { cache: true });
    expect(first.ok).toBe(true);
    expect(h.net.totalStarted).toBe(SENDS_PER_REFRESH);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    expect(h.cache.set).toHaveBeenCalledTimes(1);
    expect(h.cache.entries.size).toBe(1);
    const second = await run(h, { cache: true });
    expect(second).not.toBe(first);
    expect(second.data).toEqual(first.data);
    expect(second.ok).toBe(true);
    expect(h.net.totalStarted).toBe(SENDS_PER_REFRESH);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  },
);

it("[auth.cb.onRefresh × cache.req.cache.key] 显式 key：刷新重放成功的结果写入该 key，后续同 key 请求命中缓存（承接旧用例）", /** 显式键不经过 key 服务，不受 token 变化影响。 */ async () => {
  const h = client();
  const first = await run(h, { cache: { key: CACHE_KEY } });
  expect(first.ok).toBe(true);
  expect(h.net.totalStarted).toBe(SENDS_PER_REFRESH);
  const [key] = [...h.cache.entries.keys()];
  expect(key).toBe(CACHE_KEY);
  const second = await run(h, { cache: { key: CACHE_KEY } });
  expect(second.ok).toBe(true);
  expect(second).not.toBe(first);
  expect(second.data).toEqual(first.data);
  expect(h.net.totalStarted).toBe(SENDS_PER_REFRESH);
});

it("[auth.reason.expired × cache.req.cache] 刷新失败落定为 auth 过期：失败结果不写缓存，重新登录后请求照常触网并缓存", /** 只有成功才进缓存，过期结果不会毒化缓存。 */ async () => {
  const h = client(false, { onRefresh: /** 刷新失败。 */ () => false });
  const expired = await run(h, { cache: true });
  expect(expired).toMatchObject({ status: 401, [AXP_FAILURE]: { type: "auth", reason: "expired" } });
  expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
  expect(h.net.totalStarted).toBe(EXPIRED_SENDS);
  expect(h.cache.set).not.toHaveBeenCalled();
  expect(clearCache(h.api)).toBe(0);
  h.tm.set(TOKEN_NEW, REFRESH_TOKEN);
  const login = await run(h, { cache: true });
  expect(login.ok).toBe(true);
  expect(h.net.totalStarted).toBe(EXPIRED_SENDS + 1);
  expect(h.cache.set).toHaveBeenCalledTimes(1);
});

it("[auth.cb.onRefresh × cache.req.cache] 并发 401（未开 share）：单飞刷新、各自重放，缓存里只有一条成功结果，之后命中缓存", /** I5 在缓存介入时仍成立。 */ async () => {
  const h = client();
  const results = await settleAll(...Array.from({ length: CALLERS }, () => h.send({ url: REQUEST_URL, cache: true, latency: LATENCY } as never)));
  expect(results.every(/** 全部成功。 */ (r) => r.ok)).toBe(true);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  expect(h.net.totalStarted).toBe(CALLERS * SENDS_PER_REFRESH);
  expect(h.cache.entries.size).toBe(1);
  expect([...h.cache.entries.values()].every(/** 快照全部来自成功结果。 */ (e) => e.snapshot.failure === undefined && e.snapshot.status === 200 && e.snapshot.code === 0)).toBe(true);
  const before = h.net.totalStarted;
  const [hit] = await settleAll(h.send({ url: REQUEST_URL, cache: true }));
  expect(hit.ok).toBe(true);
  expect(results).not.toContain(hit);
  expect(hit.data).toEqual([...h.cache.entries.values()][0].snapshot.data);
  expect(h.net.totalStarted).toBe(before);
});

it("[auth.cb.onRefresh × cache.req.cache] 命中缓存不经过服务端：即使服务端此刻已拒绝所有 token，缓存的成功结果照常返回，不触发刷新", /** 命中直接返回，不会走到 401 处理。 */ async () => {
  const h = client();
  const first = await run(h, { cache: true });
  expect(first.ok).toBe(true);
  h.net.on("get", REQUEST_URL, /** 此后服务端一律拒绝。 */ () => failure(401));
  const second = await run(h, { cache: true });
  expect(second).not.toBe(first);
  expect(second.data).toEqual(first.data);
  expect(second.ok).toBe(true);
  expect(h.net.totalStarted).toBe(SENDS_PER_REFRESH);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
});
