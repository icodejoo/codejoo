/**
 * SVG 方案（engine: "svg"）的运行时图：按根上的高光色和时长现生成 SVG，转成 blob URL 写到根的内联变量，
 * 颜色与时长都和 CSS 主题一致；CSS 里没有任何内置 SVG，JS 未执行或生成失败时退回 fade。
 * 同参数共用一份 blob，引用计数归零时释放；系统深浅色切换时自动重新生成。
 * 严格 CSP 需要放行 img-src blob:。
 */
import { dropEmptyStyle } from "../core/dom.js";

/** 根上记录动画实现的属性名；blob 图真正挂上后才写，CSS 的 SVG 规则据此生效 */
const ENGINE_ATTR = "skz-engine";

/** engine 属性的 SVG 值 */
const ENGINE_SVG = "svg";

/** 根上存放 shimmer 图的变量 */
const SHIMMER_VAR = "--skz-svg-shimmer";

/** 根上存放 pulse 图的变量 */
const PULSE_VAR = "--skz-svg-pulse";

/** 默认时长（毫秒），与 CSS 的 --skz-duration 默认值一致 */
const DEFAULT_DURATION = 1500;

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

/** 一组生成好的图 */
interface SvgEntry {
  /** shimmer 图的 blob URL */
  shimmer: string;
  /** pulse 图的 blob URL */
  pulse: string;
  /** 正在使用的根数 */
  refs: number;
}

/** 按 "高光色|时长" 缓存的图 */
const cache = new Map<string, SvgEntry>();

/** 每个根当前使用的缓存键 */
const owned = new Map<HTMLElement, string>();

/** 系统深浅色的媒体查询，首次用到时创建并监听 */
let scheme: MediaQueryList | null = null;

/**
 * 当前环境能否生成 blob URL 并读取主题变量。
 * @returns 是否可用
 */
function canBlob(): boolean {
  return typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof getComputedStyle === "function";
}

/**
 * shimmer 图：高光色光带（透明 → 高光 → 透明）从左扫到右，铺满视口（配合 fixed 背景各骨头同步）。
 * @param hl 高光色
 * @param dur 时长（毫秒）
 * @returns SVG 文本
 */
function shimmerSvg(hl: string, dur: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><linearGradient id="g"><stop stop-color="${hl}" stop-opacity="0"/><stop offset=".5" stop-color="${hl}"/><stop offset="1" stop-color="${hl}" stop-opacity="0"/></linearGradient><rect width="60" height="100" fill="url(#g)"><animateTransform attributeName="transform" type="translate" from="-60 0" to="110 0" dur="${dur}ms" repeatCount="indefinite"/></rect></svg>`;
}

/**
 * pulse 图：整块高光色透明度 0 → 1 → 0，来回一次是两个时长。
 * @param hl 高光色
 * @param dur 时长（毫秒）
 * @returns SVG 文本
 */
function pulseSvg(hl: string, dur: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" preserveAspectRatio="none"><rect width="10" height="10" fill="${hl}" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="${dur * 2}ms" calcMode="spline" keySplines=".42 0 .58 1;.42 0 .58 1" repeatCount="indefinite"/></rect></svg>`;
}

/**
 * 把 SVG 文本转成 blob URL。
 * @param svg SVG 文本
 * @returns blob URL
 */
function toUrl(svg: string): string {
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

/** 系统深浅色切换时，给所有在用的根重新生成 */
function onSchemeChange(): void {
  // 循环里会删除再重新加入，先拷一份键
  for (const root of Array.from(owned.keys())) {
    releaseSvg(root);
    applySvg(root);
  }
}

/**
 * 给根生成并挂上运行时图，成功后在根上写 skz-engine="svg"。
 * 环境不支持 blob、读不到主题变量（样式表未加载）时，摘掉自己挂过的东西（含 engine 属性）并返回 false，
 * 此时根上没有 engine 属性，CSS 自动退回基底的 fade。参数没变（已挂上）直接返回 true。
 * @param root 骨架根元素（需已带 skz，主题变量才读得到）
 * @returns 是否已挂上
 * @example if (!applySvg(root)) console.log("退回 fade");
 */
export function applySvg(root: HTMLElement): boolean {
  if (!canBlob()) {
    releaseSvg(root);
    return false;
  }
  const cs = getComputedStyle(root);
  const hl = cs.getPropertyValue("--skz-highlight").trim();
  if (!hl) {
    releaseSvg(root);
    return false;
  }
  const dur = toMs(cs.getPropertyValue("--skz-duration"), DEFAULT_DURATION);
  const key = `${hl}|${dur}`;
  if (owned.get(root) === key) {
    root.setAttribute(ENGINE_ATTR, ENGINE_SVG);
    return true;
  }
  releaseSvg(root);
  let entry = cache.get(key);
  if (!entry) {
    entry = { shimmer: toUrl(shimmerSvg(hl, dur)), pulse: toUrl(pulseSvg(hl, dur)), refs: 0 };
    cache.set(key, entry);
  }
  entry.refs++;
  owned.set(root, key);
  root.style.setProperty(SHIMMER_VAR, `url("${entry.shimmer}")`);
  root.style.setProperty(PULSE_VAR, `url("${entry.pulse}")`);
  root.setAttribute(ENGINE_ATTR, ENGINE_SVG);
  if (!scheme && typeof matchMedia === "function") {
    scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener?.("change", onSchemeChange);
  }
  return true;
}

/**
 * 摘掉根上的运行时图；没有根再用这组图时释放 blob。没挂过则什么都不做。
 * @param root 骨架根元素
 * @example releaseSvg(root);
 */
export function releaseSvg(root: HTMLElement): void {
  const key = owned.get(root);
  if (root.getAttribute(ENGINE_ATTR) === ENGINE_SVG) root.removeAttribute(ENGINE_ATTR);
  if (key === undefined) return;
  owned.delete(root);
  root.style.removeProperty(SHIMMER_VAR);
  root.style.removeProperty(PULSE_VAR);
  dropEmptyStyle(root);
  const entry = cache.get(key);
  if (entry && --entry.refs <= 0) {
    URL.revokeObjectURL(entry.shimmer);
    URL.revokeObjectURL(entry.pulse);
    cache.delete(key);
  }
}
