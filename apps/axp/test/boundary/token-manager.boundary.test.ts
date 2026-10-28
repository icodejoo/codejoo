import { afterEach, describe, expect, it, vi } from "vitest";

/** 默认实现持久化使用的两个存储键。 */
const ACCESS_KEY = "axp:token:access";
const REFRESH_KEY = "axp:token:refresh";
/** 每个用例结束后还原全局存储并丢弃已加载的模块实例。 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** 装入内存版 localStorage 并重新加载 TokenManager。 */
async function load(init: Record<string, string> = {}) {
  const values = new Map(Object.entries(init));
  vi.stubGlobal("localStorage", {
    getItem: /** 缺失键按 null 返回。 */ (key: string) => values.get(key) ?? null,
    setItem: /** 写入存裸值。 */ (key: string, value: string) => void values.set(key, value),
    removeItem: /** 删除存储键。 */ (key: string) => void values.delete(key),
  });
  vi.resetModules();
  const { default: TM } = await import("../../src/objects/TokenManager");
  return { TM, values };
}

describe("TokenManager — 边界", () => {
  it.each([undefined, null, ""])(
    "[public.member.TokenManager.set.accessToken][public.member.TokenManager.get.accessToken] 写入 %s 视为清除：不带 Bearer、存储键被删",
    /** 空值归一化。 */ async (value) => {
      const { TM, values } = await load({ [ACCESS_KEY]: "old" });
      const tm = new TM();
      tm.accessToken = value;
      expect(tm.accessToken).toBeUndefined();
      expect(values.has(ACCESS_KEY)).toBe(false);
    },
  );

  it.each([undefined, null, ""])(
    "[public.member.TokenManager.set.refreshToken][public.member.TokenManager.get.refreshToken] 写入 %s 视为清除并删除存储键",
    /** 空值归一化。 */ async (value) => {
      const { TM, values } = await load({ [REFRESH_KEY]: "old" });
      const tm = new TM();
      tm.refreshToken = value;
      expect(tm.refreshToken).toBeUndefined();
      expect(values.has(REFRESH_KEY)).toBe(false);
    },
  );

  it("[public.member.TokenManager.get.accessToken][public.member.TokenManager.get.refreshToken] 存储中为空串视为无 token", /** 空串不是凭证。 */ async () => {
    const { TM } = await load({ [ACCESS_KEY]: "", [REFRESH_KEY]: "" });
    const tm = new TM();
    expect(tm.accessToken).toBeUndefined();
    expect(tm.refreshToken).toBeUndefined();
  });

  it("[public.member.TokenManager.set] 无参 set() 清空两者；只传 access 会清除已有 refresh", /** 一对写入。 */ async () => {
    const { TM, values } = await load({ [ACCESS_KEY]: "a", [REFRESH_KEY]: "r" });
    const tm = new TM();
    tm.set("a2");
    expect(tm.accessToken).toBe("Bearer a2");
    expect(tm.refreshToken).toBeUndefined();
    tm.set();
    expect(tm.accessToken).toBeUndefined();
    expect(values.size).toBe(0);
  });

  it("[public.member.TokenManager.clear] 对空状态与重复 clear 都安全", /** 幂等清除。 */ async () => {
    const { TM, values } = await load();
    const tm = new TM();
    expect(() => {
      tm.clear();
      tm.clear();
    }).not.toThrow();
    expect(values.size).toBe(0);
  });

  it("[public.member.TokenManager.constructor] 无 localStorage（undefined）时构造不抛，仅内存态", /** SSR 环境。 */ async () => {
    vi.stubGlobal("localStorage", undefined);
    vi.resetModules();
    const { default: TM } = await import("../../src/objects/TokenManager");
    const tm = new TM();
    tm.set("a", "r");
    expect(tm.accessToken).toBe("Bearer a");
    expect(tm.refreshToken).toBe("r");
    expect(() => tm.clear()).not.toThrow();
    expect(tm.accessToken).toBeUndefined();
  });

  it("[public.member.TokenManager.constructor] 多个实例各自内存态独立，但共享存储键", /** 实例隔离。 */ async () => {
    const { TM } = await load();
    const a = new TM();
    const b = new TM();
    a.set("x");
    expect(b.accessToken).toBeUndefined();
    expect(new TM().accessToken).toBe("Bearer x");
  });

  it("[public.export.TokenManager] 模块导出的类可重复实例化，实现 ITokenManager 的全部成员且没有 canRefresh", /** 成员清单与已删除成员。 */ async () => {
    const { TM } = await load();
    const tm = new TM();
    for (const name of ["set", "clear"] as const) expect(typeof tm[name]).toBe("function");
    for (const name of ["accessToken", "refreshToken"]) expect(name in tm).toBe(true);
    expect("canRefresh" in tm).toBe(false);
  });
});
