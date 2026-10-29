import { AXP_FAILURE } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import { authClient, deferred, failure, guarded, REFRESH_TOKEN, REQUEST_URL, run, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";

/** 默认刷新时限。 */
const DEFAULT_TIMEOUT = 30_000;
/** 自定义刷新时限。 */
const CUSTOM_TIMEOUT = 50;
/** 刷新回调的原始故障。 */
const BUG = new Error("late refresh failure");
/** 重入请求的受保护地址。 */
const REFRESH_URL = "/refresh";

/** 每个用例独立推进刷新时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it.each(["false", "reject"])(
  "[auth.cb.onRefresh][auth.cb.onAccessExpired] 刷新期间重新登录，旧刷新 %s 不清理新 token，等待者携新 token 成功",
  /** 用失败结果验证新会话不受旧刷新影响。 */ async (mode) => {
    const gate = deferred<boolean>();
    const h = authClient({
      onRefresh: /** 放行后按指定方式失败。 */ async () => {
        await gate.promise;
        if (mode === "reject") throw BUG;
        return false;
      },
    });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(/** 服务端只认新会话。 */ () => TOKEN_NEW),
    );
    const pending = h.send({ url: REQUEST_URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    const queued = h.send({ url: REQUEST_URL });
    h.tm.set(TOKEN_NEW, REFRESH_TOKEN);
    gate.resolve(false);
    await vi.runAllTimersAsync();
    expect((await pending).ok).toBe(true);
    expect((await queued).ok).toBe(true);
    expect(h.tm.accessToken).toBe(TOKEN_NEW);
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    expect(h.net.log.map(/** 检查实际发送的凭证。 */ (record) => record.auth)).toEqual([TOKEN_OLD, TOKEN_NEW, TOKEN_NEW]);
  },
);

it("[auth.cb.onRefresh][auth.cb.onAccessExpired] 刷新期间登出，旧刷新失败后以 unauthenticated 落定，不发过期通知", /** 登出后不发送无凭证重放。 */ async () => {
  const gate = deferred<boolean>();
  const h = authClient({ onRefresh: /** 挂起旧刷新。 */ () => gate.promise });
  h.net.on("get", REQUEST_URL, /** 旧凭证失败。 */ () => failure(401));
  const pending = h.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(0);
  h.tm.clear();
  gate.resolve(false);
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
  expect(h.tm.accessToken).toBeUndefined();
  expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
  expect(h.net.totalStarted).toBe(1);
});

it.each(["true", "false", "reject"])(
  "[auth.cb.onRefresh][auth.opt.refreshTimeout] 默认 30s 超时只通知一次，迟到的 %s 被忽略且不影响新会话",
  /** 计时器只决定一轮结果，迟到拒绝已有处理器。 */ async (mode) => {
    const gate = deferred<boolean>();
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const h = authClient(
      {
        refreshTimeout: undefined,
        onRefresh: /** 超时后再给出结果。 */ async () => {
          await gate.promise;
          if (mode === "reject") throw BUG;
          return mode === "true";
        },
      },
      [],
      { debug: logger },
    );
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(/** 新登录后可正常发送。 */ () => TOKEN_NEW),
    );
    const pending = h.send({ url: REQUEST_URL });
    await vi.advanceTimersByTimeAsync(0);
    const queued = h.send({ url: REQUEST_URL });
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT - 1);
    expect(h.api.pending()).toBe(2);
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(await queued).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(h.api.pending()).toBe(0);
    expect(h.events.listeners).toBe(0);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith("[axp:auth] onRefresh 超时，按刷新失败处理");
    h.tm.set(TOKEN_NEW, REFRESH_TOKEN);
    gate.resolve(true);
    await vi.runAllTimersAsync();
    expect(h.tm.accessToken).toBe(TOKEN_NEW);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect((await run(h)).ok).toBe(true);
  },
);

it.each([0, Infinity])(
  "[auth.opt.refreshTimeout][core.req.signal] refreshTimeout=%s 不限时，signal 仍可立即取消等待者",
  /** 共享刷新不随单个等待者取消。 */ async (refreshTimeout) => {
    const gate = deferred<boolean>();
    const h = authClient({ refreshTimeout, onRefresh: /** 等用例放行。 */ () => gate.promise });
    h.net.on("get", REQUEST_URL, /** 触发刷新。 */ () => failure(401));
    const controller = new AbortController();
    const pending = h.send({ url: REQUEST_URL, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT * 2);
    expect(h.api.pending()).toBe(1);
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    controller.abort();
    expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    expect(h.api.pending()).toBe(0);
    expect(h.events.listeners).toBe(0);
    gate.resolve(true);
    await vi.runAllTimersAsync();
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
  },
);

it("[auth.opt.refreshTimeout] 自定义刷新时限生效，超时后释放单飞并允许新登录再次刷新", /** 新一轮不被旧刷新挂住。 */ async () => {
  const gate = deferred<boolean>();
  const h = authClient({ refreshTimeout: CUSTOM_TIMEOUT, onRefresh: /** 第一轮挂起。 */ () => gate.promise });
  h.net.on(
    "get",
    REQUEST_URL,
    guarded(/** 仅认可新 token。 */ () => TOKEN_NEW),
  );
  const pending = h.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(CUSTOM_TIMEOUT - 1);
  expect(h.api.pending()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
  h.tm.set(TOKEN_OLD, REFRESH_TOKEN);
  h.settings.onRefresh.mockImplementationOnce(
    /** 新一轮正常刷新。 */ (_r, tm) => {
      tm.set(TOKEN_NEW, REFRESH_TOKEN);
      return Promise.resolve(true);
    },
  );
  expect((await run(h)).ok).toBe(true);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(2);
  gate.resolve(false);
  await vi.runAllTimersAsync();
  expect(h.tm.accessToken).toBe(TOKEN_NEW);
  expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
});

it.each(["login", "logout"])(
  "[auth.opt.refreshTimeout][auth.cb.onAccessExpired] 超时期间发生 %s，旧刷新不判过期",
  /** 超时失败也使用启动时的会话快照。 */ async (mode) => {
    const gate = deferred<boolean>();
    const h = authClient({ refreshTimeout: CUSTOM_TIMEOUT, onRefresh: /** 保持旧刷新挂起。 */ () => gate.promise });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(/** 认可新登录。 */ () => TOKEN_NEW),
    );
    const pending = h.send({ url: REQUEST_URL });
    await vi.advanceTimersByTimeAsync(0);
    if (mode === "login") h.tm.set(TOKEN_NEW, REFRESH_TOKEN);
    else h.tm.clear();
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject(mode === "login" ? { ok: true } : { [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    gate.resolve(false);
    await vi.runAllTimersAsync();
  },
);

it("[auth.cb.onRefresh][auth.opt.refreshTimeout] onRefresh 重入同一客户端的受保护接口，超时后两路 expired 并释放 pending", /** 超时拆开等待自身的环。 */ async () => {
  let nested: ReturnType<ReturnType<typeof authClient>["send"]> | undefined;
  const h = authClient({
    refreshTimeout: CUSTOM_TIMEOUT,
    onRefresh: /** 忘记 protected:false 的刷新请求会加入本轮刷新。 */ () => {
      nested = h.send({ url: REFRESH_URL });
      return nested;
    },
  });
  h.net.on("get", REQUEST_URL, /** 首发触发刷新。 */ () => failure(401));
  const pending = h.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(CUSTOM_TIMEOUT - 1);
  expect(h.api.pending()).toBe(2);
  expect(h.net.calls("get", REFRESH_URL)).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
  expect(await nested).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
  expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
  expect(h.api.pending()).toBe(0);
  expect(h.events.listeners).toBe(0);
});
