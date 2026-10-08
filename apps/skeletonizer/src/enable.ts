/** 动画效果 */
export type XSkeEffect = "fade" | "solid" | "sweep" | "pulse" | "shimmer";

/** 文字骨头模式 */
export type XSkeTextMode = "underline" | "leaf";

/** enable() 的选项 */
export interface EnableOptions {
  /** 动画效果，默认 fade */
  effect?: XSkeEffect;
  /** 文字骨头模式 */
  text?: XSkeTextMode;
  /** pulse / shimmer 允许的最大元素数，默认 300 */
  maxAnimated?: number;
}

/** registerCustomElements 的选项 */
export interface RegisterOptions {
  /** 手动补充的自定义元素标签名 */
  tags?: string[];
  /** 监听 DOM 变化自动重扫 */
  watch?: boolean;
}

/** 骨架加载态的根 class */
export const ROOT_CLASS = "x-ske";

/** 自定义元素标签名，不参与宿主扫描 */
const SELF_TAG = "x-ske";

/** 元素级动画（pulse / shimmer）允许的最大元素数，超过就自动降级成 fade */
export const MAX_ANIMATED = 300;

/** 元素级动画的效果名（每个骨头各挂一个动画，贵） */
const HEAVY_EFFECTS: ReadonlySet<XSkeEffect> = new Set<XSkeEffect>(["pulse", "shimmer"]);

/** 每个已启用根元素对应的清理函数 */
const active = new WeakMap<HTMLElement, () => void>();

/**
 * 无原生 inert 时的焦点拦截：元素一拿到焦点就失焦。
 * @param e focusin 事件
 */
function blockFocus(e: Event): void {
  const t = e.target;
  if (t instanceof HTMLElement) t.blur();
}

/** 当前是否支持原生 inert */
const supportsInert = (): boolean => typeof HTMLElement !== "undefined" && "inert" in HTMLElement.prototype;

/**
 * 按根下元素数量决定实际使用的效果：pulse / shimmer 是元素级动画，
 * 元素一多主线程每帧都要重算，超过上限就降级成根级 opacity 的 fade。
 * @param el 骨架根元素
 * @param effect 期望的效果
 * @param max 元素数上限
 * @returns 实际生效的效果
 */
function resolveEffect(el: HTMLElement, effect: XSkeEffect | undefined, max: number): XSkeEffect | undefined {
  if (!effect || !HEAVY_EFFECTS.has(effect)) return effect;
  return el.getElementsByTagName("*").length > max ? "fade" : effect;
}

/**
 * 对元素开启骨架加载态：加根 class、aria-busy、锁定交互。
 * class 被框架重写时会自动补回；重复调用是幂等的。
 *
 * @param el 骨架根元素
 * @param opts
 *   effect：动画效果（写到 x-ske-effect 属性），不写则用默认的 fade（根级 opacity，几乎零成本）；
 *   text：文字骨头模式（写到 x-ske-text 属性）；
 *   maxAnimated：pulse / shimmer 允许的最大元素数，默认 300，超过自动降级成 fade
 * @returns 关闭函数，调用后恢复真实内容
 * @example
 * const off = enable(document.querySelector('#card'), { effect: 'pulse' }); // 元素多时自动降级 fade
 * // 数据到了：
 * off();
 */
export function enable(el: HTMLElement, opts: EnableOptions = {}): () => void {
  const max = opts.maxAnimated ?? MAX_ANIMATED;
  const effect = resolveEffect(el, opts.effect, max);
  if (active.has(el)) {
    if (effect) el.setAttribute("x-ske-effect", effect);
    if (opts.text) el.setAttribute("x-ske-text", opts.text);
    return active.get(el)!;
  }
  el.classList.add(ROOT_CLASS);
  el.setAttribute("aria-busy", "true");
  if (effect) el.setAttribute("x-ske-effect", effect);
  if (opts.text) el.setAttribute("x-ske-text", opts.text);

  // 框架重绘会整体改写 class，这里只盯 class 属性，被清掉就补回
  const observer = new MutationObserver(() => {
    if (!el.classList.contains(ROOT_CLASS)) el.classList.add(ROOT_CLASS);
  });
  observer.observe(el, { attributes: true, attributeFilter: ["class"] });

  // 交互锁：优先原生 inert，不支持时靠 CSS pointer-events + 焦点拦截
  const native = supportsInert();
  if (native) (el as HTMLElement & { inert: boolean }).inert = true;
  else el.addEventListener("focusin", blockFocus, true);

  const off = (): void => {
    observer.disconnect();
    if (native) (el as HTMLElement & { inert: boolean }).inert = false;
    else el.removeEventListener("focusin", blockFocus, true);
    el.classList.remove(ROOT_CLASS);
    el.removeAttribute("aria-busy");
    active.delete(el);
  };
  active.set(el, off);
  return off;
}

/**
 * 关闭元素的骨架加载态；没开启过则什么都不做。
 * @param el 骨架根元素
 * @example disable(document.querySelector('#card'));
 */
export function disable(el: HTMLElement): void {
  const off = active.get(el);
  if (off) off();
}

/** 宿主样式表的单例状态 */
let hostSheet: CSSStyleSheet | null = null;
let hostStyleEl: HTMLStyleElement | null = null;

/**
 * 生成 Web Component 宿主的骨架样式：宿主 visibility:hidden 藏起 shadow 内容，
 * 再用宿主的 ::before 铺一块骨头（宿主自己的背景会被 visibility 一起藏掉，所以借伪元素）。
 * @param tags 带连字符的自定义元素标签名
 * @returns CSS 文本
 */
function buildHostCss(tags: string[]): string {
  if (!tags.length) return "";
  const sel = (suffix = ""): string => tags.map((t) => `.${ROOT_CLASS} ${t}:not([x-ske-ignore])${suffix}`).join(",");
  return `${sel()}{visibility:hidden !important;position:relative}
${sel("::before")}{content:"" !important;visibility:visible !important;position:absolute !important;top:0 !important;right:0 !important;bottom:0 !important;left:0 !important;background:var(--x-ske-color,#d9dde3) !important;border-radius:var(--x-ske-radius,4px) !important}`;
}

/**
 * 扫描文档里的自定义元素，生成宿主骨架样式表（adoptedStyleSheets，不支持时退回 <style>）。
 * 不改任何 DOM 节点；新增的自定义元素可调用 refresh() 或开启 watch 自动重扫。
 *
 * @param root 扫描范围，默认 document
 * @param opts tags：手动补充的标签名；watch：监听 DOM 变化自动重扫
 * @returns refresh 重扫并返回命中的标签名
 * @example
 * const hosts = registerCustomElements(document, { tags: ['sl-button'], watch: true });
 */
export function registerCustomElements(root: Document | ShadowRoot = document, opts: RegisterOptions = {}): { refresh: () => string[]; dispose: () => void } {
  const extra = opts.tags ?? [];
  const doc = ((root as ShadowRoot).ownerDocument ?? root) as Document;
  const refresh = (): string[] => {
    const found = new Set(extra.map((t) => t.toLowerCase()));
    root.querySelectorAll("*").forEach((n) => {
      if (n.localName.includes("-") && n.localName !== SELF_TAG) found.add(n.localName);
    });
    const tags = [...found];
    const css = buildHostCss(tags);
    if ("adoptedStyleSheets" in doc && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
      if (!hostSheet) {
        hostSheet = new CSSStyleSheet();
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, hostSheet];
      }
      hostSheet.replaceSync(css);
    } else {
      if (!hostStyleEl) {
        hostStyleEl = doc.createElement("style");
        hostStyleEl.setAttribute("data-x-ske-hosts", "");
        doc.head.appendChild(hostStyleEl);
      }
      hostStyleEl.textContent = css;
    }
    return tags;
  };
  refresh();

  let observer: MutationObserver | null = null;
  let scheduled = false;
  if (opts.watch) {
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      void Promise.resolve().then((): void => {
        scheduled = false;
        refresh();
      });
    });
    observer.observe((root as Document).documentElement ?? root, { childList: true, subtree: true });
  }

  const dispose = (): void => {
    observer?.disconnect();
    if (hostSheet) {
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== hostSheet);
      hostSheet = null;
    }
    hostStyleEl?.remove();
    hostStyleEl = null;
  };
  return { refresh, dispose };
}
