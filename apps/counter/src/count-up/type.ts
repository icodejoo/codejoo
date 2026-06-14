/** 缓动函数签名：输入归一化时间 t(0→1)，输出归一化进度(0→1) */
export type TEasing = (t: number) => number;

export type TCountupFormatter = (value: number, ctx?: ICountupRenderContext) => string;

/**
 * 上下文：作为 fmt / render / on* 的**最后一个参数**统一传入。
 * 任务期内复用同一对象（仅 value 逐帧变化），请勿跨帧持有；需保留请自行拷贝字段。
 */
export interface ICountupRenderContext {
  /** 当前原始数值（格式化前） */
  value: number;
  /** 本次动画起始值 */
  from: number;
  /** 本次动画目标值 */
  to: number;
  /** 数值格式化器（可用它精确格式化 from/to，无需猜测宽度） */
  fmt: TCountupFormatter;
  /** 目标元素（无 el 的任务为 undefined） */
  el?: Element;
  /** 任务 id */
  id: number;
  /** 是否已激活（lazy 任务进入视口后为 true） */
  active: boolean;
  /** 是否暂停中 */
  paused: boolean;
}

/**
 * 渲染函数。
 * @param el     目标元素
 * @param value  当前原始数值（= ctx.value）；需要字符串时用 `ctx.fmt(value)` **按需**格式化
 * @param ctx    上下文
 *
 * 注：不再预先格式化——避免不需要字符串的渲染器（如里程表）每帧白算 Intl 格式化。
 */
export type TCountupRender = (el: Element, value: number, ctx: ICountupRenderContext) => void;

export type TCountupHook = (value: number, ctx: ICountupRenderContext) => void;

export interface ICountupHooks {
  /** 任务真正开始（非 lazy：add 时；lazy：进入视口时）首帧触发一次 */
  onStart?: TCountupHook;
  onUpdate?: TCountupHook;
  onDone?: TCountupHook;
  /** 暂停 / 恢复（pause/resume 时触发） */
  onPause?: TCountupHook;
  onResume?: TCountupHook;
}

/** 公共参数 */
export interface ICountupBaseOptions {
  /** 动画时长（毫秒），默认 1000 */
  duration?: number;
  easing?: TEasing;
  /** 更新频率（次/秒），0 表示每帧更新 */
  fps?: number;
  /** 数值格式化器，默认 Intl.NumberFormat */
  fmt?: TCountupFormatter;
  render?: TCountupRender;
  /**
   * 懒加载，默认 true。lazy 且提供了 el 时，用 IntersectionObserver 观察 el，
   * 元素首次进入视口才真正开始计数（从那一刻起锚定动画计时）；无 el 或 lazy:false 则立即开始。
   */
  lazy?: boolean;
  /** 自定义 lazy observer（用 createLazyObserver(opts) 创建），覆盖默认单例以定制触发条件 */
  observer?: IntersectionObserver;
  /** 懒任务超时回收(ms)，>0 时若元素在该时长内仍未进入视口则自动 remove；默认 0=不回收 */
  lazyTimeout?: number;
}

export interface ICountupGroupOptions extends ICountupBaseOptions {}

export interface ICountupGroup {
  config?: ICountupGroupOptions;
  /** id -> task 映射，保证按 id 删除为 O(1) */
  queue: Map<number, ICountupTask>;
}

export interface ICountupTaskOptions {
  el?: Element | string;
  from?: number;
  label?: string;
  to: number;
}

export interface ICountupFullOptions extends ICountupBaseOptions, ICountupHooks, ICountupTaskOptions {}

export interface ICountupTask extends Required<Omit<ICountupTaskOptions, "el">>, Required<Omit<ICountupBaseOptions, "observer">>, ICountupHooks {
  el?: Element;
  id: number;
  value: number;
  startAt: number;
  accum: number;
  /** 预算的节流间隔(ms)：fps>0 时 = (1000/fps)|0，否则 0；建任务/重定时算一次，热路径只读 */
  interval: number;
  /** 是否已激活：false 表示 lazy 任务尚未进入视口，tick 会跳过它 */
  active: boolean;
  /** 是否暂停：暂停期 tick 跳过且不计 busy */
  paused: boolean;
  /** 暂停时刻的 RAF 时间戳（用于 resume 时按暂停时长平移 startAt，保持进度不跳变） */
  pausedElapsed: number;
  /** 标记：下一帧需补偿暂停时长 */
  resuming: boolean;
  /** lazy 观察的取消函数（移除/清空时断开 observer，未进入视口前避免泄漏） */
  cancel?: () => void;
  /** 复用的上下文（最后一个参数传给 fmt/render/on*） */
  ctx: ICountupRenderContext;
}

/** buildCountupFormatter 的包裹选项（prefix/suffix） */
export interface ICountupFormatterOptions {
  prefix?: string;
  suffix?: string;
}
