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
  expect(params(1)).toBe(params("1"));
  for (const method of ["delete", "post", "put", "patch"])
    expect(requestKey({ ...BASE, method, data: 1 })).not.toBe(
      requestKey({ ...BASE, method, data: 2 }),
    );
  expect(requestKey({ ...BASE, data: 1 })).toBe(requestKey({ ...BASE, data: 2 }));
  expect(requestKey({ ...BASE, method: "post" })).not.toBe(requestKey(BASE));
  expect(requestKey({ ...BASE, url: "/other" })).not.toBe(requestKey(BASE));
});
it("[core.req.key][core.opt.key] 显式键、关闭、scope 常量/回调与空值", /** 显式键、关闭、scope 常量/回调与空值。 */ () => {
  expect(requestKey({ key: false })).toBeNull();
  expect(requestKey({ key: "  explicit  " })).toBe("explicit");
  expect(requestKey({ key: "  " })).toBeNull();
  expect(requestKey(BASE, { scope: "one" })).not.toBe(requestKey(BASE, { scope: "two" }));
  expect(
    requestKey({ key: "explicit" }, { scope: /** 返回固定账号分区。 */ () => "account" }),
  ).toBe("explicit#account");
  for (const scope of [undefined, "", NaN, /** 返回 null 视为没有分区。 */ () => null])
    expect(requestKey(BASE, { scope })).toBe(requestKey(BASE));
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
it("[core.opt.key] 深层空值回滚、ignores 按名称或值豁免", /** 深层空值回滚、ignores 按名称或值豁免。 */ () => {
  for (const value of [
    null,
    undefined,
    NaN,
    "",
    "  ",
    [],
    {},
    [[]],
    [[{}]],
    { a: { b: [] } },
    { a: null },
    Buffer.alloc(0),
  ])
    expect(params(value)).toBe(requestKey(BASE));
  for (const value of [false, 0, new Date(0), new URLSearchParams("q=1"), Buffer.from("a")])
    expect(params(value)).not.toBe(requestKey(BASE));
  for (const value of [undefined, null, NaN, ""])
    expect(requestKey({ ...BASE, params: value }, { ignores: [value] })).not.toBe(requestKey(BASE));
  expect(requestKey({ ...BASE, params: { a: null } }, { ignores: ["a"] })).not.toBe(params({}));
  expect(requestKey({ ...BASE, params: { a: new Map() } }, { ignores: ["a"] })).not.toBeNull();
});
it("[core.opt.key] 不可哈希对象、循环与抛错 getter", /** 不可哈希对象、循环与抛错 getter。 */ () => {
  for (const value of [new Map(), new Set(), new Blob(), new FormData()])
    expect(params({ value })).toBeNull();
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
it("[core.opt.key] 全量哈希中段差异与长串采样", /** 全量哈希中段差异与长串采样。 */ () => {
  const value = "a".repeat(128);
  const changed = value.slice(0, 20) + "x" + value.slice(21);
  expect(params(value)).not.toBe(params(changed));
  expect(requestKey({ ...BASE, params: value }, { sample: true })).toBe(
    requestKey({ ...BASE, params: changed }, { sample: true }),
  );
  expect(params("  value  ")).toBe(params("value"));
});
it("[core.req.key] key: true 与省略等价，都按请求自动计算（兼容旧写法）", /** 旧代码大量写 key: true, cache: true，迁移时不必逐处删除。 */ () => {
  const base = { method: "get", url: "/pets", params: { page: 1 } };
  const auto = requestKey(base);
  expect(auto).not.toBeNull();
  expect(requestKey({ ...base, key: true })).toBe(auto);
  expect(requestKey({ ...base, params: { page: 2 }, key: true })).not.toBe(auto);
});
