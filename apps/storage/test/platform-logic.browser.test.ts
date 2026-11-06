// 同一组纯逻辑断言同时覆盖 Node 与浏览器运行时。
import "./platform-serialization.node.test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { supported } from "../src/helper";
import { factory } from "../src/core";
import { Idb } from "../src/idb";
import { Memory } from "../src/memory";

afterEach(() => vi.restoreAllMocks());

describe("platform 浏览器兜底", () => {
  it("共享 ls/ss 兜底保留数据，memo 与两种后端互相隔离", async () => {
    const flags = { ...supported };
    supported.storage = supported.session = supported.indexedDB = false;
    try {
      const a = factory({ memoized: true });
      const b = factory();
      a.ls.clear();
      a.ss.clear();
      a.ls.set("k", 1);
      a.ss.set("k", 2);
      expect(b.ls.get("k")).toBe(1);
      expect(b.ss.get("k")).toBe(2);
      await a.destroy();
      expect(a.ls.get("k")).toBe(1);
      a.setNamespace("next");
      expect(b.ls.get("k")).toBe(1);
      b.ls.remove("k");
      b.ss.clear();
      const dbName = `platform-memory-${crypto.randomUUID()}`;
      const x = new Idb(dbName);
      const y = new Idb(dbName);
      await x.set("a", "1");
      expect(await y.update("a", () => undefined)).toBe("1");
      expect(await y.update("a", () => "2")).toBe("2");
      expect(await x.get("a")).toBe("2");
      expect(await x.length()).toBe(1);
      expect(await x.key(0)).toBe("a");
      expect(await x.keys()).toEqual(["a"]);
      expect(await x.update("a", () => null)).toBeNull();
      await x.set("b", "3");
      await y.remove("b");
      await x.clear();
      await x.destroy();
      await y.destroy();
    } finally {
      Object.assign(supported, flags);
    }
  });
  it("Memory.key 与真实 Storage 的 unsigned long 转换一致", () => {
    const mem = new Memory();
    sessionStorage.clear();
    sessionStorage.setItem("only", "v");
    mem.set("only", "v");
    for (const index of [Infinity, -Infinity, NaN, 2 ** 32, -(2 ** 32), -1, -0.5, 0, 1.9]) {
      expect(mem.key(index)).toBe(sessionStorage.key(index));
    }
    sessionStorage.clear();
  });
});
