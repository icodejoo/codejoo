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
  expect(patternToRegex("/a.+?^${}()|[]\\/:id").test("/a.+?^${}()|[]\\/x")).toBe(true);
});

it("[auth.fn.patternToRegex] 命名参数仅一段，星号任意深度，锚定且允许可选尾斜杠", () => {
  const named = patternToRegex(NAMED);
  expect(named.test(USER)).toBe(true);
  expect(named.test(`${USER}/`)).toBe(true);
  expect(named.test("/user/")).toBe(false);
  expect(named.test(`${USER}/2`)).toBe(false);
  expect(named.test(`/prefix${USER}`)).toBe(false);
  expect(patternToRegex(USER_PATTERN).test(DEEP_USER)).toBe(true);
  expect(patternToRegex("/:a/:$b/:_c").test("/a/b/c")).toBe(true);
});

it("[auth.fn.patternToRegex] 一次替换完成：字面量里恰好长得像占位符的文本原样保留，不会被误当成通配或参数", () => {
  const regex = patternToRegex("/ NAMED / STAR /:id/*");
  expect(regex.test("/ NAMED / STAR /1/x/y")).toBe(true);
  expect(regex.test("/ NAMED / STAR /")).toBe(false);
});

/** 构造器可用时才有意义的原生对照；运行时没有 URLPattern 时跳过。 */
const HAS_NATIVE = typeof URLPattern === "function";
/** 字面量与前缀通配的快路径对照模式。 */
const FAST_PATTERNS = ["/me", "/me/", "/api/*", "/api*", "/a-b_c/*", "*", "/a b", "/a%20b", "/café", "/v1.0/x", "/v1.0/*", "/"];
/** 稳定、含点段、转义、空格、非 ASCII、尾斜杠与大小写差异的路径。 */
const FAST_URLS = [
  "/me",
  "/me/",
  "/mex",
  "/api",
  "/api/",
  "/apix",
  "/api/a/b",
  "/api/../admin",
  "/api/./x",
  "/admin/../api/x",
  "/me/../me",
  "/a b",
  "/a%20b",
  "/a%2Fb",
  "/café",
  "/caf%C3%A9",
  "/v1.0/x",
  "/v1X0/x",
  "/ME",
  "/",
  "",
  "/a-b_c/d",
];

it.skipIf(!HAS_NATIVE)("[auth.fn.compileUrlPatterns] 字面量与前缀通配的字符串快路径与原生 URLPattern 逐一等价，含点段、转义、非 ASCII 等需规范化的输入", () => {
  for (const pattern of FAST_PATTERNS) {
    const native = new URLPattern({ pathname: pattern });
    const match = compileUrlPatterns([pattern, "!/never-match-anything"]);
    for (const url of FAST_URLS) expect(match(url), `${pattern} <= ${JSON.stringify(url)}`).toBe(native.test({ pathname: url }));
  }
});

it("[auth.fn.compileUrlPatterns] 稳定路径走字符串比较不触碰原生匹配，含点段或转义的输入才交给原生判定", () => {
  const test = vi.fn((_options: { pathname: string }) => false);
  /** 记录 test 调用的原生替身。 */
  class NativePattern {
    /** 代理匹配调用。 */
    test(options: { pathname: string }): boolean {
      return test(options);
    }
  }
  vi.stubGlobal(URL_PATTERN, NativePattern);
  const exact = compileUrlPatterns(ME_PATH);
  const prefix = compileUrlPatterns(USER_PATTERN);
  expect(exact(ME_PATH)).toBe(true);
  expect(exact(`${ME_PATH}/`)).toBe(false);
  expect(prefix("/user/")).toBe(true);
  expect(prefix("/user")).toBe(false);
  expect(prefix(DEEP_USER)).toBe(true);
  expect(test).not.toHaveBeenCalled();
  expect(exact("/x/../me")).toBe(false);
  expect(prefix("/user/../x")).toBe(false);
  expect(test).toHaveBeenCalledTimes(2);
});

it("[auth.fn.compileUrlPatterns] 含参数、正则元字符或点号的模式不走字符串快路径，统一交给原生或正则回退", () => {
  vi.stubGlobal(URL_PATTERN, undefined);
  expect(compileUrlPatterns("/v1.0/*")("/v1.0/x")).toBe(true);
  expect(compileUrlPatterns("/v1.0/*")("/v1X0/x")).toBe(false);
  expect(compileUrlPatterns("/a/:id")("/a/1")).toBe(true);
  expect(compileUrlPatterns("/a/:id")("/a/1/2")).toBe(false);
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

it("[auth.fn.compileUrlPatterns] 没有原生 URLPattern 时，字面量与前缀通配的快路径与正则回退逐一等价（含尾斜杠容忍）", () => {
  vi.stubGlobal(URL_PATTERN, undefined);
  for (const pattern of FAST_PATTERNS) {
    const reference = patternToRegex(pattern);
    const match = compileUrlPatterns([pattern, "!/never-match-anything"]);
    for (const url of FAST_URLS) expect(match(url), `${pattern} <= ${JSON.stringify(url)}`).toBe(reference.test(url));
  }
  // 字面量容忍一个尾斜杠，前缀通配本身就能吞掉它
  expect(compileUrlPatterns(ME_PATH)(`${ME_PATH}/`)).toBe(true);
  expect(compileUrlPatterns(ME_PATH)(`${ME_PATH}//`)).toBe(false);
  expect(compileUrlPatterns(USER_PATTERN)("/user")).toBe(false);
});
