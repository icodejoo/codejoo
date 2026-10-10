/**
 * skeletonizer 核心入口模块：导出 core 全部 API，并在执行时把 `skz` 挂到全局。
 * 只有 skeletonizer / skeletonizer/explicit / skeletonizer/full 这几个入口会引用本文件；
 * 框架适配层（vue / react / svelte）直接引用 core 下的具体模块，不经过这里，所以不会带上全局挂载。
 */
import { mountGlobal } from "./global.js";

export { Bone } from "./bone.js";
export { enable, disable, ROOT_ATTR } from "./enable.js";
export { SkzBox, defineSkzBox } from "./element.js";
export { registerExtension } from "./extension.js";
export type { SkzExtension } from "./extension.js";
export type { SkzGlobal } from "./global.js";
export { skz as default } from "./global.js";
export type { SkzEffect, SkzEffectMap, EnableOptions } from "./types.js";

mountGlobal();
