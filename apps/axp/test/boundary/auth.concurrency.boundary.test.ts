import { businessAuthFailure } from "../helpers/b3";
import { AXP_FAILURE } from "../../src/response";
import { failureOf } from "../../src/response";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ITokenManager } from "../../src/objects/TokenManager";
import axpAuth, { AuthFailureAction } from "../../src/plugins/auth";
import type { AxpResponse } from "../../src/response";
import { authClient, authSettings, b3Client, deferred, failure, guarded, REFRESH_TOKEN, REQUEST_URL, run, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";
/** 并发刷新场景的请求数。 */
const BURST = 30;
/** 每个鉴权用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 放行刷新窗口：由用例控制刷新结束的时机与结果。 */
function gatedRefresh() {
  const gate = deferred<boolean>();
  return {
    gate,
    onRefresh: /** 等门打开；成功则换上新 token。 */ async (_r: AxpResponse, tm: ITokenManager) => {
      const ok = await gate.promise;
      if (ok) tm.set(TOKEN_NEW, REFRESH_TOKEN);
      return ok;
    },
  };
}
/** 清空等待队列里的微任务与定时器。 */
async function settle(): Promise<void> {
  await vi.runAllTimersAsync();
}

describe("单飞刷新与排队", () => {
  it.each([false, true])(
    `[auth.cb.onRefresh] ${BURST} 个并发 401 在刷新窗口内共享同一次刷新，全部用新 token 重放成功（business=%s）`,
    /** I5：并发 401 只调用一次 onRefresh。 */ async (business) => {
      const { gate, onRefresh } = gatedRefresh();
      const h = authClient({ onFailure: business ? businessAuthFailure : undefined, onRefresh });
      h.net.on(
        "get",
        REQUEST_URL,
        guarded(() => TOKEN_NEW, business),
      );
      const all = Array.from({ length: BURST }, /** 同时发出的受保护请求。 */ () => h.send({ url: REQUEST_URL }));
      await settle();
      expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
      expect(h.net.totalStarted).toBe(BURST);
      gate.resolve(true);
      await settle();
      const results = await Promise.all(all);
      expect(results.every(/** 全部成功。 */ (r) => r.ok)).toBe(true);
      expect(h.net.totalStarted).toBe(BURST * 2);
      expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
      expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    },
  );

  it("[auth.cb.onRefresh][auth.req.protected] 刷新窗口内到达的新受保护请求等刷新完成后用新 token 发出，不触发二次刷新；公开请求不受阻塞", /** 排队请求不带旧 token 上路。 */ async () => {
    const { gate, onRefresh } = gatedRefresh();
    const h = authClient({ onRefresh });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(() => TOKEN_NEW),
    );
    h.net.on("get", "/public", () => ({}));
    const first = h.send({ url: REQUEST_URL });
    await settle();
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    const queued = h.send({ url: REQUEST_URL });
    expect((await run(h, { url: "/public", protected: false })).ok).toBe(true);
    expect(h.net.totalStarted).toBe(2);
    gate.resolve(true);
    await settle();
    expect((await first).ok).toBe(true);
    expect((await queued).ok).toBe(true);
    expect(h.net.log.map(/** 每次发送携带的凭证。 */ (record) => record.auth)).toEqual([TOKEN_OLD, undefined, TOKEN_NEW, TOKEN_NEW]);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("[auth.cb.onRefresh][auth.cb.onAccessExpired] 刷新失败：窗口内的 401 与排队请求全部失败为 auth/expired，不重放，onAccessExpired 只通知一次", /** 过期每轮只通知一次。 */ async () => {
    const { gate, onRefresh } = gatedRefresh();
    const h = authClient({ onRefresh });
    h.net.on("get", REQUEST_URL, () => failure(401));
    const bursts = Array.from({ length: 5 }, /** 先到的 401。 */ () => h.send({ url: REQUEST_URL }));
    await settle();
    const queued = h.send({ url: REQUEST_URL });
    gate.resolve(false);
    await settle();
    const results = await Promise.all([...bursts, queued]);
    expect(results.every(/** 全部过期。 */ (r) => failureOf(r)?.type === "auth" && failureOf(r)?.reason === "expired")).toBe(true);
    expect(results[5].status).toBe(0);
    expect(h.net.totalStarted).toBe(5);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
    expect(h.tm.accessToken).toBeUndefined();
  });

  it("[auth.cb.onAccessExpired][auth.const.AuthFailureAction.Expired] 多个请求连续走到 Expired → 会话只清一次、onAccessExpired 只通知一次", /** 过期通知按轮次去重。 */ async () => {
    const h = authClient({ onFailure: () => AuthFailureAction.Expired });
    const clear = vi.spyOn(h.tm, "clear");
    h.net.on("get", REQUEST_URL, () => failure(401));
    const all = Array.from({ length: 3 }, /** 并发请求。 */ () => h.send({ url: REQUEST_URL }));
    await settle();
    const results = await Promise.all(all);
    expect(results.every(/** 全部过期。 */ (r) => failureOf(r)?.reason === "expired")).toBe(true);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "[auth.state.singleFlight] 两客户端共用 tm，共享一次刷新并都成功（分别创建插件=%s）",
    /** 共享由 tm 身份决定。 */ async (separate) => {
      const { gate, onRefresh } = gatedRefresh();
      const settings = authSettings({ onRefresh });
      const plugin = axpAuth(settings);
      const first = b3Client([plugin]);
      const second = b3Client([separate ? axpAuth(settings) : plugin]);
      for (const h of [first, second])
        h.net.on(
          "get",
          REQUEST_URL,
          guarded(() => TOKEN_NEW),
        );
      const a = first.send({ url: REQUEST_URL });
      const b = second.send({ url: REQUEST_URL });
      await settle();
      expect(settings.onRefresh).toHaveBeenCalledTimes(1);
      gate.resolve(true);
      await settle();
      expect((await a).ok).toBe(true);
      expect((await b).ok).toBe(true);
      expect(settings.onAccessExpired).not.toHaveBeenCalled();
    },
  );
});

describe("刷新期间取消", () => {
  it("[auth.cb.onRefresh] 排队中的请求被取消：只有它以 cancel 结束，刷新继续，其余请求照常重放成功，监听全部释放", /** 取消只影响当前等待者。 */ async () => {
    const { gate, onRefresh } = gatedRefresh();
    const h = authClient({ onRefresh });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(() => TOKEN_NEW),
    );
    const first = h.send({ url: REQUEST_URL });
    await settle();
    const controller = new AbortController();
    const queued = h.send({ url: REQUEST_URL, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await settle();
    expect(await queued).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    gate.resolve(true);
    await settle();
    expect((await first).ok).toBe(true);
    expect(h.net.totalStarted).toBe(2);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("[auth.cb.onRefresh] 发起刷新的请求被取消：它以 cancel 结束，刷新仍为其它请求完成并重放成功", /** 刷新不依赖发起者存活。 */ async () => {
    const { gate, onRefresh } = gatedRefresh();
    const h = authClient({ onRefresh });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(() => TOKEN_NEW),
    );
    const controller = new AbortController();
    const initiator = h.send({ url: REQUEST_URL, signal: controller.signal });
    await settle();
    const joiner = h.send({ url: REQUEST_URL });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await settle();
    expect(await initiator).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    gate.resolve(true);
    await settle();
    expect((await joiner).ok).toBe(true);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    "[auth.cb.onRefresh][auth.cb.onAccessExpired] 刷新期间 cancelAll：等待者全部 cancel 且不重放；刷新结果 %s 仍照常落到会话",
    /** 共享刷新不随取消中止。 */ async (success) => {
      const { gate, onRefresh } = gatedRefresh();
      const h = authClient({ onRefresh });
      h.net.on("get", REQUEST_URL, () => failure(401));
      const waiting = h.send({ url: REQUEST_URL });
      await settle();
      const queued = h.send({ url: REQUEST_URL });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.api.cancelAll()).toBe(2);
      await settle();
      expect(await waiting).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
      expect(await queued).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
      gate.resolve(success);
      await settle();
      expect(h.net.totalStarted).toBe(1);
      expect(h.tm.accessToken).toBe(success ? TOKEN_NEW : undefined);
      expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(success ? 0 : 1);
    },
  );

  it("[auth.cb.onFailure][auth.cb.onRefresh] 判定路由期间信号已中止：请求以 cancel 结束，不等待刷新", /** 进入等待前就已中止。 */ async () => {
    const controller = new AbortController();
    const h = authClient({
      onFailure: /** 路由时被取消，随后仍要求刷新。 */ () => {
        controller.abort();
        return AuthFailureAction.Refresh;
      },
      onRefresh: () => new Promise<boolean>(/** 刷新永不结束，验证不会被等待。 */ () => undefined),
    });
    h.net.on("get", REQUEST_URL, () => failure(401));
    expect(await run(h, { signal: controller.signal })).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
  });

  it("[auth.cb.onRefresh] 请求到达 auth 时信号已中止且刷新进行中：直接以 cancel 结束，不等待刷新", /** 入口处的取消快路径。 */ async () => {
    const { gate, onRefresh } = gatedRefresh();
    const h = authClient({ onRefresh });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(() => TOKEN_NEW),
    );
    h.api.use({
      name: "cancel-before-auth",
      stage: "prepare",
      /** 请求 /late 到达前先取消全部，使其在刷新窗口内带着已中止的信号进入 auth。 */
      async handle(ctx, next) {
        if (ctx.request.url === "/late") ctx.client.cancelAll();
        return next();
      },
    });
    const first = h.send({ url: REQUEST_URL });
    await settle();
    const late = h.send({ url: "/late" });
    await settle();
    expect(await late).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    expect(await first).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    gate.resolve(true);
    await settle();
    expect(h.net.totalStarted).toBe(1);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("异步回调期间的会话变化", () => {
  it("[auth.cb.onFailure] 异步路由期间调用方取消：以 cancel 落定，不再触发 denied/expired 通知", /** 路由结果晚于取消到达。 */ async () => {
    const gate = deferred<AuthFailureAction>();
    const h = authClient({ onFailure: () => gate.promise });
    h.net.on("get", REQUEST_URL, () => failure(403));
    const controller = new AbortController();
    const pending = h.send({ url: REQUEST_URL, signal: controller.signal });
    await settle();
    controller.abort();
    gate.resolve(AuthFailureAction.Deny);
    await settle();
    expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    expect(h.settings.onAccessDenied).not.toHaveBeenCalled();
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
  });

  it("[auth.cb.ready] 异步 ready 期间 token 被替换：按实际注入的新 token 记快照，401 走刷新而非重放后判过期", /** 快照与注入保持一致。 */ async () => {
    const fresh = "token-fresh";
    const gate = deferred<void>();
    let calls = 0;
    const h = authClient({
      ready: /** 首次准备卡在门上，放行后才读 token。 */ async (tm) => {
        if (calls++ === 0) await gate.promise;
        return { headers: { Authorization: tm.accessToken } };
      },
      onRefresh: /** 刷新换上服务端认可的 token。 */ (_r, tm) => {
        tm.set(fresh, REFRESH_TOKEN);
      },
    });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(() => fresh),
    );
    const pending = h.send({ url: REQUEST_URL });
    await settle();
    h.tm.set(TOKEN_NEW, REFRESH_TOKEN);
    gate.resolve();
    await settle();
    expect((await pending).ok).toBe(true);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    expect(h.net.log.map(/** 首发与重放的凭证。 */ (record) => record.auth)).toEqual([TOKEN_NEW, fresh]);
  });

  it("[auth.cb.onRefresh][auth.cb.onAccessDenied] 刷新期间登出：重放前在本地拒绝为 unauthenticated，不发出无凭证请求", /** 每次重放前都核对凭证。 */ async () => {
    const h = authClient({
      onRefresh: /** 刷新写入新 token 后用户随即登出。 */ (_r, tm) => {
        tm.set(TOKEN_NEW, REFRESH_TOKEN);
        tm.clear();
        return true;
      },
    });
    h.net.on("get", REQUEST_URL, () => failure(401));
    expect(await run(h)).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
    expect(h.net.totalStarted).toBe(1);
    expect(h.settings.onAccessDenied).toHaveBeenCalledTimes(1);
  });
});
