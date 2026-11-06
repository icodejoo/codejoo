import { afterEach, describe, expect, it, vi } from "vitest";
import { factory } from "../src/core";
import { Memory } from "../src/memory";
import { STORE } from "../src/proxy";
import { supported } from "../src/helper";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sync 后端 kind 契约", () => {
  it("ls/ss 内存兜底种类不同，各自模块级共享且身份稳定", async () => {
    const local = supported.storage,
      session = supported.session;
    supported.storage = false;
    supported.session = false;
    try {
      const a = factory(),
        b = factory();
      expect(a.ls[STORE].kind).toBe("local");
      expect(a.ss[STORE].kind).toBe("session");
      expect(a.ls[STORE]).toBe(b.ls[STORE]);
      expect(a.ss[STORE]).toBe(b.ss[STORE]);
      expect(a.ls[STORE]).not.toBe(a.ss[STORE]);
      a.ls.set("sync-kind", "local");
      a.ss.set("sync-kind", "session");
      expect(b.ls.get("sync-kind")).toBe("local");
      expect(b.ss.get("sync-kind")).toBe("session");
      await a.destroy();
      expect(b.ls.get("sync-kind")).toBe("local");
      b.ls.remove("sync-kind");
      b.ss.remove("sync-kind");
      await b.destroy();
    } finally {
      supported.storage = local;
      supported.session = session;
    }
  });
  it("Memory 无参兼容 IDB 兜底，显式 kind 不改变存储行为", () => {
    expect(new Memory().kind).toBe("idb");
    const memory = new Memory("local");
    memory.set("k", "v");
    expect(memory.get("k")).toBe("v");
    expect(memory.kind).toBe("local");
  });
  it("所有 kind 保留键顺序、原生下标转换与删除清空契约", () => {
    for (const kind of ["local", "session", "idb"] as const) {
      const memory = new Memory(kind);
      memory.set("first", "one");
      memory.set("second", "two");
      expect(memory.length).toBe(2);
      expect(memory.keys()).toEqual(["first", "second"]);
      expect(memory.key(1)).toBe("second");
      expect(memory.key(2 ** 32)).toBe("first");
      expect(memory.key(-1)).toBeNull();
      memory.remove("first");
      expect(memory.get("first")).toBeNull();
      memory.clear();
      expect(memory.length).toBe(0);
      expect(memory.key(0)).toBeNull();
      expect(memory.kind).toBe(kind);
    }
  });
});
