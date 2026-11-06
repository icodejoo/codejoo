import { describe, expect, it } from "vitest";
import { codec } from "../src/index";
import { BACKENDS } from "./backends";
import { make } from "./helpers/matrix";

describe.each(BACKENDS)("Keyspace invariant %s", (backend) => {
  it("set get remove clear keys length and deprecated key enumerate logical keys", async () => {
    const f = await make(backend);
    try {
      expect(await f.handler.get("missing")).toBeNull();
      expect(await f.handler.get("missing", 4)).toBe(4);
      await f.handler.set("a", 1);
      await f.handler.set("b", 2);
      expect(await f.handler.length).toBe(2);
      expect((await f.handler.keys()).sort()).toEqual(["a", "b"]);
      expect([await f.handler.key(0), await f.handler.key(1)].sort()).toEqual(["a", "b"]);
      expect(await f.handler.key(2)).toBeNull();
      expect(await f.handler.key(-1)).toBeNull();
      await f.handler.remove("a");
      expect(await f.handler.get("a")).toBeNull();
      expect(await f.handler.get("b")).toBe(2);
      await f.handler.clear();
      expect(await f.handler.keys()).toEqual([]);
      expect(await f.handler.length).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it.each([false, true])("namespace boundaries escaping and switching with encoding=%s", async (encoded) => {
    const f = await make(backend, { memoized: true, enckey: encoded, codeable: encoded, codec: codec("matrix") });
    const base = f.handler.namespace.slice(0, -1);
    try {
      f.handler.setNamespace(base + "a");
      await f.handler.set("%:key", "A");
      f.handler.setNamespace(base + "a:b");
      expect(await f.handler.get("%:key")).toBeNull();
      await f.handler.set("%:key", "B");
      f.handler.setNamespace(base + "a%3Ab");
      await f.handler.set("%:key", "C");
      expect(await f.handler.keys()).toEqual(["%:key"]);
      expect(await f.handler.length).toBe(1);
      f.handler.setNamespace(base + "a");
      expect(await f.handler.get("%:key")).toBe("A");
      await f.handler.clear();
      f.handler.setNamespace(base + "a:b");
      expect(await f.handler.get("%:key")).toBe("B");
      await f.handler.clear();
      f.handler.setNamespace(base + "a%3Ab");
      expect(await f.handler.get("%:key")).toBe("C");
    } finally {
      await f.cleanup();
    }
  });
});
