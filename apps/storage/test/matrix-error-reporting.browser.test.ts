import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKENDS } from "./backends";
import { make } from "./helpers/matrix";
import { backing, matrix } from "./helpers/matrix";
import type { StorageErrorInfo } from "../src/index";

afterEach(() => vi.restoreAllMocks());

describe.each(BACKENDS)("Error reporting invariant %s", (backend) => {
  it.each([
    ["text", 0],
    [1, "fallback"],
    [false, 1n],
    [{ a: 1 }, []],
  ])("type mismatch %# returns fallback and preserves stored value", async (value, fallback) => {
    const onError = vi.fn(),
      f = await make(backend, { memoized: true, onError });
    try {
      await f.handler.set("k", value);
      const store = backing(f.handler),
        before = await store.get(f.handler.namespace + "k");
      expect(await f.handler.get("k", fallback)).toEqual(fallback);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.lastCall?.[0]).toMatchObject({ kind: "type", op: "get", key: "k", error: expect.anything() });
      expect(await store.get(f.handler.namespace + "k")).toBe(before);
      expect(await f.handler.get("k")).toEqual(value);
    } finally {
      await f.cleanup();
    }
  });

  it.each(["QuotaExceededError", "AbortError"])("backend %s reports original error and force false never retries", async (name) => {
    const onError = vi.fn(),
      f = await make(backend, { force: false, memoized: true, onError });
    const error = new DOMException("failure", name),
      store = backing(f.handler);
    const spy = vi.spyOn(store, "set").mockImplementation(() => {
      throw error;
    });
    try {
      await f.handler.set("k", 1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.lastCall?.[0]).toEqual({ kind: name === "AbortError" ? "abort" : "write", op: "set", key: "k", error });
      expect(await f.handler.get("k")).toBeNull();
      expect(await f.handler.length).toBe(0);
    } finally {
      spy.mockRestore();
      await f.cleanup();
    }
  });

  it("serialization errors preserve original error and suppress console logging", async () => {
    const error = new Error("serializer"),
      onError = vi.fn(),
      log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = await make(backend, {
      serialize: () => {
        throw error;
      },
      onError,
    });
    try {
      await f.handler.set(["a", "b"], [1, 2]);
      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError.mock.calls.map(([info]) => info)).toEqual(["a", "b"].map((key) => ({ kind: "serialize", op: "set", key, error })));
      expect(log).not.toHaveBeenCalled();
      expect(await f.handler.keys()).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  it.each(["serialize", "type", "corrupt", "write", "abort"] as const)("user callback exception for %s propagates unchanged exactly once", async (kind) => {
    const thrown = new Error("user callback"),
      cause = new DOMException("backend", kind === "abort" ? "AbortError" : "QuotaExceededError");
    const onError = vi.fn((_info: StorageErrorInfo) => {
      throw thrown;
    });
    const f = await matrix(backend, {
      force: false,
      onError,
      ...(kind === "serialize"
        ? {
            serialize: () => {
              throw cause;
            },
          }
        : {}),
    });
    let restore: (() => void) | undefined;
    try {
      if (kind === "corrupt") await f.inject("k", "{}");
      if (kind === "type") await f.handler.set("k", "text");
      if (kind === "write" || kind === "abort") {
        const spy = vi.spyOn(backing(f.handler), "set").mockImplementation(() => {
          throw cause;
        });
        restore = () => spy.mockRestore();
      }
      // Promise 包装同时校验同步 throw 与异步 rejection 的异常身份。
      await expect(Promise.resolve().then(() => (kind === "type" ? f.handler.get("k", 0) : kind === "corrupt" ? f.handler.get("k") : f.handler.set("k", 1)))).rejects.toBe(thrown);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.lastCall?.[0]).toMatchObject({ kind, key: "k", op: kind === "corrupt" || kind === "type" ? "get" : "set" });
      if (kind === "corrupt") expect(await backing(f.handler).get(f.handler.namespace + "k")).toBe("{}");
    } finally {
      restore?.();
      await f.cleanup();
    }
  });
});
