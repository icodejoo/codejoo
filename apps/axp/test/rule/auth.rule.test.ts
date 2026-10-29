import { businessAuthFailure } from "../helpers/b3";
import { AXP_FAILURE } from "../../src/response";
import { failureOf } from "../../src/response";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IAuthOptions } from "../../src/plugins/auth";
import axpAuth, { AuthFailureAction } from "../../src/plugins/auth";
import { isAxpResponse, type AxpResponse } from "../../src/response";
import type { AxpRequestConfig } from "../../src/types";
import { authHeader } from "../helpers/auth";
import { AUTH_NAME, authClient, failure, guarded, memoryTokens, REFRESH_TOKEN, REQUEST_URL, run, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";

/** 公开路由，不在受保护范围内。 */
/** 断言回调末位收到当前请求的上下文。 */
const ctxOf = (url: string) => expect.objectContaining({ request: expect.objectContaining({ url }) });
const PUBLIC_URL = "/public";
/** 受保护范围收窄到的前缀模式。 */
const API_PATTERN = "/api/*";
/** 在途期间模拟别处刷新所需的网络延迟。 */
const SLOW = { latency: 50 } as AxpRequestConfig;
/** 每个鉴权用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

describe("请求侧：保护判定与凭证注入", () => {
  it("[auth.cb.ready][auth.opt.tokenManager] 受保护请求默认注入 Authorization，token 变化后下一次请求带新值，不改调用方的头对象", /** 默认 ready 只写 Authorization。 */ async () => {
    const h = authClient();
    const seen: unknown[] = [];
    h.net.on(
      "get",
      REQUEST_URL,
      /** 记录凭证头与调用方头。 */ (config) => {
        seen.push([authHeader(config), config.headers.get("X-Trace")]);
      },
    );
    const headers = { "X-Trace": "1" };
    expect((await run(h, { headers })).ok).toBe(true);
    h.tm.set(TOKEN_NEW, REFRESH_TOKEN);
    expect((await run(h)).ok).toBe(true);
    expect(seen).toEqual([
      [TOKEN_OLD, "1"],
      [TOKEN_NEW, undefined],
    ]);
    expect(headers).toEqual({ "X-Trace": "1" });
  });

  it("[auth.req.protected] protected:false 本次公开：不注入、没有 token 也直接放行；protected:true 把范围外的请求也纳入保护", /** 请求级布尔覆盖插件范围。 */ async () => {
    const h = authClient({ urlPattern: API_PATTERN });
    h.tm.clear();
    const seen: unknown[] = [];
    h.net.on("get", PUBLIC_URL, /** 记录公开请求是否带凭证。 */ (config) => void seen.push(authHeader(config)));
    expect((await run(h, { url: PUBLIC_URL })).ok).toBe(true);
    expect((await run(h, { url: "/api/me", protected: false })).ok).toBe(true);
    const forced = await run(h, { url: PUBLIC_URL, protected: true });
    expect(forced).toMatchObject({ ok: false, [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
    expect(seen).toEqual([undefined]);
    expect(h.net.calls("GET", "/api/me")).toBe(1);
    expect(h.settings.onAccessDenied).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["默认全部受保护", {}, "get", REQUEST_URL, true],
    ["methods 命中不区分大小写", { methods: ["POST"] }, "post", REQUEST_URL, true],
    ["methods 未命中则公开", { methods: ["POST"] }, "get", REQUEST_URL, false],
    ["methods 字符串通配", { methods: "*" }, "delete", REQUEST_URL, true],
    ["urlPattern 命中绝对 URL 与查询串", { urlPattern: "/me" }, "get", "https://example.com/me?q=1", true],
    ["urlPattern 未命中其它路径", { urlPattern: "/me" }, "get", "/me/other", false],
    ["urlPattern 否定模式放行", { urlPattern: ["!/me/public"] }, "get", "/me/public", false],
    ["urlPattern 否定模式之外仍受保护", { urlPattern: ["!/me/public"] }, "get", "/me/x", true],
    ["methods 与 urlPattern 取交集", { methods: ["post"], urlPattern: "/me" }, "get", "/me", false],
    ["methods 含通配的数组", { methods: ["post", "*"] }, "get", REQUEST_URL, true],
    ["methods 空数组：没有方法受保护", { methods: [] }, "get", REQUEST_URL, false],
    ["methods 空串：没有方法受保护", { methods: "" }, "get", REQUEST_URL, false],
    ["methods 为 null：回退默认全部受保护", { methods: null }, "get", REQUEST_URL, true],
    ["urlPattern 空数组：没有路径受保护", { urlPattern: [] }, "get", REQUEST_URL, false],
    ["urlPattern 为 null：回退默认全部受保护", { urlPattern: null }, "get", REQUEST_URL, true],
  ] as const)(
    "[auth.opt.methods][auth.opt.urlPattern] %s",
    /** 无 token 时受保护请求以 unauthenticated 失败，公开请求照常发出。 */ async (_label, options, method, url, isProtected) => {
      const h = authClient(options as Partial<IAuthOptions<AxpResponse>>);
      h.tm.clear();
      const result = await run(h, { url, method });
      if (isProtected) expect(result).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
      else expect(result.ok).toBe(true);
      expect(h.net.totalStarted).toBe(isProtected ? 0 : 1);
    },
  );

  it("[auth.cb.isProtected] 布尔结果为终值；其它值回落到 methods/urlPattern；请求级 protected 优先于它", /** 三级判定优先级。 */ async () => {
    const isProtected = vi.fn(/** 范围外放行，/api 之下强制公开。 */ (request: Readonly<AxpRequestConfig>) => (request.url === PUBLIC_URL ? true : request.url?.startsWith("/api/") ? false : undefined));
    const h = authClient({ urlPattern: "/me", isProtected });
    h.tm.clear();
    expect(await run(h, { url: PUBLIC_URL })).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
    expect((await run(h, { url: "/api/x" })).ok).toBe(true);
    expect(await run(h, { url: "/me" })).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
    expect((await run(h, { url: "/other" })).ok).toBe(true);
    expect((await run(h, { url: PUBLIC_URL, protected: false })).ok).toBe(true);
    expect(isProtected).toHaveBeenCalledTimes(4);
  });

  it("[auth.cb.isProtected][auth.req.protected] 同一次尝试里 401 刷新重放只判定一次保护，不重复调用", /** 重放不重新求值。 */ async () => {
    const isProtected = vi.fn(/** 全部受保护。 */ () => true);
    const h = authClient({ isProtected });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(() => TOKEN_NEW),
    );
    expect((await run(h)).ok).toBe(true);
    expect(h.net.totalStarted).toBe(2);
    expect(isProtected).toHaveBeenCalledTimes(1);
    expect(isProtected).toHaveBeenCalledWith(expect.objectContaining({ url: REQUEST_URL }));
  });

  it("[auth.cb.ready] 自定义 ready 的补丁写入自定义头，401 路由按本次注入的 token 判断，与头名无关", /** 状态键记录注入快照。 */ async () => {
    const ready = vi.fn(
      /** 自定义凭证头，异步返回补丁。 */ async (tm: { accessToken?: string }, request: Readonly<AxpRequestConfig>) => ({
        headers: { "X-Token": tm.accessToken, "X-Url": request.url },
      }),
    );
    const h = authClient({ ready });
    const seen: unknown[] = [];
    h.net.on(
      "get",
      REQUEST_URL,
      /** 服务端只认 X-Token 里的新 token。 */ (config) => {
        const token = config.headers.get("X-Token");
        seen.push(token);
        return token === TOKEN_NEW ? {} : failure(401);
      },
    );
    expect((await run(h)).ok).toBe(true);
    expect(seen).toEqual([TOKEN_OLD, TOKEN_NEW]);
    expect(ready).toHaveBeenNthCalledWith(1, h.tm, expect.objectContaining({ url: REQUEST_URL }));
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("[auth.cb.ready] ready 不返回补丁时不改请求，仍照常发出", /** 空补丁等价于不注入。 */ async () => {
    const h = authClient({ ready: () => undefined });
    const seen: unknown[] = [];
    h.net.on("get", REQUEST_URL, /** 记录凭证头。 */ (config) => void seen.push(authHeader(config)));
    expect((await run(h)).ok).toBe(true);
    expect(seen).toEqual([undefined]);
  });
});

describe("本地无 token", () => {
  it.each([false, true])(
    "[auth.cb.onAccessDenied][auth.reason.unauthenticated] 受保护请求没有 token：不发出，onAccessDenied 通知一次，落定 auth/unauthenticated，throws:true 时抛 R，throws:false 时 resolve R",
    /** 本地拒绝不触网。 */ async (throws) => {
      const h = authClient();
      h.tm.clear();
      const pending = h.send({ url: REQUEST_URL, throws }).catch(/** 失败的 R 作为值观察。 */ (error: unknown) => error);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(isAxpResponse(result)).toBe(true);
      expect(result).toMatchObject({ ok: false, status: 0, [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
      expect(h.net.totalStarted).toBe(0);
      expect(h.settings.onAccessDenied).toHaveBeenCalledExactlyOnceWith(result, h.tm, ctxOf(REQUEST_URL));
      expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
      expect(h.settings.onRefresh).not.toHaveBeenCalled();
    },
  );

  it("[auth.cb.onAccessDenied][auth.cb.onAccessExpired] 没有配置 onAccessDenied 时沿用 onAccessExpired；配置了则只调用它", /** 越权通知缺省回退。 */ async () => {
    const fallback = authClient({ onAccessDenied: undefined });
    fallback.tm.clear();
    await run(fallback);
    expect(fallback.settings.onAccessExpired).toHaveBeenCalledTimes(1);
    const custom = authClient();
    custom.tm.clear();
    await run(custom);
    expect(custom.settings.onAccessDenied).toHaveBeenCalledTimes(1);
    expect(custom.settings.onAccessExpired).not.toHaveBeenCalled();
  });
});

describe.each([
  ["HTTP 状态", false],
  ["business 风格（HTTP 200 + 业务码，配置 onFailure）", true],
])("响应侧路由：%s", (_style, business) => {
  it("[auth.cb.onRefresh][auth.const.AuthFailureAction.Refresh] 401 且携带当前 token → 刷新一次后用新 token 重放成功，刷新回调收到 (r, tm)，成功结果不带过期原因", /** 刷新成功的主路径。 */ async () => {
    const h = authClient({ onFailure: business ? businessAuthFailure : undefined });
    const seen: unknown[] = [];
    const route = guarded(() => TOKEN_NEW, business);
    h.net.on(
      "get",
      REQUEST_URL,
      /** 记录每次携带的凭证。 */ (config, hit) => {
        seen.push(authHeader(config));
        return route(config, hit);
      },
    );
    const result = await run(h);
    expect(result.ok).toBe(true);
    expect(failureOf(result)?.reason).toBeUndefined();
    expect(seen).toEqual([TOKEN_OLD, TOKEN_NEW]);
    expect(h.settings.onRefresh).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: business ? 200 : 401, ok: false }), h.tm, ctxOf(REQUEST_URL));
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    expect(h.settings.onAccessDenied).not.toHaveBeenCalled();
  });

  it("[auth.cb.onRefresh][auth.cb.onAccessExpired][auth.cb.tokenManager.clear][auth.const.AuthFailureAction.Expired][auth.reason.expired] 刷新失败 → 清除会话、onAccessExpired 通知一次，落定 auth/expired 并保留原 HTTP 状态", /** 刷新返回 false 即过期。 */ async () => {
    const h = authClient({ onFailure: business ? businessAuthFailure : undefined, onRefresh: () => false });
    h.net.on("get", REQUEST_URL, () => failure(401, business));
    const result = await run(h);
    expect(result).toMatchObject({ ok: false, status: business ? 200 : 401, [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(h.tm.accessToken).toBeUndefined();
    expect(h.tm.refreshToken).toBeUndefined();
    expect(h.settings.onAccessExpired).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: business ? 200 : 401 }), h.tm, ctxOf(REQUEST_URL));
    expect(h.settings.onAccessDenied).not.toHaveBeenCalled();
    expect(h.net.totalStarted).toBe(1);
  });

  it("[auth.cb.onAccessDenied][auth.const.AuthFailureAction.Deny][auth.reason.denied] 403 → onAccessDenied 通知一次，会话保留，落定 auth/denied 并保留原 HTTP 状态，不刷新", /** 越权不是过期。 */ async () => {
    const h = authClient({ onFailure: business ? businessAuthFailure : undefined });
    h.net.on("get", REQUEST_URL, () => failure(403, business));
    const result = await run(h);
    expect(result).toMatchObject({ ok: false, status: business ? 200 : 403, [AXP_FAILURE]: { type: "auth", reason: "denied" } });
    expect(h.tm.accessToken).toBe(TOKEN_OLD);
    expect(h.settings.onAccessDenied).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: business ? 200 : 403 }), h.tm, ctxOf(REQUEST_URL));
    expect(h.settings.onRefresh).not.toHaveBeenCalled();
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    expect(h.net.totalStarted).toBe(1);
  });

  it("[auth.const.AuthFailureAction.Others] 无关失败（500）原样透传：不刷新、不清会话、不通知，也不改写成 auth", /** 路由不认识的状态不拦截。 */ async () => {
    const h = authClient({ onFailure: business ? businessAuthFailure : undefined });
    h.net.on("get", REQUEST_URL, () => failure(500, business));
    const result = await run(h);
    expect(result).toMatchObject({ ok: false, status: business ? 200 : 500 });
    expect(failureOf(result)?.reason).toBeUndefined();
    expect(h.tm.accessToken).toBe(TOKEN_OLD);
    expect(h.settings.onRefresh).not.toHaveBeenCalled();
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    expect(h.settings.onAccessDenied).not.toHaveBeenCalled();
  });
});

describe("响应侧路由：其它入口", () => {
  it("[auth.fn.axpAuth] 业务成功原样透传，不触发任何鉴权回调", /** 成功不经过路由。 */ async () => {
    const h = authClient();
    expect((await run(h)).ok).toBe(true);
    expect(h.net.totalStarted).toBe(1);
    for (const callback of [h.settings.onRefresh, h.settings.onAccessExpired, h.settings.onAccessDenied]) {
      expect(callback).not.toHaveBeenCalled();
    }
  });

  it("[auth.const.AuthFailureAction.Replay] 401 时 token 已被别处刷新（与本次注入不同）→ 不再刷新，直接用当前 token 重放", /** 并发刷新后的陈旧 401。 */ async () => {
    const h = authClient();
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(() => TOKEN_NEW),
    );
    const pending = h.send({ url: REQUEST_URL, ...SLOW });
    await vi.advanceTimersByTimeAsync(10);
    h.tm.set(TOKEN_NEW, REFRESH_TOKEN);
    await vi.runAllTimersAsync();
    expect((await pending).ok).toBe(true);
    expect(h.net.totalStarted).toBe(2);
    expect(h.settings.onRefresh).not.toHaveBeenCalled();
  });

  it("[auth.const.AuthFailureAction.Expired] 401 时会话已被清空（在途期间登出）→ 直接判过期：清除、通知一次、不刷新", /** 无 token 的 401 是过期。 */ async () => {
    const h = authClient();
    h.net.on("get", REQUEST_URL, () => failure(401));
    const pending = h.send({ url: REQUEST_URL, ...SLOW });
    await vi.advanceTimersByTimeAsync(10);
    h.tm.clear();
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: 401, [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
    expect(h.settings.onRefresh).not.toHaveBeenCalled();
  });

  it.each([
    [500, AuthFailureAction.Deny, "denied"],
    [502, AuthFailureAction.Expired, "expired"],
    [503, AuthFailureAction.Refresh, undefined],
    [504, AuthFailureAction.Replay, undefined],
    [500, AuthFailureAction.Others, undefined],
  ] as const)(
    "[auth.cb.onFailure] 自定义路由对 %i 返回 %s，覆盖默认分类",
    /** onFailure 收到 (r, tm, ctx)。 */ async (status, action, reason) => {
      const onFailure = vi.fn(/** 固定返回目标动作。 */ () => action);
      const h = authClient({ onFailure });
      h.net.on("get", REQUEST_URL, /** 首发失败，重放成功。 */ (_config, hit) => (hit === 1 ? failure(status) : {}));
      const result = await run(h);
      if (reason) expect(result).toMatchObject({ status, [AXP_FAILURE]: { type: "auth", reason: reason } });
      else if (action === AuthFailureAction.Others) expect(result).toMatchObject({ ok: false, status });
      else expect(result.ok).toBe(true);
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ status }), h.tm, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(h.settings.onRefresh).toHaveBeenCalledTimes(action === AuthFailureAction.Refresh ? 1 : 0);
    },
  );

  it("[auth.cb.onAccessDenied][auth.const.AuthFailureAction.Deny] 越权但没有 onAccessDenied 时沿用 onAccessExpired 通知，会话不清除", /** Deny 回退不等于过期。 */ async () => {
    const h = authClient({ onAccessDenied: undefined });
    h.net.on("get", REQUEST_URL, () => failure(403));
    expect(await run(h)).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "denied" } });
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
    expect(h.tm.accessToken).toBe(TOKEN_OLD);
  });
});

describe("刷新可用性（O4）", () => {
  it("[auth.state.expired][auth.cb.onAccessExpired] 过期后登录写入新 token 自动恢复刷新，不需要手动重置；再次过期再通知一次", /** 快照随 token 变化解除。 */ async () => {
    let server = "login-2";
    let calls = 0;
    const h = authClient({
      onRefresh: /** 第一次失败，之后按服务端 token 刷新，最后一轮再次失败。 */ (_r, tm) => {
        calls++;
        if (calls === 1 || calls === 3) return false;
        tm.set(server, REFRESH_TOKEN);
        return undefined;
      },
    });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(() => server),
    );
    expect(await run(h)).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
    h.tm.set("login-1", REFRESH_TOKEN);
    expect((await run(h)).ok).toBe(true);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(2);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
    server = "login-3";
    expect(await run(h)).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(3);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(2);
  });
});

describe("插件生命周期", () => {
  it("[auth.opt.enable][auth.prop.name] enable:false 不进链：不注入、不回调，请求级 protected:true 也不能重新开启；启用时 inspect 列在 credential 阶段", /** 插件级总开关。 */ async () => {
    const h = authClient({ enable: false });
    expect(h.api.inspect()).not.toContainEqual(expect.objectContaining({ name: AUTH_NAME }));
    h.tm.clear();
    const seen: unknown[] = [];
    h.net.on("get", REQUEST_URL, /** 记录凭证头。 */ (config) => void seen.push(authHeader(config)));
    expect((await run(h, { protected: true })).ok).toBe(true);
    expect(seen).toEqual([undefined]);
    expect(h.settings.onAccessDenied).not.toHaveBeenCalled();
    const enabled = authClient();
    expect(enabled.api.inspect()).toContainEqual({ name: AUTH_NAME, stage: "credential" });
  });

  it("[auth.method.lifecycle] eject 之后请求不再注入、也不走 401 路由；重名安装被拒绝", /** 卸载即停止所有行为。 */ async () => {
    const h = authClient();
    expect(() => h.api.use(axpAuth({ tokenManager: memoryTokens(), onRefresh: () => true, onAccessExpired: () => {} }))).toThrow("Duplicate plugin");
    expect(h.api.eject(AUTH_NAME)).toBe(true);
    expect(h.api.eject(AUTH_NAME)).toBe(false);
    h.net.on("get", REQUEST_URL, () => failure(401));
    const seen: unknown[] = [];
    h.net.on("get", "/seen", /** 记录凭证头。 */ (config) => void seen.push(authHeader(config)));
    expect(await run(h)).toMatchObject({ status: 401, ok: false });
    await run(h, { url: "/seen" });
    expect(seen).toEqual([undefined]);
    expect(h.settings.onRefresh).not.toHaveBeenCalled();
  });
});
