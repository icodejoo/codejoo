/**
 * Shared LCP-friendly scheduling. "Past the LCP" is approximated by two
 * signals combined: a real `largest-contentful-paint` PerformanceObserver
 * entry (the page has painted its LCP candidate at least once) AND the main
 * thread going idle — work runs at the later of the two, capped by a timeout
 * so it never stalls indefinitely (e.g. pages that produce no LCP entry).
 * Used by both the `<video>` facade and the image progressive-loading paths
 * (load()/auto()) so that upgrading a placeholder/thumbnail to heavier real
 * content never competes with the page's LCP candidate.
 *
 * 共享的 LCP 友好调度。"LCP 已过去"用两个信号共同近似:真实的
 * `largest-contentful-paint` PerformanceObserver 条目(页面已至少绘制过一次 LCP
 * 候选)**且**主线程进入空闲——工作在两者较晚者执行,并受超时上限兜底(如某些页面
 * 不产生 LCP 条目)。`<video>` facade 与图片渐进加载路径(load()/auto())共用,
 * 确保把占位符/缩略图升级为更重的真实内容,永远不与页面的 LCP 候选抢资源。
 */

/** Default upper bound (ms) for the idle wait when a caller doesn't specify one — 调用方未指定时的空闲等待默认上限(毫秒) */
export const DEFAULT_IDLE_TIMEOUT = 2000;

/** Extra wait (ms) for the LCP entry after idle fires, before the timeout fallback runs the work anyway — idle 触发后额外等待 LCP 条目的时长(毫秒),超过则兜底执行 */
const LCP_EXTRA_WAIT = 1000;

/** Whether a largest-contentful-paint entry has been observed — 是否已观察到 largest-contentful-paint 条目 */
let lcpSeen = false;

// Observe LCP once at module load; `buffered: true` catches entries painted
// before this script ran. Environments that don't SUPPORT the entry type
// (older browsers, test runners — checked via supportedEntryTypes, since some
// of them accept observe() without ever producing an entry) fall back to
// treating LCP as already seen, so the idle signal alone gates the work,
// same as the previous behavior.
//
// 模块加载时注册一次 LCP 观察;`buffered: true` 能补到本脚本运行前已绘制的条目。
// 不**支持**该 entry 类型的环境(旧浏览器、测试运行器——用 supportedEntryTypes 检测,
// 因为其中一些环境 observe() 不抛错但永远不产出条目)退回视为 LCP 已出现,
// 仅由 idle 信号门控,与此前行为一致。
try {
  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("largest-contentful-paint")) {
    new PerformanceObserver(() => {
      lcpSeen = true;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } else {
    lcpSeen = true;
  }
} catch {
  lcpSeen = true;
}

/**
 * Schedule work for after the LCP: waits for the next idle period (capped by
 * `timeout`), then — if no LCP entry has been painted yet — up to
 * {@link LCP_EXTRA_WAIT} more for one before running anyway. Falls back to
 * `setTimeout` where `requestIdleCallback` is unavailable.
 *
 * 把工作安排到 LCP 之后:先等下一个空闲期(受 `timeout` 上限约束),若此时还没有任何
 * LCP 条目被绘制,再至多等 {@link LCP_EXTRA_WAIT} 后兜底执行。无 `requestIdleCallback`
 * 时退回 `setTimeout`。
 * @param cb - Work to run — 待执行工作
 * @param timeout - Idle upper bound in ms, default {@link DEFAULT_IDLE_TIMEOUT} — 空闲等待上限(毫秒),默认 {@link DEFAULT_IDLE_TIMEOUT}
 * @example scheduleIdle(() => swapToRealSource(), 2000)
 */
export function scheduleIdle(cb: () => void, timeout: number = DEFAULT_IDLE_TIMEOUT): void {
  const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  const onIdle = (): void => {
    if (lcpSeen) {
      cb();
      return;
    }
    // Idle arrived before any LCP paint — poll briefly for the entry, then run
    // regardless so work never stalls on pages that never produce one.
    // 空闲先于任何 LCP 绘制到来——短暂轮询等待条目,超时后无论如何执行,
    // 确保在不产生 LCP 条目的页面上也不会卡死。
    const start = Date.now();
    const poll = (): void => {
      if (lcpSeen || Date.now() - start >= LCP_EXTRA_WAIT) cb();
      else setTimeout(poll, 100);
    };
    poll();
  };
  if (typeof ric === "function") ric(onIdle, { timeout });
  else setTimeout(onIdle, timeout);
}

/**
 * Test-only override for the LCP-seen flag.
 *
 * 仅测试用:覆写 LCP 已见标记。
 * @param v - Value to force — 强制设定的值
 */
export function _setLcpSeen(v: boolean): void {
  lcpSeen = v;
}
