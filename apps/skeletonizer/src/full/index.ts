/**
 * skeletonizer 完整版入口：core + 完整版扩展（文字模式、pulse / shimmer 方案调度、懒渲染）+ 宿主样式 API。
 * 不带 CSS：样式另引（skeletonizer/core.css、/global.css 等，或用自带样式的 /global、/svg、/all 入口）；
 * 方案运行时由 skeletonizer/global、/svg 注册到 engine 方案表。
 * 导入本入口后，core 的类型自动变宽（text / engine / fallback / sweep），全局 skz 多出 registerCustomElements。
 */
import { registerExtension } from "../core/extension.js";
import { skz, skzGlobal } from "../core/global.js";
import { engineExtension } from "./engine.js";
import { lazyExtension } from "./lazy.js";
import { registerCustomElements } from "./hosts.js";
import { textExtension } from "./text.js";

// 导入 core/index 是为了挂全局 skz（下面往上补完整版的 API）
export * from "../core/index.js";
export { default } from "../core/index.js";
export { registerEngine } from "./engine.js";
export { registerCustomElements } from "./hosts.js";
export type { SkzEngineImpl } from "./engine.js";
export type { RegisterOptions } from "./hosts.js";
export type { SkzTextMode, SkzFallback, SkzEngine } from "./types.js";

// 注册顺序即 enable 里的调用顺序：文字属性 → 方案调度 → 懒渲染
registerExtension(textExtension);
registerExtension(engineExtension);
registerExtension(lazyExtension);

// 默认导出的 skz 对象补上完整版 API；全局上若是另一份拷贝挂的 skz 也补上，被别人占用时不碰
skz.registerCustomElements = registerCustomElements;
const g = skzGlobal();
if (g && g !== skz) g.registerCustomElements = registerCustomElements;
