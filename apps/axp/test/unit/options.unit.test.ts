import { expect, it, vi } from "vitest";
import { resolveOption, resolveRequestOption } from "../../src/options";
import type { ILoadingOptions, TLoadingFunc } from "../../src/plugins/loading";

/** 默认解析配置。 */
const DEFAULTS: ILoadingOptions = { delay: 0, delayClose: 0 };
/** 不产生副作用的显示回调。 */
const loading = vi.fn<TLoadingFunc>();
/** 只识别本模块的数字和函数简写。 */
function shorthand(value: unknown): Partial<ILoadingOptions> | undefined {
  if (typeof value === "number") return { delay: value };
  if (typeof value === "function") return { loading: value as TLoadingFunc };
  return undefined;
}
it.each([undefined, null, true, {}, 0, "", "unknown", [], new Date(), Symbol("invalid")])(
  "[core.fn.resolveOption] 省略、布尔与非法类型 %s 沿用插件配置",
  /** 非声明值不改变默认继承。 */ (request) => {
    const plugin: ILoadingOptions = { loading, delay: 20 };
    expect(resolveOption(request, plugin, DEFAULTS)).toEqual({ ...DEFAULTS, ...plugin });
    expect(loading).not.toHaveBeenCalled();
  },
);
it("[core.fn.resolveOption] false 与对象关闭，插件总开关由装配保证", /** 解析器只处理请求级关闭。 */ () => {
  expect(resolveOption(false, {}, DEFAULTS)).toBeNull();
  expect(resolveOption({ enable: false }, {}, DEFAULTS)).toBeNull();
});
it("[core.fn.resolveOption] 简写只覆盖主参数，函数作为值透传", /** 数字和回调简写。 */ () => {
  expect(resolveOption(7, { delayClose: 30 }, DEFAULTS, shorthand)).toEqual({
    delay: 7,
    delayClose: 30,
  });
  expect(resolveOption(loading, {}, DEFAULTS, shorthand)?.loading).toBe(loading);
  expect(resolveOption(null, {}, DEFAULTS, shorthand)).toEqual(DEFAULTS);
});
it("[core.fn.resolveOption] 空字段继承、零值覆盖、数组整体替换且输入不变", /** 字段级优先级。 */ () => {
  const defaults = { enable: true, delay: 0, keys: ["a"], nested: { a: 1 } };
  const plugin = Object.freeze({ delay: 10, keys: ["b"], nested: { a: 2 } });
  const request = Object.freeze({ delay: 0, keys: [], nested: null, enable: undefined });
  expect(resolveOption<typeof defaults, typeof defaults>(request, plugin, defaults)).toEqual({
    enable: true,
    delay: 0,
    keys: [],
    nested: plugin.nested,
  });
  expect(resolveOption<ILoadingOptions, typeof DEFAULTS>({ delay: null }, { delay: undefined }, DEFAULTS)).toEqual(DEFAULTS);
  expect(resolveOption(Object.create(null), {}, DEFAULTS)).toEqual(DEFAULTS);
  expect(resolveOption(undefined, {}, DEFAULTS)).not.toBe(DEFAULTS);
});

it("[core.fn.resolveOption] 不含 enable 的主参数配置也能自动推断", /** 解析函数不要求业务配置重复声明开关。 */ () => {
  expect(resolveOption({ delay: 0 }, { delay: 20 }, { delay: 1 })).toEqual({ delay: 0 });
});

it("[options.req.callback] 未声明的函数选项不求值，运行时按省略继承", /** 不恢复旧 MaybeFun 行为。 */ () => {
  const callback = vi.fn(/** 旧式动态开关。 */ () => false);
  expect(resolveOption(callback, {}, DEFAULTS)).toEqual(DEFAULTS);
  expect(callback).not.toHaveBeenCalled();
});

/** 只认正数的简写：其余类型一律不认。 */
function unrecognized(input: unknown) {
  return typeof input === "number" && input > 0 ? { delay: input } : undefined;
}
/** 请求级入口测试使用的精确默认值，与插件装配时一致。 */
const REQUEST_DEFAULTS = { delay: 0, delayClose: 0 };
/** 装配期已解析好的插件级配置，请求级沿用时必须原样返回这个对象。 */
const BASE = Object.freeze(resolveOption<ILoadingOptions, typeof REQUEST_DEFAULTS>(undefined, { loading, delay: 20 }, REQUEST_DEFAULTS));

it("[options.fn.resolveRequestOption] false 关闭；true 沿用插件配置并原样返回 base，与是否需请求开启无关", () => {
  for (const optIn of [false, true]) {
    expect(resolveRequestOption(false, BASE, REQUEST_DEFAULTS, shorthand, optIn)).toBeNull();
    expect(resolveRequestOption(true, BASE, REQUEST_DEFAULTS, shorthand, optIn)).toBe(BASE);
  }
});

it.each([undefined, null, 0, "", "unknown", [], new Date(), Symbol("invalid")])(
  "[options.fn.resolveRequestOption] 省略或不认得的类型 %s：不要求请求开启时沿用 base，要求开启时为 null",
  /** 非声明值既不关闭也不改写配置。 */ (value) => {
    expect(resolveRequestOption(value, BASE, REQUEST_DEFAULTS, unrecognized)).toBe(BASE);
    expect(resolveRequestOption(value, BASE, REQUEST_DEFAULTS, unrecognized, true)).toBeNull();
    expect(resolveRequestOption(value, BASE, REQUEST_DEFAULTS)).toBe(BASE);
    expect(resolveRequestOption(value, BASE, REQUEST_DEFAULTS, undefined, true)).toBeNull();
  },
);

it("[options.fn.resolveRequestOption] 对象与认得的简写逐字段覆盖，返回新对象；enable:false 关闭；空字段继承", () => {
  const empty = resolveRequestOption({}, BASE, REQUEST_DEFAULTS, shorthand, true);
  expect(empty).toEqual(BASE);
  expect(empty).not.toBe(BASE);
  expect(resolveRequestOption({ delay: 5, delayClose: null }, BASE, REQUEST_DEFAULTS)).toEqual({ ...BASE, delay: 5 });
  expect(resolveRequestOption(7, BASE, REQUEST_DEFAULTS, shorthand, true)).toEqual({ ...BASE, delay: 7 });
  const replacement = vi.fn<TLoadingFunc>();
  expect(resolveRequestOption(replacement, BASE, REQUEST_DEFAULTS, shorthand)?.loading).toBe(replacement);
  expect(resolveRequestOption({ enable: false }, BASE, REQUEST_DEFAULTS, shorthand, true)).toBeNull();
  expect(resolveRequestOption({ enable: false, delay: 5 }, BASE, REQUEST_DEFAULTS)).toBeNull();
});

it("[options.fn.resolveRequestOption] 简写认得时视为开启，即使要求请求开启；输入与 base 都不被修改", () => {
  const before = { ...BASE };
  expect(resolveRequestOption(0, BASE, REQUEST_DEFAULTS, (input) => (typeof input === "number" ? { delay: input } : undefined), true)).toEqual({ ...BASE, delay: 0 });
  expect(BASE).toEqual(before);
});
