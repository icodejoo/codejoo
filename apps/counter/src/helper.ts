/** 解析 CSS 选择器或 Element 引用为 DOM 元素 */
export function $(el: string | Element): Element {
  if (typeof Element !== "undefined" && el instanceof Element) return el;
  if (typeof document === "undefined") throw new Error("[GT]: DOM unavailable (SSR?); pass an Element on the client");
  const found = document.querySelector(el as string);
  if (!found) throw new Error("[GT]: Invalid element value [" + el + "]");
  return found;
}

// 元素 → 该元素上所有待激活的懒注册（cb + 所属 observer）。用数组而非单条记录，
// 允许同一元素被多个懒任务同时观察（如同一元素上先后挂了懒 countdown 又挂懒 countup）而不互相顶掉。
// WeakMap：元素被 GC 时记录自动释放，无泄漏。
const lazyMap = new WeakMap<Element, { cb: () => void; io: IntersectionObserver }[]>();

// 所有 lazy observer 共用同一派发回调：某元素进入视口即触发该 observer 名下匹配的回调（一次性）。
// 用回调形参里的 observer 而非闭包变量识别"是哪个 observer 触发的"，避免多个 observer 共用同一 dispatch 时互相误判。
const dispatch: IntersectionObserverCallback = (entries, observer) => {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.isIntersecting) continue;
    const recs = lazyMap.get(entry.target);
    if (!recs) continue;
    // 同一元素可能挂了多个懒注册，只摘取属于当前 observer 的那一条，其余留给各自的 observer 触发
    const idx = recs.findIndex((r) => r.io === observer);
    if (idx === -1) continue;
    const [rec] = recs.splice(idx, 1);
    if (recs.length === 0) lazyMap.delete(entry.target);
    // 同一元素上若还有别的注册复用同一个 observer，暂不 unobserve，避免误伤它们
    if (!recs.some((r) => r.io === observer)) observer.unobserve(entry.target);
    rec.cb();
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
  const rec = { cb: onEnter, io };
  const recs = lazyMap.get(el);
  if (recs) recs.push(rec);
  else lazyMap.set(el, [rec]);
  io.observe(el);
  return () => {
    const list = lazyMap.get(el);
    if (!list) return;
    const idx = list.indexOf(rec);
    if (idx === -1) return;
    list.splice(idx, 1);
    if (list.length === 0) lazyMap.delete(el);
    // 同一元素上若还有别的注册复用同一个 observer，暂不 unobserve，避免误伤它们
    if (!list.some((r) => r.io === io)) io.unobserve(el);
  };
}
