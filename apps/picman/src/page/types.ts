/**
 * Public option types for the page-side entry.
 *
 * 页面端入口的公共配置类型。
 */

import type { PicmanErrorContext } from "../shared/types";

/**
 * Options for page-side auto takeover.
 *
 * 页面端零改造接管配置。
 */
export interface PicmanAutoOptions {
  /** Scan root, default document — 扫描根节点,默认 document */
  root?: ParentNode;

  /** Take over CSS backgrounds too, default true — 是否接管 CSS 背景,默认 true */
  backgrounds?: boolean;

  /** Error hook — 错误钩子 */
  onError?: (ctx: PicmanErrorContext) => void;
}
