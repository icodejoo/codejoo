import { syncAttr } from "../core/dom.js";
import type { SkzExtension } from "../core/extension.js";

/** 根上记录文字模式的属性名（注意不是元素级标记 skz-text：那是开发者写在 HTML 里的裸属性，JS 不碰） */
const TEXT_ATTR = "skz-text-mode";

/**
 * 文字模式扩展：按 enable 的 text 选项写 skz-text-mode 属性，没传就清掉（保证重复调用时不残留上一次的值）。
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
