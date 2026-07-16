/**
 * Shared LCP-friendly scheduling: approximates "past the LCP" by waiting for
 * the main thread to go idle, capped by a timeout so work never stalls
 * indefinitely. Used by both the `<video>` facade and the image progressive-
 * loading paths (load()/auto()) so that upgrading a placeholder/first-frame
 * to heavier real content never competes with the page's LCP candidate.
 *
 * 共享的 LCP 友好调度:用主线程进入空闲来近似"LCP 已过去",受超时上限约束以免
 * 工作被无限期搁置。`<video>` facade 与图片渐进加载路径(load()/auto())共用,
 * 确保把占位符/首帧升级为更重的真实内容这件事,永远不会与页面的 LCP 候选抢资源。
 */

/** Default upper bound (ms) for the idle wait when a caller doesn't specify one — 调用方未指定时的空闲等待默认上限(毫秒) */
export const DEFAULT_IDLE_TIMEOUT = 2000;

/**
 * Schedule work for the next idle period, capped by `timeout`; falls back to
 * `setTimeout` where `requestIdleCallback` is unavailable.
 *
 * 安排下一个空闲期执行工作,受 `timeout` 上限约束;无 `requestIdleCallback` 时退回 `setTimeout`。
 * @param cb - Work to run — 待执行工作
 * @param timeout - Upper bound in ms, default {@link DEFAULT_IDLE_TIMEOUT} — 上限(毫秒),默认 {@link DEFAULT_IDLE_TIMEOUT}
 * @example scheduleIdle(() => swapToRealSource(), 2000)
 */
export function scheduleIdle(cb: () => void, timeout: number = DEFAULT_IDLE_TIMEOUT): void {
  const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  if (typeof ric === "function") ric(cb, { timeout });
  else setTimeout(cb, timeout);
}
