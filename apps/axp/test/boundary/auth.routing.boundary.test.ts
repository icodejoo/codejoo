import { businessAuthFailure } from "../helpers/b3";
import { AXP_FAILURE } from "../../src/response";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ITokenManager } from "../../src/objects/TokenManager";
import { AuthFailureAction } from "../../src/plugins/auth";
import type { AxpRequestConfig } from "../../src/types";
import { authClient, failure, memoryTokens, POLLUTED_ONCE, pollutingBody, pollutingTransform, REFRESH_TOKEN, REQUEST_URL, run, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";

/** 通知与判定回调的原始故障。 */
const BUG = new Error("auth callback bug");
/** 让请求在途一段时间，便于插入刷新或取消。 */
const SLOW = { latency: 50 } as AxpRequestConfig;
/** 每个鉴权用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});
/** 清空等待队列里的微任务与定时器。 */
async function settle(): Promise<void> {
  await vi.runAllTimersAsync();
}

describe("路由与防回环边界", () => {
  it.each([[null], [undefined], ["unknown"], [42], [{}]])(
    "[auth.const.AuthFailureAction.Others][auth.cb.onFailure] onFailure 返回 %j → 按 Others：原响应透传，不刷新、不清会话",
    /** 未知动作不触发任何副作用。 */ async (value) => {
      const h = authClient({ onFailure: () => value as never });
      h.net.on("get", REQUEST_URL, () => failure(401));
      expect(await run(h)).toMatchObject({ status: 401, ok: false });
      expect(h.tm.accessToken).toBe(TOKEN_OLD);
      expect(h.settings.onRefresh).not.toHaveBeenCalled();
      expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "[auth.cb.onRefresh][auth.const.AuthFailureAction.Replay] 刷新成功但服务端仍拒绝 → 只重放一次后判过期，不无限循环（business=%s）",
    /** 重放后仍 401 的防回环。 */ async (business) => {
      const h = authClient({ onFailure: business ? businessAuthFailure : undefined });
      h.net.on("get", REQUEST_URL, () => failure(401, business));
      expect(await run(h)).toMatchObject({ status: business ? 200 : 401, [AXP_FAILURE]: { type: "auth", reason: "expired" } });
      expect(h.net.totalStarted).toBe(2);
      expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
      expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
      expect(h.tm.accessToken).toBeUndefined();
    },
  );

  it("[auth.const.AuthFailureAction.Replay] onFailure 一直要求重放 → 第二次同样判过期，不刷新、只发两次", /** 自定义路由也受防回环约束。 */ async () => {
    const h = authClient({ onFailure: () => AuthFailureAction.Replay });
    h.net.on("get", REQUEST_URL, () => failure(401));
    expect(await run(h)).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(h.net.totalStarted).toBe(2);
    expect(h.settings.onRefresh).not.toHaveBeenCalled();
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
    expect(h.tm.accessToken).toBeUndefined();
  });

  it.each([false, true])(
    "[auth.cb.onRefresh][auth.cb.onAccessExpired] 刷新成功后重放遇到无关错误（500）→ 会话不清、不通知过期，500 原样传播（business=%s）",
    /** 重放得到的无关失败不当作过期。 */ async (business) => {
      const h = authClient({ onFailure: business ? businessAuthFailure : undefined });
      h.net.on("get", REQUEST_URL, /** 首发 401，重放 500。 */ (_config, hit) => failure(hit === 1 ? 401 : 500, business));
      expect(await run(h)).toMatchObject({ ok: false, status: business ? 200 : 500 });
      expect(h.tm.accessToken).toBe(TOKEN_NEW);
      expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["network", AxiosError.ERR_NETWORK],
    ["timeout", AxiosError.ETIMEDOUT],
  ] as const)(
    "[auth.fn.axpAuth][auth.cb.onFailure] 没有 HTTP 响应的失败（%s）原样透传，不被误判为鉴权问题：默认路由判 Others，自定义路由也能收到",
    /** 无状态码的失败不触发刷新。 */ async (kind, code) => {
      const onFailure = vi.fn(/** 观察自定义路由确实能收到这类失败。 */ () => undefined);
      const clients = [authClient({ onFailure }), authClient()];
      for (const h of clients)
        h.net.on(
          "get",
          REQUEST_URL,
          /** 模拟传输层失败。 */ () => {
            throw new AxiosError("fail", code);
          },
        );
      const results = await Promise.all(clients.map(/** 两个客户端并行发起。 */ (h) => run(h)));
      for (const [index, result] of results.entries()) {
        expect(result).toMatchObject({ ok: false, status: 0, [AXP_FAILURE]: { type: kind } });
        expect(clients[index].settings.onRefresh).not.toHaveBeenCalled();
        expect(clients[index].tm.accessToken).toBe(TOKEN_OLD);
      }
      expect(onFailure).toHaveBeenCalledTimes(1);
    },
  );

  it("[auth.fn.axpAuth] internal 与 cancel 不进入路由：onFailure 不会被调用，bug 抛原始异常，取消落定为 cancel", /** 程序错误与取消直接放行。 */ async () => {
    const onFailure = vi.fn(/** 不应被调用。 */ () => AuthFailureAction.Refresh);
    const buggy = authClient({ onFailure });
    buggy.api.use({
      name: "boom",
      stage: "source",
      handle: /** 内层中间件故障。 */ async () => {
        throw BUG;
      },
    });
    await expect(run(buggy)).rejects.toBe(BUG);
    const cancelled = authClient({ onFailure });
    cancelled.net.on("get", REQUEST_URL, () => failure(401));
    const controller = new AbortController();
    const pending = cancelled.send({ url: REQUEST_URL, signal: controller.signal, ...SLOW });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await settle();
    expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    expect(onFailure).not.toHaveBeenCalled();
    expect(cancelled.settings.onRefresh).not.toHaveBeenCalled();
  });

  it.each([["yes"], [1], [null], [{}], [() => true]])(
    "[auth.req.protected] 请求级 protected 取 %s（非布尔）→ 按省略处理，沿用插件范围判定",
    /** 只有布尔值才覆盖判定。 */ async (value) => {
      const h = authClient({ urlPattern: "/me" });
      h.tm.clear();
      expect(await run(h, { url: "/me", protected: value as never })).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
      expect((await run(h, { url: "/other", protected: value as never })).ok).toBe(true);
    },
  );

  it.each([[null], [undefined], [0], ["yes"]])(
    "[auth.cb.isProtected] isProtected 返回 %s（非布尔）→ 回落到 methods/urlPattern",
    /** 只有布尔返回值才是终值。 */ async (value) => {
      const h = authClient({ urlPattern: "/me", isProtected: () => value as never });
      h.tm.clear();
      expect(await run(h, { url: "/me" })).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
      expect((await run(h, { url: "/other" })).ok).toBe(true);
    },
  );
});

describe("过期后的刷新可用性（O4）", () => {
  it("[auth.state.expired][auth.cb.onAccessExpired] 会话管理器清除后 token 仍在：token 未变前不再刷新、不重复通知；写入新 token 后恢复，再次过期再通知", /** 快照与当前 token 比较决定是否恢复。 */ async () => {
    const store = memoryTokens();
    const sticky: ITokenManager = {
      get accessToken() {
        return store.accessToken;
      },
      get refreshToken() {
        return store.refreshToken;
      },
      set: store.set.bind(store),
      clear: /** 模拟不真正清除的自定义实现。 */ () => undefined,
    };
    const h = authClient({ tokenManager: sticky, onRefresh: () => false });
    h.net.on("get", REQUEST_URL, () => failure(401));
    expect(await run(h)).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(await run(h)).toMatchObject({ status: 401, [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(h.net.totalStarted).toBe(2);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
    store.set("login-2", REFRESH_TOKEN);
    expect(await run(h)).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(2);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(2);
  });

  it("[auth.state.expired][auth.const.AuthFailureAction.Refresh] 过期后还在途的旧请求回来被要求刷新：同一轮不再刷新、不重复通知", /** 在途旧请求不触发第二次刷新。 */ async () => {
    const h = authClient({ onFailure: () => AuthFailureAction.Refresh, onRefresh: () => false });
    h.net.on("get", REQUEST_URL, () => failure(401));
    const fast = h.send({ url: REQUEST_URL });
    const stale = h.send({ url: REQUEST_URL, ...SLOW });
    await settle();
    expect(await fast).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(await stale).toMatchObject({ status: 401, [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
  });
});

describe("请求体一致性（I7）", () => {
  it("[auth.fn.axpAuth][auth.cb.onRefresh] 401 刷新重放：原地转换累积到重放与调用方请求体", /** 首发使用原引用，修改会随重放累积。 */ async () => {
    const h = authClient();
    const bodies: unknown[] = [];
    h.net.on(
      "post",
      REQUEST_URL,
      /** 记录每次发出的请求体。 */ (config, hit) => {
        bodies.push(config.data);
        return hit === 1 ? failure(401) : {};
      },
    );
    const data = pollutingBody();
    const result = await run(h, { method: "post", data, transformRequest: [pollutingTransform] });
    expect(result.ok).toBe(true);
    expect(bodies).toEqual([POLLUTED_ONCE, JSON.stringify({ items: [{ n: 2 }] })]);
    expect(data).toEqual({ items: [{ n: 2 }] });
    expect(h.net.log.map(/** 首发与重放的凭证。 */ (record) => record.auth)).toEqual([TOKEN_OLD, TOKEN_NEW]);
  });
});
