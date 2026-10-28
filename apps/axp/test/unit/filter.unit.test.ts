import { expect, it } from "vitest";
import { $filter, defaultPredicate, type TDroppedKV } from "../../src/plugins/filter";

/** 默认规则剥离的空文本。 */
const EMPTY_TEXT = "";
/** 纯判定测试使用的字段名。 */
const FIELD_NAME = "field";
/** 不会被默认规则剥离的文本。 */
const NONEMPTY_TEXT = "x";
/** 特殊键中保存的业务文本。 */
const SAFE_VALUE = "safe";

it.each([null, undefined, NaN, EMPTY_TEXT, " \t\n", "\u00a0"])(
  "[filter.fn.defaultPredicate] 空值 %s 丢弃",
  /** 默认空字段判定。 */ (value) => {
    expect(defaultPredicate([FIELD_NAME, value])).toBe(true);
  },
);
it.each([0, -0, false, Infinity, "a", [], {}])(
  "[filter.fn.defaultPredicate] 有效值 %s 保留",
  /** 零和结构值有效。 */ (value) => {
    expect(defaultPredicate([FIELD_NAME, value])).toBe(false);
  },
);
it("[filter.fn.$filter] 只读自有字段，豁免 NaN/undefined，收集 dropped 并保留 __proto__ 数据键", /** 无原型和继承字典。 */ () => {
  const source = Object.assign(Object.create({ inherited: NONEMPTY_TEXT }), {
    empty: EMPTY_TEXT,
    nil: null,
    nan: NaN,
    absent: undefined,
    valid: 0,
  });
  Object.defineProperty(source, "__proto__", { enumerable: true, value: SAFE_VALUE });
  const dropped: TDroppedKV[] = [];
  const result = $filter(
    source,
    { predicate: defaultPredicate, ignoreKeys: ["empty"], ignoreValues: [NaN, undefined] },
    dropped,
  );
  expect(result).toEqual({
    empty: EMPTY_TEXT,
    nan: NaN,
    absent: undefined,
    valid: 0,
    ["__proto__"]: SAFE_VALUE,
  });
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(dropped).toEqual([["nil", null]]);
  expect(source.nil).toBeNull();
  expect(
    $filter(source, { predicate: defaultPredicate, ignoreKeys: [], ignoreValues: [] }),
  ).toEqual({ valid: 0, ["__proto__"]: SAFE_VALUE });
});
it("[filter.cb.predicate] 自定义过滤且只接受严格 true", /** 不是 true 的返回值保留。 */ () => {
  for (const returned of [false, 1, Promise.resolve(true)]) {
    expect(
      $filter({ n: 1 }, { predicate: /** JS 返回值边界。 */ () => returned as boolean }),
    ).toEqual({ n: 1 });
  }
  expect(
    $filter(
      { n: 1, s: NONEMPTY_TEXT },
      { predicate: /** 丢弃数值。 */ ([, value]) => typeof value === "number" },
    ),
  ).toEqual({ s: NONEMPTY_TEXT });
});
