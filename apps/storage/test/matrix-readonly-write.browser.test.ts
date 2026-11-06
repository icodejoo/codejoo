import { describe, expect, it } from "vitest";
import { BACKENDS } from "./backends";
import { make } from "./helpers/matrix";
import { clock } from "./helpers/clock";

describe.each(BACKENDS)("Readonly invariant %s", (backend) => {
  it("writes only absent or expired values and treats stored null as present", async () => {
    const time = clock(),
      f = await make(backend, { readonly: true, memoized: true });
    try {
      await f.handler.set("null", null);
      await f.handler.set("null", "replacement");
      expect(await f.handler.get("null")).toBeNull();
      await f.handler.set("k", "first", 10);
      await f.handler.set("k", "second");
      expect(await f.handler.get("k")).toBe("first");
      time.advance(10);
      await f.handler.set("k", "third");
      expect(await f.handler.get("k")).toBe("third");
      expect(await f.handler.keys()).toHaveLength(2);
    } finally {
      await f.cleanup();
      time.restore();
    }
  });

  it("concurrent readonly calls commit the first value exactly once", async () => {
    const f = await make(backend, { readonly: true });
    try {
      await Promise.all([f.handler.set("k", null), f.handler.set("k", 2), f.handler.set("k", 3)]);
      expect(await f.handler.get("k")).toBeNull();
      expect(await f.handler.length).toBe(1);
    } finally {
      await f.cleanup();
    }
  });
});
