import { syncAttr } from "../core/dom.js";
import type { SkzExtension } from "../core/extension.js";

/** 根上记录光带模式的属性名 */
const SHIMMER_MODE_ATTR = "skz-shimmer-mode";

/**
 * 光带模式扩展：按 enable 的 shimmerMode 选项写 skz-shimmer-mode 属性，没传就清掉（保证重复调用时不残留上一次的值）。
 * 由完整版入口自动注册。
 */
export const shimmerModeExtension: SkzExtension = {
  name: "shimmerMode",
  sync(el, opts) {
    syncAttr(el, SHIMMER_MODE_ATTR, opts.shimmerMode);
  },
  release(el) {
    el.removeAttribute(SHIMMER_MODE_ATTR);
  },
};
