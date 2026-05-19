import { Ticker, type TickerPlugin } from '../Ticker'
import {
  ease,
  isElement,
  parseTarget,
  readCurrentValue,
  resolveEl,
  TRANSFORM_PROPS,
  getTransformCache,
  composeTransform,
  type AnimateCSSProperties,
  type TickerEasingFn
} from '../TickerHelper'

// ========================= 类型定义 =========================

export interface ITweenConfig {
  /** 动画时长(ms)，默认 500 */
  duration?: number
  /** 缓动函数，默认 easeInOutQuad */
  ease?: TickerEasingFn
  /** 延迟启动(ms)，默认 0 */
  delay?: number
  /** 重复次数。0=播一次，1=播两次，-1=无限循环。默认 0 */
  repeat?: number
  /** 重复时反向播放（乒乓效果），默认 false */
  yoyo?: boolean
  /** 帧率限制，0 = 每帧更新 */
  fps?: number
  /** 动画开始时触发（delay 结束后首帧） */
  onStart?: () => void
  /** 每帧更新后触发 */
  onUpdate?: (tween: ITweenControl) => void
  /** 动画完成时触发，chain 参数可直接对同一目标发起下一段动画 */
  onComplete?: (chain: ITweenChain) => void
  /** 每次重复开始时触发 */
  onRepeat?: () => void
}

/** GSAP 风格 vars：配置项 + CSS 属性混写 */
export type TweenVars = ITweenConfig & AnimateCSSProperties

/** GSAP 风格 vars：配置项 + 对象属性混写（自动推导 key） */
export type TweenObjectVars<T> = ITweenConfig & Partial<Record<keyof T & string, number | string>>

/**
 * 链式助手，绑定了同一目标，用于在 onComplete 中串联动画形成时间轴。
 *
 * @example
 * ticker.to('#box', {
 *   left: 200, duration: 500,
 *   onComplete: (chain) => {
 *     chain.to({ top: 100, duration: 300, onComplete: (chain) => {
 *       chain.to({ opacity: 0, duration: 200 })
 *     }})
 *   }
 * })
 */
export interface ITweenChain {
  to(vars: TweenVars & Record<string, any>): ITweenControl
  from(vars: TweenVars & Record<string, any>): ITweenControl
  fromTo(fromVars: Record<string, number | string>, toVars: TweenVars & Record<string, any>): ITweenControl
}

/**
 * Tween 控制句柄，支持 GSAP 风格的播放控制。
 *
 * @example
 * const tw = ticker.to('#box', { left: 200, duration: 800 })
 * tw.pause()
 * tw.reverse()
 * tw.seek(0.5)
 * tw.kill()
 */
export interface ITweenControl {
  readonly id: number
  /** 当前进度 0→1（单次迭代内） */
  readonly progress: number
  /** 是否正在播放（非暂停、非完成、非销毁） */
  readonly isActive: boolean
  play(): ITweenControl
  pause(): ITweenControl
  reverse(): ITweenControl
  restart(): ITweenControl
  /** 跳到指定进度 0→1 并立即渲染 */
  seek(progress: number): ITweenControl
  kill(): void
}

// ========================= 内部常量与类型 =========================

const RESERVED_KEYS = new Set([
  'duration', 'ease', 'easing', 'delay', 'repeat', 'yoyo', 'fps',
  'onStart', 'onUpdate', 'onComplete', 'onRepeat'
])

const DEFAULT_CONFIG: Required<ITweenConfig> = {
  duration: 500,
  ease: ease.easeInOutQuad,
  delay: 0,
  repeat: 0,
  yoyo: false,
  fps: 0,
  onStart: () => {},
  onUpdate: () => {},
  onComplete: (() => {}) as (chain: ITweenChain) => void,
  onRepeat: () => {}
}

interface TweenTrack {
  prop: string
  from: number
  to: number
  unit: string
  isCSS: boolean
  /** transform 简写属性对应的 CSS 函数名（如 'translateX'），undefined 表示普通属性 */
  transformFn?: string
}

interface ITweenTask {
  updateAt: number
  id: number
  interval: number
  immediate: boolean
  once: boolean
  args: any[]
}

// ========================= Vars 解析 =========================

function extractVars(vars: Record<string, any>): {
  config: Required<ITweenConfig>
  props: Record<string, number | string>
} {
  const config: any = Object.assign({}, DEFAULT_CONFIG)
  const props: Record<string, number | string> = {}

  for (const key of Object.keys(vars)) {
    if (RESERVED_KEYS.has(key)) {
      const cfgKey = key === 'easing' ? 'ease' : key
      config[cfgKey] = vars[key]
    } else {
      props[key] = vars[key]
    }
  }

  return { config, props }
}

// ========================= 轨道构建 =========================

function resolveTarget(target: string | Element | Record<string, any>) {
  const el = isElement(target) ? resolveEl(target) as HTMLElement | null : null
  const obj = isElement(target) ? null : target as Record<string, any>
  if (isElement(target) && !el) throw new Error('tween: target element not found')
  return { el, obj }
}

function getTransformFn(prop: string, isCSS: boolean): string | undefined {
  return isCSS ? TRANSFORM_PROPS[prop]?.fn : undefined
}

type TrackMode = 'to' | 'from' | 'fromTo'

/**
 * 统一 track 构建器。
 * - to:     from = current,    to = props[prop]
 * - from:   from = props[prop], to = current
 * - fromTo: from = fromProps,   to = toProps（fromProps 通过 fromVars 传入；props 即 toProps）
 */
function buildTracks(
  mode: TrackMode,
  props: Record<string, number | string>,
  el: HTMLElement | null,
  obj: Record<string, any> | null,
  fromVars?: Record<string, number | string>
): TweenTrack[] {
  const tracks: TweenTrack[] = []
  const computed = el ? getComputedStyle(el) : null
  const isCSS = !!el
  const propNames = mode === 'fromTo' ? new Set([...Object.keys(fromVars!), ...Object.keys(props)]) : Object.keys(props)

  for (const prop of propNames) {
    const cur = readCurrentValue(prop, el, obj, computed)
    let from: number, to: number, unit: string
    if (mode === 'to') {
      const tgt = parseTarget(props[prop], cur.value)
      from = cur.value; to = tgt.to; unit = tgt.unit || cur.unit
    } else if (mode === 'from') {
      const spec = parseTarget(props[prop], cur.value)
      from = spec.to; to = cur.value; unit = spec.unit || cur.unit
    } else {
      const f = prop in fromVars! ? parseTarget(fromVars![prop], cur.value) : { to: cur.value, unit: '' }
      const t = prop in props ? parseTarget(props[prop], cur.value) : { to: cur.value, unit: '' }
      from = f.to; to = t.to; unit = t.unit || f.unit || cur.unit
    }
    tracks.push({ prop, from, to, unit, isCSS, transformFn: getTransformFn(prop, isCSS) })
  }
  return tracks
}

// ========================= 值渲染 =========================

function renderTracks(
  tracks: TweenTrack[],
  progress: number,
  easing: TickerEasingFn,
  el: HTMLElement | null,
  obj: Record<string, any> | null
): void {
  const ep = easing(progress)
  let hasTransform = false
  const cache = el ? getTransformCache(el) : null

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]
    const v = t.from + (t.to - t.from) * ep

    if (t.transformFn) {
      cache![t.prop] = v
      hasTransform = true
    } else if (t.isCSS) {
      (el!.style as any)[t.prop] = t.unit ? v + t.unit : String(v)
    } else {
      obj![t.prop] = v
    }
  }

  if (hasTransform) el!.style.transform = composeTransform(cache!)
}

function renderExact(
  tracks: TweenTrack[],
  pos: 'from' | 'to',
  el: HTMLElement | null,
  obj: Record<string, any> | null
): void {
  let hasTransform = false
  const cache = el ? getTransformCache(el) : null

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]
    const v = pos === 'from' ? t.from : t.to

    if (t.transformFn) {
      cache![t.prop] = v
      hasTransform = true
    } else if (t.isCSS) {
      (el!.style as any)[t.prop] = t.unit ? v + t.unit : String(v)
    } else {
      obj![t.prop] = v
    }
  }

  if (hasTransform) el!.style.transform = composeTransform(cache!)
}

// ========================= Tween 类 =========================

/**
 * 内部 Tween 实现。通过 ticker.to/from/fromTo 创建，不直接 new。
 *
 * 时间模型：
 * - _phBase + (currentDt - _dtBase) × _direction = playhead（ms）
 * - playhead < 0 → delay 阶段
 * - 0 ≤ playhead ≤ totalDuration → 动画进行中
 * - playhead ≥ totalDuration → 完成
 *
 * 每次 pause/reverse/seek/restart 都执行 snapshot：
 * 将当前 playhead 保存到 _phBase，重置 _dtBase，
 * 下次 tick 从保存点无缝继续。
 */
class Tween implements ITweenControl {
  declare private _ticker: Ticker
  declare private _taskId: number
  declare private _tracks: TweenTrack[]
  declare private _el: HTMLElement | null
  declare private _obj: Record<string, any> | null
  declare private _cfg: Required<ITweenConfig>

  declare private _phBase: number
  declare private _dtBase: number
  declare private _lastDt: number
  declare private _direction: number
  declare private _iteration: number
  declare private _progress: number
  declare private _paused: boolean
  declare private _started: boolean
  declare private _completed: boolean
  declare private _killed: boolean

  constructor(
    ticker: Ticker,
    el: HTMLElement | null,
    obj: Record<string, any> | null,
    tracks: TweenTrack[],
    config: Required<ITweenConfig>
  ) {
    this._ticker = ticker
    this._taskId = -1
    this._el = el
    this._obj = obj
    this._tracks = tracks
    this._cfg = config
    this._phBase = -config.delay
    this._dtBase = -1
    this._lastDt = 0
    this._direction = 1
    this._iteration = 0
    this._progress = 0
    this._paused = false
    this._started = false
    this._completed = false
    this._killed = false
    this._addTask()
  }

  private _addTask() {
    const interval = this._cfg.fps > 0 ? ~~(1000 / this._cfg.fps) : 0
    const self = this
    const task = this._ticker.manager.add(
      function (t: ITweenTask) { self._tick(t.updateAt) },
      false,
      interval
    )
    this._taskId = task.id
  }

  private get _totalDuration(): number {
    const { duration, repeat } = this._cfg
    return repeat < 0 ? Infinity : duration * (repeat + 1)
  }

  private get _playhead(): number {
    if (this._dtBase < 0) return this._phBase
    return this._phBase + (this._lastDt - this._dtBase) * this._direction
  }

  private _snapshot() {
    this._phBase = this._playhead
    this._dtBase = -1
  }

  private _tick(dt: number) {
    if (this._paused || this._completed || this._killed) return

    if (this._dtBase < 0) this._dtBase = dt
    this._lastDt = dt

    const ph = this._playhead

    if (ph < 0) return

    if (!this._started) {
      this._started = true
      this._cfg.onStart()
    }

    const { duration, repeat, yoyo } = this._cfg
    const totalDur = this._totalDuration
    const clamped = Math.max(0, Math.min(ph, totalDur === Infinity ? ph : totalDur))

    let iterProgress: number
    if (duration <= 0) {
      iterProgress = 1
    } else if (clamped >= totalDur && totalDur !== Infinity) {
      iterProgress = yoyo && (repeat + 1) % 2 === 0 ? 0 : 1
    } else {
      const iter = Math.min(Math.floor(clamped / duration), repeat < 0 ? Infinity : repeat)

      if (iter > this._iteration) {
        this._iteration = iter
        this._cfg.onRepeat()
      }

      iterProgress = (clamped % duration) / duration
      if (yoyo && iter % 2 === 1) iterProgress = 1 - iterProgress
    }

    renderTracks(this._tracks, iterProgress, this._cfg.ease, this._el, this._obj)
    this._progress = iterProgress
    this._cfg.onUpdate(this)

    if (totalDur !== Infinity && ph >= totalDur) {
      this._completed = true
      this._ticker.remove(this._taskId)
      this._cfg.onComplete(this._createChain())
    }
  }

  /** 创建绑定同一目标的链式助手 */
  private _createChain(): ITweenChain {
    const ticker = this._ticker
    const target: string | Element | Record<string, any> = (this._el ?? this._obj)!
    return {
      to(vars) {
        const { config, props } = extractVars(vars)
        const { el, obj } = resolveTarget(target)
        return new Tween(ticker, el, obj, buildTracks('to', props, el, obj), config)
      },
      from(vars) {
        const { config, props } = extractVars(vars)
        const { el, obj } = resolveTarget(target)
        const tracks = buildTracks('from', props, el, obj)
        renderExact(tracks, 'from', el, obj)
        return new Tween(ticker, el, obj, tracks, config)
      },
      fromTo(fromVars, toVars) {
        const { config, props: toProps } = extractVars(toVars)
        const { el, obj } = resolveTarget(target)
        const tracks = buildTracks('fromTo', toProps, el, obj, fromVars)
        renderExact(tracks, 'from', el, obj)
        return new Tween(ticker, el, obj, tracks, config)
      }
    }
  }

  // ---- Public API ----

  get id() { return this._taskId }
  get progress() { return this._progress }
  get isActive() { return !this._completed && !this._paused && !this._killed }

  play(): ITweenControl {
    if (this._killed) return this
    if (this._completed) return this.restart()
    this._paused = false
    this._dtBase = -1
    return this
  }

  pause(): ITweenControl {
    if (this._killed || this._completed) return this
    this._snapshot()
    this._paused = true
    return this
  }

  reverse(): ITweenControl {
    if (this._killed) return this
    this._snapshot()
    this._direction *= -1
    this._paused = false
    if (this._completed) {
      this._completed = false
      this._addTask()
    }
    return this
  }

  restart(): ITweenControl {
    if (this._killed) return this
    this._phBase = -this._cfg.delay
    this._dtBase = -1
    this._direction = 1
    this._iteration = 0
    this._progress = 0
    this._started = false
    this._paused = false
    if (this._completed) {
      this._completed = false
      this._addTask()
    }
    return this
  }

  seek(progress: number): ITweenControl {
    if (this._killed) return this
    const p = Math.max(0, Math.min(progress, 1))
    const totalDur = this._totalDuration
    this._phBase = totalDur === Infinity ? p * this._cfg.duration : p * totalDur
    this._dtBase = -1
    renderTracks(this._tracks, p, this._cfg.ease, this._el, this._obj)
    this._progress = p
    return this
  }

  kill(): void {
    if (this._killed) return
    this._killed = true
    this._ticker.remove(this._taskId)
  }
}

// ========================= 插件工厂 =========================

/**
 * Tween 插件工厂。注册后为 Ticker 实例添加 `to`、`from`、`fromTo` 方法。
 *
 * @example
 * import { Ticker } from './Ticker'
 * import { tween } from './TickerTween'
 *
 * Ticker.extend(tween())
 * const ticker = new Ticker()
 *
 * // to — 从当前值动画到目标值（最常用）
 * const tw = ticker.to('#box', { left: 200, opacity: 0.5, duration: 800, ease: ease.easeOutCubic })
 * tw.pause()
 * tw.reverse()
 *
 * // from — 从指定值动画回到当前值
 * ticker.from('.modal', { opacity: 0, top: '-=30', duration: 300 })
 *
 * // fromTo — 明确指定起止值
 * ticker.fromTo(pos, { x: 0 }, { x: 100, duration: 1000, repeat: -1, yoyo: true })
 */
export function tween(): TickerPlugin {
  return {
    name: 'tween',
    install(clazz: typeof Ticker) {

      clazz.prototype.to = function (
        target: string | Element | Record<string, any>,
        vars: Record<string, any>
      ): ITweenControl {
        const { config, props } = extractVars(vars)
        const { el, obj } = resolveTarget(target)
        const tracks = buildTracks('to', props, el, obj)
        return new Tween(this, el, obj, tracks, config)
      }

      clazz.prototype.from = function (
        target: string | Element | Record<string, any>,
        vars: Record<string, any>
      ): ITweenControl {
        const { config, props } = extractVars(vars)
        const { el, obj } = resolveTarget(target)
        const tracks = buildTracks('from', props, el, obj)
        renderExact(tracks, 'from', el, obj)
        return new Tween(this, el, obj, tracks, config)
      }

      clazz.prototype.fromTo = function (
        target: string | Element | Record<string, any>,
        fromVars: Record<string, number | string>,
        toVars: Record<string, any>
      ): ITweenControl {
        const { config, props: toProps } = extractVars(toVars)
        const { el, obj } = resolveTarget(target)
        const tracks = buildTracks('fromTo', toProps, el, obj, fromVars)
        renderExact(tracks, 'from', el, obj)
        return new Tween(this, el, obj, tracks, config)
      }
    }
  }
}

// ========================= Module Augmentation =========================

declare module '../Ticker' {
  interface Ticker {
    /** 从当前值动画到目标值 */
    to(target: string | Element, vars: TweenVars): ITweenControl
    to<T extends Record<string, any>>(target: T, vars: TweenObjectVars<T>): ITweenControl

    /** 从指定值动画回到当前值（立即渲染初始值） */
    from(target: string | Element, vars: TweenVars): ITweenControl
    from<T extends Record<string, any>>(target: T, vars: TweenObjectVars<T>): ITweenControl

    /** 明确指定起止值动画（立即渲染 from 值） */
    fromTo(target: string | Element, fromVars: AnimateCSSProperties, toVars: TweenVars): ITweenControl
    fromTo<T extends Record<string, any>>(target: T, fromVars: Partial<Record<keyof T & string, number | string>>, toVars: TweenObjectVars<T>): ITweenControl
  }
}
