/** 忽略区的属性选择器：里面的内容保持可交互（包内共用，不从入口导出） */
export const IGNORE_SEL = "[skz-ignore]";

/** 至少有这么多个列表项才算列表（项太少时防火墙 / fit 都省不下多少） */
const MIN_ITEMS = 2;

/**
 * 删掉空的 style 属性：内联变量被移除后浏览器会留下 style=""，这里清掉，不在用户元素上留痕迹。
 * @param el 目标元素
 * @example dropEmptyStyle(root);
 */
export function dropEmptyStyle(el: HTMLElement): void {
  if (el.getAttribute("style") === "") el.removeAttribute("style");
}

/**
 * 有值就写属性，没值就删掉，保证根上不残留上一次的选项。
 * @param el 目标元素
 * @param name 属性名
 * @param value 属性值
 * @example syncAttr(root, "skz-effect", opts.effect);
 */
export function syncAttr(el: HTMLElement, name: string, value: string | undefined): void {
  if (value) el.setAttribute(name, value);
  else el.removeAttribute(name);
}

/**
 * 找列表项：从根往下跳过只有一个子元素的包裹层，取第一个有多个子元素那一层的子元素。
 * 常见结构"根 > 列表容器 > 卡片们"也能命中卡片。fit（core）与继承防火墙（完整版）共用。
 * @param root 骨架根元素
 * @returns 列表项；不足 MIN_ITEMS 个时返回空数组
 * @example const items = listItems(root);
 */
export function listItems(root: Element): Element[] {
  let box: Element = root;
  while (box.children.length === 1) box = box.children[0]!;
  const items = Array.from(box.children);
  return items.length >= MIN_ITEMS ? items : [];
}
