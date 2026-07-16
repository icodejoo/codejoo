/**
 * Zero-instrumentation page-side takeover: tracks <img> and data-marked
 * background elements, swaps them to progressive-loading URLs as SW stages arrive.
 *
 * 页面端零改造接管:跟踪 <img> 与打标背景元素,随 SW 阶段推进切换其显示 URL。
 */

import { type PicmanStage, PARAM_BYPASS, isPicmanMessage, stripPicmanParams, withStageParam } from "../shared/protocol";
import type { PicmanErrorContext } from "../shared/types";
import type { PicmanAutoOptions } from "./types";
import { scheduleIdle } from "./idle";
import { _getContainer } from "./messages";
import { createVideoFacade, resolveVideoOptions, type VideoFacade } from "./video";

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
 * Whether an element currently intersects the viewport (best-effort; treats a
 * zero-size layout, as in headless test envs, as visible).
 *
 * 元素当前是否与视口相交(尽力而为;把零尺寸布局——如无头测试环境——视为可见)。
 * @param el - Element to test — 待测元素
 * @returns Whether it is in view — 是否在视口内
 */
function inViewport(el: Element): boolean {
  if (typeof (el as HTMLElement).getBoundingClientRect !== "function" || typeof innerHeight === "undefined") return true;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return true;
  return r.top < innerHeight && r.bottom > 0;
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
  const videos = options.videos ?? false;
  const onError = options.onError ?? (() => {});

  /** Video facade, created only when video takeover is enabled — 仅在启用视频接管时创建的 video facade */
  const videoFacade: VideoFacade | null = videos ? createVideoFacade(resolveVideoOptions({ ...options, onError })) : null;

  /** Canonical URL → tracked elements (weakly held) — 规范化 URL → 被跟踪元素(弱引用) */
  const tracked = new Map<string, Set<WeakRef<Element>>>();
  /** Canonical URL → latest known stage — 规范化 URL → 已知最新阶段 */
  const stageOf = new Map<string, PicmanStage>();

  /** Elements waiting for viewport entry before their full-stage swap — 等待进入视口才切换完整阶段的元素 */
  const pendingFull = new WeakMap<Element, string>();
  /** Shared viewport observer for full-stage gating, lazily created — 完整阶段视口门控共享的观察器,惰性创建 */
  let fullIO: IntersectionObserver | null = null;

  /**
   * Ensure the shared full-stage viewport observer exists.
   *
   * 确保完整阶段共享视口观察器已创建。
   */
  function ensureFullObserver(): void {
    if (fullIO || typeof IntersectionObserver === "undefined") return;
    fullIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        fullIO!.unobserve(e.target);
        const displayUrl = pendingFull.get(e.target);
        if (displayUrl) {
          pendingFull.delete(e.target);
          applyUrl(e.target, displayUrl);
        }
      }
    });
  }

  /**
   * Swap every live tracked element for a URL to the given stage. The full
   * ('1') stage is additionally gated per element on viewport entry: elements
   * outside the viewport keep showing their current preview (thumbnail/first
   * frame) and only get the heavier full content once actually scrolled into
   * view; falls back to an immediate swap where IntersectionObserver is
   * unavailable.
   *
   * 把某 URL 下所有存活的被跟踪元素切换到给定阶段。完整('1')阶段额外做逐元素视口门控:
   * 视口外的元素继续显示当前预览(缩略图/首帧),真正滚入可见区才换上更重的完整内容;
   * IntersectionObserver 不可用时退回立即切换。
   * @param url - Canonical URL — 规范化 URL
   * @param stage - Stage to display — 待展示阶段
   */
  function swapAll(url: string, stage: PicmanStage): void {
    const set = tracked.get(url);
    if (!set) return;
    for (const ref of set) {
      const el = ref.deref();
      if (el) applyStageToElement(el, url, stage);
    }
  }

  /**
   * Apply one stage to one element, with the full-stage viewport gate.
   *
   * 把一个阶段应用到一个元素,带完整阶段的视口门控。
   * @param el - Target element — 目标元素
   * @param url - Canonical URL — 规范化 URL
   * @param stage - Stage to display — 待展示阶段
   */
  function applyStageToElement(el: Element, url: string, stage: PicmanStage): void {
    const displayUrl = withStageParam(url, stage);
    if (stage === "1" && !inViewport(el) && typeof IntersectionObserver !== "undefined") {
      ensureFullObserver();
      pendingFull.set(el, displayUrl);
      fullIO?.observe(el);
    } else {
      pendingFull.delete(el);
      applyUrl(el, displayUrl);
    }
  }

  /**
   * Apply a real (non-placeholder) stage to a URL only once the main thread
   * goes idle (past the LCP) — regardless of whether this stage was learned
   * via a live SW notification or a cache hit, so a repeat-visit's instant
   * cache hit can never win a race against the LCP. Guards against stage
   * regression: if `stage` is `'ff'` but `stageOf` already recorded `'1'` by
   * the time this idle callback runs (its own notification arrived and got
   * scheduled first), skip — never downgrade a page that already shows the
   * full content back to a first-frame placeholder.
   *
   * 只在主线程进入空闲(LCP 之后)才把真实(非占位)阶段应用到某 URL——无论这个阶段是
   * 通过 SW 实时通知还是缓存命中得知,确保重复访问时的瞬间缓存命中永远不会抢在 LCP
   * 前面。同时防止阶段倒退:若 `stage` 是 `'ff'`,但这个空闲回调真正执行时 `stageOf`
   * 已经记录了 `'1'`(它自己的通知先到且先被调度执行了),则跳过——绝不能把已经显示
   * 完整内容的页面倒退回首帧占位。
   * @param url - Canonical URL — 规范化 URL
   * @param stage - Stage to apply once idle — 待应用的阶段(空闲后)
   */
  function applyStageWhenIdle(url: string, stage: PicmanStage): void {
    scheduleIdle(() => {
      if (stage === "ff" && stageOf.get(url) === "1") return;
      stageOf.set(url, stage);
      swapAll(url, stage);
    });
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

  /** URLs already cache-reconciled at least once, to avoid redundant repeat queries — 已做过至少一次缓存对账的 URL,避免重复查询 */
  const reconciled = new Set<string>();

  /**
   * Catch up on a notification that may have been missed between this SW
   * request completing and this page's message listener being registered —
   * the HTML parser's preload scanner fires `<img>` requests independently of
   * script execution order, so a fast-resolving download can finish (and its
   * SW notification arrive) before `auto()` gets a chance to subscribe.
   * Awaits both cache lookups in order, first-frame before complete, for the
   * same LCP-friendly reason as {@link ../page/load.ts}'s reconciliation.
   *
   * 补偿可能在"这次 SW 请求已完成"与"本页面的消息监听器完成注册"之间错过的通知——
   * HTML parser 的预加载扫描器发起 `<img>` 请求独立于脚本执行顺序,一次很快完成的
   * 下载(及其 SW 通知)可能在 `auto()` 有机会订阅之前就已经结束。按顺序 await 两次
   * 缓存查询,先首帧后完整,原因与 {@link ../page/load.ts} 对账逻辑里的 LCP 友好考量一致。
   * @param url - Canonical URL to reconcile — 待对账的规范化 URL
   */
  async function reconcileFromCache(url: string): Promise<void> {
    if (reconciled.has(url) || typeof caches === "undefined") return;
    reconciled.add(url);

    try {
      const ffHit = await caches.match(withStageParam(url, "ff"));
      if (ffHit && !stageOf.has(url)) applyStageWhenIdle(url, "ff");
    } catch {
      // Cache Storage access failing is non-fatal — 访问 Cache Storage 失败不致命
    }

    try {
      const hit = await caches.match(withStageParam(url, "1"));
      if (hit) applyStageWhenIdle(url, "1");
    } catch {
      // Cache Storage access failing is non-fatal — 访问 Cache Storage 失败不致命
    }
  }

  /**
   * Start tracking one element for one (possibly non-canonical) URL; swaps
   * immediately when this URL's stage is already known (missed-notification
   * catch-up — `known` is itself only ever set post-idle by
   * {@link applyStageWhenIdle}, so this "immediate" swap can never happen
   * before the LCP either), and kicks off a cache reconciliation check for
   * URLs not yet known.
   *
   * 开始跟踪一个元素对应的(可能未规范化的)URL;若该 URL 阶段已知则立即切换(补偿错过的
   * 通知——`known` 本身也只会由 {@link applyStageWhenIdle} 在空闲之后才被设置,所以这里
   * 的"立即"切换同样不可能发生在 LCP 之前),并对尚未知晓阶段的 URL 发起一次缓存对账检查。
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
    if (known) {
      applyStageToElement(el, url, known);
    } else {
      void reconcileFromCache(url);
    }
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
    if (videoFacade) {
      node.querySelectorAll?.("video").forEach((v) => videoFacade.track(v as HTMLVideoElement));
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
          if (videoFacade && n.matches("video")) videoFacade.track(n as HTMLVideoElement);
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
      applyStageWhenIdle(url, "ff");
    } else if (e.data.type === "complete") {
      applyStageWhenIdle(url, "1");
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
          if (hit) applyStageWhenIdle(url, "1");
        })
        .catch(() => {});
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    observer.disconnect();
    fullIO?.disconnect();
    fullIO = null;
    document.removeEventListener("visibilitychange", onVisible);
    container?.removeEventListener("message", onMessage);
    videoFacade?.stop();
    tracked.clear();
    stageOf.clear();
    reconciled.clear();
  };
}
