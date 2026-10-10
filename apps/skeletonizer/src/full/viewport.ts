/** 惰性创建的视口标记观察器句柄 */
export interface ViewportMarker {
  /**
   * 取观察器：首次调用时才创建。
   * @returns 观察器；环境不支持 IntersectionObserver（SSR、老浏览器）时返回 null
   */
  get(): IntersectionObserver | null;
  /**
   * 取消观察一个元素；观察器还没创建过则什么都不做（不会顺手创建）。
   * @param el 目标元素
   */
  unobserve(el: Element): void;
}

/**
 * 造一个「视口标记」观察器：元素在视口（含 rootMargin 缓冲）外就打上 attr，回来就撤掉。
 * 懒渲染（暂停动画）与继承防火墙共用这套逻辑，各自一个单例，只差属性名和缓冲距离。
 * @param attr 离开视口时打的属性名
 * @param rootMargin 视口外预留的缓冲距离，如 "100px"
 * @returns 句柄；观察器在第一次 get() 时才创建
 * @example
 * const paused = viewportMarker("skz-paused", "100px");
 * paused.get()?.observe(el);
 */
export function viewportMarker(attr: string, rootMargin: string): ViewportMarker {
  let io: IntersectionObserver | null = null;
  return {
    get() {
      if (!io && typeof IntersectionObserver !== "undefined") {
        io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) e.target.toggleAttribute(attr, !e.isIntersecting);
          },
          { rootMargin },
        );
      }
      return io;
    },
    unobserve(el) {
      io?.unobserve(el);
    },
  };
}
