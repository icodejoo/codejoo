import { expect, it } from "vitest";
import { isObject, isPlainObject, toText } from "../../src/utils";

/** 自定义类实例，原型既不是 Object.prototype 也不是 null。 */
class Custom {
  /** 实例字段，使其不是空类。 */
  value = 1;
}

it("isObject 把数组和特殊对象也算作对象，排除 null 与原始值", /** 只排除 null、原始值和函数。 */ () => {
  for (const value of [{}, [], new Date(), new Map(), new Custom(), Object.create(null)]) expect(isObject(value)).toBe(true);
  for (const value of [null, undefined, 0, "", "text", true, Symbol("s"), () => {}]) expect(isObject(value)).toBe(false);
});
it("isPlainObject 只接受字面量与无原型字典", /** 数组、日期、类实例等不能当作可按字段复制的纯对象。 */ () => {
  for (const value of [{}, { a: 1 }, Object.create(null), Object.assign(Object.create(null), { a: 1 })]) expect(isPlainObject(value)).toBe(true);
  for (const value of [[], new Date(), new Map(), new Custom(), null, undefined, 1, "text"]) expect(isPlainObject(value)).toBe(false);
});

it("toText 与 String 等价：原始值、数组、自带 toString 的对象和普通对象", /** 对象沿用自身 toString 结果。 */ () => {
  expect(toText("text")).toBe("text");
  expect(toText(1)).toBe("1");
  expect(toText(false)).toBe("false");
  expect(toText(["a", "b"])).toBe("a,b");
  expect(toText({ toString: /** 自定义文本。 */ () => "custom" })).toBe("custom");
  expect(toText({})).toBe("[object Object]");
  expect(toText(null)).toBe("null");
});
