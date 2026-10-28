import { afterEach, describe, expect, it, vi } from "vitest";

/** 默认实现持久化使用的两个存储键。 */
const ACCESS_KEY = "axp:token:access";
const REFRESH_KEY = "axp:token:refresh";
/** 每个用例结束后还原全局存储并丢弃已加载的模块实例。 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** 装入内存版 localStorage 并重新加载 TokenManager，返回类与底层存储。 */
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

describe("TokenManager — 访问器规则", () => {
  it("[public.member.TokenManager.get.accessToken][public.member.TokenManager.set.accessToken] 读取带 Bearer 前缀，写入存裸值，未设置时 undefined", /** 前缀只在读取时添加。 */ async () => {
    const { TM, values } = await load();
    const tm = new TM();
    expect(tm.accessToken).toBeUndefined();
    tm.accessToken = "abc";
    expect(tm.accessToken).toBe("Bearer abc");
    expect(values.get(ACCESS_KEY)).toBe("abc");
  });

  it("[public.member.TokenManager.get.refreshToken][public.member.TokenManager.set.refreshToken] refreshToken 原样读写并持久化，不加前缀", /** 刷新凭证没有前缀。 */ async () => {
    const { TM, values } = await load();
    const tm = new TM();
    expect(tm.refreshToken).toBeUndefined();
    tm.refreshToken = "r1";
    expect(tm.refreshToken).toBe("r1");
    expect(values.get(REFRESH_KEY)).toBe("r1");
    expect(new TM().refreshToken).toBe("r1");
  });
});
