import type { AxiosRequestConfig } from "axios";
import { expect, it } from "vitest";
import { $key, requestKey, type IKeyOptions } from "../../src/key";
import type { AxpRequestConfig } from "../../src/types";
import { $key as referenceKey, requestKey as referenceRequestKey } from "../helpers/key-reference";

/** 固定随机种子，失败可完整复现。 */
const RANDOM_SEED = 0x6a09e667;
/** 至少一万组请求的差分规模。 */
const CASE_COUNT = 12_000;
/** 随机数归一化分母。 */
const UINT_RANGE = 0x1_0000_0000;
/** 限制生成树深度，避免规模指数失控。 */
const MAX_DEPTH = 4;
/** 随机容器最大宽度。 */
const MAX_WIDTH = 5;
/** 有效业务请求体方法。 */
const POST_METHOD = "post";
/** 差分请求地址。 */
const TEST_URL = "/differential";
/** 按名称豁免的字段。 */
const KEEP_FIELD = "keep";
/** 多位长度分帧使用的文本。 */
const FRAME_TEXT = "x";
/** 与基准相同的长串尺寸。 */
const LONG_LENGTH = 1_024;
/** 分帧边界附近的二进制长度。 */
const BINARY_LENGTH = 128;
/** 会话分区样本。 */
const SCOPES = [undefined, null, "", NaN, 0, -1, "account", "中文#分区"] as const;
/** 同时覆盖缺省、大小写、空方法及不携带请求体的方法。 */
const METHODS = [
  undefined,
  "",
  "get",
  "GET",
  POST_METHOD,
  "POST",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "purge",
  "link",
  "unlink",
];
/** URL 的边界、分隔符和非 ASCII 样本。 */
const URLS = [undefined, "", TEST_URL, "/a?b=1#c", "/中文/😀", "|p|d"];
/** 字段名分帧与豁免候选。 */
const FIELD_NAMES = ["", KEEP_FIELD, "a:b", "ab", "中文", "😀", FRAME_TEXT.repeat(BINARY_LENGTH)];
/** 显式指纹和关闭开关。 */
const EXPLICIT_KEYS = [undefined, false, "", "  ", " fixed ", "带#分区"] as const;

/** xorshift32 的确定性随机数流。 */
function randomSource(): () => number {
  let state = RANDOM_SEED;
  return /** 推进固定种子的随机序列。 */ () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / UINT_RANGE;
  };
}

/** 选择固定池中的一个样本。 */
function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)]!;
}

/** 生成嵌套数据，特殊对象与循环引用也作为叶子嵌入。 */
function generate(random: () => number, leaves: unknown[], depth = 0): unknown {
  const shape = Math.floor(random() * MAX_WIDTH);
  if (depth >= MAX_DEPTH || shape > 1) return pick(leaves, random);
  const width = Math.floor(random() * MAX_WIDTH);
  if (shape === 0) {
    return Array.from(
      { /** 随机容器宽度。 */ length: width },
      /** 递归生成有序数组项。 */ () => generate(random, leaves, depth + 1),
    );
  }
  const result: Record<string, unknown> = {};
  for (let index = 0; index < width; index++) {
    result[pick(FIELD_NAMES, random)] = generate(random, leaves, depth + 1);
  }
  return result;
}

/** 函数叶子沿用旧 String 转换语义。 */
function marker(): void {}

/** 创建包含循环、共享引用和各种特殊对象的叶子池。 */
function leafPool(): unknown[] {
  const cycle: unknown[] = [];
  cycle.push(cycle);
  const objectCycle: Record<string, unknown> = {};
  objectCycle.keep = objectCycle;
  const shared = { /** 共享子树业务值。 */ value: 7 };
  return [
    null,
    undefined,
    NaN,
    true,
    false,
    0,
    -0,
    1,
    -42,
    Infinity,
    -Infinity,
    0.125,
    1e30,
    "",
    " ",
    "\t\r\n",
    " a:b,c ",
    "中文😀\ud800",
    FRAME_TEXT.repeat(64),
    " y".repeat(65),
    "中文😀".repeat(300),
    new Date(0),
    new Date(NaN),
    new Date(1_700_000_000_000),
    new URLSearchParams(),
    new URLSearchParams("a=1&a=2&b=%E4%B8%AD"),
    new Map(),
    new Set(),
    new Blob(),
    new FormData(),
    /opaque/,
    Buffer.alloc(0),
    Buffer.from("abc"),
    new Uint8Array(32),
    new ArrayBuffer(BINARY_LENGTH),
    new DataView(new ArrayBuffer(8)),
    cycle,
    objectCycle,
    { /** 前一个共享引用。 */ left: shared, /** 后一个共享引用。 */ right: shared },
    [],
    {},
    [[{}]],
    { /** 深层空字段。 */ empty: { /** 末级空数组。 */ nested: [] } },
    Object.assign(Object.create(null), { /** 无原型字典字段。 */ keep: 1 }),
    Object.assign(Object.create({ /** 继承字段不参与摘要。 */ inherited: 2 }), {
      /** 自身业务字段。 */ own: 1,
    }),
    Symbol.for("differential"),
    marker,
  ];
}

it("12,000 组固定种子请求与改造前逐位一致", /** 覆盖请求选项、特殊值和随机嵌套组合。 */ () => {
  const random = randomSource();
  const leaves = leafPool();
  for (let index = 0; index < CASE_COUNT; index++) {
    const request: AxpRequestConfig = {
      /** 轮流覆盖所有方法，同时保持随机组合。 */
      method: METHODS[index % METHODS.length],
      /** 地址含空值和分隔符。 */
      url: pick(URLS, random),
      /** 部分输入直接取叶子，确保每类特殊值均被执行。 */
      params: index % MAX_WIDTH === 0 ? leaves[index % leaves.length] : generate(random, leaves),
      /** 强制轮转特殊值，兼顾深度递归。 */
      data: index % MAX_WIDTH === 1 ? leaves[index % leaves.length] : generate(random, leaves),
    };
    if (index % 17 === 0) request.key = pick(EXPLICIT_KEYS, random);
    const scope = SCOPES[index % SCOPES.length];
    const options: IKeyOptions = {
      /** 交替启用超长串采样。 */
      sample: index % 2 === 0,
      /** scope 同时覆盖回调和值，回调读取当前请求。 */
      scope:
        index % 3 === 0
          ? /** 缺省地址保留空分区语义。 */ (view) => (view.url ? scope : undefined)
          : (scope ?? undefined),
    };
    if (index % 4 !== 0) {
      options.ignores =
        index % 3 === 0 ? [] : [KEEP_FIELD, "", null, undefined, NaN, false, pick(SCOPES, random)];
    }
    expect(requestKey(request, options), "case=" + index).toBe(
      referenceRequestKey(request, options),
    );
  }
});

it("直接 $key 的缺省 method/url 与零长度字段分帧保持兼容", /** 覆盖 requestKey 包装之外的入口兜底。 */ () => {
  const configs: AxiosRequestConfig[] = [
    {},
    {
      /** 空方法。 */ method: "",
      /** 空地址。 */ url: "",
      /** 空字段名参与长度分帧。 */ params: { "": 1 },
    },
    {
      /** 非空参数触发入口。 */ params: {
        /** 多位十进制长度。 */ long: FRAME_TEXT.repeat(LONG_LENGTH),
      },
    },
    { /** data 独立支持直接入口。 */ data: { /** 空白过滤。 */ value: " " } },
  ];
  for (const config of configs) {
    expect($key(config)).toBe(referenceKey(config));
    expect($key(config, { ignores: [] })).toBe(referenceKey(config, { ignores: [] }));
  }
});

it("豁免失败子树后恢复祖先栈，兄弟共享引用仍可正常计算", /** 防止移除 try/finally 后残留祖先。 */ () => {
  const shared = { /** 可哈希业务值。 */ value: 7 };
  const cycle: unknown[] = [shared];
  cycle.push(cycle);
  const data = {
    /** 忽略含循环引用的字段。 */
    keep: { /** 异常发生前经过共享子树。 */ shared, /** 循环子树。 */ cycle },
    /** 后续兄弟仍访问同一共享子树。 */
    shared,
  };
  const request = {
    /** 使用请求体。 */ method: POST_METHOD,
    /** 基准地址。 */ url: TEST_URL,
    /** 测试子树。 */ data,
  };
  const options = { /** 按字段名豁免不可哈希值。 */ ignores: [KEEP_FIELD] };
  expect(requestKey(request, options)).toBe(referenceRequestKey(request, options));
  expect(requestKey(request, options)).not.toBeNull();
});

it("按值豁免无原型对象仍透传旧实现的转换异常", /** 对比两版相同的程序异常类型。 */ () => {
  const value = Object.create(null);
  const request = { /** 使用请求体。 */ method: POST_METHOD, /** 无原型请求体。 */ data: value };
  const options = { /** 命中值豁免后需执行旧 String 转换。 */ ignores: [value] };
  expect(/** 原实现暴露转换失败。 */ () => referenceRequestKey(request, options)).toThrow(
    TypeError,
  );
  expect(/** 新实现保留同样异常。 */ () => requestKey(request, options)).toThrow(TypeError);
});

it("特殊类型自定义转换沿用旧加号的默认转换语义", /** 前缀拆分仍保留对象转换提示和异常。 */ () => {
  const dateValue = {
    /** 默认转换提示优先得到业务数值。 */
    valueOf: /** 提供旧日期数值。 */ () => 42,
    /** 字符串提示故意返回不同内容。 */
    toString: /** 区分默认与字符串转换。 */ () => "different",
  };
  const values: unknown[] = [
    {
      /** 复现 Date 分支的类型标签。 */
      [Symbol.toStringTag]: "Date",
      /** 自定义返回值用于验证加号转换提示。 */
      getTime: /** 返回带自定义转换的日期值。 */ () => dateValue,
    },
    {
      /** 复现 URLSearchParams 的类型标签。 */
      [Symbol.toStringTag]: "URLSearchParams",
      /** 保留旧实现允许的数值转换。 */
      toString: /** 返回可转换的数值。 */ () => 42,
    },
  ];
  for (const data of values) {
    const request = { /** 使用请求体。 */ method: POST_METHOD, /** 自定义特殊值。 */ data };
    expect(requestKey(request)).toBe(referenceRequestKey(request));
  }
  const unsupported = {
    /** 进入日期转换分支。 */
    [Symbol.toStringTag]: "Date",
    /** Symbol 与字符串相加应继续抛错。 */
    getTime: /** 模拟非法日期转换结果。 */ () => Symbol.for("conversion"),
  };
  const request = {
    /** 使用请求体。 */ method: POST_METHOD,
    /** 转换抛错的特殊值。 */ data: unsupported,
  };
  expect(/** 参照实现保留加号转换异常。 */ () => referenceRequestKey(request)).toThrow(TypeError);
  expect(/** 新实现同样透传转换异常。 */ () => requestKey(request)).toThrow(TypeError);
});
