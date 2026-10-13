/**
 * 私有全局键：core 总会把 API（skz）挂在 `globalThis[SKZ_API_KEY]` 上，框架适配层（vue / react / svelte）从这里取 enable / disable。
 * 不依赖公开的 `skz` 变量，所以 `skz` 被别人占用时适配层照常可用。
 * 本文件刻意零依赖：适配层引用它不会带进 core 代码。
 */
export const SKZ_API_KEY = Symbol.for("skeletonizer");
