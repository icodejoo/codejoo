/**
 * skeletonizer（完整版）的类型入口：只给 d.mts 构建用，运行时代码见 full.ts。
 * 类型底座全部来自 skeletonizer/lite（不另生成一份），本文件只补完整版独有的导出，
 * 并通过 `declare module "skeletonizer/lite"`（见 full/types.ts）把 lite 的选项类型变宽。
 */
export * from "skeletonizer/lite";
export { default } from "skeletonizer/lite";
export { registerEngine } from "../full/engine.js";
export type { SkzEngineImpl } from "../full/engine.js";
export type { SkzTextMode, SkzShimmerMode, SkzFallback, SkzEngine } from "../full/types.js";
