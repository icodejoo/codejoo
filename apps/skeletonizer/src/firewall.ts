/**
 * 继承防火墙：pulse / shimmer（根驱动）时，给视口外的列表项打 skz-fw，CSS 在它身上把动画变量钉成静态值，
 * 根上变量逐帧变化时，这些项的后代不再跟着重算样式。全库共用一个 IntersectionObserver。
 * 不监听 DOM 增删：之后新插入的列表项照常动画（只是没省下这份开销），下次调用 enable() 时会被纳入。
 */

/** 列表项上的防火墙属性 */
const FW_ATTR = "skz-fw";

/** 视口外预留的缓冲距离：快滚进来之前就撤掉防火墙，恢复动画 */
const FW_MARGIN = "200px";

/** 至少有这么多项才值得启用（项太少时省不下多少） */
const MIN_ITEMS = 2;

/** 共享观察器，首次用到时创建 */
let io: IntersectionObserver | null = null;

/** 每个根当前被观察的列表项 */
const watched = new Map<HTMLElement, Element[]>();

/**
 * 取共享观察器：项离开视口就打防火墙，进入视口就撤掉。
 * @returns 观察器；环境不支持时返回 null
 */
function observer(): IntersectionObserver | null {
  if (!io && typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.target.toggleAttribute(FW_ATTR, !e.isIntersecting);
      },
      { rootMargin: FW_MARGIN },
    );
  }
  return io;
}

/**
 * 找列表项：从根往下跳过只有一个子元素的包裹层，取第一个有多个子元素那一层的子元素。
 * 常见结构"根 > 列表容器 > 卡片们"也能命中卡片。
 * @param root 骨架根元素
 * @returns 列表项；不足 MIN_ITEMS 个时返回空数组
 */
export function firewallItems(root: Element): Element[] {
  let box: Element = root;
  while (box.children.length === 1) box = box.children[0]!;
  const items = Array.from(box.children);
  return items.length >= MIN_ITEMS ? items : [];
}

/**
 * 对根启用（或刷新）防火墙：先给所有项预打防火墙，再交给观察器按是否在视口内撤掉。
 * 预打是为了开启第一帧就省掉视口外的重算；视口内的项最迟一两帧内恢复动画。
 * @param root 骨架根元素
 * @returns 是否启用了（环境不支持或找不到足够的列表项时为 false）
 * @example startFirewall(root);
 */
export function startFirewall(root: HTMLElement): boolean {
  const obs = observer();
  if (!obs) return false;
  stopFirewall(root);
  const items = firewallItems(root);
  if (!items.length) return false;
  for (const item of items) {
    item.setAttribute(FW_ATTR, "");
    obs.observe(item);
  }
  watched.set(root, items);
  return true;
}

/**
 * 停用防火墙：取消观察并清掉标记。没启用过则什么都不做。
 * @param root 骨架根元素
 * @example stopFirewall(root);
 */
export function stopFirewall(root: HTMLElement): void {
  const items = watched.get(root);
  if (!items) return;
  for (const item of items) {
    io?.unobserve(item);
    item.removeAttribute(FW_ATTR);
  }
  watched.delete(root);
}
