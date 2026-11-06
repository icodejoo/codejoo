import { describe, expect, it } from "vitest";
import { JSONX } from "../src/index";
import { BACKENDS } from "./backends";
import { make } from "./helpers/matrix";
import { backing, peer } from "./helpers/matrix";

describe.each(BACKENDS)("Memo and lifecycle invariant %s", (backend) => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])("instance memo=%s per-call memo=%s obeys override and invalidation", async (memoized, perCall) => {
    const f = await make(backend, { memoized });
    try {
      await f.handler.set("k", "cached", { memoized: perCall });
      const store = backing(f.handler),
        key = f.handler.namespace + "k";
      await store.set(key, JSON.stringify({ value: "external", createdAt: Date.now() }));
      expect(await f.handler.get("k")).toBe(perCall ? "cached" : "external");
      await f.handler.remove("k");
      expect(await f.handler.get("k")).toBeNull();
      await f.handler.set("k", "new");
      await f.handler.clear();
      expect(await f.handler.get("k")).toBeNull();
    } finally {
      await f.cleanup();
    }
  });

  it.each([false, true])("another factory invalidates cached reads writer memo=%s", async (writerMemo) => {
    const f = await make(backend, { memoized: true }),
      other = await peer(backend, f.handler, { memoized: writerMemo });
    try {
      await f.handler.set("k", "old");
      expect(await f.handler.get("k")).toBe("old");
      await other.handler.set("k", "new");
      expect(await f.handler.get("k")).toBe("new");
      await other.handler.remove("k");
      expect(await f.handler.get("k")).toBeNull();
      await f.handler.set("k", "again");
      await other.handler.clear();
      expect(await f.handler.get("k")).toBeNull();
    } finally {
      await other.destroy();
      await f.cleanup();
    }
  });

  it.each([false, true])("cloned=%s controls nested object and JSONX collection isolation", async (cloned) => {
    const f = await make(backend, { memoized: true, cloned, serialize: JSONX.stringify, deserialize: JSONX.parse });
    const value = { inner: { n: 1 }, arr: [1], map: new Map([["a", 1]]), set: new Set([1]) };
    try {
      await f.handler.set("k", value);
      const got = await f.handler.get<typeof value>("k");
      got!.inner.n = 2;
      got!.arr.push(2);
      got!.map.set("b", 2);
      got!.set.add(2);
      const again = await f.handler.get<typeof value>("k");
      expect(again!.inner.n).toBe(cloned ? 1 : 2);
      expect(again!.arr).toHaveLength(cloned ? 1 : 2);
      expect(again!.map.size).toBe(cloned ? 1 : 2);
      expect(again!.set.size).toBe(cloned ? 1 : 2);
    } finally {
      await f.cleanup();
    }
  });

  it("destroy drops cached data preserves storage and permits subsequent operations", async () => {
    const f = await make(backend, { memoized: true });
    try {
      await f.handler.set("k", "old");
      await backing(f.handler).set(f.handler.namespace + "k", '{"value":"external"}');
      expect(await f.handler.get("k")).toBe("old");
      await f.handler.destroy();
      expect(await f.handler.get("k")).toBe("external");
      await f.handler.set("next", 2);
      expect(await f.handler.get("next")).toBe(2);
    } finally {
      await f.cleanup();
    }
  });

  it("local factories invalidate peer memo", async () => {
    const f = await make(backend, { memoized: true }),
      other = await peer(backend, f.handler, {});
    try {
      await f.handler.set("k", "old");
      expect(await f.handler.get("k")).toBe("old");
      await other.handler.set("k", "new");
      expect(await f.handler.get("k")).toBe("new");
    } finally {
      await other.destroy();
      await f.cleanup();
    }
  });
});
