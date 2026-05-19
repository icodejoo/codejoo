import TickerTask from './TickerTask'

/**
 * 桶条目：将任务、回调、桶内索引打包在一起。
 * bi 字段用于 swap-with-last + pop 的 O(1) 移除定位。
 * _epoch 用于 tick 内去重，防止 swap 导致同帧重复执行。
 */
interface BucketEntry {
  /** 任务实例 */
  task: TickerTask
  /** 任务回调函数，签名为 callback(task, ...args) */
  cb: Function
  /** 该 entry 在所属桶数组中的索引，remove 时通过此字段 O(1) 定位 */
  bi: number
  /** 上次被 tick 执行时的 epoch，防止 swap-with-last 导致同帧二次执行 */
  _epoch: number
}

/**
 * 任务存储与执行管理器 —— 桶模式调度核心。
 *
 * ## 存储结构
 * 以 interval(ms) 为 key 对任务分桶，相同执行频率的任务归入同一桶。
 * 维护 bucketKeys / bucketBuckets / bucketLastTicks 三个平行数组：
 * 同一索引 ki 对应同一桶的 (interval, entries, lastTickDt)，tick 热路径只需数组下标访问。
 *
 * ## 复杂度
 * | 操作   | 复杂度 | 实现方式 |
 * |--------|--------|----------|
 * | add    | O(1)   | Map.get + Array.push |
 * | remove | O(1)   | Map.get → swap-with-last + pop |
 * | tick   | O(K+N) | K = 活跃 interval 数, N = 本帧到期任务数；无 Map 查找 |
 *
 * ## 与 Ticker 的关系
 * TickerManager 不涉及 RAF 调度，仅负责任务的增删和按时执行。
 * Ticker 持有 TickerManager 实例，每帧调用 manager.tick(dt)。
 *
 * @example
 * // 通常不直接使用，而是通过 Ticker 间接操作
 * const manager = new TickerManager()
 * const task = manager.add((task) => console.log(task.updateAt), true, 1000)
 * manager.tick(1000) // 触发执行
 * manager.remove(task.id)
 */
export class TickerManager {
  /** 当前活跃任务总数 */
  declare private _size: number
  /** 任务 ID 自增计数器 */
  declare private _nextId: number
  /** tick 轮次计数器，每次 tick 递增，用于 entry._epoch 去重 */
  declare private _tickEpoch: number

  /** 活跃 interval 值列表。tick 时遍历此数组决定哪些桶需要执行 */
  declare private _bucketKeys: number[]
  /** 与 _bucketKeys 平行：每个 interval 对应的桶。tick 通过下标直达，无 Map 查找 */
  declare private _bucketBuckets: BucketEntry[][]
  /** 与 _bucketKeys 平行：每个桶上次执行时的 dt(ms)。判断到期：dt - lastTick >= interval */
  declare private _bucketLastTicks: number[]
  /** interval → 在 _bucketKeys 中的下标。add 时定位现有桶、remove 时回收空桶用 */
  declare private _bucketKeyIndex: Map<number, number>
  /** taskId → BucketEntry。O(1) 由任务 ID 直达桶条目，供 remove 使用 */
  declare private _taskLookup: Map<number, BucketEntry>

  constructor() {
    this._size = 0
    this._nextId = 0
    this._tickEpoch = 0
    this._bucketKeys = []
    this._bucketBuckets = []
    this._bucketLastTicks = []
    this._bucketKeyIndex = new Map<number, number>()
    this._taskLookup = new Map<number, BucketEntry>()
  }

  /** 当前活跃任务总数 */
  get size(): number {
    return this._size
  }

  /**
   * 添加任务到对应 interval 的桶中。
   *
   * @param callback - 任务回调，签名为 callback(task, ...args)，task 始终是首参
   * @param once     - 是否一次性执行。true = 执行后自动移除，false = 持续执行直到手动 remove
   * @param interval - 执行间隔(ms)，默认 1000。相同 interval 的任务共享同一个桶
   * @param args     - 传递给回调的额外参数，会展开在 task 之后：callback(task, ...args)
   * @returns 创建的 TickerTask 实例，可通过 task.id 后续 remove
   *
   * @example
   * const task = manager.add(
   *   (task, x, y) => console.log(x + y, task.id),
   *   false,  // 持续执行
   *   2000,   // 每 2 秒
   *   [1, 2]  // 额外参数
   * )
   */
  add(callback: Function, once: boolean = true, interval?: number, args?: any[]): TickerTask {
    const task = new TickerTask(this._nextId++, once, interval, args)
    const iv = task.interval

    let ki = this._bucketKeyIndex.get(iv)
    let bucket: BucketEntry[]
    if (ki === undefined) {
      ki = this._bucketKeys.length
      bucket = []
      this._bucketKeys.push(iv)
      this._bucketBuckets.push(bucket)
      this._bucketLastTicks.push(0)
      this._bucketKeyIndex.set(iv, ki)
    } else {
      bucket = this._bucketBuckets[ki]
    }
    const entry: BucketEntry = { task, cb: callback, bi: bucket.length, _epoch: 0 }
    bucket.push(entry)
    this._taskLookup.set(task.id, entry)
    this._size++
    return task
  }

  /**
   * 按任务 ID 移除任务。全程 O(1)。
   *
   * 内部流程：
   * 1. taskLookup.get(id) → 直达 BucketEntry
   * 2. 桶内 swap-with-last + pop → O(1) 移除（更新被交换条目的 bi）
   * 3. 若桶清空 → 三个平行数组同步 swap-with-last + pop → 回收空桶
   *
   * 在 tick 倒序遍历中调用是安全的：swap-pop 只影响当前及更大下标，不影响更小下标。
   *
   * @param id - 要移除的任务 ID（task.id）
   */
  remove(id: number): void {
    const entry = this._taskLookup.get(id)
    if (!entry) return
    this._taskLookup.delete(id)

    const interval = entry.task.interval
    const ki = this._bucketKeyIndex.get(interval)!
    const bucket = this._bucketBuckets[ki]

    // swap-with-last + pop：O(1) 桶内移除
    const last = bucket.length - 1
    if (entry.bi !== last) {
      const tail = bucket[last]
      bucket[entry.bi] = tail
      tail.bi = entry.bi
    }
    bucket.pop()

    // 空桶回收：三个平行数组同步 swap-with-last + pop
    if (bucket.length === 0) {
      const lastKi = this._bucketKeys.length - 1
      if (ki !== lastKi) {
        const tailInterval = this._bucketKeys[lastKi]
        this._bucketKeys[ki] = tailInterval
        this._bucketBuckets[ki] = this._bucketBuckets[lastKi]
        this._bucketLastTicks[ki] = this._bucketLastTicks[lastKi]
        this._bucketKeyIndex.set(tailInterval, ki)
      }
      this._bucketKeys.pop()
      this._bucketBuckets.pop()
      this._bucketLastTicks.pop()
      this._bucketKeyIndex.delete(interval)
    }
    this._size--
  }

  /**
   * 遍历所有到期桶并执行其中的任务，由 Ticker 每帧调用。
   *
   * 执行流程：
   * 1. 倒序遍历 bucketKeys（保证当前桶自删 key 时不影响更小下标）
   * 2. 对每个 interval，检查 dt - lastTick >= interval 是否到期
   * 3. 到期则更新 lastTick，倒序遍历桶内任务并执行回调
   * 4. once 任务在回调执行后自动 remove
   *
   * @param dt - 当前帧相对于 Ticker 启动时间的偏移量(ms)
   */
  tick(dt: number): void {
    const keys = this._bucketKeys
    const buckets = this._bucketBuckets
    const lastTicks = this._bucketLastTicks
    const epoch = ++this._tickEpoch
    const idt = ~~dt

    for (let ki = keys.length - 1; ki >= 0; ki--) {
      if (ki >= keys.length) continue
      const interval = keys[ki]
      if (dt - lastTicks[ki] < interval) continue
      lastTicks[ki] = idt

      const bucket = buckets[ki]
      for (let i = bucket.length - 1; i >= 0; i--) {
        if (i >= bucket.length) continue
        const entry = bucket[i]
        if (entry._epoch === epoch) continue
        entry._epoch = epoch
        const task = entry.task
        task.updateAt = idt
        const args = task.args
        // 无 args 时走快路径，避免 spread 分配
        if (args.length === 0) entry.cb(task)
        else entry.cb(task, ...args)
        if (task.once) this.remove(task.id)
      }
    }
  }
}
