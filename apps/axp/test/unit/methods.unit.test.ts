import { expect, it } from "vitest";
import { BODY_METHODS, isBodyMethod, methodSet, NO_BODY_METHODS, SAFE_METHODS } from "../../src/methods";

it("请求体方法与查询参数方法互斥，合计覆盖 axios 的十个小写方法", /** 两组方法不重叠，合起来正好十个。 */ () => {
  expect([...BODY_METHODS].toSorted()).toEqual(["delete", "patch", "post", "put"]);
  expect([...NO_BODY_METHODS].toSorted()).toEqual(["get", "head", "link", "options", "purge", "unlink"]);
  expect(new Set([...BODY_METHODS, ...NO_BODY_METHODS]).size).toBe(10);
});
it("isBodyMethod 只认请求体方法的小写名称", /** 判定只针对规范化后的小写方法名。 */ () => {
  for (const method of BODY_METHODS) expect(isBodyMethod(method)).toBe(true);
  for (const method of NO_BODY_METHODS) expect(isBodyMethod(method)).toBe(false);
  expect(isBodyMethod("POST")).toBe(false);
  expect(isBodyMethod("")).toBe(false);
});

it("[core.const.SAFE_METHODS][core.fn.methodSet] 安全方法只含 get、head；方法列表规范成小写集合，空列表得空集合", () => {
  expect(SAFE_METHODS).toEqual(["get", "head"]);
  const set = methodSet(["GET", "Head", "post"]);
  expect([...set].toSorted()).toEqual(["get", "head", "post"]);
  expect(set.has("get")).toBe(true);
  expect(set.has("GET")).toBe(false);
  expect(methodSet([]).size).toBe(0);
});
