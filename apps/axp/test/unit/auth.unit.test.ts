import { describe, expect, it, vi } from "vitest";
import type { AxpContext } from "../../src/context";
import axpAuth, { AuthFailureAction, defaultAuthFailure } from "../../src/plugins/auth";
import type { AxpResponse } from "../../src/response";
import { memoryTokens } from "../helpers/b3";

/** 受保护请求注入过的 token 与会话当前 token 的对照夹具。 */
const INJECTED = "injected";
const OTHER = "other";
/** 只提供状态读取的上下文替身，defaultAuthFailure 只会 get 注入快照。 */
function ctxWith(injected: string | undefined): AxpContext<AxpResponse> {
  return { get: vi.fn(/** 只读注入快照。 */ () => injected) } as unknown as AxpContext<AxpResponse>;
}
/** 只带逻辑状态的响应替身。 */
function statusOf(status: number): AxpResponse {
  return { status } as AxpResponse;
}
/** 以指定 access token 建立会话，undefined 表示未登录。 */
function tokensOf(access: string | undefined) {
  const tm = memoryTokens();
  tm.set(access);
  return tm;
}
/** 五个动作的稳定字面量。 */
const ACTION_VALUES = {
  Refresh: "refresh",
  Replay: "replay",
  Deny: "deny",
  Expired: "expired",
  Others: "others",
};

describe("defaultAuthFailure", () => {
  it.each([
    ["401 无 token", 401, undefined, undefined, AuthFailureAction.Expired],
    ["401 空串 token 视为无 token", 401, "", INJECTED, AuthFailureAction.Expired],
    ["401 携带与当前一致", 401, INJECTED, INJECTED, AuthFailureAction.Refresh],
    ["401 携带与当前不一致（已被并发刷新）", 401, OTHER, INJECTED, AuthFailureAction.Replay],
    ["401 没有注入记录", 401, OTHER, undefined, AuthFailureAction.Replay],
    ["403 有 token", 403, INJECTED, INJECTED, AuthFailureAction.Deny],
    ["403 无 token", 403, undefined, undefined, AuthFailureAction.Deny],
    ["403 空串 token 视为无 token", 403, "", undefined, AuthFailureAction.Deny],
    ["500", 500, INJECTED, INJECTED, AuthFailureAction.Others],
    ["200", 200, INJECTED, INJECTED, AuthFailureAction.Others],
    ["状态 0", 0, INJECTED, INJECTED, AuthFailureAction.Others],
    ["状态 NaN", NaN, INJECTED, INJECTED, AuthFailureAction.Others],
    ["状态为负", -401, INJECTED, INJECTED, AuthFailureAction.Others],
  ])(
    "[auth.fn.defaultAuthFailure][auth.const.AuthFailureAction] %s",
    /** 只读逻辑状态与注入快照，不解析请求头。 */ (_label, status, current, injected, expected) => {
      const tm = tokensOf(current);
      expect(defaultAuthFailure(statusOf(status), tm, ctxWith(injected))).toBe(expected);
    },
  );

  it("[auth.fn.defaultAuthFailure] 无状态：连续用不同会话判定互不影响", /** 同一函数多次调用。 */ () => {
    const first = tokensOf(INJECTED);
    const second = tokensOf(undefined);
    expect(defaultAuthFailure(statusOf(401), first, ctxWith(INJECTED))).toBe(AuthFailureAction.Refresh);
    expect(defaultAuthFailure(statusOf(401), second, ctxWith(INJECTED))).toBe(AuthFailureAction.Expired);
    expect(defaultAuthFailure(statusOf(401), first, ctxWith(INJECTED))).toBe(AuthFailureAction.Refresh);
  });
});

describe("AuthFailureAction", () => {
  it("[auth.const.AuthFailureAction] 五个动作的值稳定，且同时可作值和类型使用", /** 值和类型同名导出。 */ () => {
    expect({ ...AuthFailureAction }).toEqual(ACTION_VALUES);
    const typed: AuthFailureAction = AuthFailureAction.Refresh;
    expect(typed).toBe("refresh");
  });
});

describe("axpAuth 装配", () => {
  const refresh = vi.fn();
  const expired = vi.fn();
  it.each([
    ["缺 tokenManager", { onRefresh: refresh, onAccessExpired: expired }, "options.tokenManager is required"],
    ["缺 onRefresh", { tokenManager: memoryTokens(), onAccessExpired: expired }, "options.onRefresh is required"],
    ["缺 onAccessExpired", { tokenManager: memoryTokens(), onRefresh: refresh }, "options.onAccessExpired is required"],
    ["onRefresh 不是函数", { tokenManager: memoryTokens(), onRefresh: "x", onAccessExpired: expired }, "options.onRefresh is required"],
    ["整个选项缺失", undefined, "options.tokenManager is required"],
    ["选项为 null", null, "options.tokenManager is required"],
  ])(
    "[auth.opt.tokenManager][auth.cb.onRefresh][auth.cb.onAccessExpired] %s 创建时即抛错",
    /** 必填项在装配期校验，不拖到首个请求。 */ (_label, options, message) => {
      expect(() => axpAuth(options as never)).toThrow(message);
    },
  );

  it("[auth.prop.name] 工厂与插件名称都稳定为 axp:auth，enable 原样透出", /** 工厂 name 被锁定。 */ () => {
    const plugin = axpAuth({
      tokenManager: memoryTokens(),
      onRefresh: refresh,
      onAccessExpired: expired,
    });
    expect(axpAuth.name).toBe("axp:auth");
    expect(plugin.name).toBe("axp:auth");
    expect(plugin.stage).toBe("credential");
    expect(plugin.enable).toBeUndefined();
    expect(
      axpAuth({
        tokenManager: memoryTokens(),
        onRefresh: refresh,
        onAccessExpired: expired,
        enable: false,
      }).enable,
    ).toBe(false);
  });
});
