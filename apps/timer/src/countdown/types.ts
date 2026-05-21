/** 倒计时解析结果 —— 对象形式 { d, h, m, s, sss } */
export type TCountdownObjectResult = { d: number; h: number; m: number; s: number; sss: number };
/** 倒计时解析结果 —— 元组形式 [d, h, m, s, sss] */
export type TCountdownArrayResult = [number, number, number, number, number];
/** 倒计时回调签名，接收 d/h/m/s/sss 五个参数并返回格式化字符串 */
export type TCountdownCallbackResult = (
  d: number,
  h: number,
  m: number,
  s: number,
  sss: number,
) => string;

export type TCountdownResult =
  | TCountdownObjectResult
  | TCountdownArrayResult
  | TCountdownCallbackResult;

/** 倒计时格式化器：输入剩余毫秒，输出展示字符串 */
export type TCountdownFormatter = (duration: number) => string;
/** 倒计时解析器 —— 对象模式 */
export type TCountdownObjectParser = (duration: number) => TCountdownObjectResult;
/** 倒计时解析器 —— 数组模式 */
export type TCountdownArrayParser = (duration: number) => TCountdownArrayResult;
/** 倒计时解析器 —— 回调模式 */
export type TCountdownCallbackParser = (duration: number, cb: TCountdownCallbackResult) => string;

export type TCountdownParser =
  | TCountdownObjectParser
  | TCountdownArrayParser
  | TCountdownCallbackParser;

export interface IDefaults {
  timeOffset: number;
  countdown: {
    formatter: TCountdownFormatter;
    parser: TCountdownParser;
  };
  countup: {
    formatter: 1;
    parser: 1;
  };
}
