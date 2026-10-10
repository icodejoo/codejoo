import { PAUSED_ATTR } from "./dom.js";
import { enableFit, disableFit } from "./fit.js";

/** 动画效果 */
export type SkzEffect = "fade" | "solid" | "sweep" | "pulse" | "shimmer";

/**
 * 文字骨头模式：不传 = "clip"（默认）。
 * - "clip"：下划线当形状 + background-clip:text 当填充，文字条里也有 shimmer 光带，形状沿真实文字行；
 * - "underline"：纯下划线，颜色脉冲，最便宜；
 * - "leaf"：叶子元素整块当背景骨头（有圆角、能放光带）；
 * - "tofu"：方块字体（需引入 skeletonizer/tofu.css，否则退回 underline 外观），颜色脉冲。
 */
export type SkzTextMode = "underline" | "leaf" | "clip" | "tofu";

/** 降级目标：浏览器不支持 @property、global 方案的 pulse / shimmer 跑不起来时改用的效果：svg（默认，JS 挂 blob SVG 动画）/ fade（根级淡入淡出） */
export type SkzFallback = "svg" | "fade";

/** pulse / shimmer 的实现：global（根驱动）或 svg（骨头共用一张 SVG 动画背景图）；与入口 skeletonizer/global、skeletonizer/svg 对应 */
export type SkzEngine = "global" | "svg";

/** enable() 的选项 */
export interface EnableOptions {
  /** 动画效果，默认 fade */
  effect?: SkzEffect;
  /** 文字骨头模式，不传 = clip，各模式见 SkzTextMode */
  text?: SkzTextMode;
  /** global 方案在不支持 @property 的浏览器里退回的效果，默认 svg（由 JS 挂 blob SVG，需加载 skeletonizer/global）；JS 执行前一律是 fade */
  fallback?: SkzFallback;
  /**
   * pulse / shimmer 的实现。不传时：加载了 skeletonizer/global 就用 global，只加载了 skeletonizer/svg 就用 svg；
   * 两者都加载（如 skeletonizer/all）时默认 global。
   */
  engine?: SkzEngine;
  /** 保证骨架自身绝不撑出滚动条，超出部分自动隐藏。默认关闭 */
  fit?: boolean;
}

/** 方案扩展：变体入口（skeletonizer/global、skeletonizer/svg）注册进来，给根挂上 / 撤掉该方案特有的运行时处理 */
export interface SkzExtension {
  /** 方案名，与 engine 选项对应 */
  engine: SkzEngine;
  /**
   * 根已带 skz 后按选项同步（pulse / shimmer 且选中本方案时调用）
   * @param el 骨架根元素
   * @param opts 骨架选项
   */
  sync(el: HTMLElement, opts: EnableOptions): void;
  /**
   * 撤掉本方案在根上的一切处理（未选中本方案、换效果或关闭时调用）
   * @param el 骨架根元素
   */
  release(el: HTMLElement): void;
}

/** 已注册的方案扩展 */
const extensions = new Map<SkzEngine, SkzExtension>();

/**
 * 注册方案扩展；同名重复注册以后者为准。由变体入口在加载时调用，一般不需要手动调用。
 * @param ext 方案扩展
 * @example registerExtension({ engine: "svg", sync: applySvg, release: releaseSvg });
 */
export function registerExtension(ext: SkzExtension): void {
  extensions.set(ext.engine, ext);
}

/**
 * 决定根实际使用的方案：显式传了就用；否则加载了 global 用 global，只加载了 svg 用 svg，都没加载按 global（纯 CSS 根驱动）。
 * @param opts 骨架选项
 * @returns 方案名
 */
function resolveEngine(opts: EnableOptions): SkzEngine {
  if (opts.engine) return opts.engine;
  return !extensions.has("global") && extensions.has("svg") ? "svg" : "global";
}

/** registerCustomElements 的选项 */
export interface RegisterOptions {
  /** 手动补充的自定义元素标签名 */
  tags?: string[];
  /** 监听 DOM 变化自动重扫 */
  watch?: boolean;
}

/** 骨架加载态的根标记属性（用属性而非 class：框架重写 class 时不会被冲掉） */
export const ROOT_ATTR = "skz";

/** 自定义元素标签名，不参与宿主扫描 */
const SELF_TAG = "skz-box";

/** 根上记录效果的属性名 */
const EFFECT_ATTR = "skz-effect";

/** 根上记录文字模式的属性名 */
const TEXT_ATTR = "skz-text";

/** 根里含忽略区时打上的属性：CSS 据此关闭隐式 fade、修正下划线，代替昂贵的 :has([skz-ignore]) */
const HAS_IGNORE_ATTR = "skz-has-ignore";

/** 视口外预留的缓冲距离：快滚进来之前就恢复动画 */
const VIEWPORT_MARGIN = "100px";

/** 全库共用的视口观察器，首次用到时创建 */
let viewport: IntersectionObserver | null = null;

/**
 * 取共享的视口观察器：根离开视口就暂停动画，回来再恢复。
 * @returns 观察器；环境不支持（SSR、老浏览器）时返回 null
 */
function viewportObserver(): IntersectionObserver | null {
  if (!viewport && typeof IntersectionObserver !== "undefined") {
    viewport = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.target.toggleAttribute(PAUSED_ATTR, !e.isIntersecting);
      },
      { rootMargin: VIEWPORT_MARGIN },
    );
  }
  return viewport;
}

/** 忽略区的属性选择器：里面的内容保持可交互 */
const IGNORE_SEL = "[skz-ignore]";

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
 * 有值就写属性，没值就删掉，保证根上不残留上一次的选项。
 * @param el 骨架根元素
 * @param name 属性名
 * @param value 属性值
 */
function syncAttr(el: HTMLElement, name: string, value: string | undefined): void {
  if (value) el.setAttribute(name, value);
  else el.removeAttribute(name);
}

/**
 * 找出要设 inert 的元素：根里没有忽略区就锁根本身；有的话逐层下钻，
 * 只锁不含忽略区的分支，让忽略区保持可点、可聚焦（inert 无法在后代上解除）。
 * @param el 当前元素
 * @returns 需要设 inert 的元素
 */
function inertTargets(el: Element): HTMLElement[] {
  if (!el.querySelector(IGNORE_SEL)) return el instanceof HTMLElement ? [el] : [];
  const out: HTMLElement[] = [];
  for (const c of Array.from(el.children)) {
    if (!c.matches(IGNORE_SEL)) out.push(...inertTargets(c));
  }
  return out;
}

/**
 * 锁定交互：优先原生 inert（避开忽略区），不支持时靠 CSS pointer-events + 焦点拦截。
 * @param el 骨架根元素
 * @returns 解锁函数
 */
function lock(el: HTMLElement): () => void {
  if (!supportsInert()) {
    el.addEventListener("focusin", blockFocus, true);
    return () => el.removeEventListener("focusin", blockFocus, true);
  }
  // 原本就 inert 的不动，解锁时也不碰
  const targets = inertTargets(el).filter((t) => !t.inert);
  for (const t of targets) t.inert = true;
  return () => {
    for (const t of targets) t.inert = false;
  };
}

/**
 * 同步方案扩展：pulse / shimmer 时只让选中的方案处理这个根，其余方案撤掉；其他效果全部撤掉。
 * 分两遍：先撤掉未选中的，再同步选中的——选中方案（如 global 在老浏览器上）可能借用别的方案的运行时图，
 * 同遍里先 sync 再被后面的 release 撤掉就白挂了。
 * 根上已有 skz 后调用，主题变量才读得到。
 * @param el 骨架根元素
 * @param opts 骨架选项
 * @param engine 实际使用的方案
 */
function syncExtensions(el: HTMLElement, opts: EnableOptions, engine: SkzEngine): void {
  const animated = opts.effect === "pulse" || opts.effect === "shimmer";
  const selected: SkzExtension[] = [];
  for (const ext of extensions.values()) {
    if (animated && ext.engine === engine) selected.push(ext);
    else ext.release(el);
  }
  for (const ext of selected) ext.sync(el, opts);
}

/**
 * 对元素开启骨架加载态：加根标记属性 skz、aria-busy、锁定交互。
 * 前提：入口处引入一次基底样式（`skeletonizer/base.css` 或 `explicit.css`）和需要的变体（`skeletonizer/global` / `/svg`，或 `/all`）；el 里照常渲染真实组件 + `Bone` mock 数据。
 * 框架项目优先用子路径适配层（`/react`、`/vue`、`/svelte`），它们会自动开关。
 * 完整用法与坑点：包内 `llms.md`。
 * 根滚出视口时自动暂停动画（懒渲染），回到视口附近再恢复。
 * pulse / shimmer 的增强处理（继承防火墙、SVG 运行时图）由变体入口 skeletonizer/global、skeletonizer/svg 提供。
 * 重复调用是幂等的，会按本次选项重新同步 effect / text 属性（没传的会被清掉）。
 * pulse / shimmer 由根驱动（根上一个动画），每帧仍要重绘骨头，成本随元素数增长；不支持 @property 的浏览器由 JS 改挂 SVG 动画（fallback 可改成 fade），JS 执行前显示 fade。
 *
 * @param el 骨架根元素
 * @param opts
 *   effect：动画效果（写到 skz-effect 属性），不写则用默认的 fade（根级 opacity，几乎零成本）；
 *   text：文字骨头模式（写到 skz-text 属性），不传 = clip，各模式见 SkzTextMode；
 *   engine：pulse / shimmer 的实现，global / svg（svg 方案挂上 blob 图后由扩展写 skz-engine 属性），默认按已加载的变体入口决定；
 *   fallback：global 方案在不支持 @property 的浏览器里的降级，svg（默认，JS 挂 blob SVG 动画）/ fade（不挂，保持基底 fade）
 * @returns 关闭函数，调用后恢复真实内容
 * @example
 * const off = enable(document.querySelector('#card'), { effect: 'shimmer' });
 * // 数据到了：
 * off();
 */
export function enable(el: HTMLElement, opts: EnableOptions = {}): () => void {
  syncAttr(el, EFFECT_ATTR, opts.effect);
  syncAttr(el, TEXT_ATTR, opts.text);
  const engine = resolveEngine(opts);
  // 忽略区可能随内容变化，每次调用都重新检测
  el.toggleAttribute(HAS_IGNORE_ATTR, !!el.querySelector(IGNORE_SEL));
  const prev = active.get(el);
  if (prev) {
    syncExtensions(el, opts, engine);
    if (opts.fit) enableFit(el);
    else disableFit(el);
    // 忽略区可能随内容变化，重新上锁
    prev.unlock();
    prev.unlock = lock(el);
    return prev.off;
  }

  el.setAttribute(ROOT_ATTR, "");
  el.setAttribute("aria-busy", "true");
  syncExtensions(el, opts, engine);

  if (opts.fit) enableFit(el);
  else disableFit(el);

  viewportObserver()?.observe(el);

  const off = (): void => {
    for (const ext of extensions.values()) ext.release(el);
    disableFit(el);
    viewport?.unobserve(el);
    el.removeAttribute(PAUSED_ATTR);
    active.get(el)?.unlock();
    el.removeAttribute(ROOT_ATTR);
    el.removeAttribute("aria-busy");
    el.removeAttribute(EFFECT_ATTR);
    el.removeAttribute(TEXT_ATTR);
    el.removeAttribute(HAS_IGNORE_ATTR);
    active.delete(el);
  };
  active.set(el, { off, unlock: lock(el) });
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

/** 宿主样式表的挂载句柄 */
interface HostSheet {
  /** 整体替换样式文本 */
  set(css: string): void;
  /** 从文档里摘掉 */
  remove(): void;
}

/**
 * 在 root 上挂一张宿主样式表：优先 adoptedStyleSheets，不支持时退回 <style>。
 * @param root 样式生效的范围（Document 或 ShadowRoot）
 * @returns 挂载句柄
 */
function mountHostSheet(root: Document | ShadowRoot): HostSheet {
  if ("adoptedStyleSheets" in root && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return {
      set: (css) => sheet.replaceSync(css),
      remove: () => {
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
      },
    };
  }
  const doc = root.ownerDocument ?? (root as Document);
  const el = doc.createElement("style");
  el.setAttribute("data-skz-hosts", "");
  ("head" in root ? root.head : root).appendChild(el);
  return {
    set: (css) => {
      el.textContent = css;
    },
    remove: () => el.remove(),
  };
}

/**
 * 生成 Web Component 宿主的骨架样式：宿主 visibility:hidden 藏起 shadow 内容，
 * 再用宿主的 ::before 铺一块骨头（宿主自己的背景会被 visibility 一起藏掉，所以借伪元素）。
 * 骨头的画法与 _mixins.scss 的 sk-bone 一致：读根上动画驱动继承下来的 --skz-fill / --skz-bg-img / --skz-bg-pos，
 * 所以 pulse / shimmer（global 含降频、svg 引擎、防火墙）对宿主同样生效。
 * @param tags 带连字符的自定义元素标签名
 * @returns CSS 文本
 */
function buildHostCss(tags: string[]): string {
  if (!tags.length) return "";
  const sel = (suffix = ""): string => tags.map((t) => `[${ROOT_ATTR}] ${t}:not([skz-ignore])${suffix}`).join(",");
  return `${sel()}{visibility:hidden !important;position:relative}
${sel("::before")}{content:"" !important;visibility:visible !important;position:absolute !important;top:0 !important;right:0 !important;bottom:0 !important;left:0 !important;background-color:var(--skz-fill,var(--skz-color,#d9dde3)) !important;background-image:var(--skz-bg-img,none) !important;background-position:var(--skz-bg-pos,0 0);background-repeat:no-repeat !important;background-attachment:fixed !important;background-size:var(--skz-bg-size,60vw 100vh) !important;border-radius:var(--skz-radius,4px) !important}`;
}

/**
 * 扫描 root 里的自定义元素，生成宿主骨架样式表（adoptedStyleSheets，不支持时退回 <style>）。
 * 不改任何 DOM 节点；新增的自定义元素可调用 refresh() 或开启 watch 自动重扫。
 * 每次调用各自持有一张样式表，dispose 只清自己的。
 *
 * @param root 扫描范围兼样式生效范围，默认 document
 * @param opts tags：手动补充的标签名；watch：监听 DOM 变化自动重扫
 * @returns refresh 重扫并返回命中的标签名；dispose 停止监听并摘掉样式表
 * @example
 * const hosts = registerCustomElements(document, { tags: ['sl-button'], watch: true });
 */
export function registerCustomElements(root: Document | ShadowRoot = document, opts: RegisterOptions = {}): { refresh: () => string[]; dispose: () => void } {
  const extra = (opts.tags ?? []).map((t) => t.toLowerCase());
  const sheet = mountHostSheet(root);
  let lastCss = "";
  const refresh = (): string[] => {
    const found = new Set(extra);
    root.querySelectorAll("*").forEach((n) => {
      if (n.localName.includes("-") && n.localName !== SELF_TAG) found.add(n.localName);
    });
    const tags = [...found].sort();
    const css = buildHostCss(tags);
    // 标签集合没变就不重建样式表，省掉一次整表失效
    if (css !== lastCss) {
      lastCss = css;
      sheet.set(css);
    }
    return tags;
  };
  refresh();

  let observer: MutationObserver | null = null;
  if (opts.watch) {
    let queued = false;
    observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        refresh();
      });
    });
    observer.observe((root as Document).documentElement ?? root, { childList: true, subtree: true });
  }

  const dispose = (): void => {
    observer?.disconnect();
    sheet.remove();
  };
  return { refresh, dispose };
}
