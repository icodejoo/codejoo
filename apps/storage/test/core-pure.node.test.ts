import { describe, expect, it, vi } from "vitest";
import { attempt, chain, all, isPromise } from "../src/maybe";
import { keyspace } from "../src/keyspace";
import { isExpired, mkEntity, parseEntity, renewOf, typeMismatch } from "../src/entity";
import { report } from "../src/errors";

describe("core pure modules", () => {
  it("Maybe 保留同步结果并串联 Promise，处理器异常不被二次捕获", async () => {
    expect(chain(1, n => n + 1)).toBe(2);
    expect(await chain(Promise.resolve(1), n => n + 1)).toBe(2);
    expect(isPromise(Promise.resolve())).toBe(true);
    expect(isPromise(null)).toBe(false);
    const error = new Error("original"), handler = vi.fn(() => { throw error; });
    expect(() => attempt(() => { throw 1; }, handler)).toThrow(error);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await attempt(() => Promise.reject(error), e => e)).toBe(error);
    expect(await all([undefined, Promise.resolve()])).toBeUndefined();
  });
  it("keyspace 转义不重叠，普通键兼容，双向缓存有界", () => {
    const a = keyspace("a"), ab = keyspace("a:b"), pct = keyspace("a%3Ab");
    expect(a.full("x")).toBe("a:x");
    expect(a.owns(ab.full("x"))).toBe(false);
    expect(ab.full("x")).toBe("a%3Ab:x");
    expect(pct.full("x")).toBe("a%253Ab:x");
    expect(pct.logical(pct.full("%:x"))).toBe("%:x");
    const encode = vi.fn((s: string) => "@" + s), decode = vi.fn((s: string) => s.startsWith("@") ? s.slice(1) : null);
    const k = keyspace("n", { encode, decode });
    for (let i = 0; i < 1000; i++) { expect(k.owns(k.full(String(i)))).toBe(true); k.logical(k.full(String(i))); }
    encode.mockClear(); decode.mockClear();
    for (let i = 0; i < 1000; i++) { k.owns(k.full(String(i))); k.logical(k.full(String(i))); }
    expect(decode).not.toHaveBeenCalled(); expect(encode).not.toHaveBeenCalled();
    for (let i = 1000; i < 2050; i++) k.owns(k.full(String(i)));
    expect(k.owns("foreign")).toBe(false);
  });
  it("entity 验证形状、数字元数据、过期边界和续期标志", () => {
    for (const text of ['{}', '{"foo":1}', '[]', 'false', '{"value":1,"ttl":"1"}', '{"value":1,"createdAt":null}']) expect(() => parseEntity(text)).toThrow(TypeError);
    expect(() => parseEntity(null)).toThrow(TypeError);
    expect(parseEntity('{"value":null}').value).toBeNull();
    expect(isExpired({ value: 1, createdAt: 0, expireAt: 100 }, 100)).toBe(true);
    expect(isExpired({ value: 1, expireAt: 100 }, 100)).toBe(false);
    expect(renewOf({ value: 1, ttl: 100, expireAt: 100 }, 50)).toBeUndefined();
    expect(renewOf({ value: 1, createdAt: 0, ttl: 100, expireAt: 100 }, 10)?.expireAt).toBe(110);
    expect(renewOf({ value: 1, createdAt: 0, ttl: 100, expireAt: 100 }, 9)).toBeUndefined();
    expect(typeMismatch("1", 0)).toBe(true); expect(typeMismatch({}, [])).toBe(true);
    for (const fallback of [undefined, null, {}, new Date(), () => {}]) expect(typeMismatch(1, fallback)).toBe(false);
    expect(typeMismatch([], [])).toBe(false);
  });
  it("entity 创建和错误上报保留原异常", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(mkEntity(1, -1, undefined, false, "k", 100)).toEqual({ value: 1, createdAt: 100 });
    expect(mkEntity(1, 10, 50, true, "k", 100)?.expireAt).toBe(110);
    expect(mkEntity(1, undefined, "invalid", false, "k", 100)).toBeNull();
    expect(mkEntity(1, 10, 50, false, "k", 100)).toBeNull();
    expect(mkEntity(1, 10, 200, false, "k", 100)?.expireAt).toBe(200);
    const error = new Error("error"), onError = vi.fn();
    report(onError, { kind: "write", op: "set", key: "k", error });
    expect(onError.mock.calls[0][0].error).toBe(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    report(undefined, { kind: "write", op: "set", key: "k", error }); expect(log).toHaveBeenCalled();
    expect(() => report(() => { throw error; }, { kind: "type", op: "get", key: "k", error })).toThrow(error);
    warn.mockRestore(); log.mockRestore();
  });
});
