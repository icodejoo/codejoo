import TimerTask from "./TimerTask"

/**
 * 单个任务条目：把任务、回调、平铺数组中的位置与到期信息打包。
 *
 * - `idx`     是该 entry 在 `_entries` 中的下标，remove 时用于 swap-with-last + pop
 * - `lastTick` 每个任务独立记录的上次执行 dt(ms)，判断到期：`dt - lastTick >= task.interval`
 * - `_epoch`  tick 内去重，防止 swap-pop 让同一 entry 在同一帧被二次执行
 */
interface Entry {
  task: TimerTask
  cb: Function
  idx: number
  lastTick: number
  _epoch: number
}

/**
 * 任务存储与执行管理器 —— **平铺遍历版**。
 *
 * ## 存储结构
 * 全部任务平铺在一个数组 `_entries` 中，按插入顺序排列。
 * 每个 entry 独立维护 `lastTick`，到期判定不再依赖任何分桶。
 *
 * ## 复杂度
 * | 操作   | 复杂度 | 实现方式 |
 * |--------|--------|----------|
 * | add    | O(1)   | Array.push |
 * | remove | O(1)   | Map.get → swap-with-last + pop |
 * | tick   | O(N)   | 倒序遍历 _entries，逐个检查 dt - lastTick >= interval |
 *
 * ## 与 Timer 的关系
 * TimerManager 不涉及 RAF 调度，仅负责任务的增删和按时执行。
 * Timer 持有 TimerManager 实例，每帧调用 manager.tick(dt)。
 *
 * @example
 * const manager = new TimerManager()
 * const task = manager.add((task) => console.log(task.updateAt), true, 1000)
 * manager.tick(1000) // 触发执行
 * manager.remove(task.id)
 */
export class TimerManager {
  /** 任务自增 ID */
  declare private _nextId: number
  /** tick 轮次计数器，每次 tick 递增，用于 entry._epoch 去重 */
  declare private _tickEpoch: number
  /** 所有任务条目的平铺数组（按插入顺序） */
  declare private _entries: Entry[]
  /** taskId → Entry。供 remove 通过 O(1) 直达条目 */
  declare private _taskLookup: Map<number, Entry>

  constructor() {
    this._nextId = 0
    this._tickEpoch = 0
    this._entries = []
    this._taskLookup = new Map<number, Entry>()
  }

  /** 当前活跃任务总数 */
  get size(): number {
    return this._entries.length
  }

  /**
   * 添加任务到平铺数组尾部。
   *
   * @param callback - 任务回调，签名为 callback(task, ...args)，task 始终是首参
   * @param once     - 是否一次性执行。true = 执行后自动移除，false = 持续执行直到手动 remove
   * @param interval - 执行间隔(ms)，默认 1000
   * @param args     - 传递给回调的额外参数，会展开在 task 之后：callback(task, ...args)
   * @returns 创建的 TimerTask 实例，可通过 task.id 后续 remove
   */
  add(callback: Function, once: boolean = true, interval?: number, args?: any[]): TimerTask {
    const task = new TimerTask(this._nextId++, once, interval, args)
    const entry: Entry = {
      task,
      cb: callback,
      idx: this._entries.length,
      lastTick: 0,
      _epoch: 0,
    }
    this._entries.push(entry)
    this._taskLookup.set(task.id, entry)
    return task
  }

  /**
   * 按任务 ID 移除任务。全程 O(1)。
   *
   * 流程：
   * 1. taskLookup.get(id) → 直达 Entry
   * 2. swap-with-last + pop → O(1) 数组内移除（更新被交换条目的 idx）
   *
   * 在 tick 倒序遍历中调用是安全的：swap-pop 只影响当前及更大下标，不影响更小下标。
   */
  remove(id: number): void {
    const entry = this._taskLookup.get(id)
    if (!entry) return
    this._taskLookup.delete(id)

    const entries = this._entries
    const last = entries.length - 1
    if (entry.idx !== last) {
      const tail = entries[last]
      entries[entry.idx] = tail
      tail.idx = entry.idx
    }
    entries.pop()
  }

  /**
   * 平铺遍历所有任务并执行到期者，由 Timer 每帧调用。
   *
   * 执行流程：
   * 1. 倒序遍历 _entries（在迭代中删除当前及更大下标的条目是安全的）
   * 2. 对每个 entry，检查 `dt - entry.lastTick >= task.interval` 是否到期
   * 3. 到期则更新 lastTick 与 task.updateAt，执行回调
   * 4. once 任务在回调执行后自动 remove
   * 5. _epoch 防止 swap-pop 导致同一 entry 在同帧二次执行
   *
   * @param dt - 当前帧相对于 Timer 启动时间的偏移量(ms)
   */
  tick(dt: number): void {
    const entries = this._entries
    const epoch = ++this._tickEpoch
    const idt = ~~dt

    for (let i = entries.length - 1; i >= 0; i--) {
      if (i >= entries.length) continue
      const entry = entries[i]
      if (entry._epoch === epoch) continue

      const task = entry.task
      if (dt - entry.lastTick < task.interval) continue

      entry._epoch = epoch
      entry.lastTick = idt
      task.updateAt = idt

      const args = task.args
      if (args.length === 0) entry.cb(task)
      else entry.cb(task, ...args)

      if (task.once) this.remove(task.id)
    }
  }
}
