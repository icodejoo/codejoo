/**
 * 共享可见性观测：所有懒任务复用同一套 IntersectionObserver 派发逻辑。
 * 元素 -> 显隐回调的映射存于 WeakMap，元素被 GC 时自动清理，无内存泄漏。
 */

export interface VisibilityHandlers {
  /** 元素进入视口 */
  enter(): void;
  /** 元素离开视口 */
  leave(): void;
}

const handlers = new WeakMap<Element, VisibilityHandlers>();

function dispatch(entries: IntersectionObserverEntry[]) {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const h = handlers.get(entry.target);
    if (!h) continue;
    if (entry.isIntersecting) h.enter();
    else h.leave();
  }
}

/**
 * 创建一个复用库内派发逻辑的 IntersectionObserver。
 * 通过 init 定制 root / rootMargin / threshold；其回调始终走共享的 dispatch，
 * 因此用它 observe 的元素也能正确触发 enter/leave。
 */
export function createLazyObserver(init?: IntersectionObserverInit): IntersectionObserver {
  return new IntersectionObserver(dispatch, init);
}

let _default: IntersectionObserver | undefined;

/** 进程级共享的默认 observer，首个懒任务出现时才创建（避免模块加载/SSR 期 new） */
export function defaultObserver(): IntersectionObserver {
  if (!_default) _default = createLazyObserver();
  return _default;
}

/** 登记元素的显隐回调并开始观测 */
export function observe(observer: IntersectionObserver, el: Element, h: VisibilityHandlers) {
  handlers.set(el, h);
  observer.observe(el);
}

/** 停止观测并注销回调 */
export function unobserve(observer: IntersectionObserver, el: Element) {
  handlers.delete(el);
  observer.unobserve(el);
}
