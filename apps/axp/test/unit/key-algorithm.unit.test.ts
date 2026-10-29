import { expect, expectTypeOf, it, vi } from "vitest";
import { requestKey, type IKeyOptions } from "../../src/key";

/** 请求体算法的基准请求。 */
const BASE = { method: "post", url: "/algorithm" };
/** 随机性质样本数。 */
const SAMPLE_COUNT = 160;
/** 固定随机种子。 */
const SEED = 0x5eed2026;
/** 随机树最大深度。 */
const MAX_DEPTH = 3;
/** 数组与对象的最大宽度。 */
const MAX_WIDTH = 4;
/** 仅计算请求体指纹。 */
function data(value: unknown) {
  return requestKey({ ...BASE, data: value });
}

/** 生成固定种子的随机树；只包含可哈希值。 */
function samples(): unknown[] {
  let seed = SEED;
  /** 线性同余随机数，结果仅依赖固定种子。 */
  function random(limit: number): number {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed % limit;
  }
  /** 生成含空标量、容器和嵌套字段的随机值。 */
  function value(depth: number): unknown {
    const scalar = [null, undefined, "", "  text  ", 0, false, NaN, random(10_000), "v:" + random(10_000), true];
    const kind = random(depth ? scalar.length + 2 : scalar.length);
    if (kind < scalar.length) return scalar[kind];
    const items = Array.from({ length: random(MAX_WIDTH) }, /** 递归生成下层样本。 */ () => value(depth - 1));
    return kind === scalar.length ? items : Object.fromEntries(items.map(/** 赋予可分帧字段名。 */ (item, index) => ["field:" + index, item]));
  }
  return Array.from({ length: SAMPLE_COUNT }, /** 每个样本包成参与摘要的对象。 */ () => ({ payload: value(MAX_DEPTH), id: random(10_000) }));
}

/** 递归反转对象字段插入顺序，数组顺序保持原样。 */
function reorder(value: any): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toReversed()
        .map(/** 反转每一层对象字段。 */ ([key, item]) => [key, reorder(item)]),
    );
  }
  return value;
}

/** 枚举每个参与字段或数组元素单独变化的样本，不改动原值。 */
function changes(value: any): unknown[] {
  if (Array.isArray(value)) {
    if (!value.length) return [[0]];
    return value.flatMap(/** 每次只替换一个数组元素。 */ (item, index) => changes(item).map(/** 复制数组并替换对应元素。 */ (changed) => value.with(index, changed)));
  }
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value).filter(/** 仅 undefined 字段不参与摘要，null 字段参与。 */ ([, item]) => item !== undefined);
    if (!fields.length) return [{ ...value, added: 0 }];
    return fields.flatMap(/** 每次只变更一个参与字段。 */ ([key, item]) => changes(item).map(/** 保留其余字段。 */ (changed) => Object.assign({}, value, { [key]: changed })));
  }
  return [typeof value === "string" ? value + "!" : typeof value === "number" ? (Number.isNaN(value) ? 0 : value + 1) : !value];
}

it("[core.method.key] 固定种子随机请求反复计算稳定且不修改输入", /** 重复调用不能受上一个请求的递归状态影响。 */ () => {
  for (const payload of samples()) {
    const before = structuredClone(payload);
    const expected = data(payload);
    expect(expected).not.toBeNull();
    for (let repeat = 0; repeat < MAX_WIDTH; repeat++) expect(data(payload)).toBe(expected);
    expect(payload).toEqual(before);
  }
});

it("[core.method.key] 固定种子随机对象每层字段重排后 key 相同", /** 可交换累加不依赖字段插入顺序。 */ () => {
  for (const payload of samples()) expect(data(reorder(payload))).toBe(data(payload));
});

it("[core.method.key] 固定种子随机请求任一参与字段单独改变则 key 改变", /** 遍历参与摘要的叶子和空容器。 */ () => {
  for (const payload of samples()) {
    const expected = data(payload);
    for (const changed of changes(payload)) expect(data(changed)).not.toBe(expected);
  }
});

it("[core.method.key] 类型标签区分数字、文本、布尔和大整数", /** 相同文本表示也不能跨类型命中。 */ () => {
  const values = [1, "1", 1n, true, "true", 0, "0", false, "false", NaN, "NaN", [], {}, ""];
  const keys = values.map(data);
  expect(keys).not.toContain(null);
  expect(new Set(keys).size).toBe(values.length);
});

it("[core.method.key] 数组保留空元素、位置和嵌套边界", /** 不折叠数组中的 null、undefined 或空容器。 */ () => {
  const values = [[], [null], [undefined], [null, undefined], [undefined, null], [""], [[]], [{}], [[1], 2], [[1, 2]], [1, [2]], [1, null], [1]];
  expect(new Set(values.map(data)).size).toBe(values.length);
  const sparse: unknown[] = [];
  sparse.length = 1;
  expect(data(sparse)).toBe(data([undefined]));
});

it("[core.method.key] 字符串、字段名和请求片段分帧防止拼接歧义", /** 分隔字符出现在内容中也不改变结构边界。 */ () => {
  for (const [left, right] of [
    [
      ["ab", "c"],
      ["a", "bc"],
    ],
    [["ab,c"], ["ab", "c"]],
    [{ "a:b": "c" }, { a: "b:c" }],
    [{ ab: 1 }, { a: "b1" }],
    [{ a: { b: 1 } }, { a: {}, b: 1 }],
  ])
    expect(data(left)).not.toBe(data(right));
  expect(requestKey({ ...BASE, params: 1, data: 2 })).not.toBe(requestKey({ ...BASE, params: 2, data: 1 }));
  expect(requestKey({ ...BASE, params: { x: 1 } })).not.toBe(data({ x: 1 }));
  expect(requestKey({ ...BASE, url: "/a", params: "bc" })).not.toBe(requestKey({ ...BASE, url: "/ab", params: "c" }));
});

it("[core.method.key] Unicode 字符串的每个字符和尾部都参与哈希", /** 覆盖各种长度与字符位置，保留 UTF-16 代理项。 */ () => {
  const original = "中😀a".repeat(32);
  for (let length = 0; length <= original.length; length++) {
    const text = original.slice(0, length);
    const expected = data(text);
    expect(expected).not.toBeNull();
    expect(data(text)).toBe(expected);
    for (let index = 0; index < text.length; index++) expect(data(text.slice(0, index) + "!" + text.slice(index + 1))).not.toBe(expected);
  }
});

it("[core.method.key] Date 和 URLSearchParams 按值并与其他类型区分", /** 固定时钟避免测试依赖真实时间。 */ () => {
  vi.useFakeTimers();
  try {
    expect(data(new Date(0))).toBe(data(new Date(0)));
    expect(data(new Date(0))).not.toBe(data(new Date(1)));
    expect(data(new Date(0))).not.toBe(data(0));
    expect(data(new Date(NaN))).toBe(data(new Date(NaN)));
    expect(data(new Date(NaN))).not.toBe(data(NaN));
    const text = "a=1&b=2";
    expect(data(new URLSearchParams(text))).toBe(data(new URLSearchParams(text)));
    expect(data(new URLSearchParams(text))).not.toBe(data(new URLSearchParams("a=2&b=2")));
    expect(data(new URLSearchParams(text))).not.toBe(data(text));
    expect(data(new URLSearchParams())).not.toBe(data(""));
  } finally {
    vi.useRealTimers();
  }
});

it("[core.method.key] 不透明对象、函数和 Symbol 在任意参与位置返回 null", /** 有可枚举字段或 byteLength 的类实例也不能冒充普通值。 */ () => {
  /** 带自有字段的不透明业务实例。 */
  class Opaque {
    /** 可枚举业务字段。 */
    value = 1;
    /** 不能冒充二进制缓冲区。 */
    byteLength = 1;
  }
  const values = [new Opaque(), new Map([[1, 2]]), new Set([1]), new Blob(), new FormData(), /pattern/, Symbol("value"), /** 函数不能按文本生成指纹。 */ () => 1];
  for (const value of values) {
    expect(data(value)).toBeNull();
    expect(data({ nested: [value] })).toBeNull();
  }
});

it("[core.method.key] 直接和间接循环返回 null，共享子对象不算循环", /** 祖先栈只记录当前递归路径。 */ () => {
  const cycle: any = {};
  cycle.self = cycle;
  const array: unknown[] = [];
  array.push({ array });
  expect(data(cycle)).toBeNull();
  expect(data(array)).toBeNull();
  const shared = { value: 1 };
  expect(data({ left: shared, right: shared })).toBe(data({ left: { value: 1 }, right: { value: 1 } }));
  expect(data([shared, shared])).not.toBeNull();
});

it("[core.method.key] 普通对象只读自有字段并支持无原型字典", /** Object.prototype 上的枚举字段不能进入指纹。 */ () => {
  const field = "axpKeyInherited";
  let actual: string | null = null;
  let expected: string | null = null;
  Object.defineProperty(Object.prototype, field, { /** 可被 for-in 枚举。 */ enumerable: true, /** 允许测试后清理。 */ configurable: true, /** 继承值。 */ value: 2 });
  try {
    actual = data({ own: 1 });
    expected = data(Object.assign(Object.create(null), { own: 1 }));
  } finally {
    Reflect.deleteProperty(Object.prototype, field);
  }
  expect(actual).not.toBeNull();
  expect(actual).toBe(expected);
});

it("[core.method.key] 只有请求体方法读取 data，其余方法忽略不透明请求体", /** 覆盖 axios 全部方法和大小写规整。 */ () => {
  for (const method of ["delete", "post", "put", "patch"]) {
    const request = { ...BASE, method };
    expect(requestKey({ ...request, data: 1 })).not.toBe(requestKey({ ...request, data: 2 }));
    expect(requestKey({ ...request, data: 1 })).toBe(requestKey({ ...request, method: method.toUpperCase(), data: 1 }));
    expect(requestKey({ ...request, data: new Map() })).toBeNull();
  }
  for (const method of ["get", "head", "options", "purge", "link", "unlink"]) {
    expect(requestKey({ ...BASE, method, data: new Map() })).toBe(requestKey({ ...BASE, method }));
  }
});

it("[core.opt.key.scope] scope 回调接收原请求且公开配置只剩 scope", /** 分区函数可以按当前请求取值。 */ () => {
  expectTypeOf<keyof IKeyOptions>().toEqualTypeOf<"scope">();
  expect(requestKey(BASE, { scope: /** 读取当前请求方法作为分区。 */ (request) => request.method })).toBe(requestKey(BASE) + "#post");
});
