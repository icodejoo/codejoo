/**
 * 计时器任务基类，承载单个调度任务的全部状态。
 *
 * 由 {@link TimerManager.add} 内部创建，外部不应直接 new。
 * 所有时间字段单位均为毫秒(ms)。
 *
 * 字段全部用 `declare` 声明 + constructor 内赋值，
 * 避免 es2015 target 下 oxc 把字段声明编译成 `Object.defineProperty(this, "x", void 0)`
 * 的开销与 helper 注入。
 *
 * @example
 * // 通过 Timer 间接创建（推荐）
 * const id = timer.setTimeout((task) => {
 *   console.log(task.id, task.updateAt)
 * }, 2000)
 *
 * // 在回调中访问任务状态
 * timer.setInterval((task) => {
 *   const elapsed = task.updateAt - task.beginAt
 *   console.log(`已运行 ${elapsed}ms`)
 * }, 1000)
 */
export default class TimerTask {
  /** 任务唯一标识，由 TimerManager 的自增计数器分配 */
  declare id: number;
  /** 执行间隔(ms)，同一 interval 的任务会被归入同一个桶 */
  declare interval: number;
  /** 任务创建时的时间戳(ms)，取自 performance.now() */
  declare beginAt: number;
  /** 最近一次被执行时的 dt 值(ms)，初始为 0 表示尚未执行过 */
  declare updateAt: number;
  /** 任务结束时间(ms)，用于 countDown 等有截止时间的场景，默认 0 表示无截止 */
  declare endAt: number;
  /** 传递给回调的额外参数，回调签名为 callback(task, ...args) */
  declare args: any[];
  /** 是否为一次性任务。true = 执行一次后自动移除（setTimeout），false = 持续执行（setInterval） */
  declare once: boolean;
  /** 是否在添加后的第一个 tick 立即执行，而不等待首个 interval 周期 */
  declare immediate: boolean;

  /**
   * @param id       - 任务唯一 ID，由 TimerManager 提供
   * @param once     - 是否一次性执行，默认 true
   * @param interval - 执行间隔(ms)，默认 1000
   * @param args     - 传递给回调的额外参数
   */
  constructor(id: number, once: boolean = true, interval: number = 1000, args?: any[]) {
    this.id = id;
    this.interval = interval;
    this.beginAt = ~~performance.now();
    this.updateAt = 0;
    this.endAt = 0;
    this.args = args ?? [];
    this.once = once;
    this.immediate = false;
  }
}
