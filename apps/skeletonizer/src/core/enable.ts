import { IGNORE_SEL, syncAttr } from "./dom.js";
import { enableFit, disableFit } from "./fit.js";
import { listExtensions } from "./extension.js";
import type { EnableOptions } from "./types.js";

/** 骨架加载态的根标记属性（用属性而非 class：框架重写 class 时不会被冲掉） */
export const ROOT_ATTR = "skz";

/** 根上记录效果的属性名 */
const EFFECT_ATTR = "skz-effect";

/** 根里含忽略区时打上的属性：CSS 据此关闭隐式 fade、修正下划线，代替昂贵的 :has([skz-ignore]) */
const HAS_IGNORE_ATTR = "skz-has-ignore";

/** 已启用根元素的运行时状态 */
interface ActiveState {
  /** 关闭骨架的函数 */
  off: () => void;
  /** 解除当前交互锁 */
  unlock: () => void;
}

/** 每个已启用根元素对应的状态 */
const active = new WeakMap<HTMLElement, ActiveState>();

/**
 * 无原生 inert 时的焦点拦截：元素一拿到焦点就失焦，忽略区内的除外。
 * @param e focusin 事件
 */
function blockFocus(e: Event): void {
  const t = e.target;
  if (t instanceof HTMLElement && !t.closest(IGNORE_SEL)) t.blur();
}

/** 当前是否支持原生 inert */
const supportsInert = (): boolean => typeof HTMLElement !== "undefined" && "inert" in HTMLElement.prototype;

/**
 * 找出要设 inert 的元素：根里没有忽略区就锁根本身；有的话逐层下钻，
 * 只锁不含忽略区的分支，让忽略区保持可点、可聚焦（inert 无法在后代上解除）。
 * @param el 当前元素
 * @param hasIgnore el 里是否含忽略区，默认现查（顶层调用方已经查过时直接传，省一次 querySelector）
 * @returns 需要设 inert 的元素
 */
function inertTargets(el: Element, hasIgnore: boolean = !!el.querySelector(IGNORE_SEL)): HTMLElement[] {
  if (!hasIgnore) return el instanceof HTMLElement ? [el] : [];
  const out: HTMLElement[] = [];
  for (const c of Array.from(el.children)) {
    if (!c.matches(IGNORE_SEL)) out.push(...inertTargets(c));
  }
  return out;
}

/**
 * 锁定交互：优先原生 inert（避开忽略区），不支持时靠 CSS pointer-events + 焦点拦截。
 * @param el 骨架根元素
 * @param hasIgnore 根里是否含忽略区（调用方已查过）
 * @returns 解锁函数
 */
function lock(el: HTMLElement, hasIgnore: boolean): () => void {
  if (!supportsInert()) {
    el.addEventListener("focusin", blockFocus, true);
    return () => el.removeEventListener("focusin", blockFocus, true);
  }
  // 原本就 inert 的不动，解锁时也不碰
  const targets = inertTargets(el, hasIgnore).filter((t) => !t.inert);
  for (const t of targets) t.inert = true;
  return () => {
    for (const t of targets) t.inert = false;
  };
}

/**
 * 按注册顺序让所有扩展同步一遍。根上已有 skz 后调用，主题变量才读得到。
 * @param el 骨架根元素
 * @param opts 骨架选项
 */
function syncExtensions(el: HTMLElement, opts: EnableOptions): void {
  for (const ext of listExtensions()) ext.sync(el, opts);
}

/**
 * 对元素开启骨架加载态：加根标记属性 skz、aria-busy、锁定交互。
 * 前提：入口处引入一次样式（`skeletonizer` 默认带 core.css，或 `skeletonizer/explicit`）；el 里照常渲染真实组件 + `Bone` mock 数据。
 * 框架项目优先用子路径适配层（`/react`、`/vue`、`/svelte`），它们会自动开关。
 * 完整用法与坑点：包内 `llms.md`。
 * 文字模式（text）、pulse / shimmer 的方案调度（engine / fallback）、视口外暂停动画等增强属于完整版（`skeletonizer/full`），
 * 通过通用扩展点 registerExtension 挂接；core 自己只处理 effect、fit、交互锁和忽略区。
 * 重复调用是幂等的，会按本次选项重新同步 effect 属性（没传的会被清掉），并让所有扩展再同步一遍。
 *
 * @param el 骨架根元素
 * @param opts
 *   effect：动画效果（写到 skz-effect 属性），不写则用默认的 fade（根级 opacity，几乎零成本）；
 *   fit：保证骨架自身绝不撑出滚动条；
 *   导入完整版后还可传 text / engine / fallback，见 skeletonizer/full
 * @returns 关闭函数，调用后恢复真实内容
 * @example
 * const off = enable(document.querySelector('#card'), { effect: 'shimmer' });
 * // 数据到了：
 * off();
 */
export function enable(el: HTMLElement, opts: EnableOptions = {}): () => void {
  // 忽略区可能随内容变化，每次调用都重新检测（只查一次，结果同时给属性和交互锁用）
  const hasIgnore = !!el.querySelector(IGNORE_SEL);
  syncAttr(el, EFFECT_ATTR, opts.effect);
  el.toggleAttribute(HAS_IGNORE_ATTR, hasIgnore);
  const prev = active.get(el);
  if (!prev) {
    el.setAttribute(ROOT_ATTR, "");
    el.setAttribute("aria-busy", "true");
  }
  syncExtensions(el, opts);
  if (opts.fit) enableFit(el);
  else disableFit(el);

  if (prev) {
    // 忽略区可能随内容变化，重新上锁
    prev.unlock();
    prev.unlock = lock(el, hasIgnore);
    return prev.off;
  }

  const off = (): void => {
    for (const ext of listExtensions()) ext.release(el);
    disableFit(el);
    active.get(el)?.unlock();
    el.removeAttribute(ROOT_ATTR);
    el.removeAttribute("aria-busy");
    el.removeAttribute(EFFECT_ATTR);
    el.removeAttribute(HAS_IGNORE_ATTR);
    active.delete(el);
  };
  active.set(el, { off, unlock: lock(el, hasIgnore) });
  return off;
}

/**
 * 关闭元素的骨架加载态；没开启过则什么都不做。
 * @param el 骨架根元素
 * @example disable(document.querySelector('#card'));
 */
export function disable(el: HTMLElement): void {
  active.get(el)?.off();
}

/**
 * 按 loading 开关骨架态：真则 enable，假则 disable。各框架适配层共用的入口。
 * @param el 骨架根元素
 * @param loading 是否加载中
 * @param opts 骨架选项
 * @example toggle(el, loading, { effect: 'pulse' });
 */
export function toggle(el: HTMLElement, loading: boolean, opts: EnableOptions = {}): void {
  if (loading) enable(el, opts);
  else disable(el);
}
