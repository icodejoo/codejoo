import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKENDS } from "./backends";
import { clock } from "./helpers/clock";
import { matrix, realm } from "./helpers/matrix";

afterEach(() => vi.restoreAllMocks());

describe.each(BACKENDS)("TTL and sliding invariant %s", (backend) => {
  it("expires exactly at expireAt and deletes the physical entry", async () => {
    const time = clock(),
      f = await matrix(backend);
    try {
      const now = Date.now();
      await f.handler.set("k", "v", 1000);
      expect(f.writes.at(-1)).toMatchObject({ createdAt: now, ttl: 1000, expireAt: now + 1000 });
      time.advance(999);
      expect(await f.handler.get("k")).toBe("v");
      time.advance(1);
      expect(await f.handler.get("k", "default")).toBe("default");
      expect(await f.handler.keys()).toEqual([]);
    } finally {
      await f.cleanup();
      time.restore();
    }
  });

  it("renews at exactly ninety percent remaining and not one millisecond earlier", async () => {
    const time = clock(),
      f = await matrix(backend, { sliding: true });
    try {
      const now = Date.now();
      await f.handler.set("k", "v", 1000);
      time.advance(99);
      expect(await f.handler.get("k")).toBe("v");
      expect(f.writes).toHaveLength(1);
      time.advance(1);
      expect(await f.handler.get("k")).toBe("v");
      expect(f.writes).toHaveLength(2);
      expect(f.writes.at(-1)).toMatchObject({ createdAt: now, ttl: 1000, expireAt: now + 1100 });
      time.set(now + 1100);
      expect(await f.handler.get("k")).toBeNull();
    } finally {
      await f.cleanup();
      time.restore();
    }
  });

  it.each([0, -1, -1000, NaN, Infinity, -Infinity])("ignores invalid ttl %s and persists without expiry", async (ttl) => {
    const time = clock(),
      f = await matrix(backend);
    const warn = vi.spyOn(realm(f.handler).console, "warn").mockImplementation(() => {});
    try {
      await f.handler.set("k", "v", ttl);
      expect(warn).toHaveBeenCalled();
      expect(f.writes.at(-1)).not.toHaveProperty("ttl");
      expect(f.writes.at(-1)).not.toHaveProperty("expireAt");
      time.advance(1e10);
      expect(await f.handler.get("k")).toBe("v");
    } finally {
      await f.cleanup();
      time.restore();
    }
  });

  it("absolute expireAt takes precedence over ttl", async () => {
    const time = clock(),
      f = await matrix(backend);
    try {
      const expiry = Date.now() + 500;
      await f.handler.set("k", "v", { ttl: 1000, expireAt: new Date(expiry) });
      expect(f.writes.at(-1)).toMatchObject({ ttl: 1000, expireAt: expiry });
      time.advance(500);
      expect(await f.handler.get("k")).toBeNull();
    } finally {
      await f.cleanup();
      time.restore();
    }
  });

  it("external entity without createdAt neither expires nor renews", async () => {
    const time = clock(),
      f = await matrix(backend, { sliding: true });
    try {
      await f.inject("k", JSON.stringify({ value: "foreign", ttl: 1000, expireAt: Date.now() + 500 }));
      expect(await f.handler.get("k")).toBe("foreign");
      time.advance(1000);
      expect(await f.handler.get("k")).toBe("foreign");
      expect(f.writes).toHaveLength(1);
    } finally {
      await f.cleanup();
      time.restore();
    }
  });

  it("purge removes unread expired entries and preserves live and external entries", async () => {
    const time = clock(),
      f = await matrix(backend);
    try {
      await f.handler.set("dead", 1, 10);
      await f.handler.set("alive", 2, 1000);
      await f.inject("external", '{"expireAt":1}');
      time.advance(10);
      await f.handler.purge();
      expect((await f.handler.keys()).sort()).toEqual(["alive", "external"]);
      expect(await f.handler.get("alive")).toBe(2);
    } finally {
      await f.cleanup();
      time.restore();
    }
  });
});
