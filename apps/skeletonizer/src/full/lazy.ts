import type { SkzExtension } from "../core/extension.js";
import { viewportMarker } from "./viewport.js";

/** 根在视口外时打上的属性（懒渲染）：CSS 据此停掉动画 */
export const PAUSED_ATTR = "skz-paused";

/** 视口外预留的缓冲距离：快滚进来之前就恢复动画 */
const VIEWPORT_MARGIN = "100px";

/** 全库共用的视口观察器：根离开视口就暂停动画，回来再恢复 */
const viewport = viewportMarker(PAUSED_ATTR, VIEWPORT_MARGIN);

/**
 * 懒渲染扩展：根滚出视口时打 skz-paused 暂停动画，回到视口附近再恢复；关闭时取消观察并清掉标记。
 * 重复 observe 同一个根是无害的（观察器会忽略）。由完整版入口自动注册。
 */
export const lazyExtension: SkzExtension = {
  name: "lazy",
  sync(el) {
    viewport.get()?.observe(el);
  },
  release(el) {
    viewport.unobserve(el);
    el.removeAttribute(PAUSED_ATTR);
  },
};
