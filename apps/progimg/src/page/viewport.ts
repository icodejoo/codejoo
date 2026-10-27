/**
 * 页面端视口判定工具,auto 与 video 共用。
 */

/**
 * Whether an element currently intersects the viewport (best-effort; treats a
 * zero-size layout, as in headless test envs, as visible).
 *
 * 元素当前是否与视口相交(尽力而为;把零尺寸布局——如无头测试环境——视为可见)。
 * @param el - Element to test — 待测元素
 * @returns Whether it is in view — 是否在视口内
 */
export function inViewport(el: Element): boolean {
  if (typeof (el as HTMLElement).getBoundingClientRect !== "function" || typeof innerHeight === "undefined") return true;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return true;
  const vertical = r.top < innerHeight && r.bottom > 0;
  // innerWidth 缺失时横向不设限
  const horizontal = typeof innerWidth === "undefined" || (r.left < innerWidth && r.right > 0);
  return vertical && horizontal;
}
