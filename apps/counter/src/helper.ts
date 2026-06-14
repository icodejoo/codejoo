/** 解析 CSS 选择器或 Element 引用为 DOM 元素 */
export function $(el: string | Element): Element {
  if (typeof Element !== "undefined" && el instanceof Element) return el;
  if (typeof document === "undefined") throw new Error("[GT]: DOM unavailable (SSR?); pass an Element on the client");
  const found = document.querySelector(el as string);
  if (!found) throw new Error("[GT]: Invalid element value [" + el + "]");
  return found;
}

// 元素 → 其首次进入视口的回调 + 所属 observer（命中后用于精确 unobserve）。
// WeakMap：元素被 GC 时记录自动释放，无泄漏。
const lazyMap = new WeakMap<Element, { cb: () => void; io: IntersectionObserver }>();

// 所有 lazy observer 共用同一派发回调：某元素进入视口即注销它并触发其回调（一次性）。
const dispatch: IntersectionObserverCallback = (entries) => {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.isIntersecting) continue;
    const rec = lazyMap.get(entry.target);
    if (rec) {
      lazyMap.delete(entry.target);
      rec.io.unobserve(entry.target);
      rec.cb();
    }
  }
};

// 默认单例 observer，所有未自定义 observer 的 lazy 任务共用同一个（避免每任务新建一个 IO）。
let defaultObserver: IntersectionObserver | undefined;

/**
 * 创建一个复用库内派发逻辑的 IntersectionObserver，可自定义触发条件（root / rootMargin / threshold）。
 * 把返回值作为 countup / countdown 的 `observer` 选项传入，即可定制"进入视口"的判定；
 * 同一个 observer 可被多个任务复用。
 *
 * @example
 * import { countdown, createLazyObserver } from "@codejoo/counter";
 * const ob = createLazyObserver({ rootMargin: "200px" }); // 提前 200px 触发
 * countdown(60000, "#t", { observer: ob });
 */
export function createLazyObserver(options?: IntersectionObserverInit): IntersectionObserver {
  return new IntersectionObserver(dispatch, options);
}

/**
 * 懒启动：观察 el，**首次进入视口**时触发 onEnter 一次。
 * 默认所有任务复用同一个单例 observer；传入 `observer` 则用它（自定义触发条件，可跨任务复用）。
 * 无 IntersectionObserver 环境（SSR / jsdom）退化为立即触发 onEnter，等价于非懒加载。
 * 返回取消函数：进入视口前被移除/清空时调用，注销观察避免泄漏。
 */
export function lazyStart(el: Element, onEnter: () => void, observer?: IntersectionObserver): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onEnter();
    return () => {};
  }
  if (!defaultObserver) defaultObserver = createLazyObserver();
  const io = observer ?? defaultObserver;
  lazyMap.set(el, { cb: onEnter, io });
  io.observe(el);
  return () => {
    lazyMap.delete(el);
    io.unobserve(el);
  };
}
