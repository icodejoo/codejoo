import { expect, it, vi } from "vitest";
import { resolveOption } from "../../src/options";
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
  "[options.fn.resolveOption] 省略、布尔与非法类型 %s 沿用插件配置",
  /** 非声明值不改变默认继承。 */ (request) => {
    const plugin: ILoadingOptions = { loading, delay: 20 };
    expect(resolveOption(request, plugin, DEFAULTS)).toEqual({ ...DEFAULTS, ...plugin });
    expect(loading).not.toHaveBeenCalled();
  },
);
it("[options.fn.resolveOption] false 与对象关闭，插件总开关由装配保证", /** 解析器只处理请求级关闭。 */ () => {
  expect(resolveOption(false, {}, DEFAULTS)).toBeNull();
  expect(resolveOption({ enable: false }, {}, DEFAULTS)).toBeNull();
});
it("[options.fn.resolveOption] 简写只覆盖主参数，函数作为值透传", /** 数字和回调简写。 */ () => {
  expect(resolveOption(7, { delayClose: 30 }, DEFAULTS, shorthand)).toEqual({
    delay: 7,
    delayClose: 30,
  });
  expect(resolveOption(loading, {}, DEFAULTS, shorthand)?.loading).toBe(loading);
  expect(resolveOption(null, {}, DEFAULTS, shorthand)).toEqual(DEFAULTS);
});
it("[options.fn.resolveOption] 空字段继承、零值覆盖、数组整体替换且输入不变", /** 字段级优先级。 */ () => {
  const defaults = { enable: true, delay: 0, keys: ["a"], nested: { a: 1 } };
  const plugin = Object.freeze({ delay: 10, keys: ["b"], nested: { a: 2 } });
  const request = Object.freeze({ delay: 0, keys: [], nested: null, enable: undefined });
  expect(resolveOption<typeof defaults, typeof defaults>(request, plugin, defaults)).toEqual({
    enable: true,
    delay: 0,
    keys: [],
    nested: plugin.nested,
  });
  expect(
    resolveOption<ILoadingOptions, typeof DEFAULTS>(
      { delay: null },
      { delay: undefined },
      DEFAULTS,
    ),
  ).toEqual(DEFAULTS);
  expect(resolveOption(Object.create(null), {}, DEFAULTS)).toEqual(DEFAULTS);
  expect(resolveOption(undefined, {}, DEFAULTS)).not.toBe(DEFAULTS);
});

it("[options.fn.resolveOption] 不含 enable 的主参数配置也能自动推断", /** 解析函数不要求业务配置重复声明开关。 */ () => {
  expect(resolveOption({ delay: 0 }, { delay: 20 }, { delay: 1 })).toEqual({ delay: 0 });
});

it("[options.req.callback] 未声明的函数选项不求值，运行时按省略继承", /** 不恢复旧 MaybeFun 行为。 */ () => {
  const callback = vi.fn(/** 旧式动态开关。 */ () => false);
  expect(resolveOption(callback, {}, DEFAULTS)).toEqual(DEFAULTS);
  expect(callback).not.toHaveBeenCalled();
});
