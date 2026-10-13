import type { registerCustomElements } from "./hosts.js";

/**
 * 文字骨头模式：不传 = "round"（默认；纯 CSS 里根上不写 skz-text-mode 也是 round）。
 * - "round"：用背景盒 + 圆角画文字条：行内元素折行后每行一条、各自圆角，块元素（p / h3 / div / flex 子项）按自身 display 整块圆角矩形；
 *   文字条里有 shimmer 光带，GPU 约为 clip 的一半；浏览器不支持 box-decoration-break（含 -webkit- 前缀）时自动退回 clip；
 * - "clip"：下划线当形状 + background-clip:text 当填充，文字条里也有 shimmer 光带，形状沿真实文字行；
 * - "underline"：纯下划线，颜色脉冲，最便宜；
 * - "leaf"：叶子元素整块当背景骨头（有圆角、能放光带）；
 */
export type SkzTextMode = "round" | "clip" | "underline" | "leaf";

/** 降级目标：浏览器不支持 @property、global 方案的 pulse / shimmer 跑不起来时改用的效果：svg（默认，JS 挂 blob SVG 动画）/ fade（根级淡入淡出） */
export type SkzFallback = "svg" | "fade";

/** pulse / shimmer 的实现：global（根驱动）或 svg（骨头共用一张 SVG 动画背景图）；与入口 skeletonizer/global、skeletonizer/svg 对应 */
export type SkzEngine = "global" | "svg";

/**
 * 完整版对 core 类型的扩展：导入 skeletonizer/full（或 /global、/svg、/all）后，
 * enable() 等处的选项自动多出 text / engine / fallback，effect 多出 sweep，全局 skz 多出 registerCustomElements。
 * 注意：目标模块名 "skeletonizer" 是包的根入口（core），产物里它再导出 core 的类型，增强能合并过去。
 */
declare module "skeletonizer" {
  interface SkzEffectMap {
    /** 扫光效果（需引入 skeletonizer/sweep.css） */
    sweep: true;
  }
  interface EnableOptions {
    /** 文字骨头模式，不传 = round，各模式见 SkzTextMode */
    text?: SkzTextMode;
    /** global 方案在不支持 @property 的浏览器里退回的效果，默认 svg（由 JS 挂 blob SVG，需加载 skeletonizer/global）；JS 执行前一律是 fade */
    fallback?: SkzFallback;
    /**
     * pulse / shimmer 的实现。不传时：加载了 skeletonizer/global 就用 global，只加载了 skeletonizer/svg 就用 svg；
     * 两者都加载（如 skeletonizer/all）时默认 global。
     */
    engine?: SkzEngine;
  }
  interface SkzGlobal {
    /** 扫描自定义元素并生成宿主骨架样式，见 registerCustomElements */
    registerCustomElements: typeof registerCustomElements;
  }
}
