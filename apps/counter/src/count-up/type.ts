/** 缓动函数签名：输入归一化时间 t(0→1)，输出归一化进度(0→1) */
export type TEasing = (t: number) => number;

export type TCountupFormatter = (value: number) => string;

export type TCountupHook = (task: ICountupTask) => void;

export interface ICountupHooks {
  onUpdate?: (formatted: string, value: number, task: ICountupTask) => any;
  onDone?: TCountupHook;
  onDestory?: TCountupHook;
}

/** 公共参数 */
export interface ICountupBaseOptions {
  once?: boolean,
  /** 懒加载：初始化不入队，由 observer 观测 el，进入视口才入队、离开则移出 */
  lazy?: boolean
  /** 懒加载使用的 IntersectionObserver，缺省用库内共享的默认 observer */
  observer?: IntersectionObserver;
  /**  */
  duration?: number;
  easing?: TEasing;
  /** 更新频率（次/秒），0 表示每帧更新 */
  fps?: number;
  /** 由调用方传入，库内不提供默认实现 */
  formatter?: TCountupFormatter;
  render?: (el: Element, formatted: string) => void;
}

export interface ICountupGroupOptions extends ICountupBaseOptions { }

export interface ICountupTaskOptions {
  el?: Element | string;
  from?: number;
  label?: string;
  to: number;
}

export interface ICountupFullOptions extends ICountupBaseOptions, ICountupHooks, ICountupTaskOptions { }

export interface ICountupTask extends ICountupHooks {
  _index: number
  _active: boolean
  /**累加器 */
  _accum: number;
  _value: number;
  _beginAt: number;
  _nextAt: number
  _interval: number,
  id: number;
  from: number;
  to: number;
  el?: Element;
  label?: string
  lazy: boolean,
  /** 懒加载观测此任务 el 的 observer（仅 lazy 任务持有） */
  observer?: IntersectionObserver;
  once: boolean,
  duration: number;
  easing: TEasing;
  /** 由调用方传入，库内不提供默认实现 */
  fmt: TCountupFormatter;
  render: (el: Element, formatted: string) => void;
}

/** buildCountupFormatter 的包裹选项（prefix/suffix/numerals） */
export interface ICountupFormatterOptions {
  prefix?: string;
  suffix?: string;
}
