import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ITokenManager } from "../../src/objects/TokenManager";
import axpAuth, { AuthFailureAction } from "../../src/plugins/auth";
import type { AxpResponse } from "../../src/response";
import type { AxpRequestConfig } from "../../src/types";
import { authClient, authSettings, b3Client, deferred, failure, guarded, memoryTokens, POLLUTED_ONCE, pollutingBody, pollutingTransform, REFRESH_TOKEN, REQUEST_URL, run, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";

/** 通知与判定回调的原始故障。 */
const BUG = new Error("auth callback bug");
/** 并发刷新场景的请求数。 */
const BURST = 30;
/** 让请求在途一段时间，便于插入刷新或取消。 */
const SLOW = { latency: 50 } as AxpRequestConfig;
/** 通知回调故障的统一输出前缀。 */
const NOTICE_LABEL = expect.stringContaining("axp:auth");
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

describe("会话与 token 边界", () => {
  it.each([undefined, "", null])(
    "[auth.opt.tokenManager.accessToken] accessToken 为 %s 视为未登录：拒绝请求并走 onAccessDenied，不发出",
    /** 空值不算凭证。 */ async (access) => {
      const h = authClient();
      h.tm.set(access as string | undefined, REFRESH_TOKEN);
      expect(await run(h)).toMatchObject({ kind: "auth", reason: "unauthenticated" });
      expect(h.net.totalStarted).toBe(0);
      expect(h.settings.onAccessDenied).toHaveBeenCalledTimes(1);
    },
  );

  it("[auth.opt.urlPattern] 请求没有 url 时按根路径匹配保护范围", /** 缺省 url 等价于根路径。 */ async () => {
    const h = authClient({ urlPattern: "/" });
    h.tm.clear();
    expect(await run(h, { url: undefined })).toMatchObject({
      kind: "auth",
      reason: "unauthenticated",
    });
  });

  it("[auth.cb.tokenManager.set] set(undefined) 视同登出：下一次受保护请求被拒绝，登录后恢复", /** 登出再登录。 */ async () => {
    const h = authClient();
    expect((await run(h)).ok).toBe(true);
    h.tm.set(undefined, undefined);
    expect(await run(h)).toMatchObject({ kind: "auth", reason: "unauthenticated" });
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
    expect(await run(h)).toMatchObject({ kind: "auth", reason: "expired" });
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
      else expect(result).toMatchObject({ kind: "auth", reason: "expired" });
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
      expect(await run(h)).toMatchObject({ ok: false, kind: "auth", reason: "expired" });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("onRefresh"), BUG);
      expect(tm.accessToken).toBeUndefined();
      expect(await run(h)).toMatchObject({ kind: "auth", reason: "unauthenticated" });
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
      expect(await run(h)).toMatchObject({ ok: false, kind: "auth", reason });
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

describe("路由与防回环边界", () => {
  it.each([[null], [undefined], ["unknown"], [42], [{}]])(
    "[auth.const.AuthFailureAction.Others][auth.cb.onFailure] onFailure 返回 %j → 按 Others：原响应透传，不刷新、不清会话",
    /** 未知动作不触发任何副作用。 */ async (value) => {
      const h = authClient({ onFailure: () => value as never });
      h.net.on("get", REQUEST_URL, () => failure(401));
      expect(await run(h)).toMatchObject({ ok: false, status: 401, kind: "http" });
      expect(h.tm.accessToken).toBe(TOKEN_OLD);
      expect(h.settings.onRefresh).not.toHaveBeenCalled();
      expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "[auth.cb.onRefresh][auth.const.AuthFailureAction.Replay] 刷新成功但服务端仍拒绝 → 只重放一次后判过期，不无限循环（business=%s）",
    /** 重放后仍 401 的防回环。 */ async (business) => {
      const h = authClient();
      h.net.on("get", REQUEST_URL, () => failure(401, business));
      expect(await run(h)).toMatchObject({ kind: "auth", reason: "expired", status: 401 });
      expect(h.net.totalStarted).toBe(2);
      expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
      expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
      expect(h.tm.accessToken).toBeUndefined();
    },
  );

  it("[auth.const.AuthFailureAction.Replay] onFailure 一直要求重放 → 第二次同样判过期，不刷新、只发两次", /** 自定义路由也受防回环约束。 */ async () => {
    const h = authClient({ onFailure: () => AuthFailureAction.Replay });
    h.net.on("get", REQUEST_URL, () => failure(401));
    expect(await run(h)).toMatchObject({ kind: "auth", reason: "expired" });
    expect(h.net.totalStarted).toBe(2);
    expect(h.settings.onRefresh).not.toHaveBeenCalled();
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "[auth.cb.onRefresh][auth.cb.onAccessExpired] 刷新成功后重放遇到无关错误（500）→ 会话不清、不通知过期，500 原样传播（business=%s）",
    /** 重放得到的无关失败不当作过期。 */ async (business) => {
      const h = authClient();
      h.net.on("get", REQUEST_URL, /** 首发 401，重放 500。 */ (_config, hit) => failure(hit === 1 ? 401 : 500, business));
      expect(await run(h)).toMatchObject({ ok: false, status: 500 });
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
        expect(result).toMatchObject({ ok: false, status: 0, kind });
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
    expect(await pending).toMatchObject({ kind: "cancel" });
    expect(onFailure).not.toHaveBeenCalled();
    expect(cancelled.settings.onRefresh).not.toHaveBeenCalled();
  });

  it.each([["yes"], [1], [null], [{}], [() => true]])(
    "[auth.req.protected] 请求级 protected 取 %s（非布尔）→ 按省略处理，沿用插件范围判定",
    /** 只有布尔值才覆盖判定。 */ async (value) => {
      const h = authClient({ urlPattern: "/me" });
      h.tm.clear();
      expect(await run(h, { url: "/me", protected: value as never })).toMatchObject({
        kind: "auth",
        reason: "unauthenticated",
      });
      expect((await run(h, { url: "/other", protected: value as never })).ok).toBe(true);
    },
  );

  it.each([[null], [undefined], [0], ["yes"]])(
    "[auth.cb.isProtected] isProtected 返回 %s（非布尔）→ 回落到 methods/urlPattern",
    /** 只有布尔返回值才是终值。 */ async (value) => {
      const h = authClient({ urlPattern: "/me", isProtected: () => value as never });
      h.tm.clear();
      expect(await run(h, { url: "/me" })).toMatchObject({
        kind: "auth",
        reason: "unauthenticated",
      });
      expect((await run(h, { url: "/other" })).ok).toBe(true);
    },
  );
});

describe("单飞刷新与排队", () => {
  it.each([false, true])(
    `[auth.cb.onRefresh] ${BURST} 个并发 401 在刷新窗口内共享同一次刷新，全部用新 token 重放成功（business=%s）`,
    /** I5：并发 401 只调用一次 onRefresh。 */ async (business) => {
      const { gate, onRefresh } = gatedRefresh();
      const h = authClient({ onRefresh });
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
    expect(results.every(/** 全部过期。 */ (r) => r.kind === "auth" && r.reason === "expired")).toBe(true);
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
    expect(results.every(/** 全部过期。 */ (r) => r.reason === "expired")).toBe(true);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
  });

  it("[auth.state.singleFlight] 同一个插件对象装到两个客户端：状态各自独立，互不阻塞，各自刷新一次", /** 单飞状态建在 setup 里。 */ async () => {
    const { gate, onRefresh } = gatedRefresh();
    const settings = authSettings({ onRefresh });
    const plugin = axpAuth(settings);
    const first = b3Client([plugin]);
    const second = b3Client([plugin]);
    for (const h of [first, second])
      h.net.on(
        "get",
        REQUEST_URL,
        guarded(() => TOKEN_NEW),
      );
    const a = first.send({ url: REQUEST_URL });
    const b = second.send({ url: REQUEST_URL });
    await settle();
    expect(settings.onRefresh).toHaveBeenCalledTimes(2);
    gate.resolve(true);
    await settle();
    expect((await a).ok).toBe(true);
    expect((await b).ok).toBe(true);
  });
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
    expect(await queued).toMatchObject({ kind: "cancel" });
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
    expect(await initiator).toMatchObject({ kind: "cancel" });
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
      expect(await waiting).toMatchObject({ kind: "cancel" });
      expect(await queued).toMatchObject({ kind: "cancel" });
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
    expect(await run(h, { signal: controller.signal })).toMatchObject({ kind: "cancel" });
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
    expect(await late).toMatchObject({ kind: "cancel" });
    expect(await first).toMatchObject({ kind: "cancel" });
    gate.resolve(true);
    await settle();
    expect(h.net.totalStarted).toBe(1);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  });
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
    expect(await run(h)).toMatchObject({ kind: "auth", reason: "expired" });
    expect(await run(h)).toMatchObject({ kind: "auth", reason: "expired", status: 401 });
    expect(h.net.totalStarted).toBe(2);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
    store.set("login-2", REFRESH_TOKEN);
    expect(await run(h)).toMatchObject({ kind: "auth", reason: "expired" });
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(2);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(2);
  });

  it("[auth.state.expired][auth.const.AuthFailureAction.Refresh] 过期后还在途的旧请求回来被要求刷新：同一轮不再刷新、不重复通知", /** 在途旧请求不触发第二次刷新。 */ async () => {
    const h = authClient({ onFailure: () => AuthFailureAction.Refresh, onRefresh: () => false });
    h.net.on("get", REQUEST_URL, () => failure(401));
    const fast = h.send({ url: REQUEST_URL });
    const stale = h.send({ url: REQUEST_URL, ...SLOW });
    await settle();
    expect(await fast).toMatchObject({ kind: "auth", reason: "expired" });
    expect(await stale).toMatchObject({ kind: "auth", reason: "expired", status: 401 });
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
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
    expect(await pending).toMatchObject({ kind: "cancel" });
    expect(h.settings.onAccessDenied).not.toHaveBeenCalled();
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
  });

  it("[auth.opt.ready] 异步 ready 期间 token 被替换：按实际注入的新 token 记快照，401 走刷新而非重放后判过期", /** 快照与注入保持一致。 */ async () => {
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
    expect(await run(h)).toMatchObject({ kind: "auth", reason: "unauthenticated" });
    expect(h.net.totalStarted).toBe(1);
    expect(h.settings.onAccessDenied).toHaveBeenCalledTimes(1);
  });
});

describe("请求体一致性（I7）", () => {
  it("[auth.fn.axpAuth][auth.cb.onRefresh] 401 刷新重放：请求体与首发一致，不被 transformRequest 套两层，调用方数据不被改", /** 重放前克隆请求体。 */ async () => {
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
    expect(bodies).toEqual([POLLUTED_ONCE, POLLUTED_ONCE]);
    expect(data).toEqual(pollutingBody());
    expect(h.net.log.map(/** 首发与重放的凭证。 */ (record) => record.auth)).toEqual([TOKEN_OLD, TOKEN_NEW]);
  });
});
