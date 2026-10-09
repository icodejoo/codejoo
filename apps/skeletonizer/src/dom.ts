/** 根在视口外时打上的属性（懒渲染）：CSS 据此停掉动画 */
export const PAUSED_ATTR = "skz-paused";

/**
 * 删掉空的 style 属性：内联变量被移除后浏览器会留下 style=""，这里清掉，不在用户元素上留痕迹。
 * @param el 目标元素
 * @example dropEmptyStyle(root);
 */
export function dropEmptyStyle(el: HTMLElement): void {
  if (el.getAttribute("style") === "") el.removeAttribute("style");
}

/**
 * 把 CSS 时长（如 "1.5s"、"750ms"）换算成毫秒，解析不了时返回默认值。
 * @param raw CSS 时长文本
 * @param fallback 默认值（毫秒）
 * @returns 毫秒
 * @example toMs("1.5s", 1500); // 1500
 */
export function toMs(raw: string, fallback: number): number {
  const text = raw.trim();
  const n = parseFloat(text);
  if (!(n > 0)) return fallback;
  return text.endsWith("ms") ? n : n * 1000;
}
