import type { ICountupTask } from "../count-up";

export interface IDefaultOptions {
  countdown: Required<ICountdownOptions>;
}

export type TEndTime = string | number | Date

// ========================= countdown 类型定义 =========================

export type TDateUnit =
  | "days"
  | "hours"
  | "minutes"
  | "seconds"
  | "millseconds"

export type TDateParser = (value: any) => number;

/** 倒计时解析结果 —— 元组形式 [d, h, m, s, sss] */
export type TCountdownValue = [
  days: number,
  hours: number,
  minutes: number,
  seconds: number,
  millseconds: number,
];


export type TCountdownParser = (duration: number) => TCountdownValue;

/** 倒计时格式化器：输入剩余毫秒，输出展示字符串 */
export type TCountdownFormatter = (value: TCountdownValue) => string;

/** 倒计时渲染函数：输入剩余毫秒，输出展示字符串 */
export type TCountdownRender = (
  el: Element,
  formatted: string,
  values: TCountdownValue,
) => void;

export interface ICountdownOptions {
  /** 格式化器，默认 buildHighPerfFormatter('HH:mm:ss') */
  fmt?: TCountdownFormatter | string;
  /** 时间解析器，默认 parse */
  resolver?: TDateParser | TDateUnit;
  /** 解析器 */
  parser?: TCountdownParser;
  /** 渲染函数 */
  render?: TCountdownRender;
}




export interface ICountdownTaskOptions extends ICountdownOptions, IHooks {
  label?: string
  el?: string | Element
  endTime: TEndTime;
  autokill?: boolean
  /** 懒加载：初始化不入队，由 observer 观测 el，进入视口才入队、离开则移出 */
  lazy?: boolean
  /** 懒加载使用的 IntersectionObserver，缺省用库内共享的默认 observer */
  observer?: IntersectionObserver;
}

export interface ICountdownTask extends IHooks {
  _index: number
  _active: boolean
  id: number
  /** 分组标记 */
  label?: string
  /** 元素 */
  el?: Element;
  /** 剩余时间 */
  cd: number;
  /** 归零后从队列移除 */
  autokill: boolean
  /** 懒触发，进入视口才入队、离开则移出 */
  lazy: boolean
  /** 懒加载观测此任务 el 的 observer（仅 lazy 任务持有） */
  observer?: IntersectionObserver;
  /** 倒计时格式化函数 */
  fmt: TCountdownFormatter;
  /** 倒计时解析函数 */
  parser: TCountdownParser;
  /** 渲染函数 */
  render?: TCountdownRender;
}

interface IHooks {
  onDone?: (task: ICountdownTask) => void;
  onUpdate?: (formatted: string, cd: TCountdownValue, task: ICountdownTask) => void;
  onStart?: (task: ICountdownTask) => void;
  onPause?: (task: ICountdownTask) => void;
  onResume?: (task: ICountdownTask) => void;
  onStop?: (task: ICountdownTask) => void;
  onDestroy?: (task: ICountdownTask) => void;
}
