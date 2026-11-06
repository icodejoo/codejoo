import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/proxy");
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("platform 原生适配器契约", () => {
  it("area 保留原生身份且所有方法绑定原生对象", async () => {
    // 捕获传给编排层的真实适配器，验证其完整 SyncStore 契约。
    vi.doMock("../src/proxy", () => ({ proxy: (store: unknown) => store }));
    const data = new Map<string, string>();
    const native = {
      getItem(key: string) {
        return data.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        data.set(key, value);
      },
      removeItem(key: string) {
        data.delete(key);
      },
      clear() {
        data.clear();
      },
      key(index: number) {
        return [...data.keys()][index] ?? null;
      },
      get length() {
        return data.size;
      },
    };
    vi.stubGlobal("window", { localStorage: native, sessionStorage: native });
    const { factory } = await import("../src/core");
    const { ls } = factory() as any;
    expect(ls.area).toBe(native);
    ls.set("k", "v");
    expect(ls.get("k")).toBe("v");
    expect(ls.length).toBe(1);
    expect(ls.key(0)).toBe("k");
    expect(ls.keys()).toEqual(Object.keys(native));
    ls.remove("k");
    expect(ls.get("k")).toBeNull();
    ls.set("k", "v");
    ls.clear();
    expect(ls.length).toBe(0);
  });
});
