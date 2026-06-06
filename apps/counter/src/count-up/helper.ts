import type {
  ICountupFormatterOptions,
  TCountupFormatter,
  TEasing,
} from "./type";

export const ease = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeOutCubic: (t: number) => --t * t * t + 1,
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeCountup: easeAsymmetricS(0.3),
} satisfies Record<string, TEasing>;

export function easeAsymmetricS(skew: number): TEasing {
  return (t: number) => {
    const s =
      t < skew ? (t / skew) * 0.5 : 0.5 + ((t - skew) / (1 - skew)) * 0.5;
    return s * s * (3 - 2 * s);
  };
}

/**
 * 用调用方传入的 Intl.NumberFormat 生成 formatter（实例应在工厂外创建并复用）。
 * 通过 new Function 把 prefix/suffix 内联为字面量，热路径上只剩 format(value) 与字符串拼接。
 */
export function buildCountupFmt(
  fmt: (value: number) => string,
  options: ICountupFormatterOptions = {},
): TCountupFormatter {
  const prefix = JSON.stringify(options.prefix ?? "");
  const suffix = JSON.stringify(options.suffix ?? "");

  const make = new Function(
    "format",
    `return (value) => ${prefix} + format(value) + ${suffix};`,
  ) as any;

  return make(fmt);
}

export function fps2ms(fps: number): number {
  return 1000 / fps;
}