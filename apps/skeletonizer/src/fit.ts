/**
 * fit：保证骨架自身绝不撑出滚动条。
 * CSS 兜底（skz-fit：max-height: 100vh + overflow clip）零 JS 首帧生效；
 * JS 再按可视边界算出精确的可用高度，写到根的内联 max-height，并把完全落在可用高度之外的列表项打上隐藏标记。
 * 模块顶层不访问 window / document，SSR 安全。
 */
import { dropEmptyStyle } from "./dom.js";
import { firewallItems } from "./firewall.js";

/** 开启 fit 的根标记属性（CSS 兜底挂在它上面） */
export const FIT_ATTR = "skz-fit";

/** 完全落在可用高度之外的列表项的隐藏标记属性（CSS：display: none） */
export const FIT_HIDE_ATTR = "skz-fit-hide";

/** 内联 max-height 的 CSS 属性名 */
const MAX_HEIGHT_PROP = "max-height";

/** 单个根的 fit 运行状态 */
interface FitState {
  /** 当前可视边界元素；null 表示视口 */
  boundary: HTMLElement | null;
  /** 已被打上隐藏标记的项，清理时用 */
  hidden: Element[];
  /** 待执行的 rAF id，0 表示没有 */
  raf: number;
  /** 边界 ResizeObserver（有滚动祖先且环境支持时） */
  ro: ResizeObserver | null;
  /** 视口 resize 监听（边界是视口时） */
  onResize: (() => void) | null;
}

/** 已开启 fit 的根 -> 运行状态 */
const active = new WeakMap<HTMLElement, FitState>();

/**
 * overflow 取值是否会裁剪 / 滚动内容
 * @param v computed overflow 值
 * @returns 非 visible 即为 true
 */
function isClipping(v: string | undefined): boolean {
  return !!v && v !== "visible";
}

/**
 * 判断元素是否是"可视边界"：computed overflow-y 或 overflow 不是 visible。
 * @param el 待判断的元素
 * @returns 是否会裁剪 / 滚动其内容
 */
function clips(el: Element): boolean {
  const cs = getComputedStyle(el);
  return isClipping(cs.overflowY) || isClipping(cs.overflow);
}

/**
 * 找可视边界：从根往上第一个会裁剪 / 滚动内容的祖先；没有（或只到 html / body）则用视口。
 * html / body 上的 overflow 会传播给视口，按视口算。
 * @param root 骨架根元素
 * @returns 边界元素；null 表示视口
 */
function findBoundary(root: HTMLElement): HTMLElement | null {
  let cur = root.parentElement;
  while (cur) {
    if (cur === document.body || cur === document.documentElement) return null;
    if (clips(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * 取边界可视区底边（视口坐标）。
 * @param boundary 边界元素；null 表示视口
 * @returns 底边的 y 值（px）
 */
function boundaryBottom(boundary: HTMLElement | null): number {
  if (boundary) return boundary.getBoundingClientRect().top + boundary.clientTop + boundary.clientHeight;
  return window.innerHeight || document.documentElement.clientHeight;
}

/**
 * 清掉旧的隐藏标记。
 * @param state fit 状态
 */
function clearHidden(state: FitState): void {
  for (const item of state.hidden) item.removeAttribute(FIT_HIDE_ATTR);
  state.hidden = [];
}

/** 判断"仍可滚动"时容许的取整误差（px） */
const SCROLL_EPSILON = 1;

/**
 * 边界此刻是否仍可滚动（内容比可视区高）。
 * @param boundary 边界元素；null 表示视口
 * @returns 是否还能滚动
 */
function stillScrollable(boundary: HTMLElement | null): boolean {
  const el = boundary ?? document.scrollingElement ?? document.documentElement;
  return el.scrollHeight - el.clientHeight > SCROLL_EPSILON;
}

/**
 * 取"一屏高"：容器是它的可视高，视口是视口高（与 CSS 兜底的 100dvh 一致）。
 * @param boundary 边界元素；null 表示视口
 * @returns 一屏高度（px）
 */
function screenHeight(boundary: HTMLElement | null): number {
  return boundary ? boundary.clientHeight : window.innerHeight || document.documentElement.clientHeight;
}

/**
 * 按给定高度写内联 max-height，并重新给完全落在其外的列表项打隐藏标记（先清旧标记）。
 * @param root 骨架根元素
 * @param state fit 状态
 * @param top 根此刻的视口顶边
 * @param height 允许的高度（px）
 */
function applyHeight(root: HTMLElement, state: FitState, top: number, height: number): void {
  clearHidden(state);
  root.style.setProperty(MAX_HEIGHT_PROP, `${height}px`);
  for (const item of firewallItems(root)) {
    if (item.getBoundingClientRect().top - top >= height) {
      item.setAttribute(FIT_HIDE_ATTR, "");
      state.hidden.push(item);
    }
  }
}

/**
 * 测量一次：写内联 max-height，并给完全落在可用高度之外的列表项打隐藏标记。
 * 先清旧标记再测，resize 变大时被隐藏的项能回来。
 * 规则：
 * 1. 先按"边界可视底边 - 根顶"算可用高度并收口；
 * 2. 收口后边界若仍可滚动，说明滚动条是别的内容造成的、不是骨架（比如骨架在首屏以下，或下方还有别的内容），
 *    继续贴着可视底边只会把骨架压成 0 高，所以放宽为一屏高后重新打隐藏标记；
 * 3. 只放宽这一次，不循环：放宽后骨架顶多是一屏高，不会比 CSS 兜底（100dvh）更宽松。
 * @param root 骨架根元素
 * @param state fit 状态
 */
function measure(root: HTMLElement, state: FitState): void {
  clearHidden(state);
  const top = root.getBoundingClientRect().top;
  // 换算成"边界内容坐标"：容器 / 页面已经滚过一段时，根在内容里的位置要加回滚动量，结果才与当前滚动位置无关
  const scrolled = (state.boundary ? state.boundary.scrollTop : window.scrollY) || 0;
  const avail = Math.max(0, boundaryBottom(state.boundary) - (top + scrolled));
  applyHeight(root, state, top, avail);
  if (stillScrollable(state.boundary)) applyHeight(root, state, top, screenHeight(state.boundary));
}

/**
 * 停掉某个状态上的全部监听（观察器、resize、待执行的 rAF）。
 * @param state fit 状态
 */
function stopWatching(state: FitState): void {
  state.ro?.disconnect();
  state.ro = null;
  if (state.onResize) window.removeEventListener("resize", state.onResize);
  state.onResize = null;
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
}

/**
 * 对根开启（或刷新）fit：加 skz-fit 属性，同步测量一次（赶在首帧绘制前），再监听边界尺寸变化。
 * 重复调用是幂等的：会重新找边界、重测、重挂监听。
 * 没有 window / document（SSR）时什么都不做。
 * 没有 ResizeObserver 时，有滚动祖先的情况只测这一次；视口情况仍监听 window resize。
 * @param root 骨架根元素
 * @example
 * enableFit(document.querySelector('#list'));
 */
export function enableFit(root: HTMLElement): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  root.setAttribute(FIT_ATTR, "");

  let state = active.get(root);
  if (state) stopWatching(state);
  else {
    state = { boundary: null, hidden: [], raf: 0, ro: null, onResize: null };
    active.set(root, state);
  }
  const s = state;
  s.boundary = findBoundary(root);
  measure(root, s);

  /** 用 rAF 合并同一帧内的多次触发 */
  const schedule = (): void => {
    if (s.raf) return;
    s.raf = requestAnimationFrame(() => {
      s.raf = 0;
      measure(root, s);
    });
  };
  if (s.boundary) {
    if (typeof ResizeObserver !== "undefined") {
      s.ro = new ResizeObserver(schedule);
      s.ro.observe(s.boundary);
    }
  } else {
    s.onResize = schedule;
    window.addEventListener("resize", schedule, { passive: true });
  }
}

/**
 * 关闭 fit：清内联 max-height（style 空了就删掉 style 属性）、移除全部隐藏标记和 skz-fit 属性、断开监听。没开启过也安全。
 * @param root 骨架根元素
 * @example
 * disableFit(document.querySelector('#list'));
 */
export function disableFit(root: HTMLElement): void {
  const state = active.get(root);
  if (state) {
    stopWatching(state);
    clearHidden(state);
    active.delete(root);
    root.style.removeProperty(MAX_HEIGHT_PROP);
    dropEmptyStyle(root);
    root.removeAttribute(FIT_ATTR);
  }
}
