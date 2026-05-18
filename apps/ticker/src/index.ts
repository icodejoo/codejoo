/**
 * @codejoo/ticker —— 唯一入口。
 *
 * 全部 API 从此处统一导出。**不再自动安装任何插件** —— 调用方按需 import
 * 插件工厂后通过 `Ticker.extends(plugin())` 显式安装。
 *
 * 单文件入口 + 命名导出 + 子路径 plugin 工厂，由调用方的 bundler 通过
 * tree-shake 移除未使用的部分。
 *
 * @example
 * import { Ticker, tween, animate, countDown, countUp, ease } from '@codejoo/ticker'
 *
 * Ticker.extends(tween())
 * Ticker.extends(animate())   // animate 运行时依赖 tween
 *
 * const ticker = new Ticker()
 * ticker.to('#box', { left: 200, duration: 800, ease: ease.easeOutCubic })
 */

// ---- 核心 ----
export {
  Ticker,
  TickerTask,
  type ITickerOptions,
  type TickerPlugin,
  type TickerCallback
} from './Ticker'

// ---- 工具与缓动 ----
export {
  ease,
  easeAsymmetricS,
  type TickerEasingFn,
  type AnimateCSSProperties,
  type CSSPropertyKey
} from './TickerHelper'

// ---- tween 插件 ----
export {
  tween,
  type ITweenChain,
  type ITweenConfig,
  type ITweenControl,
  type TweenVars,
  type TweenObjectVars
} from './plugins/tween'

// ---- animate 插件 (运行时依赖 tween) ----
export {
  animate,
  type IAnimateControl,
  type IAnimateOptions
} from './plugins/animate'

// ---- countDown 插件 ----
export {
  countDown,
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
  type ICountDownCallbackParser
} from './plugins/countDown'

// ---- countUp 插件 ----
export {
  countUp,
  buildCountUpFormatter,
  type ICountUpControl,
  type ICountUpOptions,
  type ICountUpFormat
} from './plugins/countUp'
