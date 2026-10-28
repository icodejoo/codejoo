import { beforeEach, expect, it, vi } from "vitest";
import axpRetry from "../../src/plugins/retry";
import type { AxpResponse } from "../../src/response";
import { authClient, deferred, failure, guarded, POLLUTED_ONCE, pollutingBody, pollutingTransform, REFRESH_TOKEN, REQUEST_URL, run, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";

/** 一个重试预算，足以证明刷新没有占用它。 */
const ONE_RETRY = 1;
/** 重试等待窗口，别处的刷新可在其间完成。 */
const RETRY_WAIT = 100;
/** 窗口内换上新 token 的时刻。 */
const REFRESH_AT = 50;
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it.each([false, true])(
  "[auth.cb.onRefresh][retry.opt.max] 500 → 401 → 刷新 → 成功：onRefresh 一次，刷新重放不占重试次数（max=1 仍成功，business=%s）",
  /** 重试里遇 401 先刷新再继续。 */ async (business) => {
    const h = authClient({}, [axpRetry<AxpResponse>({ max: ONE_RETRY, delay: 0 })]);
    const route = guarded(() => TOKEN_NEW, business);
    h.net.on("get", REQUEST_URL, /** 首次服务端故障，其后按 token 放行。 */ (config, hit) => (hit === 1 ? failure(500, business) : route(config, hit)));
    expect((await run(h)).ok).toBe(true);
    expect(h.net.totalStarted).toBe(3);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    expect(h.net.log.map(/** 每次发送携带的凭证。 */ (record) => record.auth)).toEqual([TOKEN_OLD, TOKEN_OLD, TOKEN_NEW]);
  },
);

it("[auth.cb.onRefresh][retry.opt.delay] 等待重试期间 token 被别的请求刷新：重发带新 token", /** 每次尝试都由 auth 注入最新凭证。 */ async () => {
  const h = authClient({}, [axpRetry<AxpResponse>({ max: ONE_RETRY, delay: RETRY_WAIT })]);
  h.net.on("get", REQUEST_URL, /** 首发 500，重发按新 token 放行。 */ (config, hit) => (hit === 1 ? failure(500) : guarded(() => TOKEN_NEW)(config, hit)));
  const pending = h.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(REFRESH_AT);
  h.tm.set(TOKEN_NEW, REFRESH_TOKEN);
  await vi.runAllTimersAsync();
  expect((await pending).ok).toBe(true);
  expect(h.net.log.map(/** 首发旧、重发新。 */ (record) => record.auth)).toEqual([TOKEN_OLD, TOKEN_NEW]);
  expect(h.settings.onRefresh).not.toHaveBeenCalled();
});

it.each([
  [401, "expired", { onRefresh: () => false }],
  [403, "denied", {}],
] as const)(
  "[auth.reason.expired][auth.reason.denied][retry.priority.kind] 鉴权失败（%i）落定为 auth：即使状态码在重试表里也不重试，shouldRetry 不被调用",
  /** auth 类别否决重试。 */ async (status, reason, override) => {
    const shouldRetry = vi.fn(/** 不应被调用。 */ () => true);
    const h = authClient(override, [axpRetry<AxpResponse>({ max: 3, delay: 0, statusCodes: [401, 403], shouldRetry })]);
    h.net.on("get", REQUEST_URL, () => failure(status));
    expect(await run(h)).toMatchObject({ kind: "auth", reason, status });
    expect(h.net.totalStarted).toBe(1);
    expect(shouldRetry).not.toHaveBeenCalled();
  },
);

it("[auth.const.AuthFailureAction.Others][retry.opt.statusCodes] 无关失败（500）由 auth 透传给 retry：每次尝试都重新走 auth，耗尽后返回最后一次", /** retry 在 auth 之外，每轮重新进入凭证阶段。 */ async () => {
  const onFailure = vi.fn(/** 观察每次尝试都经过路由。 */ () => undefined);
  const h = authClient({ onFailure }, [axpRetry<AxpResponse>({ max: 2, delay: 0 })]);
  h.net.on("get", REQUEST_URL, () => failure(500));
  expect(await run(h)).toMatchObject({ ok: false, status: 500, kind: "http" });
  expect(h.net.totalStarted).toBe(3);
  expect(onFailure).toHaveBeenCalledTimes(3);
  expect(h.settings.onRefresh).not.toHaveBeenCalled();
});

it("[auth.cb.onRefresh][retry.opt.methods] 每次尝试请求体一致（I7）：500 → 401 → 刷新 → 成功，三次发送的请求体相同，调用方数据不被改", /** 重试与重放共用同一份请求体基准。 */ async () => {
  const bodies: unknown[] = [];
  const h = authClient({}, [axpRetry<AxpResponse>({ max: 2, delay: 0, methods: ["post"] })]);
  const route = guarded(() => TOKEN_NEW);
  h.net.on(
    "post",
    REQUEST_URL,
    /** 记录请求体后路由。 */ (config, hit) => {
      bodies.push(config.data);
      return hit === 1 ? failure(500) : route(config, hit);
    },
  );
  const data = pollutingBody();
  const result = await run(h, { method: "post", data, transformRequest: [pollutingTransform] });
  expect(result.ok).toBe(true);
  expect(bodies).toEqual([POLLUTED_ONCE, POLLUTED_ONCE, POLLUTED_ONCE]);
  expect(data).toEqual(pollutingBody());
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
});

it("[auth.cb.onRefresh][retry.opt.max] 并发请求各自重试时共享同一次刷新（I5）：窗口内 401 不会触发第二次 onRefresh", /** 重试与单飞刷新并存。 */ async () => {
  const gate = deferred<boolean>();
  const h = authClient(
    {
      onRefresh: /** 等门打开再换 token。 */ async (_r, tm) => {
        await gate.promise;
        tm.set(TOKEN_NEW, REFRESH_TOKEN);
      },
    },
    [axpRetry<AxpResponse>({ max: ONE_RETRY, delay: 0 })],
  );
  h.net.on(
    "get",
    REQUEST_URL,
    guarded(() => TOKEN_NEW),
  );
  const all = [h.send({ url: REQUEST_URL }), h.send({ url: REQUEST_URL }), h.send({ url: REQUEST_URL })];
  await vi.runAllTimersAsync();
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  gate.resolve(true);
  await vi.runAllTimersAsync();
  expect((await Promise.all(all)).every(/** 全部成功。 */ (r) => r.ok)).toBe(true);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
});

it("[auth.cb.onRefresh][retry.opt.statusCodes] 401 先由 auth 刷新重放：retry 只看到最终结果，一轮尝试就成功，不会在旧 token 上白白消耗重试次数", /** auth 在 retry 之内收敛 401。 */ async () => {
  const attempts = vi.fn();
  const h = authClient({}, [axpRetry<AxpResponse>({ max: ONE_RETRY, delay: 0, statusCodes: [401, 500] })]);
  h.api.use({
    name: "attempt-count",
    stage: "attempt",
    /** 位于 retry 之内，每轮尝试进入一次。 */
    handle: (_ctx, next) => {
      attempts();
      return next();
    },
  });
  h.net.on(
    "get",
    REQUEST_URL,
    guarded(() => TOKEN_NEW),
  );
  expect((await run(h)).ok).toBe(true);
  expect(attempts).toHaveBeenCalledTimes(1);
  expect(h.net.totalStarted).toBe(2);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
});
