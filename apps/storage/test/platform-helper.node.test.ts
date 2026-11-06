import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("platform SSR 与惰性探测", () => {
  it("无 window 导入并创建 factory，兜底共享且与 memo 隔离", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("indexedDB", undefined);
    const { factory } = await import("../src/core");
    const a = factory({ memoized: true });
    const b = factory();
    a.ls.clear();
    a.ss.clear();
    a.ls.set("k", { x: 1 });
    expect(b.ls.get("k")).toEqual({ x: 1 });
    expect(b.ss.get("k")).toBeNull();
    await a.destroy();
    expect(a.ls.get("k")).toEqual({ x: 1 });
    a.setNamespace("next");
    expect(b.ls.get("k")).toEqual({ x: 1 });
    const { Idb } = await import("../src/idb");
    const x = new Idb("platform-ssr");
    const y = new Idb("platform-ssr");
    const z = new Idb("platform-other");
    await x.clear();
    await x.set("k", "v");
    expect(await y.get("k")).toBe("v");
    expect(await z.get("k")).toBeNull();
    expect(await y.update("k", () => undefined)).toBe("v");
    expect(await y.update("k", () => "updated")).toBe("updated");
    const error = new Error("callback");
    await expect(
      x.update("k", () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(await y.get("k")).toBe("updated");
    expect(await y.update("k", () => null)).toBeNull();
    let wins = 0;
    await Promise.all(
      [x, y].map((db) =>
        db.update("once", (current) => {
          if (current !== null) return undefined;
          wins++;
          return "winner";
        }),
      ),
    );
    expect(wins).toBe(1);
    expect(await x.keys()).toEqual(["once"]);
    expect(await x.key(0)).toBe("once");
    expect(await x.key(-1)).toBeNull();
    expect(await x.length()).toBe(1);
    await x.destroy();
    expect(await y.get("once")).toBe("winner");
    await x.remove("once");
    expect(await x.length()).toBe(0);
    b.ls.clear();
  });

  it("导入不访问 getter，首次读取独立探测缓存且保留用户探测键", async () => {
    const data = new Map([["__storage_probe__", "user"]]);
    const setItem = vi.fn((k: string, v: string) => {
      data.set(k, v);
    });
    const removeItem = vi.fn((k: string) => {
      data.delete(k);
    });
    const local = { getItem: (k: string) => data.get(k) ?? null, setItem, removeItem };
    const localGetter = vi.fn(() => local);
    const sessionGetter = vi.fn(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.stubGlobal(
      "window",
      Object.defineProperties(
        {},
        {
          localStorage: { get: localGetter },
          sessionStorage: { get: sessionGetter },
        },
      ),
    );
    const idbGetter = vi.fn(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, get: idbGetter });
    try {
      const { supported } = await import("../src/helper");
      expect(localGetter).not.toHaveBeenCalled();
      expect(idbGetter).not.toHaveBeenCalled();
      expect(supported.storage).toBe(true);
      expect(supported.storage).toBe(true);
      expect(setItem).toHaveBeenCalledTimes(1);
      expect(supported.session).toBe(false);
      expect(supported.indexedDB).toBe(false);
      expect(supported.indexedDB).toBe(false);
      expect(idbGetter).toHaveBeenCalledTimes(1);
      expect(data).toEqual(new Map([["__storage_probe__", "user"]]));
      expect(removeItem).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(globalThis, "indexedDB", original);
      else Reflect.deleteProperty(globalThis, "indexedDB");
    }
  });

  it.each(["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED", "SecurityError"])("探测写失败 %s 仍清理临时键", async (errorName) => {
    const removeItem = vi.fn();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("failed", errorName);
        },
        removeItem,
      },
    });
    const { supported } = await import("../src/helper");
    expect(supported.storage).toBe(errorName !== "SecurityError");
    expect(removeItem).toHaveBeenCalledTimes(1);
  });
});
