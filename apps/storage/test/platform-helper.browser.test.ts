import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("platform 浏览器探测", () => {
  it("indexedDB getter 抛错仍可导入并使用真实 localStorage", async () => {
    localStorage.setItem("__storage_probe__", "user-data");
    const getter = vi.spyOn(window, "indexedDB", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const { factory } = await import("../src/core");
    expect(getter).not.toHaveBeenCalled();
    const { supported } = await import("../src/helper");
    expect(supported.indexedDB).toBe(false);
    const storage = factory({ namespace: "platform-probe" });
    storage.ls.set("k", "v");
    expect(storage.ls.get("k")).toBe("v");
    expect(localStorage.getItem("platform-probe:k")).not.toBeNull();
    expect(localStorage.getItem("__storage_probe__")).toBe("user-data");
    storage.ls.remove("k");
    expect(storage.ls.get("k")).toBeNull();
    storage.ls.clear();
    localStorage.removeItem("__storage_probe__");
    await storage.destroy();
  });
});
