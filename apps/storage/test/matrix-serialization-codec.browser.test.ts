import { afterEach, describe, expect, it, vi } from "vitest";
import { codec, codecAtob, codecBase64, JSONX } from "../src/index";
import { BACKENDS } from "./backends";
import { make } from "./helpers/matrix";
import { backing, matrix, peer, realm } from "./helpers/matrix";

afterEach(() => vi.restoreAllMocks());

describe.each(BACKENDS)("Serialization invariant %s", (backend) => {
  it("codeable obscures physical values and a changed codec self heals old data", async () => {
    const onError = vi.fn(),
      f = await make(backend, { codeable: true, codec: codec("old") });
    const other = await peer(backend, f.handler, { codeable: true, codec: codec("new"), onError });
    try {
      await f.handler.set("k", "secret");
      const key = f.handler.namespace + "k";
      expect(await backing(f.handler).get(key)).not.toContain("secret");
      expect(await f.handler.get("k")).toBe("secret");
      expect(await other.handler.get("k", "fallback")).toBe("fallback");
      expect(onError.mock.lastCall?.[0].kind).toBe("corrupt");
      expect(await backing(f.handler).get(key)).toBeNull();
    } finally {
      await other.destroy();
      await f.cleanup();
    }
  });
  it.each([null, false, 0, "", { nested: [1, false, null] }])("preserves JSON value %j", async (value) => {
    const f = await make(backend);
    try {
      await f.handler.set("k", value);
      expect(await f.handler.get("k")).toEqual(value);
    } finally {
      await f.cleanup();
    }
  });

  it("undefined becomes a missing-value corrupt envelope and self heals", async () => {
    const onError = vi.fn(),
      f = await make(backend, { memoized: true, onError });
    try {
      await f.handler.set("k", undefined);
      expect(await f.handler.get("k", "fallback")).toBe("fallback");
      expect(onError.mock.lastCall?.[0]).toMatchObject({ kind: "corrupt", op: "get", key: "k", error: expect.anything() });
      expect(await f.handler.keys()).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  it("JSONX preserves bigint Date Map Set and escaped tag-shaped objects", async () => {
    const f = await make(backend, { serialize: JSONX.stringify, deserialize: JSONX.parse });
    const value = { integer: 123n, date: new Date("2026-01-01"), map: new Map([["a", 1]]), set: new Set([1, 2]), tag: { __jt__: "bigint", value: "invalid" } };
    try {
      await f.handler.set("k", value);
      expect(await f.handler.get("k")).toEqual(value);
    } finally {
      await f.cleanup();
    }
  });

  it("JSON Date uses its ISO string representation", async () => {
    const f = await make(backend),
      value = new Date("2026-01-01");
    try {
      await f.handler.set("k", value);
      expect(await f.handler.get("k")).toBe(value.toISOString());
    } finally {
      await f.cleanup();
    }
  });

  it("circular and native JSON bigint failures report serialize without writing", async () => {
    const onError = vi.fn(),
      f = await make(backend, { onError });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    try {
      for (const value of [cyclic, 1n]) await f.handler.set("k", value);
      expect(onError).toHaveBeenCalledTimes(2);
      for (const [info] of onError.mock.calls) expect(info).toMatchObject({ kind: "serialize", op: "set", key: "k", error: expect.anything() });
      expect(await f.handler.keys()).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  it.each(["{", "{}", '{"foo":1}', "[]", "null", "1", '{"value":1,"ttl":"10"}', '{"value":1,"createdAt":false}', '{"value":1,"expireAt":{}}'])(
    "rejects malformed external payload %s and deletes it only once",
    async (text) => {
      const onError = vi.fn(),
        f = await matrix(backend, { onError });
      try {
        await f.inject("k", text);
        expect(await f.handler.get("k", 42)).toBe(42);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.lastCall?.[0]).toMatchObject({ kind: "corrupt", op: "get", key: "k" });
        expect(await f.handler.keys()).toEqual([]);
        expect(await f.handler.get("k", 42)).toBe(42);
        expect(onError).toHaveBeenCalledTimes(1);
      } finally {
        await f.cleanup();
      }
    },
  );

  it.each([codec, codecBase64, codecAtob])("encodes values and logical keys with codec variant %#", async (create) => {
    const f = await make(backend, { codeable: true, enckey: true, codec: create("matrix") });
    try {
      await f.handler.set("中文:%", "secret🎉");
      expect(await f.handler.get("中文:%")).toBe("secret🎉");
      expect(await f.handler.keys()).toEqual(["中文:%"]);
      expect(await f.handler.key(0)).toBe("中文:%");
      expect(await f.handler.length).toBe(1);
      await f.handler.remove("中文:%");
      expect(await f.handler.keys()).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  it.each(["enckey", "codeable"] as const)("warns for %s without codec and retains plain behavior", async (option) => {
    const f = await make(backend),
      warn = vi.spyOn(realm(f.handler).console, "warn").mockImplementation(() => {});
    const other = await peer(backend, f.handler, { [option]: true });
    try {
      expect(warn).toHaveBeenCalled();
      await other.handler.set("k", "v");
      expect(await other.handler.get("k")).toBe("v");
      expect(await other.handler.keys()).toEqual(["k"]);
    } finally {
      await other.destroy();
      await f.cleanup();
    }
  });

  it("corrupt encoded values report and self heal", async () => {
    const onError = vi.fn(),
      f = await matrix(backend, { codeable: true, codec: codec("right"), onError });
    try {
      // 注入钩子在编码前执行，因此用非 JSON 文本覆盖正常信封。
      await f.inject("k", "invalid JSON");
      expect(await f.handler.get("k", "fallback")).toBe("fallback");
      expect(onError.mock.lastCall?.[0].kind).toBe("corrupt");
      expect(await f.handler.keys()).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });
});
