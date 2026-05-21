import { Timer, type TimerCallback } from "./Timer"
import type { ICountDownControl, ICountDownOptions, ICountUpControl, ICountUpOptions } from "./TimerHelper"

/**
 * 分组化的快捷计时器入口。
 *
 * 每个 `label` 维护一个独立的 {@link Timer} 实例（按需懒创建）：
 * - `Counter.countdown(duration, label, callback, options?)` —— 与 {@link Timer.countDown}
 *   参数一致，只是在 callback 前插入了 label。若 label 对应的分组不存在则新建一个新的
 *   Timer，存在则复用已有 Timer 追加任务。
 * - `Counter.countup(to, label, options?, callback?)` —— {@link Timer.countUp} 的分组版本。
 * - `Counter.clearCountdown(label?)` / `Counter.clearCountup(label?)` —— 停止并释放指定分组；
 *   若不传 label 则清空全部 countdown/countup 分组。
 * - `Counter.resetCountdown()` / `Counter.resetCountup()` —— 清空全部分组（等价于不传 label 的 clear）。
 *
 * @example
 * // 同一 label 复用 Timer：两个 task 共用一条 RAF 循环
 * Counter.countdown(60_000, 'cart', txt => cartEl.textContent = txt)
 * Counter.countdown(30_000, 'cart', txt => freeShipEl.textContent = txt)
 *
 * // 新 label 新建独立 Timer
 * Counter.countup(99999, 'wallet', { prefix: '$' }, txt => walletEl.textContent = txt)
 *
 * Counter.clearCountdown('cart')   // 停止并释放 'cart' 分组
 * Counter.resetCountup()           // 释放所有 countup 分组
 */
export abstract class Counter {
  /** label → 该分组使用的 Timer 实例 */
  declare private static _countdownGroups: Map<string, Timer>
  /** label → 该分组使用的 Timer 实例 */
  declare private static _countupGroups: Map<string, Timer>

  /**
   * 在指定分组中创建一个倒计时任务。
   *
   * @param duration  倒计时总时长(ms)
   * @param label     分组标签；不存在则新建该分组的 Timer，存在则复用
   * @param callback  每 tick 回调，参数为格式化后的剩余时间字符串
   * @param options   可选配置（interval、formatter），透传给 Timer.countDown
   * @returns         任务控制句柄，与 `Timer.countDown` 返回值一致
   */
  static countdown(duration: number, label: string, callback: TimerCallback, options?: ICountDownOptions): ICountDownControl {
    const timer = Counter._getOrCreate(Counter._countdownGroups, label)
    return timer.countDown(duration, callback, options)
  }

  /**
   * 在指定分组中创建一个数字滚动任务。
   *
   * @param to        目标数字
   * @param label     分组标签；不存在则新建，存在则复用
   * @param callback  回调；或在 options 形式下作为第四参数
   * @returns         任务控制句柄，与 `Timer.countUp` 返回值一致
   */
  static countup(to: number, label: string, callback: TimerCallback): ICountUpControl
  static countup(to: number, label: string, options: ICountUpOptions, callback?: TimerCallback): ICountUpControl
  static countup(to: number, label: string, options: any, callback?: any): ICountUpControl {
    const timer = Counter._getOrCreate(Counter._countupGroups, label)
    return timer.countUp(to, options, callback)
  }

  /**
   * 释放指定 countdown 分组（停止其 Timer 并从分组表中删除）。
   * 不传 label 时释放所有 countdown 分组。
   */
  static clearCountdown(label?: string): void {
    Counter._clear(Counter._countdownGroups, label)
  }

  /**
   * 释放指定 countup 分组。不传 label 时释放所有 countup 分组。
   */
  static clearCountup(label?: string): void {
    Counter._clear(Counter._countupGroups, label)
  }

  /** 释放所有 countdown 分组（等价于 `clearCountdown()` 不传 label） */
  static resetCountdown(): void {
    Counter._clear(Counter._countdownGroups)
  }

  /** 释放所有 countup 分组（等价于 `clearCountup()` 不传 label） */
  static resetCountup(): void {
    Counter._clear(Counter._countupGroups)
  }

  /** 查询指定分组是否已存在（主要供测试与调试使用） */
  static hasCountdown(label: string): boolean {
    return Counter._countdownGroups.has(label)
  }

  /** 查询指定分组是否已存在（主要供测试与调试使用） */
  static hasCountup(label: string): boolean {
    return Counter._countupGroups.has(label)
  }

  private static _getOrCreate(map: Map<string, Timer>, label: string): Timer {
    let timer = map.get(label)
    if (!timer) {
      timer = new Timer()
      map.set(label, timer)
    }
    return timer
  }

  private static _clear(map: Map<string, Timer>, label?: string): void {
    if (label === undefined) {
      for (const t of map.values()) t.stop()
      map.clear()
      return
    }
    const t = map.get(label)
    if (!t) return
    t.stop()
    map.delete(label)
  }
}

// static field 初始化（外部赋值避免 oxc 在 es2015 target 下注入 _defineProperty）
Counter["_countdownGroups"] = new Map()
Counter["_countupGroups"] = new Map()
