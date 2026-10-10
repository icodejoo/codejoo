/**
 * 动画效果表：键即可用的效果名。core 自带 fade / solid / pulse / shimmer，
 * 完整版（skeletonizer/full）通过 `declare module "skeletonizer"` 往里补 sweep；
 * 想加自定义效果的扩展也可以照此补一个键。
 */
export interface SkzEffectMap {
  /** 根级淡入淡出（默认） */
  fade: true;
  /** 纯色，不动 */
  solid: true;
  /** 整体颜色脉冲 */
  pulse: true;
  /** 光带扫过 */
  shimmer: true;
}

/** 动画效果：取自 SkzEffectMap 的键 */
export type SkzEffect = keyof SkzEffectMap;

/**
 * enable() 的选项。core 只认 effect / fit；
 * 导入完整版（skeletonizer/full、/global、/svg、/all）后自动多出 text / engine / fallback。
 */
export interface EnableOptions {
  /** 动画效果，默认 fade */
  effect?: SkzEffect;
  /** 保证骨架自身绝不撑出滚动条，超出部分自动隐藏。默认关闭 */
  fit?: boolean;
}
