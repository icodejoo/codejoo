/**
 * 动画效果表：键即可用的效果名。core 自带 fade / solid / pulse / shimmer，
 * 想加自定义效果的扩展可以通过 `declare module "skeletonizer/lite"` 往里补一个键。
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
 * 导入完整版（skeletonizer）后自动多出 text / engine / fallback。
 */
export interface EnableOptions {
  /** 动画效果，默认 fade */
  effect?: SkzEffect;
  /** 保证骨架自身绝不撑出滚动条，超出部分自动隐藏。默认关闭 */
  fit?: boolean;
}

/**
 * 文字骨头模式表：键即 `skz-text-mode` 属性可写的取值。lite 只认 round / clip，
 * 导入完整版后自动补上 underline / leaf（见 full/types.ts）。
 */
export interface SkzTextModeMap {
  /** 背景盒 + 圆角画文字条（默认） */
  round: true;
  /** 下划线当形状 + background-clip:text 当填充 */
  clip: true;
}

/**
 * 裸属性（不写值）在模板里的类型：只收 `""` 与 `undefined`。
 * 不收 boolean：React 对未知属性传 `true` 会丢掉属性并警告，传 `false` 在 Vue / Solid 里会渲染成 `="false"`，照样命中 `[skz-bone]`。
 * 条件写法用 `cond ? "" : undefined`。
 */
export type SkzBareAttr = "" | undefined;

/**
 * 使用者会手写的 skz-* 属性（元素标记 + 根属性），给各框架的模板 / JSX 做补全与取值检查。
 * 只有类型，零运行时；各适配层用模块增强把它并入框架的 HTMLAttributes（导入适配层即生效）。
 * 清单的单一数据源是 src/attributes.ts，二者键一致由 test/editor-data.test.ts 保证。
 * @example
 * <div skz skz-effect="pulse"><img skz-bone src={url} /></div>
 */
export interface SkzHtmlAttributes {
  /** 文字元素：整个子树的文字按真实文字行出条，画法跟随根上的 skz-text-mode */
  "skz-text"?: SkzBareAttr;
  /** 本元素整块当一块骨头，后代隐藏（图片、头像、按钮、色块） */
  "skz-bone"?: SkzBareAttr;
  /** 容器：整棵子树合成一块骨头，不处理媒体内容 */
  "skz-leaf"?: SkzBareAttr;
  /** Web Component 宿主（Shadow DOM）：铺一块骨头 */
  "skz-host"?: SkzBareAttr;
  /** 保持原样、可点击、可聚焦的区域 */
  "skz-ignore"?: SkzBareAttr;
  /** 推导区域：区域里按标签白名单推导骨头（根自身也可写） */
  "skz-auto"?: SkzBareAttr;
  /** 根：骨架开启（通常由 enable() / 适配层代写，纯 HTML 才手写） */
  skz?: SkzBareAttr;
  /** 根：动画效果，对应 effect 选项，不写 = fade */
  "skz-effect"?: SkzEffect;
  /** 根：文字骨头画法，对应 text 选项；lite 只认 round / clip，完整版另有 underline / leaf */
  "skz-text-mode"?: keyof SkzTextModeMap;
}

/**
 * 把 SkzHtmlAttributes 里的裸属性换成别的类型，其余属性（枚举取值）不变。
 * Solid / Svelte 的裸写法 `<img skz-bone>` 传的是 `true`，它们的适配层用 `SkzHtmlAttributesFor<SkzBareAttr | true>`。
 * @typeParam B 裸属性的新类型
 */
export type SkzHtmlAttributesFor<B> = {
  [K in keyof SkzHtmlAttributes]: [SkzHtmlAttributes[K]] extends [SkzBareAttr] ? B | undefined : SkzHtmlAttributes[K];
};
