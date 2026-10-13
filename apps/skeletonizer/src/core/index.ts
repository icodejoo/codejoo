/**
 * skeletonizer 核心入口模块：导出 core 全部 API，并在执行时把 `skz` 挂到全局。
 * 只有 lite 入口和完整版入口（full）会引用本文件；
 * 框架适配层（vue / react / svelte）不引用 core 代码，只通过私有全局键 SKZ_API_KEY 取 API。
 */
import { mountGlobal } from "./global.js";

export { Bone } from "./bone.js";
export { enable, disable, ROOT_ATTR } from "./enable.js";
export { registerExtension } from "./extension.js";
export type { SkzExtension } from "./extension.js";
export type { SkzGlobal } from "./global.js";
export { skz as default } from "./global.js";
export type { SkzEffect, SkzEffectMap, EnableOptions, SkzTextModeMap, SkzBareAttr, SkzHtmlAttributes, SkzHtmlAttributesFor } from "./types.js";

mountGlobal();
