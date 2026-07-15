/**
 * Zero-instrumentation page-side takeover: tracks <img> and data-marked
 * background elements, swaps them to progressive-loading URLs as SW stages arrive.
 *
 * 页面端零改造接管:跟踪 <img> 与打标背景元素,随 SW 阶段推进切换其显示 URL。
 */

import { type PicmanStage, PARAM_BYPASS, isPicmanMessage, stripPicmanParams, withStageParam } from "../shared/protocol";
import type { PicmanErrorContext } from "../shared/types";
import type { PicmanAutoOptions } from "./types";
import { _getContainer } from "./messages";

/** Attribute marking a non-<img> element as a background-image takeover target — 标记非 <img> 元素为背景图接管目标的属性 */
const BG_ATTR = "data-picman-bg";

/**
 * Resolve `raw` (absolute or relative) against the current page and strip
 * any picman marker params, yielding the canonical tracking key.
 *
 * 相对当前页面解析 `raw`(绝对或相对)并剥掉 picman 标记参数,得到规范化跟踪 key。
 * @param raw - Raw URL as seen on the element — 元素上看到的原始 URL
 * @returns Canonical URL — 规范化 URL
 */
function canonicalize(raw: string): string {
  return stripPicmanParams(new URL(raw, location.href).href);
}

/**
 * Apply a display URL to a tracked element (img src or background element style).
 *
 * 把展示 URL 应用到被跟踪的元素(img 的 src,或背景元素的样式)。
 * @param el - Tracked element — 被跟踪的元素
 * @param displayUrl - URL to display — 待展示的 URL
 */
function applyUrl(el: Element, displayUrl: string): void {
  if (el instanceof HTMLImageElement) {
    el.src = displayUrl;
  } else if (el.hasAttribute(BG_ATTR)) {
    (el as HTMLElement).style.backgroundImage = `url(${displayUrl})`;
  }
}

/**
 * Start zero-instrumentation takeover: scans existing elements, observes
 * DOM mutations for new ones, and swaps display URLs as SW stages arrive.
 *
 * 启动零改造接管:扫描既有元素、观察 DOM 变更接管新元素,随 SW 阶段推进切换展示 URL。
 * @param options - Root scope, background takeover toggle, error hook — 扫描根、是否接管背景图、错误钩子
 * @returns Stop function — 停止函数
 * @example
 * const stop = auto({ backgrounds: true })
 * // later
 * stop()
 */
export function auto(options: PicmanAutoOptions = {}): () => void {
  const root = options.root ?? document;
  const backgrounds = options.backgrounds ?? true;
  const onError = options.onError ?? (() => {});

  /** Canonical URL → tracked elements (weakly held) — 规范化 URL → 被跟踪元素(弱引用) */
  const tracked = new Map<string, Set<WeakRef<Element>>>();
  /** Canonical URL → latest known stage — 规范化 URL → 已知最新阶段 */
  const stageOf = new Map<string, PicmanStage>();

  /**
   * Swap every live tracked element for a URL to the given stage.
   *
   * 把某 URL 下所有存活的被跟踪元素切换到给定阶段。
   * @param url - Canonical URL — 规范化 URL
   * @param stage - Stage to display — 待展示阶段
   */
  function swapAll(url: string, stage: PicmanStage): void {
    const set = tracked.get(url);
    if (!set) return;
    const displayUrl = withStageParam(url, stage);
    for (const ref of set) {
      const el = ref.deref();
      if (el) applyUrl(el, displayUrl);
    }
  }

  /**
   * Retry every live tracked element for a URL via network bypass.
   *
   * 让某 URL 下所有存活的被跟踪元素走网络透传重试。
   * @param url - Canonical URL — 规范化 URL
   */
  function retryAll(url: string): void {
    const set = tracked.get(url);
    if (!set) return;
    const u = new URL(url);
    u.searchParams.set(PARAM_BYPASS, "1");
    for (const ref of set) {
      const el = ref.deref();
      if (el) applyUrl(el, u.href);
    }
  }

  /**
   * Start tracking one element for one (possibly non-canonical) URL; swaps
   * immediately when this URL's stage is already known (missed-notification catch-up).
   *
   * 开始跟踪一个元素对应的(可能未规范化的)URL;若该 URL 阶段已知则立即切换(补偿错过的通知)。
   * @param el - Element to track — 待跟踪元素
   * @param rawUrl - URL as seen on the element — 元素上看到的 URL
   */
  function track(el: Element, rawUrl: string): void {
    const url = canonicalize(rawUrl);
    let set = tracked.get(url);
    if (!set) {
      set = new Set();
      tracked.set(url, set);
    }
    set.add(new WeakRef(el));

    const known = stageOf.get(url);
    if (known) applyUrl(el, withStageParam(url, known));
  }

  /**
   * Whether `rawUrl` on `el` is exactly the URL our own last swap produced —
   * used to break the src-mutation feedback loop (setting an attribute to an
   * unchanged value still queues a MutationRecord per the DOM spec).
   *
   * 判断 `el` 上的 `rawUrl` 是否正是我们自己上次切换写入的值——用于打断
   * src 属性变更的反馈回路(按 DOM 规范,即便写入相同值也会入队 MutationRecord)。
   * @param rawUrl - Current URL as seen on the element — 元素当前的 URL
   * @returns Whether this mutation was self-caused — 该变更是否为自我触发
   */
  function isOwnEcho(rawUrl: string): boolean {
    const url = canonicalize(rawUrl);
    if (!tracked.has(url)) return false;
    const known = stageOf.get(url);
    const expected = known ? withStageParam(url, known) : url;
    return rawUrl === expected;
  }

  /**
   * Scan a subtree for trackable <img> and background elements.
   *
   * 扫描子树中可跟踪的 <img> 与背景元素。
   * @param node - Subtree root — 子树根
   */
  function scan(node: ParentNode): void {
    node.querySelectorAll?.("img[src]").forEach((img) => track(img, (img as HTMLImageElement).src));
    if (backgrounds) {
      node.querySelectorAll?.(`[${BG_ATTR}]`).forEach((el) => {
        const v = el.getAttribute(BG_ATTR);
        if (v) track(el, v);
      });
    }
  }

  scan(root);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches("img[src]")) track(n, (n as HTMLImageElement).src);
          if (backgrounds && n.hasAttribute(BG_ATTR)) {
            const v = n.getAttribute(BG_ATTR);
            if (v) track(n, v);
          }
          scan(n);
        });
      } else if (m.type === "attributes") {
        const el = m.target as Element;
        if (m.attributeName === "src" && el instanceof HTMLImageElement && el.src) {
          if (!isOwnEcho(el.src)) track(el, el.src);
        } else if (backgrounds && m.attributeName === BG_ATTR) {
          const v = el.getAttribute(BG_ATTR);
          if (v) track(el, v);
        }
      }
    }
  });
  observer.observe(root as unknown as Node, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", BG_ATTR] });

  const container = _getContainer();
  const onMessage = (e: MessageEvent): void => {
    if (!isPicmanMessage(e.data)) return;
    const { url } = e.data;
    if (e.data.type === "first-frame") {
      stageOf.set(url, "ff");
      swapAll(url, "ff");
    } else if (e.data.type === "complete") {
      stageOf.set(url, "1");
      swapAll(url, "1");
    } else {
      const ctx: PicmanErrorContext = { url, stage: e.data.stage, error: new Error(e.data.message) };
      onError(ctx);
      retryAll(url);
    }
  };
  container?.addEventListener("message", onMessage);

  const onVisible = (): void => {
    if (document.visibilityState !== "visible" || typeof caches === "undefined") return;
    for (const url of tracked.keys()) {
      if (stageOf.get(url) === "1") continue;
      caches
        .match(withStageParam(url, "1"))
        .then((hit) => {
          if (hit) {
            stageOf.set(url, "1");
            swapAll(url, "1");
          }
        })
        .catch(() => {});
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", onVisible);
    container?.removeEventListener("message", onMessage);
    tracked.clear();
    stageOf.clear();
  };
}
