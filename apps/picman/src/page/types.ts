/**
 * Public option types for the page-side entry.
 *
 * 页面端入口的公共配置类型。
 */

import type { PicmanErrorContext } from "../shared/types";

/**
 * Options for page-side auto takeover.
 *
 * 页面端零改造接管配置。
 */
export interface PicmanAutoOptions {
  /** Scan root, default document — 扫描根节点,默认 document */
  root?: ParentNode;

  /** Take over CSS backgrounds too, default true — 是否接管 CSS 背景,默认 true */
  backgrounds?: boolean;

  /**
   * Take over `<video>` elements with the cover-placeholder facade, default
   * false (opt-in — it changes autoplay/preload behavior). See {@link video}.
   *
   * 用封面占位 facade 接管 `<video>`,默认 false(opt-in——会改变 autoplay/preload 行为)。见 {@link video}。
   */
  videos?: boolean;

  /**
   * When a tracked `<video>` has no `poster`, try to grab a real first frame
   * off the critical path to use as the cover; default true. False keeps only
   * the instant color-block cover. Requires same-origin or CORS-enabled video.
   *
   * 被跟踪的 `<video>` 无 `poster` 时,是否在关键路径之外尝试抓取真实首帧作封面;默认 true。
   * 关闭则只用即时色块封面。需同源或视频开启 CORS。
   */
  videoFrame?: boolean;

  /** Range bytes fetched when grabbing a video first frame, default 262144 — 抓视频首帧时请求的 Range 字节数,默认 262144 */
  videoRangeBytes?: number;

  /**
   * How autoplay videos are released:
   * - `'after-lcp'` (default): defer eager loading, then restore + autoplay
   *   once the main thread goes idle (past LCP), capped by {@link videoAutoplayDelay}.
   * - `'immediate'`: do not manage autoplay videos (they play right away).
   * - `false`: even autoplay videos wait for a user gesture / `.play()`.
   *
   * autoplay 视频的放行方式:
   * - `'after-lcp'`(默认):先延迟贪婪加载,待主线程空闲(LCP 之后,受 {@link videoAutoplayDelay} 上限约束)再还原并自动播放。
   * - `'immediate'`:不接管 autoplay 视频(立即播放)。
   * - `false`:autoplay 视频也等用户手势 / `.play()`。
   */
  videoAutoplay?: "after-lcp" | "immediate" | false;

  /** Upper bound (ms) for the after-lcp autoplay idle wait, default 2000 — after-lcp 自动播放 idle 等待的上限(毫秒),默认 2000 */
  videoAutoplayDelay?: number;

  /** Error hook — 错误钩子 */
  onError?: (ctx: PicmanErrorContext) => void;
}
