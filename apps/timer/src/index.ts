/**
 * @codejoo/timer —— 唯一入口。
 *
 * 基于 requestAnimationFrame 的高性能定时引擎，全部 API 内置：
 * setTimeout / setInterval / setImmediate / countDown / countUp。
 *
 * @example
 * import { Timer, ease, buildHighPerfFormatter } from '@codejoo/timer'
 *
 * const timer = new Timer()
 *
 * timer.setInterval(task => console.log(task.updateAt), 1000)
 * timer.countDown(60_000, txt => el.textContent = txt)
 * timer.countUp(99999, { prefix: '$' }, txt => el.textContent = txt)
 */

// ---- 核心 ----
export { Timer, TimerTask, type ITimerOptions, type TimerCallback } from "./Timer"

// ---- 分组化快捷入口 ----
export { Counter } from "./Counter"

// ---- 辅助：缓动、countDown/countUp 格式化器与类型 ----
export {
  ease,
  easeAsymmetricS,
  type TimerEasingFn,
  // countDown
  buildHighPerfFormatter,
  buildCountDownFormatter,
  createCountDownParser,
  type ICountDownControl,
  type ICountDownOptions,
  type ICountDownFormatter,
  type TCountDownObjectResult,
  type TCountDownArrayResult,
  type TCountDownCallbackResult,
  type ICountDownObjectParser,
  type ICountDownArrayParser,
  type ICountDownCallbackParser,
  // countUp
  buildCountUpFormatter,
  type ICountUpControl,
  type ICountUpOptions,
  type ICountUpFormat,
} from "./TimerHelper"
