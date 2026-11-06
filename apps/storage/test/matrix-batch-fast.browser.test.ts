import { afterEach, describe, expect, it, vi } from "vitest";
import { batchFast, fast, lazy, type SyncStore } from "../src/index";
import type { Handlers } from "../src/proxy";
import { realm, snapshot } from "./helpers/matrix";
import { BACKENDS } from "./backends";
import { make } from "./helpers/matrix";

afterEach(() => vi.restoreAllMocks());

describe.each(BACKENDS)("Batch and accessor invariant %s", (backend) => {
  it("mixed memo hits backend reads and missing defaults compose in one batch", async () => {
    const f = await make(backend, { memoized: true });
    try {
      const pending = f.handler.set("hit", "cached");
      expect(Object.prototype.toString.call(pending) === "[object Promise]").toBe(backend.startsWith("db"));
      await pending;
      await f.handler.set("miss", "backend", { memoized: false });
      expect(await f.handler.get(["hit", "miss", "none"], ["", "", "default"])).toEqual(["cached", "backend", "default"]);
    } finally {
      await f.cleanup();
    }
  });
  it("batch tuples use position defaults including missing defaults and explicit generic", async () => {
    const f = await make(backend);
    try {
      await f.handler.set(["a", "b"], [5, false]);
      expect(await f.handler.get(["a", "b", "missing"], [0, true, "d"])).toEqual([5, false, "d"]);
      expect(await f.handler.get(["a", "missing"], [0])).toEqual([5, null]);
      expect(await f.handler.get<[number, boolean]>(["a", "missing"])).toEqual([5, null]);
      await f.handler.remove(["a", "b"]);
      expect(await f.handler.get(["a", "b"])).toEqual([null, null]);
    } finally {
      await f.cleanup();
    }
  });

  it("empty batches are noops and short values skip missing positions with a warning", async () => {
    const f = await make(backend),
      warn = vi.spyOn(realm(f.handler).console, "warn").mockImplementation(() => {});
    try {
      expect(await f.handler.get([])).toEqual([]);
      await f.handler.set([], []);
      await f.handler.remove([]);
      expect(await f.handler.length).toBe(0);
      await f.handler.set(["a", "b", "c"], [1]);
      expect(warn).toHaveBeenCalled();
      expect(await f.handler.get(["a", "b", "c"])).toEqual([1, null, null]);
      expect(await f.handler.keys()).toEqual(["a"]);
    } finally {
      await f.cleanup();
    }
  });

  it("fast lazy and batchFast forward get set remove and protect __proto__", async () => {
    const f = await make(backend);
    // 重载在运行时共享实现；此处统一 await 同步/异步处理器。
    const handler = f.handler as Handlers<SyncStore>;
    try {
      const a = fast<number>(handler, "a"),
        getLazy = lazy<number>(handler, "b");
      expect(getLazy()).toBe(getLazy());
      expect(await Promise.resolve(a.get())).toBeNull();
      expect(await Promise.resolve(a.get(undefined))).toBeNull();
      expect(await Promise.resolve(a.get(7))).toBe(7);
      await Promise.resolve(a.set(1));
      await Promise.resolve(getLazy().set(2));
      expect(await Promise.resolve(a.get())).toBe(1);
      expect(await Promise.resolve(getLazy().get())).toBe(2);
      const access = batchFast<number, readonly ["__proto__", "c"]>(handler, ["__proto__", "c"]);
      expect(Object.getPrototypeOf(access)).toBeNull();
      expect(Object.hasOwn(access, "__proto__")).toBe(true);
      await Promise.resolve(access.__proto__.set(3));
      await Promise.resolve(access.c.set(4));
      expect(await Promise.resolve(access.__proto__.get())).toBe(3);
      await Promise.resolve(a.remove());
      await Promise.resolve(getLazy().remove());
      await Promise.resolve(access.c.remove());
      expect(await f.handler.keys()).toEqual(["__proto__"]);
    } finally {
      await f.cleanup();
    }
  });

  it("debug snapshot preserves namespace and own __proto__ without adding storage keys", async () => {
    const f = await make(backend);
    try {
      await f.handler.set(["a", "__proto__", "_$debug"], [1, "safe", "legacy"]);
      const before = await f.handler.keys(),
        dump = await snapshot(f.handler);
      expect(dump).toEqual({ [f.handler.namespace + "a"]: 1, [f.handler.namespace + "__proto__"]: "safe" });
      expect(Object.getPrototypeOf(dump)).toBeNull();
      expect(await f.handler.keys()).toEqual(before);
      expect(await f.handler.get("_$debug")).toBe("legacy");
    } finally {
      await f.cleanup();
    }
  });
});
