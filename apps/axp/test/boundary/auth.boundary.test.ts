import { AXP_FAILURE } from "../../src/response";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ITokenManager } from "../../src/objects/TokenManager";
import axpAuth, { AuthFailureAction } from "../../src/plugins/auth";
import type { AxpResponse } from "../../src/response";
import { authClient, b3Client, failure, guarded, memoryTokens, REFRESH_TOKEN, REQUEST_URL, run, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";

/** 通知与判定回调的原始故障。 */
const BUG = new Error("auth callback bug");
/** 通知回调故障的统一输出前缀。 */
const NOTICE_LABEL = expect.stringContaining("axp:auth");
/** 每个鉴权用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

describe("会话与 token 边界", () => {
  it.each([undefined, "", null])(
    "[auth.opt.tokenManager.accessToken] accessToken 为 %s 视为未登录：拒绝请求并走 onAccessDenied，不发出",
    /** 空值不算凭证。 */ async (access) => {
      const h = authClient();
      h.tm.set(access as string | undefined, REFRESH_TOKEN);
      expect(await run(h)).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
      expect(h.net.totalStarted).toBe(0);
      expect(h.settings.onAccessDenied).toHaveBeenCalledTimes(1);
    },
  );

  it("[auth.opt.urlPattern] 请求没有 url 时按根路径匹配保护范围", /** 缺省 url 等价于根路径。 */ async () => {
    const h = authClient({ urlPattern: "/" });
    h.tm.clear();
    expect(await run(h, { url: undefined })).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
  });

  it("[auth.cb.tokenManager.set] set(undefined) 视同登出：下一次受保护请求被拒绝，登录后恢复", /** 登出再登录。 */ async () => {
    const h = authClient();
    expect((await run(h)).ok).toBe(true);
    h.tm.set(undefined, undefined);
    expect(await run(h)).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
    h.tm.set(TOKEN_NEW, REFRESH_TOKEN);
    expect((await run(h)).ok).toBe(true);
    expect(h.net.totalStarted).toBe(2);
  });

  it("[auth.opt.tokenManager.refreshToken] refreshToken 为空：onRefresh 照常收到管理器，返回 false 判过期", /** 刷新凭证缺失由 onRefresh 自行判断。 */ async () => {
    const seen: unknown[] = [];
    const h = authClient({
      onRefresh: /** 看到空刷新凭证后放弃。 */ (_r, tm) => {
        seen.push(tm.refreshToken);
        return false;
      },
    });
    h.tm.set(TOKEN_OLD, undefined);
    h.net.on("get", REQUEST_URL, () => failure(401));
    expect(await run(h)).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    expect(seen).toEqual([undefined]);
  });

  it.each([
    ["空返回", undefined, true],
    ["true", true, true],
    ["0", 0, true],
    ["null", null, true],
    ["字符串", "done", true],
    ["false", false, false],
  ])(
    "[auth.cb.onRefresh] 刷新返回 %s：只有 false 算失败",
    /** 只有显式 false 才是失败。 */ async (_label, value, success) => {
      const h = authClient({
        onRefresh: /** 先换新 token 再返回指定值。 */ (_r, tm) => {
          if (success) tm.set(TOKEN_NEW, REFRESH_TOKEN);
          return value;
        },
      });
      h.net.on(
        "get",
        REQUEST_URL,
        guarded(() => TOKEN_NEW),
      );
      const result = await run(h);
      if (success) expect(result.ok).toBe(true);
      else expect(result).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "expired" } });
    },
  );
});

describe("刷新失败：抛错也算失败，不死锁", () => {
  it.each([
    [
      "同步抛错",
      /** 直接抛出。 */ () => {
        throw BUG;
      },
    ],
    [
      "异步拒绝",
      /** 返回拒绝的承诺。 */ async () => {
        throw BUG;
      },
    ],
    [
      "内部 tm.set 抛错",
      /** 写入会话失败。 */ (_r: AxpResponse, tm: ITokenManager) => {
        tm.set(TOKEN_NEW, REFRESH_TOKEN);
      },
    ],
  ] as const)(
    "[auth.cb.onRefresh][auth.cb.tokenManager.set] 刷新%s → 按失败处理：过期、不当 bug 抛出；debug 下记录一条警告；后续请求按未登录处理，登录后恢复",
    /** 刷新失败被收敛为 expired。 */ async (label, onRefresh) => {
      const base = memoryTokens();
      const tm: ITokenManager = {
        get accessToken() {
          return base.accessToken;
        },
        get refreshToken() {
          return base.refreshToken;
        },
        set:
          label === "内部 tm.set 抛错"
            ? () => {
                throw BUG;
              }
            : base.set.bind(base),
        clear: base.clear.bind(base),
      };
      const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const refresh = vi.fn(onRefresh as never);
      const h = b3Client(
        [
          axpAuth({
            tokenManager: tm,
            onRefresh: refresh,
            onAccessExpired: vi.fn(),
            onAccessDenied: vi.fn(),
          }),
        ],
        { debug: logger },
      );
      let server = "unreachable";
      h.net.on(
        "get",
        REQUEST_URL,
        guarded(() => server),
      );
      expect(await run(h)).toMatchObject({ ok: false, [AXP_FAILURE]: { type: "auth", reason: "expired" } });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("onRefresh"), BUG);
      expect(tm.accessToken).toBeUndefined();
      expect(await run(h)).toMatchObject({ [AXP_FAILURE]: { type: "auth", reason: "unauthenticated" } });
      base.set(TOKEN_NEW, REFRESH_TOKEN);
      server = TOKEN_NEW;
      expect((await run(h)).ok).toBe(true);
    },
  );
});

describe("通知类回调抛错被隔离（N13）", () => {
  it.each([
    ["onAccessExpired", "sync", "expired"],
    ["onAccessExpired", "async", "expired"],
    ["onAccessDenied", "sync", "denied"],
    ["onAccessDenied", "async", "denied"],
    ["onAccessDenied", "sync", "unauthenticated"],
    ["onAccessDenied", "async", "unauthenticated"],
  ] as const)(
    "[auth.cb.onAccessExpired][auth.cb.onAccessDenied] %s 的 %s 故障：请求结果不变，console.error 恰好一次，状态不受影响（%s）",
    /** 通知异常不进入请求结果。 */ async (name, mode, reason) => {
      const error = vi.spyOn(console, "error").mockImplementation(/** 静默输出。 */ () => undefined);
      const notice =
        mode === "sync"
          ? vi.fn(
              /** 同步抛错。 */ () => {
                throw BUG;
              },
            )
          : vi.fn(
              /** 异步拒绝。 */ async () => {
                throw BUG;
              },
            );
      const h = authClient({ [name]: notice, onRefresh: () => false } as never);
      if (reason === "unauthenticated") h.tm.clear();
      h.net.on("get", REQUEST_URL, () => failure(reason === "denied" ? 403 : 401));
      expect(await run(h)).toMatchObject({ ok: false, [AXP_FAILURE]: { type: "auth", reason: reason } });
      expect(notice).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledExactlyOnceWith(NOTICE_LABEL, BUG);
    },
  );
});

describe("判定类回调抛错按 bug 抛原始异常（N13）", () => {
  it.each([
    [
      "onFailure 同步抛错",
      {
        onFailure: /** 同步故障。 */ () => {
          throw BUG;
        },
      },
    ],
    [
      "onFailure 异步拒绝",
      {
        onFailure: /** 异步故障。 */ async () => {
          throw BUG;
        },
      },
    ],
    [
      "isProtected 抛错",
      {
        isProtected: /** 判定故障。 */ () => {
          throw BUG;
        },
      },
    ],
    [
      "ready 同步抛错",
      {
        ready: /** 注入故障。 */ () => {
          throw BUG;
        },
      },
    ],
    [
      "ready 异步拒绝",
      {
        ready: /** 异步注入故障。 */ async () => {
          throw BUG;
        },
      },
    ],
  ] as const)(
    "[auth.cb.onFailure][auth.cb.isProtected][auth.cb.ready] %s → 调用方拿到原始异常，不被改成 auth 失败，也不留下坏状态",
    /** 程序 bug 不伪装成鉴权失败。 */ async (_label, override) => {
      const h = authClient(override as never);
      h.net.on("get", REQUEST_URL, () => failure(401));
      await expect(run(h)).rejects.toBe(BUG);
      expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
      expect(h.settings.onAccessDenied).not.toHaveBeenCalled();
      expect(h.api.pending()).toBe(0);
    },
  );

  it("[auth.cb.onFailure] 抛错后同一客户端的刷新状态没有被污染：下一次请求仍可正常刷新", /** 单飞状态不因故障残留。 */ async () => {
    let broken = true;
    const h = authClient({
      onFailure: /** 第一次故障，其后只对 401 要求刷新。 */ (r) => {
        if (broken) throw BUG;
        return r.status === 401 ? AuthFailureAction.Refresh : AuthFailureAction.Others;
      },
    });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(() => TOKEN_NEW),
    );
    await expect(run(h)).rejects.toBe(BUG);
    broken = false;
    expect((await run(h)).ok).toBe(true);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  });
});
