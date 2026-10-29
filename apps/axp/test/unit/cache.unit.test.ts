import { afterEach, expect, it, vi } from "vitest";
import { $defaultShouldCache, $resolveCloneFn, $shallowClone } from "../../src/plugins/cache";
import { AxpResponse } from "../../src/response";

/** 每个用例结束后还原被替换的全局。 */
afterEach(() => {
  vi.unstubAllGlobals();
});

it("[cache.fn.$shallowClone] 数组与对象只复制顶层，嵌套仍共享，原始值原样返回", () => {
  const nested = { n: 1 };
  const array = [nested];
  const object = { nested };
  const copiedArray = $shallowClone(array);
  const copiedObject = $shallowClone(object);
  expect(copiedArray).not.toBe(array);
  expect(copiedArray[0]).toBe(nested);
  expect(copiedObject).not.toBe(object);
  expect(copiedObject.nested).toBe(nested);
  for (const primitive of [1, "text", true, null, undefined]) {
    expect($shallowClone(primitive)).toBe(primitive);
  }
});

// 标题含 $ 的 API id 不能走 it.each（会被当成占位符），用循环生成用例。
for (const strategy of [undefined, "unknown", 1, null]) {
  it(`[cache.fn.$resolveCloneFn][cache.opt.clone] 缺省或非法策略 ${JSON.stringify(strategy)} 共享引用（null）`, () => {
    expect($resolveCloneFn(strategy as never)).toBeNull();
  });
}

/** 自定义拷贝策略样例。 */
const custom = (data: unknown) => data;

it("[cache.fn.$resolveCloneFn][cache.opt.clone] shallow 为浅拷贝函数，函数策略原样采用", () => {
  expect($resolveCloneFn("shallow")).toBe($shallowClone);
  expect($resolveCloneFn(custom)).toBe(custom);
});

it("[cache.fn.$resolveCloneFn][cache.opt.clone] deep 用 structuredClone 完整隔离；环境没有时抛错而不退化", () => {
  const data = { a: { b: [1] } };
  const cloned = $resolveCloneFn("deep")!(data);
  expect(cloned).toEqual(data);
  expect(cloned.a).not.toBe(data.a);
  vi.stubGlobal("structuredClone", undefined);
  expect(() => $resolveCloneFn("deep")).toThrow(/structuredClone/);
});

for (const [label, response, expected] of [
  ["HTTP 200 无信封", new AxpResponse({ status: 200, data: 1 }), true],
  ["HTTP 200 业务码 0", new AxpResponse({ status: 200, code: 0, data: 1 }), true],
  ["HTTP 200 业务失败码", new AxpResponse({ status: 200, code: 500, data: null }), false],
  ["HTTP 500 即使业务码 0", new AxpResponse({ status: 500, code: 0, data: null }), false],
  ["网络错误", new AxpResponse({ failure: "network" }), false],
] as const) {
  it(`[cache.fn.$defaultShouldCache][cache.cb.shouldCache] 默认读归一化的 r.ok：${label}`, () => {
    expect($defaultShouldCache(response)).toBe(expected);
  });
}
