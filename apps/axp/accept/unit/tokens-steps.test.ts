import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, breakSignature, GARBAGE_ACCESS, GARBAGE_REFRESH, tamperPayload, TokenStore, WRONG_SCHEME } from "../lib/tokens.ts";
import { drainFired, newStepState, runStep } from "../lib/steps.ts";
import type { StepEnv } from "../lib/steps.ts";
import type { Step } from "../lib/types.ts";

/** 造一个形如 JWT 的令牌 */
const jwt = (sub = "u1"): string => `${b64urlEncode('{"alg":"HS256"}')}.${b64urlEncode(JSON.stringify({ sub, exp: 123 }))}.SIGNATURE`;

describe("坏令牌生成", () => {
  it("bad_signature：只改签名段", () => {
    const t = jwt();
    const bad = breakSignature(t);
    expect(bad).not.toBe(t);
    expect(bad.split(".").slice(0, 2)).toEqual(t.split(".").slice(0, 2));
    expect(bad.split(".")[2]).not.toBe("SIGNATURE");
  });

  it("tampered_payload：改 sub 但不重签", () => {
    const t = jwt("u1");
    const bad = tamperPayload(t);
    const [h, p, s] = bad.split(".");
    expect(h).toBe(t.split(".")[0]);
    expect(s).toBe("SIGNATURE");
    expect(JSON.parse(b64urlDecode(p as string) as string).sub).toBe("u1-tampered");
  });

  it("非三段式令牌退化为破坏签名，不抛错", () => {
    expect(breakSignature("abc")).toBe("abcx");
    expect(tamperPayload("abc")).toBe("abcx");
  });
});

describe("TokenStore.applySetToken 与 previous 记录", () => {
  const login = (s: TokenStore, a = jwt(), r = "r1"): void => s.set(a, r);

  it("none / empty / garbage / wrong_scheme / keep", () => {
    const t = jwt();
    const s = new TokenStore();
    login(s, t);
    s.applySetToken({ access: "wrong_scheme" });
    expect(s.accessToken).toBe(`${WRONG_SCHEME} ${t}`);
    s.applySetToken({ access: "garbage", refresh: "garbage" });
    expect(s.accessToken).toBe(`Bearer ${GARBAGE_ACCESS}`);
    expect(s.refreshToken).toBe(GARBAGE_REFRESH);
    s.applySetToken({ access: "keep", refresh: "keep" });
    expect(s.accessToken).toBe(`Bearer ${GARBAGE_ACCESS}`);
    s.applySetToken({ access: "empty", refresh: "none" });
    expect(s.accessToken).toBe("");
    expect(s.refreshToken).toBeUndefined();
    s.applySetToken({ access: "none" });
    expect(s.accessToken).toBeUndefined();
  });

  it("bad_signature / tampered_payload 作用在当前令牌上并保留前缀", () => {
    const s = new TokenStore();
    login(s, jwt());
    s.applySetToken({ access: "bad_signature" });
    expect(s.accessToken?.startsWith("Bearer ")).toBe(true);
    expect(s.accessToken?.endsWith("SIGNATURE")).toBe(false);
  });

  it("previous：最近一次变化之前的值，login / 刷新 / set_token / clear 都算变化", () => {
    const s = new TokenStore();
    login(s, "A1", "R1");
    expect(s.previousAccess).toBeUndefined();
    s.set("A2", "R2"); // 刷新成功
    expect(s.previousAccess).toBe("Bearer A1");
    expect(s.previousRefresh).toBe("R1");
    s.applySetToken({ access: "garbage", refresh: "previous" });
    expect(s.refreshToken).toBe("R1");
    expect(s.previousRefresh).toBe("R2");
    expect(s.previousAccess).toBe("Bearer A2");
    s.applySetToken({ access: "previous" });
    expect(s.accessToken).toBe("Bearer A2");
    s.clear();
    expect(s.previousAccess).toBe("Bearer A2");
    expect(s.accessToken).toBeUndefined();
  });

  it("值没有变化不覆盖 previous", () => {
    const s = new TokenStore();
    login(s, "A1", "R1");
    s.set("A2", "R2");
    s.applySetToken({ access: "keep" });
    expect(s.previousAccess).toBe("Bearer A1");
  });

  it("logout 之后用 previous 取回登出前的令牌", () => {
    const s = new TokenStore();
    login(s, "A1", "R1");
    s.clear();
    s.applySetToken({ access: "previous", refresh: "previous" });
    expect(s.accessToken).toBe("Bearer A1");
    expect(s.refreshToken).toBe("R1");
  });

  it("expire_local 用的 setAccessHeader 也会记录旧值", () => {
    const s = new TokenStore();
    login(s, "A1", "R1");
    s.setAccessHeader("Bearer EXPIRED");
    expect(s.previousAccess).toBe("Bearer A1");
    expect(s.refreshToken).toBe("R1");
  });
});

/** 记录调用的假环境：request 耗时可控，用来观察 parallel / sequence / fire / repeat 的编排 */
function fakeEnv(delays: Record<string, number> = {}) {
  const calls: string[] = [];
  const t = (name: string) => calls.push(name);
  const env: StepEnv = {
    sleep: (ms) =>
      new Promise((r) => {
        t(`sleep:${ms}`);
        r();
      }),
    request: async (spec, suffix) => {
      t(`start:${spec.id}${suffix}`);
      await new Promise((r) => setTimeout(r, delays[spec.id] ?? 0));
      t(`end:${spec.id}${suffix}`);
    },
    login: async (s) => {
      t(`login:${s.user}`);
    },
    setToken: (s) => {
      t(`set_token:${s.access}`);
    },
    logout: async () => {
      t("logout");
    },
    revoke: async (s) => {
      t(`revoke:${s.scope}`);
    },
    expireLocal: async () => {
      t("expire_local");
    },
    cancelAll: () => {
      t("cancel_all");
    },
    clearCache: () => {
      t("clear_cache");
    },
    network: async (v) => {
      t(`network:${JSON.stringify(v)}`);
    },
    style: (s) => {
      t(`style:${s}`);
    },
    serverReset: async () => {
      t("server_reset");
    },
  };
  return { env, calls };
}
const req = (id: string): Step => ({ request: { id, path: "/x" } });

describe("steps 解释器（纯编排逻辑）", () => {
  it("sequence 严格按顺序，前一个结束后才开始下一个", async () => {
    const { env, calls } = fakeEnv({ a: 15 });
    await runStep({ sequence: [req("a"), req("b")] }, env, newStepState());
    expect(calls).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("parallel 同时启动，全部落定后才返回", async () => {
    const { env, calls } = fakeEnv({ a: 30, b: 5 });
    await runStep({ parallel: [req("a"), req("b")] }, env, newStepState());
    expect(calls.slice(0, 2)).toEqual(["start:a", "start:b"]);
    expect(calls.slice(2)).toEqual(["end:b", "end:a"]);
  });

  it("fire 不等待，drainFired 统一等待；fire 里的 fire 也会被等到", async () => {
    const { env, calls } = fakeEnv({ a: 20, c: 10 });
    const state = newStepState();
    await runStep({ fire: req("a") }, env, state);
    await runStep({ fire: { fire: req("c") } }, env, state);
    expect(calls).not.toContain("end:a");
    await drainFired(state);
    expect(calls).toContain("end:a");
    expect(calls).toContain("end:c");
    expect(state.fired).toHaveLength(0);
  });

  it("fire 内部出错被记录，不会变成未处理的 rejection", async () => {
    const { env } = fakeEnv();
    env.login = async () => {
      throw new Error("boom");
    };
    const state = newStepState();
    await runStep({ fire: { login: { user: "u" } } }, env, state);
    await drainFired(state);
    expect(state.errors).toEqual(["fire 内部出错: boom"]);
  });

  it("repeat 默认给请求 id 追加 #i，id_suffix=false 时不追加；嵌套累计后缀", async () => {
    const a = fakeEnv();
    await runStep({ repeat: { times: 3, step: req("r") } }, a.env, newStepState());
    expect(a.calls.filter((c) => c.startsWith("start:"))).toEqual(["start:r#0", "start:r#1", "start:r#2"]);
    const b = fakeEnv();
    await runStep({ repeat: { times: 2, step: req("r"), id_suffix: false } }, b.env, newStepState());
    expect(b.calls.filter((c) => c.startsWith("start:"))).toEqual(["start:r", "start:r"]);
    const c = fakeEnv();
    await runStep({ repeat: { times: 2, step: { repeat: { times: 2, step: req("r") } } } }, c.env, newStepState());
    expect(c.calls.filter((x) => x.startsWith("start:"))).toEqual(["start:r#0#0", "start:r#0#1", "start:r#1#0", "start:r#1#1"]);
  });

  it("cancel_all 先等 after_ms 再取消；after_ms 为 0 时不等待", async () => {
    const { env, calls } = fakeEnv();
    await runStep({ cancel_all: { after_ms: 500 } }, env, newStepState());
    await runStep({ cancel_all: {} }, env, newStepState());
    expect(calls).toEqual(["sleep:500", "cancel_all", "cancel_all"]);
  });

  it("其余 step 原样交给环境：wait/login/set_token/logout/revoke/expire_local/clear_cache/network/style/server_reset", async () => {
    const { env, calls } = fakeEnv();
    const steps: Step[] = [
      { wait: 7 },
      { login: { user: "u1" } },
      { set_token: { access: "garbage" } },
      { logout: {} },
      { revoke: { scope: "access" } },
      { expire_local: {} },
      { clear_cache: {} },
      { network: "offline" },
      { style: "business" },
      { server_reset: {} },
    ];
    await runStep({ sequence: steps }, env, newStepState());
    expect(calls).toEqual(["sleep:7", "login:u1", "set_token:garbage", "logout", "revoke:access", "expire_local", "clear_cache", 'network:"offline"', "style:business", "server_reset"]);
  });

  it("未知 step 抛错，不静默忽略", async () => {
    const { env } = fakeEnv();
    await expect(runStep({ nope: 1 } as unknown as Step, env, newStepState())).rejects.toThrow(/未知 step/);
  });
});
