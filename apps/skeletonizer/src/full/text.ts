import { syncAttr } from "../core/dom.js";
import type { SkzExtension } from "../core/extension.js";

/** 根上记录文字模式的属性名 */
const TEXT_ATTR = "skz-text";

/**
 * 文字模式扩展：按 enable 的 text 选项写 skz-text 属性，没传就清掉（保证重复调用时不残留上一次的值）。
 * 由完整版入口自动注册。
 */
export const textExtension: SkzExtension = {
  name: "text",
  sync(el, opts) {
    syncAttr(el, TEXT_ATTR, opts.text);
  },
  release(el) {
    el.removeAttribute(TEXT_ATTR);
  },
};
