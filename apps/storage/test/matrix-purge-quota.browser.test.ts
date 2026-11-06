import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKENDS } from "./backends";
import { make } from "./helpers/matrix";
import { backing } from "./helpers/matrix";
import { clock } from "./helpers/clock";

afterEach(() => vi.restoreAllMocks());

describe.each(BACKENDS)("Quota recovery invariant %s", (backend) => {
  it("force retry reclaims exactly dead entries and preserves live and foreign payloads", async () => {
    const time = clock(),
      onError = vi.fn(),
      f = await make(backend, { force: true, memoized: true, onError });
    const store = backing(f.handler),
      ns = f.handler.namespace;
    let restore: (() => void) | undefined;
    const outside = "outside-" + crypto.randomUUID();
    try {
      await f.handler.set("dead", "old", 10);
      await f.handler.set("alive", "keep", 1000);
      await store.set(ns + "external", '{"expireAt":1}');
      // 属于另一个键空间的过期信封不允许被本实例的 purge 删除。
      await store.set(outside, '{"value":"foreign","createdAt":0,"expireAt":1}');
      time.advance(10);
      const original = store.set.bind(store),
        error = new DOMException("quota", "QuotaExceededError");
      const spy = vi
        .spyOn(store, "set")
        .mockImplementationOnce(() => {
          throw error;
        })
        .mockImplementation(original);
      restore = () => spy.mockRestore();
      await f.handler.set("k", "new");
      if (backend.startsWith("db")) {
        // force 的自动清理重试契约目前仅适用于同步后端；IDB 仍提供主动 purge。
        expect(spy).toHaveBeenCalledTimes(1);
        expect(onError.mock.lastCall?.[0]).toMatchObject({ kind: "write", error });
        await f.handler.purge();
      } else {
        expect(spy).toHaveBeenCalledTimes(2);
        expect(onError).not.toHaveBeenCalled();
        expect(await f.handler.get("k")).toBe("new");
      }
      expect(await store.get(ns + "dead")).toBeNull();
      expect(await f.handler.get("dead")).toBeNull();
      expect(await f.handler.get("alive")).toBe("keep");
      expect(await store.get(ns + "external")).toBe('{"expireAt":1}');
      expect(await store.get(outside)).toBe('{"value":"foreign","createdAt":0,"expireAt":1}');
    } finally {
      restore?.();
      await store.remove(outside);
      await f.cleanup();
      time.restore();
    }
  });

  it("permanent write failures report once per batch key and do not fill memo", async () => {
    const onError = vi.fn(),
      f = await make(backend, { force: true, memoized: true, onError });
    const error = new DOMException("quota", "QuotaExceededError"),
      spy = vi.spyOn(backing(f.handler), "set").mockImplementation(() => {
        throw error;
      });
    try {
      await f.handler.set(["a", "b", "c"], [1, 2, 3]);
      expect(onError).toHaveBeenCalledTimes(3);
      expect(spy).toHaveBeenCalledTimes(backend.startsWith("db") ? 3 : 6);
      expect(onError.mock.calls.map(([info]) => info)).toEqual(["a", "b", "c"].map((key) => ({ kind: "write", op: "set", key, error })));
      expect(await f.handler.keys()).toEqual([]);
      expect(await f.handler.get(["a", "b", "c"])).toEqual([null, null, null]);
    } finally {
      spy.mockRestore();
      await f.cleanup();
    }
  });
});
