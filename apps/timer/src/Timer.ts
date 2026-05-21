import TimerTask from "./TimerTask"
import { TimerManager } from "./TimerManager"
import {
  buildCountUpFormatter,
  COUNT_DOWN_DEFAULTS,
  COUNT_UP_DEFAULTS,
  CountUpState,
  resolveEl,
  type ICountDownControl,
  type ICountDownOptions,
  type ICountDownTask,
  type ICountUpControl,
  type ICountUpOptions,
  type ICountUpTask,
} from "./TimerHelper"
export { default as TimerTask } from "./TimerTask"

/**
 * Timer 构造选项。
 *
 * @example
 * const timer = new Timer({ interval: 33 }) // ~30fps
 * const timer = new Timer()                  // 不限帧率
 */
export interface ITimerOptions {
  /** 全局帧间隔(ms)，RAF 循环节流。0 = 不限制（跟随原生 RAF ~60fps），33 ≈ 30fps */
  interval?: number
}

export type TimerCallback = (value: string) => void

/**
 * 全局计时器调度器 —— 基于 requestAnimationFrame 的高性能定时引擎。
 *
 * ## 架构
 * - **Timer**：负责 RAF 循环驱动与全局帧率控制，内置 setTimeout/setInterval/setImmediate/countDown/countUp
 * - **TimerManager**：负责任务的存储(桶模式)、增删(O(1))、到期执行
 * - **TimerTask**：单个任务的状态载体
 * - **TimerHelper**：缓动、DOM 工具与 countDown/countUp 的格式化器、解析器等辅助函数
 *
 * ## 与原生 API 的对应关系
 * | Timer 方法    | 原生等价         | 区别                         |
 * |--------------|-----------------|------------------------------|
 * | setTimeout   | setTimeout      | 基于 RAF，精度更高，自动清理     |
 * | setInterval  | setInterval     | 同一 interval 的任务共享桶，开销极低 |
 * | setImmediate | queueMicrotask  | 下一帧立即执行                  |
 *
 * ## pause / resume
 * pause 暂停 RAF 循环但保留所有任务，resume 恢复时自动补偿暂停时长，
 * 任务不会因暂停而"跳帧"。
 *
 * @example
 * const timer = new Timer({ interval: 33 })
 *
 * timer.setTimeout((task) => console.log('1秒后'))    // 默认 1000ms
 * timer.countUp(99999, (text) => console.log(text))   // "99,999.00"
 *
 * // pause / resume
 * timer.pause()
 * timer.resume()
 */
export class Timer {
  /** 全局默认选项，所有实例共享。可在创建实例前修改 */
  declare static defaults: ITimerOptions

  /** Timer 启动时的 performance.now() 基准时间戳 */
  declare beginAt: number
  /** 当前帧相对于 beginAt 的偏移量(ms) */
  declare delta: number
  /** 上次 tick 执行时的 dt 值(ms)，用于全局帧率节流 */
  declare lastTickAt: number
  /** 全局帧间隔(ms)，0 = 不限制（每帧都 tick）。由构造选项 interval 初始化 */
  declare frameInterval: number
  /** 任务管理器实例，所有任务的增删和执行都委托给它 */
  declare manager: TimerManager
  /** 是否处于暂停状态 */
  declare isPaused: boolean
  /** 暂停时刻的 performance.now() 时间戳，resume 时用于计算暂停时长 */
  declare pausedAt: number
  /** 当前 requestAnimationFrame 的 ID，用于 stop()/pause() 时取消 */
  declare private _rafId: number

  constructor(options: ITimerOptions = Timer.defaults) {
    if (options !== Timer.defaults) {
      options = Object.assign({}, Timer.defaults, options)
    }
    this.beginAt = 0
    this.delta = 0
    this.lastTickAt = 0
    this.manager = new TimerManager()
    this.isPaused = false
    this.pausedAt = 0
    this._rafId = 0
    this.frameInterval = options.interval ?? 0
    this.tick = this.tick.bind(this)
    this.start()
  }

  /**
   * 延时执行一次（类似 window.setTimeout，但基于 RAF）。
   *
   * @param callback - 到期回调，签名 (task, ...args)，task 为 TimerTask 实例
   * @param interval - 延时时间(ms)，默认 1000
   * @param args     - 传递给回调的额外参数
   * @returns 任务 ID，可传给 remove() 取消
   */
  setTimeout<A extends any[]>(callback: (task: TimerTask, ...args: A) => void, interval?: number, ...args: A): number {
    return this.manager.add(callback, true, interval, args).id
  }

  /**
   * 周期执行（类似 window.setInterval，但基于 RAF）。
   *
   * 支持三种调用签名：
   * - `setInterval(callback, interval, ...args)` — 指定间隔(ms)
   * - `setInterval(callback, immediate, ...args)` — immediate=true 首帧即执行
   * - `setInterval(callback, { interval, immediate }, ...args)` — 对象配置
   */
  setInterval<A extends any[]>(callback: (task: TimerTask, ...args: A) => void, immediate?: boolean, ...args: A): number
  setInterval<A extends any[]>(callback: (task: TimerTask, ...args: A) => void, interval?: number, ...args: A): number
  setInterval<A extends any[]>(callback: (task: TimerTask, ...args: A) => void, options?: { interval: number; immediate: boolean }, ...args: A): number
  setInterval<A extends any[]>(callback: (task: TimerTask, ...args: A) => void, options?: any, ...args: A): number {
    let interval: number | undefined
    let immediate: boolean | undefined
    if (typeof options === "number") {
      interval = options
    } else if (typeof options === "boolean") {
      immediate = options
    } else if (typeof options === "object") {
      interval = options.interval
      immediate = options.immediate
    }

    const task = this.manager.add(callback, false, interval, args)
    task.immediate = immediate ?? false
    return task.id
  }

  /**
   * 下一帧立即执行一次（interval = 0 的 setTimeout）。
   */
  setImmediate<A extends any[]>(callback: (task: TimerTask, ...args: A) => void, ...args: A): number {
    return this.manager.add(callback, true, 0, args).id
  }

  /**
   * 倒计时。按指定频率回调格式化后的剩余时间字符串，到期自动停止。
   *
   * endAt 基于 Timer 的 dt 参考系（非绝对 performance.now()），
   * 与 task.updateAt 同一参考系，确保 remaining 计算正确。
   *
   * @param duration  - 倒计时总时长(ms)
   * @param callback  - 每 tick 回调，参数为格式化后的剩余时间字符串
   * @param options   - 可选配置（interval、formatter）
   * @returns 控制句柄，可调用 remove() 提前取消
   *
   * @example
   * // 每秒更新（默认 interval=1000）
   * timer.countDown(60000, (text) => {
   *   timerEl.textContent = text     // "00:01:00" → "00:00:59" → ...
   * })
   *
   * // 毫秒精度倒计时（每帧更新）
   * timer.countDown(60000, (text) => {
   *   timerEl.textContent = text
   * }, { interval: 0, formatter: buildHighPerfFormatter('mm:ss.sss') })
   */
  countDown(duration: number, callback: TimerCallback, options: ICountDownOptions = COUNT_DOWN_DEFAULTS): ICountDownControl {
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration > 1e11) throw new Error("duration must be a finite number and less than 1e11")
    if (options !== COUNT_DOWN_DEFAULTS) {
      options = Object.assign({}, COUNT_DOWN_DEFAULTS, options)
    }
    const opts = options as Required<ICountDownOptions>
    const self = this
    const endDt = this.delta + duration

    const base = this.manager.add(
      function (task: ICountDownTask) {
        task.remaining = endDt - task.updateAt
        if (task.remaining <= 0) {
          self.remove(task.id)
        } else {
          callback(opts.formatter(task.remaining))
        }
      },
      false,
      opts.interval,
    )
    const item = base as ICountDownTask
    item.endAt = endDt
    item.remaining = duration

    return {
      get id() {
        return item.id
      },
      remove: () => self.remove(item.id),
    }
  }

  countUp(to: number, callback: TimerCallback): ICountUpControl
  countUp(to: number, options: ICountUpOptions, callback?: TimerCallback): ICountUpControl
  countUp(to: number, options: any, callback?: any): ICountUpControl {
    const methodOpts: ICountUpOptions = typeof options === "function" ? {} : (options ?? {})
    const cb: TimerCallback | null = typeof options === "function" ? options : (callback ?? null)
    const merged = Object.assign({}, COUNT_UP_DEFAULTS, methodOpts)
    // 若用户未显式提供 formatter，按当前 prefix/precision/thousands/decimal/suffix 懒构建
    const opts = Object.assign({}, merged, {
      formatter: merged.formatter ?? buildCountUpFormatter(merged),
    }) as Required<ICountUpOptions>

    const el = resolveEl(opts.el)
    if (el == null && cb == null) throw new Error("el or callback is required")

    const self = this
    const state = new CountUpState(opts.from ?? 0, to)
    const interval = opts.fps > 0 ? ~~(1000 / opts.fps) : 0

    const base = this.manager.add(
      function (task: ICountUpTask) {
        task.progress = state.progress(task.updateAt, opts.duration)
        task.current = state.value(task.progress, opts.easing)

        const text = opts.formatter(task.current)
        if (el) el.textContent = text
        if (cb) cb(text)

        if (task.progress >= 1) self.remove(task.id)
      },
      false,
      interval,
    )
    const item = base as ICountUpTask
    item.progress = 0
    item.current = state.from

    return {
      get id() {
        return item.id
      },
      update(newTo: number) {
        const currentProgress = state.progress(item.updateAt, opts.duration)
        state.retarget(newTo, currentProgress, opts.easing)
      },
      remove: () => self.remove(item.id),
    }
  }

  /**
   * 按 ID 移除任务（透传给 TimerManager.remove）。
   */
  remove(id: number): void {
    this.manager.remove(id)
  }

  /** 当前活跃任务总数 */
  get size(): number {
    return this.manager.size
  }

  /** 是否处于暂停状态 */
  get paused(): boolean {
    return this.isPaused
  }

  /**
   * 启动 RAF 循环（重置时间基准）。构造时自动调用。
   * 与 resume 不同：start 会重置 beginAt，而 resume 会补偿暂停时长。
   */
  start() {
    this.isPaused = false
    this.beginAt = performance.now()
    this._rafId = window.requestAnimationFrame(this.tick)
  }

  /**
   * 完全停止 RAF 循环并重置状态。已注册的任务不会被清除。
   * 再次启动需调用 start()（时间从零计）。
   */
  stop() {
    this.isPaused = false
    window.cancelAnimationFrame(this._rafId)
    this._rafId = 0
  }

  /**
   * 暂停 RAF 循环。任务保留，时间冻结。
   * 恢复调用 resume()，暂停期间的时长不计入 dt。
   * 重复调用无效（已暂停时忽略）。
   */
  pause() {
    if (this.isPaused) return
    this.isPaused = true
    this.pausedAt = performance.now()
    window.cancelAnimationFrame(this._rafId)
  }

  /**
   * 恢复已暂停的 RAF 循环。
   * 自动将 beginAt 向前推移暂停时长，使 dt 从暂停点无缝继续，任务不会"跳帧"。
   * 重复调用无效（未暂停时忽略）。
   */
  resume() {
    if (!this.isPaused) return
    this.isPaused = false
    this.beginAt += performance.now() - this.pausedAt
    this._rafId = window.requestAnimationFrame(this.tick)
  }

  /**
   * RAF 回调 —— 每帧核心逻辑。
   * 1. 计算 dt（相对于 Timer 启动的偏移量，已扣除暂停时长）
   * 2. 全局帧率节流（frameInterval > 0 时跳过过密帧）
   * 3. 委托 manager.tick(dt) 执行到期任务
   * 4. 请求下一帧
   */
  private tick(t: number) {
    const dt = (this.delta = t - this.beginAt)
    if (this.frameInterval > 0 && dt - this.lastTickAt < this.frameInterval) {
      this._rafId = window.requestAnimationFrame(this.tick)
      return
    }
    this.lastTickAt = dt

    this.manager.tick(dt)

    this._rafId = window.requestAnimationFrame(this.tick)
  }
}

// static field 初始化（外部赋值避免 oxc 在 es2015 target 下注入 _defineProperty）
Timer.defaults = { interval: 0 }
