/** 缓动函数签名：输入归一化时间 t(0→1)，输出归一化进度(0→1) */
export type TEasing = (t: number) => number;

export type TCountupFormatter = (value: number) => string;

export type TCountupHook = (value: number) => void;

export interface ICountupHooks {
  onUpdate?: TCountupHook;
  onDone?: TCountupHook;
}

/** 公共参数 */
export interface ICountupBaseOptions {
  /**  */
  duration?: number;
  easing?: TEasing;
  /** 更新频率（次/秒），0 表示每帧更新 */
  fps?: number;
  /** 由调用方传入，库内不提供默认实现 */
  formatter?: TCountupFormatter;
  render?: (el: Element, formatted: string) => void;
}

export interface ICountupGroupOptions extends ICountupBaseOptions {}

export interface ICountupGroup {
  config?: ICountupGroupOptions;
  queue: ICountupTask[];
}

export interface ICountupTaskOptions {
  el?: Element | string;
  from?: number;
  label?: string;
  to: number;
}

export interface ICountupFullOptions extends ICountupBaseOptions, ICountupHooks, ICountupTaskOptions {}

export interface ICountupTask extends Required<Omit<ICountupTaskOptions, "el">>, Required<ICountupBaseOptions>, ICountupHooks {
  el?: Element;
  id: number;
  value: number;
  startAt: number;
  accum: number;
  group: ICountupGroup;
}

/** buildCountupFormatter 的包裹选项（prefix/suffix/numerals） */
export interface ICountupFormatterOptions {
  prefix?: string;
  suffix?: string;
}
