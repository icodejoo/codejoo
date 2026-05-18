import TickerTask from './TickerTask'
import { TickerManager } from './TickerManager'
export { default as TickerTask } from './TickerTask'

export interface TickerPlugin {
  name: string
  install(clazz: typeof Ticker): void
}

/**
 * Ticker 构造选项。
 *
 * @example
 * const ticker = new Ticker({ frameInterval: 33 }) // ~30fps
 * const ticker = new Ticker()                       // 不限帧率
 */
export interface ITickerOptions {
  /** 全局帧间隔(ms)，RAF 循环节流。0 = 不限制（跟随原生 RAF ~60fps），33 ≈ 30fps */
  interval?: number
}

export type TickerCallback = (value: string) => void

/**
 * 全局计时器调度器 —— 基于 requestAnimationFrame 的高性能定时引擎。
 *
 * ## 架构
 * - **Ticker**：负责 RAF 循环驱动与全局帧率控制
 * - **TickerManager**：负责任务的存储(桶模式)、增删(O(1))、到期执行
 * - **TickerTask**：单个任务的状态载体
 *
 * ## 与原生 API 的对应关系
 * | Ticker 方法    | 原生等价         | 区别                         |
 * |---------------|-----------------|------------------------------|
 * | setTimeout    | setTimeout      | 基于 RAF，精度更高，自动清理     |
 * | setInterval   | setInterval     | 同一 interval 的任务共享桶，开销极低 |
 * | setImmediate  | queueMicrotask  | 下一帧立即执行                  |
 *
 * ## pause / resume
 * pause 暂停 RAF 循环但保留所有任务，resume 恢复时自动补偿暂停时长，
 * 任务不会因暂停而"跳帧"。
 *
 * @example
 * const ticker = new Ticker({ frameInterval: 33 })
 *
 * ticker.setTimeout((task) => console.log('1秒后'))    // 默认 1000ms
 * ticker.countUp(99999, (text) => console.log(text))   // "₱99,999.00"
 *
 * // pause / resume
 * ticker.pause()   // 暂停（任务保留，时间冻结）
 * ticker.resume()  // 恢复（时间从暂停点继续）
 */
export class Ticker {
  /** 全局默认选项，所有实例共享。可在创建实例前修改 */
  declare static defaults: ITickerOptions

  /**
   * 已安装插件名列表。每个类（含子类）维护各自的列表，
   * 互不干扰，便于隔离测试。
   */
  declare static _plugins: string[]

  /** 当前已安装的插件名列表（只读副本） */
  static get installedPlugins(): readonly string[] {
    // 子类访问继承的 _plugins 时若未独立初始化，则在此 lazy 复制一份
    if (!Object.prototype.hasOwnProperty.call(this, '_plugins')) {
      this._plugins = (this._plugins ?? []).slice()
    }
    return this._plugins.slice()
  }

  /**
   * 安装插件。同一插件可多次调用，仅以名称登记。
   * 在子类上调用时只影响子类，不污染父类。
   *
   * @example
   * import { tween } from '@codejoo/ticker/plugins/tween'
   * Ticker.extends(tween())
   */
  static extends(plugin: TickerPlugin): typeof Ticker {
    if (!Object.prototype.hasOwnProperty.call(this, '_plugins')) {
      this._plugins = (this._plugins ?? []).slice()
    }
    this._plugins.push(plugin.name)
    plugin.install(this)
    return this
  }

  /** @deprecated 请使用 {@link Ticker.extends}，本别名仅为兼容。 */
  static extend(plugin: TickerPlugin): typeof Ticker {
    return this.extends(plugin)
  }

  /** Ticker 启动时的 performance.now() 基准时间戳 */
  declare beginAt: number
  /** 当前帧相对于 beginAt 的偏移量(ms) */
  declare delta: number
  /** 上次 tick 执行时的 dt 值(ms)，用于全局帧率节流 */
  declare lastTickAt: number
  /** 全局帧间隔(ms)，0 = 不限制（每帧都 tick）。由构造选项 frameInterval 初始化 */
  declare frameInterval: number
  /** 任务管理器实例，所有任务的增删和执行都委托给它 */
  declare manager: TickerManager
  /** 是否处于暂停状态 */
  declare isPaused: boolean
  /** 暂停时刻的 performance.now() 时间戳，resume 时用于计算暂停时长 */
  declare pausedAt: number
  /** 当前 requestAnimationFrame 的 ID，用于 stop()/pause() 时取消 */
  declare private _rafId: number

  /**
   * 创建 Ticker 实例并立即启动 RAF 循环。
   *
   * @param options - 配置选项，会与 Ticker.defaults 合并
   *
   * @example
   * // 限制帧间隔 33ms (~30fps)
   * const ticker = new Ticker({ frameInterval: 33 })
   *
   * // 不限帧率（默认）
   * const ticker = new Ticker()
   */
  constructor(options: ITickerOptions = Ticker.defaults) {
    if (options !== Ticker.defaults) {
      options = Object.assign({}, Ticker.defaults, options)
    }
    this.beginAt = 0
    this.delta = 0
    this.lastTickAt = 0
    this.manager = new TickerManager()
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
   * @param callback - 到期回调，签名 (task, ...args)，task 为 TickerTask 实例
   * @param interval - 延时时间(ms)，默认 1000
   * @param args     - 传递给回调的额外参数
   * @returns 任务 ID，可传给 remove() 取消
   *
   * @example
   * ticker.setTimeout((task) => console.log('done'), 2000)
   * ticker.setTimeout((task) => console.log('1秒后'))  // 默认 1000ms
   */
  setTimeout<A extends any[]>(callback: (task: TickerTask, ...args: A) => void, interval?: number, ...args: A): number {
    return this.manager.add(callback, true, interval, args).id
  }

  /**
   * 周期执行（类似 window.setInterval，但基于 RAF）。
   *
   * 支持三种调用签名：
   * - `setInterval(callback, interval, ...args)` — 指定间隔(ms)
   * - `setInterval(callback, immediate, ...args)` — immediate=true 首帧即执行
   * - `setInterval(callback, { interval, immediate }, ...args)` — 对象配置
   *
   * @param callback - 周期回调，签名 (task, ...args)
   * @param options  - 间隔(ms) | 是否立即执行(boolean) | 配置对象
   * @param args     - 传递给回调的额外参数
   * @returns 任务 ID，可传给 remove() 停止
   *
   * @example
   * // 每秒执行
   * const id = ticker.setInterval((task) => {
   *   console.log(task.updateAt)
   * }, 1000)
   *
   * // 首帧立即执行 + 默认 1000ms 间隔
   * ticker.setInterval(callback, true)
   *
   * // 停止
   * ticker.remove(id)
   */
  setInterval<A extends any[]>(callback: (task: TickerTask, ...args: A) => void, immediate?: boolean, ...args: A): number
  setInterval<A extends any[]>(callback: (task: TickerTask, ...args: A) => void, interval?: number, ...args: A): number
  setInterval<A extends any[]>(callback: (task: TickerTask, ...args: A) => void, options?: { interval: number; immediate: boolean }, ...args: A): number
  setInterval<A extends any[]>(callback: (task: TickerTask, ...args: A) => void, options?: any, ...args: A): number {
    let interval: number | undefined
    let immediate: boolean | undefined
    if (typeof options === 'number') {
      interval = options
    } else if (typeof options === 'boolean') {
      immediate = options
    } else if (typeof options === 'object') {
      interval = options.interval
      immediate = options.immediate
    }

    const task = this.manager.add(callback, false, interval, args)
    task.immediate = immediate ?? false
    return task.id
  }

  /**
   * 下一帧立即执行一次（interval = 0 的 setTimeout）。
   *
   * @param callback - 回调函数，签名 (task, ...args)
   * @param args     - 传递给回调的额外参数
   * @returns 任务 ID
   *
   * @example
   * ticker.setImmediate((task) => console.log('下一帧执行'))
   */
  setImmediate<A extends any[]>(callback: (task: TickerTask, ...args: A) => void, ...args: A): number {
    return this.manager.add(callback, true, 0, args).id
  }

  /**
   * 按 ID 移除任务（透传给 TickerManager.remove）。
   *
   * @param id - 任务 ID（setTimeout/setInterval/countDown 的返回值）
   *
   * @example
   * const id = ticker.setInterval(callback, 1000)
   * ticker.remove(id)
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
   *
   * @example
   * ticker.stop()   // 完全停止
   * ticker.start()  // 重新开始（时间从零计）
   */
  start() {
    this.isPaused = false
    this.beginAt = performance.now()
    this._rafId = window.requestAnimationFrame(this.tick)
  }

  /**
   * 完全停止 RAF 循环并重置状态。已注册的任务不会被清除。
   * 再次启动需调用 start()（时间从零计）。
   *
   * @example
   * ticker.stop()
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
   *
   * @example
   * ticker.pause()             // 暂停
   * // ... 用户切换标签页 ...
   * ticker.resume()            // 恢复，任务从暂停点继续
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
   *
   * @example
   * ticker.pause()
   * // 暂停了 5 秒
   * ticker.resume()  // beginAt += 5000，dt 从暂停时的值继续
   */
  resume() {
    if (!this.isPaused) return
    this.isPaused = false
    this.beginAt += performance.now() - this.pausedAt
    this._rafId = window.requestAnimationFrame(this.tick)
  }

  on(event: 'tick' | 'start' | 'stop' | 'pause' | 'resume' | 'complete', callback: (dt: number) => void): void {}

  /**
   * RAF 回调 —— 每帧核心逻辑。
   * 1. 计算 dt（相对于 Ticker 启动的偏移量，已扣除暂停时长）
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
Ticker.defaults = { interval: 0 }
Ticker._plugins = []
