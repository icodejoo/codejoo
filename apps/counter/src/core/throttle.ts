// 限帧网格节流：count-up / count-down 共用，保证同一 fps 在两边节奏一致。

/** 限帧网格容差（ms）：约半个 60Hz vsync，距离网格点不足它就视为到点，避免 vsync 抖动把 30fps 压成 20fps */
export const FPS_TOLERANCE = 8;

/** 带节流状态的任务：interval 为网格间隔（0 = 每帧），nextAt 为下个网格点（0 = 尚未起网格） */
export interface IThrottled {
  interval: number;
  nextAt: number;
}

/**
 * fps 转网格间隔（ms）
 * @param fps 目标帧率；<=0 表示不限帧
 * @returns 间隔毫秒数，不限帧时为 0
 */
export const fpsToInterval = (fps: number): number => (fps > 0 ? 1000 / fps : 0);

/**
 * 判断任务此刻是否到点；到点则把网格推进到下一格（跳过错失的时隙、不补发）
 * @param t 带节流状态的任务
 * @param now 当前时间（ms，须与 nextAt 同一时间源）
 * @returns 0 表示到点应渲染，>0 为距到点还需等待的毫秒数
 */
export function throttle(t: IThrottled, now: number): number {
  if (t.interval <= 0) return 0;
  if (now < t.nextAt - FPS_TOLERANCE) return t.nextAt - FPS_TOLERANCE - now;
  t.nextAt = t.nextAt === 0 ? now + t.interval : t.nextAt + Math.max(1, Math.floor((now - t.nextAt) / t.interval) + 1) * t.interval; // 容差内提前到点也至少前进一格
  return 0;
}

/**
 * 距下个网格点的毫秒数（须在 throttle 返回 0 之后调用）
 * @param t 带节流状态的任务
 * @param now 当前时间（ms）
 */
export const untilNext = (t: IThrottled, now: number): number => t.nextAt - FPS_TOLERANCE - now;
