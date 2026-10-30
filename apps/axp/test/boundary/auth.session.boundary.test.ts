import { beforeEach, expect, it, vi } from "vitest";
import type { ITokenManager } from "../../src/objects/TokenManager";
import axpAuth, { AuthFailureAction } from "../../src/plugins/auth";
import { AXP_FAILURE, failureOf } from "../../src/response";
import type { AxpRequestConfig } from "../../src/types";
import { authClient, authSettings, b3Client, deferred, failure, guarded, REFRESH_TOKEN, REQUEST_URL, run, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";
import { observeUi, recordEvents } from "../helpers/ui";

/** 轮换后的刷新凭证。 */
const ROTATED_REFRESH = "refresh-rotated";
/** 首轮刷新耗时。 */
const REFRESH_DELAY = 50;
/** 陈旧刷新先失败的耗时。 */
const STALE_DELAY = 10;
/** 每个会话场景独立推进时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it("[auth.state.singleFlight] 父子同时 401，轮换 refresh token 只刷新一次且都重放成功", /** 第二次拿旧 refresh token 的刷新本应先失败。 */ async () => {
  const seen: (string | undefined)[] = [];
  const parent = authClient({
    onRefresh: /** 模拟服务端轮换及陈旧刷新失败。 */ (_r, tm) => {
      seen.push(tm.refreshToken);
      const first = seen.length === 1;
      return new Promise<boolean>(
        /** 按轮次制造成功和失败的时间差。 */ (resolve) => {
          setTimeout(
            /** 只有首轮刷新可以写入新凭证。 */ () => {
              if (first) tm.set(TOKEN_NEW, ROTATED_REFRESH);
              resolve(first);
            },
            first ? REFRESH_DELAY : STALE_DELAY,
          );
        },
      );
    },
  });
  const child = observeUi({ ...parent, api: parent.api.extend(), events: recordEvents() });
  parent.net.on(
    "get",
    REQUEST_URL,
    guarded(/** 服务端只接受轮换后的 token。 */ () => TOKEN_NEW),
  );
  const requests = [parent.send({ url: REQUEST_URL }), child.send({ url: REQUEST_URL })];
  await vi.advanceTimersByTimeAsync(0);
  expect(parent.net.totalStarted).toBe(2);
  await vi.runAllTimersAsync();
  expect((await Promise.all(requests)).every(/** 父子都得到成功响应。 */ (r) => r.ok)).toBe(true);
  expect(parent.settings.onRefresh).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([REFRESH_TOKEN]);
  expect(parent.settings.onAccessExpired).not.toHaveBeenCalled();
  expect(parent.tm.accessToken).toBe(TOKEN_NEW);
  expect(parent.tm.refreshToken).toBe(ROTATED_REFRESH);
});

it("[auth.cb.onRefresh][auth.opt.refreshTimeout][auth.cb.onAccessExpired] 共享刷新采用发起者的实现、超时及通知上下文", /** 后加入者的配置不改写正在进行的刷新。 */ async () => {
  const gate = deferred<boolean>();
  const first = authClient({ refreshTimeout: REFRESH_DELAY, onRefresh: /** 挂起首轮刷新。 */ () => gate.promise });
  const second = authClient({ tokenManager: first.tm, refreshTimeout: STALE_DELAY });
  first.net.on("get", REQUEST_URL, /** 首发 401。 */ () => failure(401));
  const pending = first.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(0);
  const queued = second.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(STALE_DELAY);
  expect(second.api.pending()).toBe(1);
  expect(second.settings.onRefresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(REFRESH_DELAY - STALE_DELAY);
  for (const response of await Promise.all([pending, queued])) expect(failureOf(response)?.reason).toBe("expired");
  expect(first.settings.onAccessExpired).toHaveBeenCalledExactlyOnceWith(expect.anything(), first.tm, expect.objectContaining({ client: first.api }));
  expect(second.settings.onAccessExpired).not.toHaveBeenCalled();
  gate.resolve(false);
  await vi.runAllTimersAsync();
});

it("[auth.method.lifecycle][auth.cb.onAccessExpired] 发起者 dispose 后仍有共享客户端，迟到失败照常清会话并通知一次", /** 存活判断按共享持有者数。 */ async () => {
  const gate = deferred<boolean>();
  const first = authClient({ onRefresh: /** 等待卸载后才失败。 */ () => gate.promise });
  const second = authClient({ tokenManager: first.tm });
  first.net.on("get", REQUEST_URL, /** 发起刷新。 */ () => failure(401));
  const pending = first.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(0);
  const queued = second.send({ url: REQUEST_URL });
  first.api.dispose();
  first.api.dispose();
  gate.resolve(false);
  await vi.runAllTimersAsync();
  await pending;
  expect(await queued).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
  expect(first.tm.accessToken).toBeUndefined();
  expect(first.settings.onAccessExpired).toHaveBeenCalledTimes(1);
  expect(second.settings.onAccessExpired).not.toHaveBeenCalled();
});

it("[auth.method.lifecycle] 实例重复 dispose 只撤回一个持有者，所有持有者卸载后迟到失败不清会话", /** 直接验证插件实例的幂等清理。 */ async () => {
  const gate = deferred<boolean>();
  const settings = authSettings({ onRefresh: /** 等待所有持有者卸载。 */ () => gate.promise });
  const plugin = axpAuth(settings);
  const setup = vi.spyOn(plugin, "setup");
  const first = b3Client([plugin]);
  const second = b3Client([plugin]);
  first.net.on("get", REQUEST_URL, /** 发起刷新。 */ () => failure(401));
  const pending = first.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(0);
  const instance = setup.mock.results[0].value!;
  instance.dispose!();
  instance.dispose!();
  second.api.dispose();
  gate.resolve(false);
  await vi.runAllTimersAsync();
  await pending;
  expect(settings.tokenManager.accessToken).toBe(TOKEN_OLD);
  expect(settings.onAccessExpired).not.toHaveBeenCalled();
});

it.each([false, true])(
  "[auth.reason.unauthenticated][auth.cb.onAccessDenied] 三个并发无 token 请求各自失败，但只通知一次（自定义 denied=%s）",
  /** 无凭证去重覆盖默认回退和显式通知。 */ async (custom) => {
    const notice = vi.fn();
    const h = authClient({ onAccessExpired: notice, onAccessDenied: custom ? notice : undefined });
    h.tm.clear();
    const requests = Array.from({ length: 3 }, /** 同时发起本地拒绝。 */ () => h.send({ url: REQUEST_URL }));
    for (const response of await Promise.all(requests)) expect(failureOf(response)?.reason).toBe("unauthenticated");
    expect(notice).toHaveBeenCalledTimes(1);
    expect(h.net.totalStarted).toBe(0);
  },
);

it("[auth.reason.unauthenticated][auth.state.expired] 共用 tm 的两个客户端无 token 只通知一次，观察登录再登出后重新通知", /** 通知标记随任一持有者观察到登录而复位。 */ async () => {
  const first = authClient({ onAccessDenied: undefined });
  const second = authClient({ tokenManager: first.tm, onAccessDenied: undefined });
  first.tm.clear();
  const responses = await Promise.all([first.send(), second.send()]);
  expect(responses.every(/** 两个请求都本地拒绝。 */ (r) => failureOf(r)?.reason === "unauthenticated")).toBe(true);
  expect(first.settings.onAccessExpired).toHaveBeenCalledTimes(1);
  expect(second.settings.onAccessExpired).not.toHaveBeenCalled();
  first.tm.set(TOKEN_NEW, REFRESH_TOKEN);
  expect((await run(second)).ok).toBe(true);
  first.tm.clear();
  expect(failureOf(await first.send())?.reason).toBe("unauthenticated");
  expect(first.settings.onAccessExpired).toHaveBeenCalledTimes(2);
});

it("[auth.state.expired][auth.reason.unauthenticated] 会话过期后的无 token 请求不再通知，观察新登录后可开始下一轮", /** 过期通知同样覆盖后续本地拒绝。 */ async () => {
  const first = authClient({ onAccessDenied: undefined, onRefresh: /** 刷新失败判过期。 */ () => false });
  const second = authClient({ tokenManager: first.tm, onAccessDenied: undefined });
  first.net.on("get", REQUEST_URL, /** 触发过期。 */ () => failure(401));
  expect(failureOf(await run(first))?.reason).toBe("expired");
  expect(failureOf(await second.send())?.reason).toBe("unauthenticated");
  expect(first.settings.onAccessExpired).toHaveBeenCalledTimes(1);
  expect(second.settings.onAccessExpired).not.toHaveBeenCalled();
  first.tm.set(TOKEN_NEW, REFRESH_TOKEN);
  expect((await run(second)).ok).toBe(true);
  first.tm.clear();
  expect(failureOf(await second.send())?.reason).toBe("unauthenticated");
  expect(second.settings.onAccessExpired).toHaveBeenCalledTimes(1);
});

it("[auth.const.AuthFailureAction.Replay] 别处已换 token 后直接重放，仍 401 则判 expired：清会话、通知一次", /** 默认路由的 Replay 也只能重放一次，之后按过期落定。 */ async () => {
  const h = authClient();
  h.net.on("get", REQUEST_URL, /** 两次都返回服务端拒绝。 */ () => failure(401));
  const pending = h.send({ url: REQUEST_URL, latency: REFRESH_DELAY } as AxpRequestConfig);
  await vi.advanceTimersByTimeAsync(STALE_DELAY);
  h.tm.set(TOKEN_NEW, ROTATED_REFRESH);
  await vi.runAllTimersAsync();
  const response = await pending;
  expect(response.status).toBe(401);
  expect(failureOf(response)).toMatchObject({ type: "auth", reason: "expired" });
  expect(h.tm.accessToken).toBeUndefined();
  expect(h.settings.onRefresh).not.toHaveBeenCalled();
  expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
  expect(h.net.totalStarted).toBe(2);
});

it("[auth.state.singleFlight][auth.state.expired] 共用 tm 的两个客户端并发 401，单飞刷新成功但重放仍 401：只刷新一次、只通知一次、两边都判 expired", /** 重放后判过期不会因共享会话而重复通知。 */ async () => {
  /** 两个客户端共用的刷新与过期通知记录，便于直接数总次数。 */
  const refresh = vi.fn(
    /** 刷新写入新 token。 */ (_r: unknown, tm: ITokenManager) => {
      tm.set(TOKEN_NEW, REFRESH_TOKEN);
    },
  );
  const notice = vi.fn();
  const first = authClient({ onRefresh: refresh, onAccessExpired: notice });
  const second = authClient({ tokenManager: first.tm, onRefresh: refresh, onAccessExpired: notice });
  /** 刷新后服务端仍然拒绝，两边的重放都得到 401。 */
  first.net.on("get", REQUEST_URL, () => failure(401));
  second.net.on("get", REQUEST_URL, () => failure(401));
  const requests = [first.send({ url: REQUEST_URL }), second.send({ url: REQUEST_URL })];
  await vi.runAllTimersAsync();
  for (const response of await Promise.all(requests)) expect(failureOf(response)).toMatchObject({ type: "auth", reason: "expired" });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenCalledTimes(1);
  expect(first.tm.accessToken).toBeUndefined();
});

it("[auth.state.expired][auth.const.AuthFailureAction.Replay] 共享会话已过期时，迟到的 Replay 返回 expired 而不重复通知", /** 已过期优先于重放路由。 */ async () => {
  const first = authClient({ onRefresh: /** 先判会话过期。 */ () => false });
  const second = authClient({ tokenManager: first.tm, onFailure: /** 迟到响应要求重放。 */ () => AuthFailureAction.Replay });
  first.net.on("get", REQUEST_URL, /** 快响应触发刷新失败。 */ () => failure(401));
  second.net.on("get", REQUEST_URL, /** 迟到响应。 */ () => failure(401));
  const stale = second.send({ url: REQUEST_URL, latency: REFRESH_DELAY } as AxpRequestConfig);
  expect(failureOf(await run(first))?.reason).toBe("expired");
  expect(failureOf(await stale)?.reason).toBe("expired");
  expect(first.settings.onAccessExpired).toHaveBeenCalledTimes(1);
  expect(second.settings.onAccessExpired).not.toHaveBeenCalled();
});
