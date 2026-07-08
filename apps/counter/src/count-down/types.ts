// ========================= countdown 类型定义 =========================

export type TDateUnit = "day" | "hour" | "minute" | "second" | "ms" | "week" | "month" | "year" | "quarter";

/** add 接受的截止时间：时间戳/时长数字、日期字符串或 Date 对象 */
export type TCountdownDeadline = number | string | Date;

/**
 * 时间解析器：输入截止时间与服务器时差 timeOffset，
 * 输出以客户端时钟为基准的截止时间戳（毫秒）。
 */
export type TDateParser = (value: TCountdownDeadline, timeOffset?: number) => number;

/**
 * 倒计时解析结果 —— 长度为 5 的数字元组 `[d, h, m, s, ms]`（天/时/分/秒/毫秒）。
 *
 * **只读**：解析器为「零分配」复用同一个数组返回。不要跨 tick 持有引用，也不要就地修改；
 * 如需保留或修改，请自行拷贝副本（如 `[...value]`）。
 */
export type TCountdownValue = readonly [d: number, h: number, m: number, s: number, ms: number];

/**
 * 倒计时上下文：作为 fmt / parser / render / on* 的**最后一个参数**统一传入。
 * 任务期内复用同一对象（仅 remaining/value 等逐帧更新），请勿跨帧持有；需保留请自行拷贝字段。
 */
export interface ICountdownContext {
  /** 目标元素 */
  el: Element;
  /** 任务 id */
  id: number;
  /** 截止时间戳（客户端时钟，毫秒） */
  deadline: number;
  /** 当前剩余毫秒（每帧更新） */
  remaining: number;
  /** 解析后的 [d, h, m, s, ms]（每帧更新，复用只读元组） */
  value: TCountdownValue;
  /** 上一次 value 真正变化前的快照（复用只读元组，仅在 value 变化时更新，同 value 一样不要跨帧持有引用） */
  oldValue: TCountdownValue;
  /** 是否已激活（lazy 进入视口后为 true） */
  active: boolean;
  /** 是否暂停中 */
  paused: boolean;
  /** 格式化器（剩余毫秒 → 字符串） */
  fmt: ICountdownFormatter;
  /** 解析器（剩余毫秒 → [d,h,m,s,ms] 元组） */
  parser: TCountdownParser;
}

/** 倒计时格式化器：输入剩余毫秒（+ ctx），输出展示字符串 */
export type ICountdownFormatter = (duration: number, ctx?: ICountdownContext) => string;

/** 倒计时解析器：输入剩余毫秒（+ ctx），输出 [d, h, m, s, ms] 元组（零分配复用、只读） */
export type TCountdownParser = (duration: number, ctx?: ICountdownContext) => TCountdownValue;

/**
 * 倒计时渲染函数。
 * @param el        目标元素
 * @param remaining 当前剩余毫秒
 * @param value     解析后的 [d, h, m, s, ms] 元组（= ctx.value，便于直接取分量）
 * @param ctx       上下文（含 fmt / parser，按需格式化）
 */
export type TCountdownRender = (el: Element, remaining: number, value: TCountdownValue, ctx: ICountdownContext) => void;

/**
 * 有状态渲染器生命周期。引擎在 add() 时调用 mount()，每次变化时调用 update()，remove/clear 时调用 destroy()。
 * mount() 返回的状态对象由引擎持有，透传给后续 update/destroy，渲染器无需自维护 WeakMap。
 */
export interface ICountdownRenderer<S = unknown> {
  /** 预建 DOM，返回状态；lazy 任务在进入视口时调用 */
  mount(el: Element, ctx: ICountdownContext): S;
  /** 按需增量更新 DOM，不应 createElement/appendChild */
  update(state: S, remaining: number, value: TCountdownValue, ctx: ICountdownContext): void;
  /** 断开事件监听、释放引用 */
  destroy(state: S): void;
}

export interface ICountdownOptions {
  /** 服务器时间与客户端时间的差值（server - client，毫秒），用于校正客户端时钟 */
  timeOffset?: number;
  /** 是否显示天数 */
  showDays?: boolean;
  /** 是否显示毫秒（显示毫秒的任务每帧渲染，否则只在秒位变化时渲染） */
  showMilliseconds?: boolean;
  /** 时间解析器，默认 "ms" */
  dateParser?: TDateParser | TDateUnit;
  /** 格式化器，默认 "HH:mm:ss" */
  fmt?: ICountdownFormatter | string;
  /** 解析器：剩余毫秒 → [d, h, m, s, ms] 元组；缺省用内置解析器（按 showDays 决定时/天拆分） */
  parser?: TCountdownParser;
  /** 渲染函数 */
  render?: TCountdownRender | ICountdownRenderer;
  /**
   * 懒加载，默认 true。lazy 且 el 存在时，用 IntersectionObserver 观察 el，
   * 元素首次进入视口才真正开始倒计时（相对时长从那一刻锚定截止时间；绝对时间戳/Date 不变）；
   * lazy:false 则立即开始。
   */
  lazy?: boolean;
  /** 自定义 lazy observer（用 createLazyObserver(opts) 创建），覆盖默认单例以定制触发条件 */
  observer?: IntersectionObserver;
  /** 懒任务超时回收(ms)，>0 时若元素在该时长内仍未进入视口则自动 remove；默认 0=不回收 */
  lazyTimeout?: number;
  /** 倒计时归零时是否自动销毁该任务（出队 + 调用渲染器 destroy + 清引用），默认 true；false 则保留实例停在 0 */
  autoKill?: boolean;
}

export interface ICountdownGroup {
  config?: ICountdownOptions;
  /** id -> task 映射，保证按 id 删除为 O(1) */
  queue: Map<number, ICountdownTask>;
}

export interface ICountdownTaskOptions extends ICountdownOptions, IHooks {
  /** 分组标签，默认 "default" */
  label?: string;
}

export interface ICountdownTask extends IHooks {
  /** 元素 */
  el: Element;
  /** 截止时间戳（客户端时钟，毫秒），剩余时间 = deadline - Date.now()。lazy 未激活时为 0（占位） */
  deadline: number;
  /** 是否已激活：false 表示 lazy 任务尚未进入视口，tick 会跳过它 */
  active: boolean;
  /** 是否已触发过 onStart（保证首帧只触发一次） */
  started: boolean;
  /** 是否暂停：暂停期 tick 跳过且不计 busy */
  paused: boolean;
  /** 暂停时记录的剩余毫秒（resume 时按它重锚 deadline） */
  frozen: number;
  /** lazy 观察的取消函数（移除/清空时断开 observer，未进入视口前避免泄漏） */
  cancel?: () => void;
  /** 上次渲染的秒数，用于非毫秒任务跳过同一秒内的重复渲染 */
  last: number;
  /** 是否每帧渲染毫秒 */
  showMs: boolean;
  /** 倒计时格式化函数 */
  fmt: ICountdownFormatter;
  /** 倒计时解析函数 */
  parser: TCountdownParser;
  /** 渲染函数 */
  render: TCountdownRender;
  /** 有状态渲染器绑定（undefined=函数渲染，null=未 mount 的 lazy 生命周期，otherwise=已 mount） */
  renderBound?: { update(r: number, v: TCountdownValue, ctx: ICountdownContext): void; destroy(): void } | null;
  /** 归零时是否自动销毁，默认 true */
  autoKill: boolean;
  /** 已归零并保留（autoKill:false）：tick 跳过，不再重绘/重触 onDone */
  done?: boolean;
  /** 复用的上下文（最后一个参数传给 fmt/parser/render/on*） */
  ctx: ICountdownContext;
}

interface IHooks {
  /** 任务真正开始（非 lazy：add 时；lazy：进入视口时）首帧触发一次 */
  onStart?: (remaining: number, ctx: ICountdownContext) => void;
  onUpdate?: (remaining: number, ctx: ICountdownContext) => void;
  onDone?: (remaining: number, ctx: ICountdownContext) => void;
  /** clear() 销毁任务时触发（remove() 只断开 observer/释放渲染器引用，不触发此钩子） */
  onDestroy?: (remaining: number, ctx: ICountdownContext) => void;
  /** 暂停 / 恢复（pause/resume 时触发） */
  onPause?: (remaining: number, ctx: ICountdownContext) => void;
  onResume?: (remaining: number, ctx: ICountdownContext) => void;
}
