import { expect, it } from "vitest";
import { requestKey } from "../../src/key";

/** 指纹基准请求。 */
const BASE = { method: "get", url: "/key" };
/** 生成带参数的指纹。 */
function params(value: unknown) {
  return requestKey({ ...BASE, params: value });
}

it("[core.method.key] method/url/params、body 方法与大小写", /** method/url/params、body 方法与大小写。 */ () => {
  expect(requestKey(BASE)).toBe(requestKey({ ...BASE, method: "GET" }));
  expect(requestKey({ url: BASE.url })).toBe(requestKey(BASE));
  expect(params({ id: 1 })).not.toBe(params({ id: 2 }));
  expect(params({ a: 1, b: 2 })).toBe(params({ b: 2, a: 1 }));
  expect(params([1, 2])).not.toBe(params([2, 1]));
  expect(params(["ab,c"])).not.toBe(params(["ab", "c"]));
  expect(params({ "a:b": "c" })).not.toBe(params({ a: "b:c" }));
  expect(params({ a: 1 })).not.toBe(params({ b: 1 }));
  expect(params(1)).not.toBe(params("1"));
  for (const method of ["delete", "post", "put", "patch"]) expect(requestKey({ ...BASE, method, data: 1 })).not.toBe(requestKey({ ...BASE, method, data: 2 }));
  expect(requestKey({ ...BASE, data: 1 })).toBe(requestKey({ ...BASE, data: 2 }));
  expect(requestKey({ ...BASE, method: "post" })).not.toBe(requestKey(BASE));
  expect(requestKey({ ...BASE, url: "/other" })).not.toBe(requestKey(BASE));
});
it("[core.req.key][core.opt.key] 显式键、关闭、scope 常量/回调与空值", /** 显式键、关闭、scope 常量/回调与空值。 */ () => {
  expect(requestKey({ key: false })).toBeNull();
  expect(requestKey({ key: "  explicit  " })).toBe("  explicit  ");
  expect(requestKey({ key: "  " })).toBe("  ");
  expect(requestKey({ key: "" })).toBeNull();
  expect(requestKey(BASE, { scope: "one" })).not.toBe(requestKey(BASE, { scope: "two" }));
  expect(requestKey({ key: "explicit" }, { scope: /** 返回固定账号分区。 */ () => "account" })).toBe("explicit#account");
  for (const scope of [undefined, "", NaN, /** 返回 null 视为没有分区。 */ () => null]) expect(requestKey(BASE, { scope })).toBe(requestKey(BASE));
  expect(requestKey(BASE, { scope: 0 })).toContain("#0");
  const bug = new Error("scope");
  expect(
    /** scope 回调抛错时 requestKey 原样抛出。 */ () =>
      requestKey(BASE, {
        scope: /** 模拟 scope 回调内部程序异常。 */ () => {
          throw bug;
        },
      }),
  ).toThrow(bug);
});
it("[core.method.key] 仅跳过 undefined 字段，null、空容器和空标量保留", /** undefined 字段等同于没有；null 参与哈希，JSON 请求体会发送 null。 */ () => {
  for (const value of [null, undefined]) {
    expect(params(value)).toBe(requestKey(BASE));
    expect(requestKey({ ...BASE, method: "post", data: value })).toBe(requestKey({ ...BASE, method: "post" }));
  }
  expect(params({ value: undefined })).toBe(params({}));
  expect(params({ nested: { value: undefined } })).toBe(params({ nested: {} }));
  expect(params({ value: null })).not.toBe(params({}));
  expect(params({ nested: { value: null } })).not.toBe(params({ nested: {} }));
  for (const value of [NaN, "", "  ", [], {}, [[]], [[{}]], { a: { b: [] } }, false, 0]) {
    expect(params(value)).not.toBe(requestKey(BASE));
    expect(params({ value })).not.toBe(params({}));
  }
  expect(params({ nested: {} })).not.toBe(params({}));
});
it("[core.method.key] PATCH 请求体的 null 字段与省略字段生成不同 key", /** JSON 请求体发送 null 表示清空字段，undefined 字段则被省略。 */ () => {
  const request = { ...BASE, method: "patch" };
  const empty = requestKey({ ...request, data: {} });
  expect(empty).not.toBeNull();
  expect(requestKey({ ...request, data: { a: null } })).not.toBe(empty);
  expect(requestKey({ ...request, data: { a: undefined } })).toBe(empty);
  expect(requestKey({ ...request, data: { nested: { a: null } } })).not.toBe(requestKey({ ...request, data: { nested: {} } }));
});
it("[core.opt.key] 不可哈希对象、循环与抛错 getter", /** 不可哈希对象、循环与抛错 getter。 */ () => {
  for (const value of [new Map(), new Set(), new Blob(), new FormData()]) expect(params({ value })).toBeNull();
  const cycle: unknown[] = [];
  cycle.push(cycle);
  expect(params(cycle)).toBeNull();
  const bug = new Error("getter");
  expect(
    /** 取值抛出普通异常时 key 计算不能吞掉。 */ () =>
      params({
        /** 模拟读取字段时抛出程序异常。 */ get value() {
          throw bug;
        },
      }),
  ).toThrow(bug);
  const range = new RangeError("user getter");
  expect(
    /** 读取字段抛出 RangeError 时同样原样透传。 */ () =>
      params({
        /** 模拟读取字段时抛出 RangeError。 */ get value() {
          throw range;
        },
      }),
  ).toThrow(range);
  expect(requestKey({ key: "deep" })).toBe("deep");
});
it("[core.method.key] 字符串全量哈希并保留两端空白", /** 中段和空白变化都参与摘要。 */ () => {
  const value = "a".repeat(128);
  const changed = value.slice(0, 20) + "x" + value.slice(21);
  expect(params(value)).not.toBe(params(changed));
  expect(params("  value  ")).not.toBe(params("value"));
});
it("[core.req.key] key: true 与省略等价，都按请求自动计算（兼容旧写法）", /** 旧代码大量写 key: true, cache: true，迁移时不必逐处删除。 */ () => {
  const base = { method: "get", url: "/pets", params: { page: 1 } };
  const auto = requestKey(base);
  expect(auto).not.toBeNull();
  expect(requestKey({ ...base, key: true })).toBe(auto);
  expect(requestKey({ ...base, params: { page: 2 }, key: true })).not.toBe(auto);
});
