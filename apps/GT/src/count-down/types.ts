export interface IDefaultOptions {
  countdown: Required<ICountdownOptions>;
}

// ========================= countdown 类型定义 =========================

export type TDateUnit =
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "ms"
  | "week"
  | "month"
  | "year"
  | "quarter";

export type TDateParser = (value: any) => number;

/** 倒计时解析结果 —— 对象形式 { d, h, m, s, sss } */
export type TCountdownMapValue = {
  d: number;
  h: number;
  m: number;
  s: number;
  ms: number;
};
/** 倒计时解析结果 —— 元组形式 [d, h, m, s, sss] */
export type TCountdownArrayValue = [
  d: number,
  h: number,
  m: number,
  s: number,
  ms: number,
];
/** 倒计时回调签名，接收 d/h/m/s/sss 五个参数并返回格式化字符串 */
export type TCountdownFuncValue = (
  d: number,
  h: number,
  m: number,
  s: number,
  ms: number,
) => string;

export type TCountdownValue =
  | TCountdownMapValue
  | TCountdownArrayValue
  | TCountdownFuncValue;

/** 倒计时解析器 —— 对象模式 */
export type TCountdownMapParser = (duration: number) => TCountdownMapValue;
/** 倒计时解析器 —— 数组模式 */
export type TCountdownArrayParser = (duration: number) => TCountdownArrayValue;
/** 倒计时解析器 —— 回调模式 */
export type TCountdownCallerParser = (
  duration: number,
  cb: TCountdownFuncValue,
) => string;

/** 倒计时格式化器：输入剩余毫秒，输出展示字符串 */
export type ICountdownFormatter = (duration: number) => string;

/** 倒计时渲染函数：输入剩余毫秒，输出展示字符串 */
export type TCountdownRender = (
  el: Element,
  formatter: ICountdownFormatter,
  parser: TCountdownFunctionalParser,
) => void;

export interface ICountdownOptions {
  /** 是否显示天数 */
  showDays?: boolean;
  /** 是否显示毫秒 */
  showMilliseconds?: boolean;
  /** 时间解析器，默认 parse */
  dateParser?: TDateParser | TDateUnit;
  /** 格式化器，默认 buildHighPerfFormatter('HH:mm:ss') */
  formatter?: ICountdownFormatter | string;
  /** 解析器 */
  parser?: TCountdownParser;
  /** 渲染函数 */
  render?: TCountdownRender;
}

export type TCountdownFunctionalParser =
  | TCountdownMapParser
  | TCountdownArrayParser
  | TCountdownCallerParser;

export type TCountdownParserMode = "map" | "array" | "callback";

export type TCountdownParser =
  | TCountdownFunctionalParser
  | TCountdownParserMode;

export interface ICountdownGroup {
  label: string;
  options: ICountdownOptions & { label: string };
}

export interface ICountdownTaskOptions extends ICountdownOptions, IHooks {}

export interface ICountdownTask extends IHooks {
  /** 元素 */
  el: Element;
  /** 剩余时间 */
  remaining: number;
  /** 倒计时格式化函数 */
  formatter: ICountdownFormatter;
  /** 倒计时解析函数 */
  parser: TCountdownFunctionalParser;
  /** 渲染函数 */
  render: TCountdownRender;
}

interface IHooks {
  onDone?: (remaining: number) => void;
  onUpdate?: (remaining: number) => void;
  onStart?: (remaining: number) => void;
  onPause?: (remaining: number) => void;
  onResume?: (remaining: number) => void;
  onStop?: (remaining: number) => void;
  onDestroy?: (remaining: number) => void;
}
