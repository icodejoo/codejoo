/**
 * skeletonizer 完整版模块：core + 完整版扩展（文字模式、pulse / shimmer 方案调度、懒渲染）。
 * 不含 CSS 导入与方案运行时：发布入口 entries/full.ts 在它之上补 global / svg 变体，并由构建加上 full.css；
 * 方案运行时由 full/variants 注册到 engine 方案表。
 * 导入完整版后，lite 的类型自动变宽（text / engine / fallback）。
 */
import { registerExtension } from "../core/extension.js";
import { engineExtension } from "./engine.js";
import { lazyExtension } from "./lazy.js";
import { shimmerModeExtension } from "./shimmer-mode.js";
import { textExtension } from "./text.js";

// 导入 core/index 会把 skz 挂到全局
export * from "../core/index.js";
export { default } from "../core/index.js";
export { registerEngine } from "./engine.js";
export type { SkzEngineImpl } from "./engine.js";
export type { SkzTextMode, SkzShimmerMode, SkzFallback, SkzEngine } from "./types.js";

// 注册顺序即 enable 里的调用顺序：文字 / 光带模式属性 → 方案调度 → 懒渲染
registerExtension(textExtension);
registerExtension(shimmerModeExtension);
registerExtension(engineExtension);
registerExtension(lazyExtension);
