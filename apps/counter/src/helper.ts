/** 解析 CSS 选择器或 Element 引用为 DOM 元素 */
export function $(el: string | Element): Element {
  if (el instanceof Element) return el;
  el = document.querySelector(el) as Element;
  if (!el) throw new Error("[GT]: Invalid element value [" + el + "]");
  return el;
}
