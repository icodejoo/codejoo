/**
 * Animate 插件 —— jQuery 风格属性动画。
 *
 * **运行时依赖 tween 插件**：内部通过 `this.to(...)` 调用，因此调用方必须先安装 tween。
 * 如果未先安装 tween，调用 `ticker.animate(...)` 会在运行时抛出 `TypeError: this.to is not a function`。
 *
 * @example
 * import { Ticker } from '@codejoo/ticker'
 * import { tween } from '@codejoo/ticker/plugins/tween'
 * import { animate } from '@codejoo/ticker/plugins/animate'
 *
 * Ticker.extends(tween())     // ← 必须先装 tween
 * Ticker.extends(animate())
 */
import { Ticker, type TickerPlugin } from '../Ticker'
import { ease, type AnimateCSSProperties, type TickerEasingFn } from '../TickerHelper'
import type { ITweenChain, ITweenControl } from './tween'

// ========================= 类型定义 =========================

export interface IAnimateOptions {
  /** 动画时长(ms)，默认 400 */
  duration?: number
  /** 缓动函数，默认 easeInOutQuad */
  easing?: TickerEasingFn
  /** 每帧整体进度回调：(0→1 进度, 剩余ms) */
  progress?: (progress: number, remaining: number) => void
  /** 动画完成回调，chain 参数可对同一目标串联下一段动画 */
  complete?: (chain: ITweenChain) => void
  /** 帧率限制，0 = 每帧更新 */
  fps?: number
}

/**
 * animate 控制句柄。
 *
 * @example
 * const ctrl = ticker.animate('#box', { left: 200, top: 100 }, 500)
 * ctrl.stop()       // 立即停止（保留当前位置）
 * ctrl.stop(true)   // 跳到终态并触发 complete
 */
export interface IAnimateControl {
  readonly id: number
  stop(jumpToEnd?: boolean): void
}

// ========================= 参数重载解析 =========================

const noop = () => {}

const DEFAULTS: Required<IAnimateOptions> = {
  duration: 400,
  easing: ease.easeInOutQuad,
  progress: noop as any,
  complete: noop as any,
  fps: 0
}

/**
 * 解析 jQuery 风格的可变参数：
 * - (options)
 * - (duration)
 * - (duration, complete)
 * - (duration, easing, complete)
 */
function resolveArgs(args: any[]): Required<IAnimateOptions> {
  const first = args[0]

  if (typeof first === 'object' && first !== null && !(first instanceof Function)) {
    return Object.assign({}, DEFAULTS, first) as Required<IAnimateOptions>
  }

  const opts = Object.assign({}, DEFAULTS) as Required<IAnimateOptions>
  if (typeof first === 'number') opts.duration = first

  const second = args[1]
  const third = args[2]

  if (typeof second === 'function' && third === undefined) {
    opts.complete = second
  } else if (typeof second === 'function' && typeof third === 'function') {
    opts.easing = second
    opts.complete = third
  }

  return opts
}

// ========================= 插件 =========================

/**
 * animate 插件工厂。jQuery 风格的属性动画，内部委托给 Tween 引擎。
 *
 * @example
 * ticker.animate('#box', { left: 200, opacity: 0.5 }, 500)
 * ticker.animate(el, { left: '+=100' }, { duration: 300, easing: ease.easeOutCubic })
 * ticker.animate(obj, { x: 100 }, 800, () => console.log('done'))
 */
export function animate(): TickerPlugin {
  return {
    name: 'animate',
    install(clazz: typeof Ticker) {
      clazz.prototype.animate = function (
        target: string | Element | Record<string, any>,
        properties: Record<string, number | string>,
        ...rest: any[]
      ): IAnimateControl {
        const opts = resolveArgs(rest)

        const tw: ITweenControl = this.to(target as any, Object.assign({}, properties, {
          duration: opts.duration,
          ease: opts.easing,
          fps: opts.fps,
          onUpdate: (t: ITweenControl) => {
            opts.progress(t.progress, Math.max(opts.duration - t.progress * opts.duration, 0))
          },
          onComplete: (chain: ITweenChain) => opts.complete(chain)
        }))

        return {
          get id() { return tw.id },
          stop(jumpToEnd = false) {
            if (jumpToEnd) tw.seek(1).kill()
            else tw.kill()
          }
        }
      }
    }
  }
}

// ========================= Module Augmentation =========================

declare module '../Ticker' {
  interface Ticker {
    animate(target: string | Element, properties: AnimateCSSProperties): IAnimateControl
    animate(target: string | Element, properties: AnimateCSSProperties, duration: number): IAnimateControl
    animate(target: string | Element, properties: AnimateCSSProperties, options: IAnimateOptions): IAnimateControl
    animate(target: string | Element, properties: AnimateCSSProperties, duration: number, complete: () => void): IAnimateControl
    animate(target: string | Element, properties: AnimateCSSProperties, duration: number, easing: TickerEasingFn, complete: () => void): IAnimateControl

    animate<T extends Record<string, any>>(target: T, properties: Partial<Record<keyof T & string, number | string>>): IAnimateControl
    animate<T extends Record<string, any>>(target: T, properties: Partial<Record<keyof T & string, number | string>>, duration: number): IAnimateControl
    animate<T extends Record<string, any>>(target: T, properties: Partial<Record<keyof T & string, number | string>>, options: IAnimateOptions): IAnimateControl
    animate<T extends Record<string, any>>(target: T, properties: Partial<Record<keyof T & string, number | string>>, duration: number, complete: () => void): IAnimateControl
    animate<T extends Record<string, any>>(target: T, properties: Partial<Record<keyof T & string, number | string>>, duration: number, easing: TickerEasingFn, complete: () => void): IAnimateControl
  }
}
