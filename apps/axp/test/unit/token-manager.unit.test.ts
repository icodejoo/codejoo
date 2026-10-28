import { afterEach, describe, expect, it, vi } from "vitest";

/** 默认实现持久化使用的两个存储键。 */
const ACCESS_KEY = "axp:token:access";
const REFRESH_KEY = "axp:token:refresh";
/** 模拟配额或隐私模式下的存储故障。 */
function boom(): never {
  throw new Error("QuotaExceeded");
}
/** 每个用例结束后还原全局存储并丢弃已加载的模块实例。 */
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("TokenManager — 存储不可用环境", () => {
  const realDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  /** 还原真实的 localStorage 属性描述符。 */
  const restore = () => {
    if (realDesc) Object.defineProperty(globalThis, "localStorage", realDesc);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    vi.resetModules();
  };

  it("[public.member.TokenManager.constructor] 访问 localStorage 抛 SecurityError：模块导入不崩，内存态照常工作", /** 沙箱 iframe 场景。 */ async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    vi.resetModules();
    try {
      const { default: TM } = await import("../../src/objects/TokenManager");
      const tm = new TM();
      expect(tm.accessToken).toBeUndefined();
      tm.set("a", "r");
      expect(tm.accessToken).toBe("Bearer a");
      expect(tm.refreshToken).toBe("r");
      tm.clear();
      expect(tm.accessToken).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("[public.member.TokenManager.constructor][public.member.TokenManager.set][public.member.TokenManager.clear] getItem/setItem/removeItem 抛错（配额/隐私模式）：构造、写入、清除都不抛，内存态照常更新", /** 存储故障被吞掉。 */ async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: boom, setItem: boom, removeItem: boom },
    });
    vi.resetModules();
    try {
      const { default: TM } = await import("../../src/objects/TokenManager");
      const tm = new TM();
      expect(tm.accessToken).toBeUndefined();
      expect(() => tm.set("a", "r")).not.toThrow();
      expect(tm.accessToken).toBe("Bearer a");
      expect(() => tm.clear()).not.toThrow();
      expect(tm.accessToken).toBeUndefined();
    } finally {
      restore();
    }
  });
});

describe("TokenManager — 正常持久化路径", () => {
  it("[public.member.TokenManager.constructor][public.member.TokenManager.set][public.member.TokenManager.clear] 恢复裸 token、写入和空值删除均同步存储，实例上没有 canRefresh", /** 持久化往返与已删除成员。 */ async () => {
    const values = new Map([
      [ACCESS_KEY, "saved"],
      [REFRESH_KEY, "refresh"],
    ]);
    const storage = {
      getItem: vi.fn(/** 缺失键按 null 返回。 */ (key: string) => values.get(key) ?? null),
      setItem: vi.fn(
        /** 写入存裸值。 */ (key: string, value: string) => void values.set(key, value),
      ),
      removeItem: vi.fn(/** 删除存储键。 */ (key: string) => void values.delete(key)),
    };
    vi.stubGlobal("localStorage", storage);
    vi.resetModules();
    const { default: Manager } = await import("../../src/objects/TokenManager");
    const tm = new Manager();
    expect(tm.accessToken).toBe("Bearer saved");
    expect(tm.refreshToken).toBe("refresh");
    tm.set("next", "next-refresh");
    expect(new Manager().accessToken).toBe("Bearer next");
    expect(values.get(ACCESS_KEY)).toBe("next");
    tm.accessToken = "";
    tm.refreshToken = null;
    expect(values.size).toBe(0);
    tm.set("again", "again-refresh");
    tm.clear();
    expect(values.size).toBe(0);
    expect(tm.accessToken).toBeUndefined();
    expect(tm.refreshToken).toBeUndefined();
    expect("canRefresh" in tm).toBe(false);
  });
});
