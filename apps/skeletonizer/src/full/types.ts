/**
 * 文字骨头模式：不传 = "round"（默认；纯 CSS 里根上不写 skz-text-mode 也是 round）。
 * - "round"：用背景盒 + 圆角画文字条：行内元素折行后每行一条、各自圆角，块元素（p / h3 / div / flex 子项）按自身 display 整块圆角矩形；
 *   文字条里有 shimmer 光带，GPU 约为 clip 的一半；浏览器不支持 box-decoration-break（含 -webkit- 前缀）时自动退回 clip；
 * - "clip"：下划线当形状 + background-clip:text 当填充，文字条里也有 shimmer 光带，形状沿真实文字行；
 * - "underline"：纯下划线，颜色脉冲，最便宜；
 * - "leaf"：叶子元素整块当背景骨头（有圆角、能放光带）；
 */
export type SkzTextMode = "round" | "clip" | "underline" | "leaf";

/**
 * shimmer 光带模式：不传 = "even"（默认；纯 CSS 里根上不写 skz-shimmer-mode 也是 even，未知取值同样按 even）。
 * - "even"：各骨头同速，一轮行程 = max(骨头宽, 100cqw) + 光带宽（不认 cqw 的浏览器用 100vw），时长按屏宽三档（< 640px 2s、≥ 640px 2.8s、≥ 1280px 3.6s）；
 * - "fit"：每个骨头在自己的盒子里扫、同时走完（宽骨头走得快），固定 2s 不分档。
 * 只影响 CSS 根驱动（global 引擎）；svg 引擎只能按比例，行为相当于 fit。
 */
export type SkzShimmerMode = "even" | "fit";

/** 降级目标：浏览器不支持 @property、global 方案的 pulse / shimmer 跑不起来时改用的效果：svg（默认，JS 挂 blob SVG 动画）/ fade（根级淡入淡出） */
export type SkzFallback = "svg" | "fade";

/** pulse / shimmer 的实现：global（根驱动）或 svg（骨头共用一张 SVG 动画背景图）；对应 full/variants 下的两个方案 */
export type SkzEngine = "global" | "svg";

/**
 * 完整版对 core 类型的扩展：导入 skeletonizer（完整版）后，
 * enable() 等处的选项自动多出 text / shimmerMode / engine / fallback。
 * 注意：目标模块名 "skeletonizer/lite" 是类型底座，完整版 d.mts 从它再导出，增强能合并过去。
 */
declare module "skeletonizer/lite" {
  interface EnableOptions {
    /** 文字骨头模式，不传 = round，各模式见 SkzTextMode */
    text?: SkzTextMode;
    /** shimmer 光带模式，不传 = even，各模式见 SkzShimmerMode */
    shimmerMode?: SkzShimmerMode;
    /** global 方案在不支持 @property 的浏览器里退回的效果，默认 svg（由 JS 挂 blob SVG）；JS 执行前一律是 fade */
    fallback?: SkzFallback;
    /**
     * pulse / shimmer 的实现。不传时：两种方案都注册（完整版）默认 global；只注册了 svg 的拼装场景用 svg。
     */
    engine?: SkzEngine;
  }
}

/**
 * 完整版对 skz-* 属性类型的扩展：补上 skz-text-mode 的 underline / leaf 取值，
 * 以及只有完整版才有的 skz-shimmer-mode / skz-cv。
 */
declare module "skeletonizer/lite" {
  interface SkzTextModeMap {
    /** 纯下划线，颜色脉冲，最便宜 */
    underline: true;
    /** 叶子元素整块当背景骨头 */
    leaf: true;
  }
  interface SkzHtmlAttributes {
    /** 根：shimmer 光带模式，对应 shimmerMode 选项，不写 = even */
    "skz-shimmer-mode"?: SkzShimmerMode;
    /** 根：给直接子元素加 content-visibility: auto（懒渲染） */
    "skz-cv"?: "" | undefined;
  }
}
