import { afterEach, expect, it, vi } from "vitest";
import { compileMethods, compileUrlPatterns, pathnameOf, patternToRegex } from "../../src/plugins/auth-match";

/** 小写读取动词。 */
const GET_METHOD = "get";
/** 小写提交动词。 */
const POST_METHOD = "post";
/** 大写方法配置。 */
const POST_CONFIG = "POST";
/** 多层用户通配模式。 */
const USER_PATTERN = "/user/*";
/** 多层用户路径。 */
const DEEP_USER = "/user/1/2";
/** 当前用户路径。 */
const ME_PATH = "/me";
/** 根路径。 */
const ROOT_PATH = "/";
/** 空匹配输入。 */
const EMPTY_INPUT = "";
/** 通配模式。 */
const WILDCARD = "*";
/** 样例用户路径。 */
const USER = "/user/1";
/** 样例公开路径。 */
const PUBLIC = "/public";
/** 原生构造器全局名。 */
const URL_PATTERN = "URLPattern";
/** 命名参数模式。 */
const NAMED = "/user/:id";
/** 模拟原生不支持该模式。 */
function UnsupportedPattern() {
  throw new Error("unsupported");
}

afterEach(() => vi.unstubAllGlobals());

it.each([{ methods: undefined }, { methods: EMPTY_INPUT }, { methods: [] }])("[auth.fn.compileMethods] 空配置 $methods 恒假", ({ methods }) => {
  expect(compileMethods(methods)(GET_METHOD)).toBe(false);
});

it.each([{ methods: WILDCARD }, { methods: [WILDCARD] }, { methods: [POST_METHOD, WILDCARD] }])("[auth.fn.compileMethods] 通配配置 $methods 恒真", ({ methods }) => {
  expect(compileMethods(methods)(GET_METHOD)).toBe(true);
});

it("[auth.fn.compileMethods] 字符串转小写、数组任一命中，输入依照旧契约须小写", () => {
  const single = compileMethods(POST_CONFIG);
  const multiple = compileMethods(["GET", POST_CONFIG]);
  expect(single(POST_METHOD)).toBe(true);
  expect(single(GET_METHOD)).toBe(false);
  expect(single(POST_CONFIG)).toBe(false);
  expect(multiple(GET_METHOD)).toBe(true);
  expect(multiple(POST_METHOD)).toBe(true);
  expect(multiple("put")).toBe(false);
});

it.each([{ patterns: undefined }, { patterns: [] }, { patterns: EMPTY_INPUT }, { patterns: [EMPTY_INPUT] }, { patterns: [false] as unknown as string[] }])(
  "[auth.fn.compileUrlPatterns] 空或非法模式 $patterns 恒假",
  ({ patterns }) => {
    vi.stubGlobal(URL_PATTERN, undefined);
    expect(compileUrlPatterns(patterns)(USER)).toBe(false);
  },
);

it.each([{ patterns: WILDCARD }, { patterns: [WILDCARD] }])("[auth.fn.compileUrlPatterns] 单一通配 $patterns 恒真", ({ patterns }) => {
  expect(compileUrlPatterns(patterns)(USER)).toBe(true);
});

it("[auth.fn.compileUrlPatterns] 无原生 URLPattern 时使用正则，多个包含模式任一匹配", () => {
  vi.stubGlobal(URL_PATTERN, undefined);
  const single = compileUrlPatterns(NAMED);
  expect(single(USER)).toBe(true);
  expect(single(DEEP_USER)).toBe(false);
  const multiple = compileUrlPatterns([NAMED, PUBLIC]);
  expect(multiple(PUBLIC)).toBe(true);
  expect(multiple(USER)).toBe(true);
  expect(multiple("/other")).toBe(false);
});

it("[auth.fn.compileUrlPatterns] 否定优先，只有否定模式时放行其他路径", () => {
  vi.stubGlobal(URL_PATTERN, null);
  const mixed = compileUrlPatterns([USER_PATTERN, `!${USER}`]);
  expect(mixed(USER)).toBe(false);
  expect(mixed("/user/2")).toBe(true);
  expect(mixed(PUBLIC)).toBe(false);
  const excludes = compileUrlPatterns([`!${PUBLIC}`, EMPTY_INPUT]);
  expect(excludes(USER)).toBe(true);
  expect(excludes(PUBLIC)).toBe(false);
  expect(compileUrlPatterns([WILDCARD, `!${PUBLIC}`])(PUBLIC)).toBe(false);
});

it("[auth.fn.compileUrlPatterns] 优先原生 URLPattern 并只传 pathname，test 抛错返回 false", () => {
  const test = vi
    .fn()
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(false)
    .mockImplementationOnce(() => {
      throw new Error("test");
    });
  const constructor = vi.fn();
  /** 原生能力替身，通过 spy 验证调用协议。 */
  class NativePattern {
    /** 记录原生构造参数。 */
    constructor(options: { pathname: string }) {
      constructor(options);
    }
    /** 代理原生匹配行为。 */
    test(options: { pathname: string }): boolean {
      return test(options) as boolean;
    }
  }
  vi.stubGlobal(URL_PATTERN, NativePattern);
  const match = compileUrlPatterns(NAMED);
  expect(constructor).toHaveBeenCalledExactlyOnceWith({ pathname: NAMED });
  expect(match(USER)).toBe(true);
  expect(match(PUBLIC)).toBe(false);
  expect(match(USER)).toBe(false);
  expect(test).toHaveBeenNthCalledWith(1, { pathname: USER });
});

it("[auth.fn.compileUrlPatterns][auth.fn.patternToRegex] 原生构造失败回退正则，转义标点与命名参数", () => {
  vi.stubGlobal(URL_PATTERN, UnsupportedPattern);
  const match = compileUrlPatterns("/v1.0/:id");
  expect(match("/v1.0/2")).toBe(true);
  expect(match("/v1X0/2")).toBe(false);
  expect(patternToRegex("/a.+?^${}()|[]\\/:id")?.test("/a.+?^${}()|[]\\/x")).toBe(true);
});

it("[auth.fn.patternToRegex] 命名参数仅一段，星号任意深度，锚定且允许可选尾斜杠", () => {
  const named = patternToRegex(NAMED)!;
  expect(named.test(USER)).toBe(true);
  expect(named.test(`${USER}/`)).toBe(true);
  expect(named.test("/user/")).toBe(false);
  expect(named.test(`${USER}/2`)).toBe(false);
  expect(named.test(`/prefix${USER}`)).toBe(false);
  expect(patternToRegex(USER_PATTERN)?.test(DEEP_USER)).toBe(true);
  expect(patternToRegex("/:a/:$b/:_c")?.test("/a/b/c")).toBe(true);
});

it("[auth.fn.patternToRegex][auth.fn.compileUrlPatterns] 防御性非法输入使正则编译失败并忽略该模式", () => {
  expect(patternToRegex(null as unknown as string)).toBeNull();
  vi.stubGlobal(URL_PATTERN, undefined);
  const replace = vi.spyOn(String.prototype, "replace").mockImplementationOnce(() => {
    throw new Error("replace");
  });
  try {
    expect(compileUrlPatterns(NAMED)(USER)).toBe(false);
  } finally {
    replace.mockRestore();
  }
});

it.each([
  [ME_PATH, ME_PATH],
  ["/me?q=1#hash", ME_PATH],
  ["https://host:8080/me?q=1", ME_PATH],
  ["//host/me#hash", ME_PATH],
  ["CUSTOM+v1://host/me", ME_PATH],
  [EMPTY_INPUT, ROOT_PATH],
  ["?q=1", ROOT_PATH],
  ["#hash", ROOT_PATH],
  ["https://host", ROOT_PATH],
  ["//host?q=1", ROOT_PATH],
])("[auth.fn.pathnameOf] %s 提取为 %s", (url, expected) => {
  expect(pathnameOf(url)).toBe(expected);
});

it("[auth.fn.pathnameOf][auth.fn.compileUrlPatterns] pathname 匹配绝对与带查询 URL", () => {
  vi.stubGlobal(URL_PATTERN, undefined);
  const match = compileUrlPatterns(ME_PATH);
  expect(match(pathnameOf("https://host/me?q=1"))).toBe(true);
  expect(match(pathnameOf("/me#hash"))).toBe(true);
  expect(match(pathnameOf("/other?q=/me"))).toBe(false);
});
