import { describe, expect, it } from "vitest";
import { JSONX } from "../src/serialization";
import { Memory } from "../src/memory";

describe("platform JSONX", () => {
  it("带标签对象的 toJSON 仍遵循 JSON 语义", () => {
    expect(JSONX.stringify({ __jt__: "Date", toJSON: () => null })).toBe("null");
    const tagged = { __jt__: "bigint", value: "bad" };
    expect(JSONX.parse(JSONX.stringify({ toJSON: () => tagged }))).toEqual(tagged);
  });
  it.each(["Date", "Map", "Set", "bigint", "Object", "unknown"])("普通 %s 标签往返仍为对象", (tag) => {
    const value = { __jt__: tag, value: "invalid", nested: { __jt__: "Date", value: 0 } };
    expect(JSONX.parse(JSONX.stringify(value))).toEqual(value);
    const exact = { __jt__: tag, value: "invalid" };
    expect(JSONX.parse(JSONX.stringify(exact))).toEqual(exact);
  });
  it("递归转义外壳、特殊类型和 __proto__", () => {
    const value = new Map([[{ __jt__: "bigint", value: "bad" }, new Set([1n, new Date(0)])]]);
    expect(JSONX.parse(JSONX.stringify(value))).toEqual(value);
    const proto = JSON.parse('{"__jt__":"Object","value":[],"__proto__":{"x":1}}');
    expect(JSONX.parse(JSONX.stringify(proto))).toEqual(proto);
  });
  it("旧标签可读，非法 bigint 仍抛错", () => {
    expect(JSONX.parse('{"__jt__":"Date","value":0}')).toEqual(new Date(0));
    expect(() => JSONX.parse('{"__jt__":"bigint","value":"invalid"}')).toThrow();
    expect(JSONX.parse(JSONX.stringify(new Date(NaN))).getTime()).toBeNaN();
    expect(JSONX.parse('{"__jt__":"unknown","value":0}')).toEqual({ __jt__: "unknown", value: 0 });
    expect(JSONX.parse('{"__jt__":"bigint","value":"42"}')).toBe(42n);
  });
});

describe("platform Memory", () => {
  it.each([NaN, Infinity, -Infinity, 2 ** 32, -(2 ** 32), -0.5])("unsigned long 下标 %s", (index) => {
    const mem = new Memory();
    mem.set("first", "");
    expect(mem.key(index)).toBe("first");
  });
  it("向零取整、负数回绕、越界与基础方法", () => {
    const mem = new Memory();
    mem.set("a", false);
    mem.set("b", 0);
    expect(mem.key(1.9)).toBe("b");
    expect(mem.key(-1)).toBeNull();
    expect(mem.key(2)).toBeNull();
    expect(mem.get("a")).toBe(false);
    expect(mem.keys()).toEqual(["a", "b"]);
    mem.remove("a");
    expect(mem.get("a")).toBeNull();
    mem.clear();
    expect(mem.length).toBe(0);
  });
});
