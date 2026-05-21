import type {
  ICountdownFormatter,
  TCountdownMapParser,
  TCountdownArrayParser,
  TCountdownCallerParser,
  TCountdownFuncValue,
  TCountdownMapValue,
  TCountdownParserMode,
  TDateUnit,
  TDateParser as TDateParser,
  TCountdownParser,
  TCountdownFunctionalParser,
  ICountdownOptions,
} from "./types";
// ========================= 常量 =========================

const MS_SECOND = 1000;
const MS_MINUTE = 60000;
const MS_HOUR = 3600000;
const MS_DAY = 86400000;
const MS_WEEK = MS_DAY * 7;
const MS_MONTH = MS_DAY * 30;
const MS_YEAR = MS_DAY * 365;
const MS_QUARTER = MS_DAY * 90;

// 31536000000 代表 1971-01-01 00:00:00 的毫秒数
const TS_THRESHOLD = 31536000000;



/** 类型守卫：判断目标是 DOM 引用（string 选择器或 Element）还是普通对象 */
export function isElement(target: unknown): target is string | Element {
  return typeof target === "string" || target instanceof Element;
}

// ========================= 格式化器 =========================

/**
 * 通过元编程生成高性能倒计时格式化器。
 * 在创建时解析模板，生成一个硬编码的 `new Function`，运行时零开销。
 *
 * 支持的占位符：DD (天), HH (时), mm (分), ss (秒), sss (毫秒)。
 * DD/HH/mm/ss 自动补零到两位，sss 自动补零到三位。
 *
 * @param template - 模板字符串，如 "DD天 HH:mm:ss" 或 "mm:ss.sss"
 * @param options  - 配置项
 * @param options.showDays - 是否将小时拆分为天+小时。true: HH = 0~23; false: HH = 总小时数
 * @returns 格式化器函数 (ms: number) => string
 *
 * @example
 * const fmt = createHighPerfFormatter('DD天 HH:mm:ss')
 * fmt(90061000) // "01天 01:01:01"
 *
 * const fmt2 = createHighPerfFormatter('HH:mm:ss', { showDays: false })
 * fmt2(90061000) // "25:01:01"
 *
 * const fmt3 = createHighPerfFormatter('mm:ss.sss')
 * fmt3(61500) // "01:01.500"
 */
export function buildHighPerfFormatter(
  template: string,
  options = { showDays: false, showMs: false },
): ICountdownFormatter {
  const { showDays, showMs } = options;

  // 紧凑形式:这个字符串会被 new Function 编译执行,JS 不在乎空白,
  // 故写成单行节省 minify 后产物体积。
  const h = showDays
    ? `((ms%${MS_DAY})/${MS_HOUR})|0`
    : `Math.trunc(ms/${MS_HOUR})`;
  const ms = showMs ? "ms%${MS_SECOND}|0" : "0";
  let code = `var d=Math.trunc(ms/${MS_DAY}),h=${h},m=((ms%${MS_HOUR})/${MS_MINUTE})|0,s=((ms%${MS_MINUTE})/${MS_SECOND})|0,sss=${ms};`;

  const TOKEN_VAR: Record<string, string> = {
    DD: "d",
    HH: "h",
    mm: "m",
    ss: "s",
    sss: "sss",
  };
  const parts = template.split(/(DD|HH|mm|sss|ss)/);
  const fragments: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    const v = TOKEN_VAR[part];
    if (v === "sss") {
      fragments.push(
        `(sss < 10 ? "00" + sss : sss < 100 ? "0" + sss : "" + sss)`,
      );
    } else if (v) {
      fragments.push(`(${v} < 10 ? "0" + ${v} : ${v})`);
    } else {
      fragments.push(`"${part}"`);
    }
  }

  code += "return " + (fragments.length ? fragments.join(" + ") : '""') + ";";

  return new Function("ms", code) as (ms: number) => string;
}

// ========================= 解析器 =========================

export function createCountdownParser(
  mode: "map",
  showDays: boolean,
): TCountdownMapParser;
export function createCountdownParser(
  mode: "array",
  showDays: boolean,
): TCountdownArrayParser;
export function createCountdownParser(
  mode: "callback",
  showDays: boolean,
): TCountdownCallerParser;
export function createCountdownParser(
  mode: TCountdownParserMode,
  showDays: boolean = false,
): any {
  let d: number, h: number, m: number, s: number, sss: number;

  const compute = (ms: number) => {
    d = Math.trunc(ms / MS_DAY);
    h = showDays ? ((ms % MS_DAY) / MS_HOUR) | 0 : Math.trunc(ms / MS_HOUR);
    m = ((ms % MS_HOUR) / MS_MINUTE) | 0;
    s = ((ms % MS_MINUTE) / MS_SECOND) | 0;
    sss = (ms % MS_SECOND) | 0;
  };

  if (mode === "map") {
    const obj: TCountdownMapValue = Object.create(null);
    obj.d = 0;
    obj.h = 0;
    obj.m = 0;
    obj.s = 0;
    obj.ms = 0;
    return (ms: number) => {
      compute(ms);
      obj.d = d;
      obj.h = h;
      obj.m = m;
      obj.s = s;
      obj.ms = sss;
      return obj;
    };
  }

  if (mode === "array") {
    const arr = new Int32Array(5);
    return (ms: number) => {
      compute(ms);
      arr[0] = d;
      arr[1] = h;
      arr[2] = m;
      arr[3] = s;
      arr[4] = sss;
      return arr;
    };
  }

  return (ms: number, cb: TCountdownFuncValue) => {
    compute(ms);
    return cb(d, h, m, s, sss);
  };
}

/**
 * 将任意 parser 包装为字符串格式化器。
 * 创建时通过 parser.length 区分 callback(arity=2) 和 value(arity=1) parser，
 * 运行时不做类型判断，直达分支。
 *
 * @example
 * const parser = createCountdownParser('shared', true)
 * const formatter = createCountdownFormatter(parser, (d, h, m, s, sss) =>
 *   `${d}天 ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
 * )
 * formatter(90061500) // "1天 01:01:01"
 */
export function buildCountdownFormatter(
  parser: TCountdownMapParser | TCountdownArrayParser | TCountdownCallerParser,
  format: (d: number, h: number, m: number, s: number, sss: number) => string,
): ICountdownFormatter {
  if (parser.length === 2) {
    return (ms: number) => (parser as TCountdownCallerParser)(ms, format);
  }

  return (ms: number) => {
    const v = (parser as TCountdownMapParser | TCountdownArrayParser)(ms);
    return "d" in v
      ? format(v.d, v.h, v.m, v.s, v.ms)
      : format(v[0], v[1], v[2], v[3], v[4]);
  };
}

export function countdownRender(el: Element, formatter: ICountdownFormatter, parser: TCountdownParser) {
  const values = parser(el.textContent);
  el.textContent = formatter(values[0], values[1], values[2], values[3], values[4]);
}

const REGEX_PARSE =
  /^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$/;

/**
 * @description 解析时间字符串或日期对象或时间戳或数字为时间戳
 * @param value 时间字符串或日期对象或时间戳或数字
 * @param base 基数，默认毫秒,用于将时间单位(如3周,3天、3小时、3分钟、3秒、3毫秒)转换为毫秒
 * @returns 时间戳
 */
export function buildDateParser(unit: TDateUnit): TDateParser {
  const scale = {
    ms: 1,
    second: MS_SECOND,
    minute: MS_MINUTE,
    hour: MS_HOUR,
    day: MS_DAY,
    week: MS_WEEK,
    month: MS_MONTH,
    year: MS_YEAR,
    quarter: MS_QUARTER,
  }[unit];
  return function (value: any) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return resolveNumber(value, scale);
    if (!value || typeof value !== "string") return fallback(value);
    const match = value.match(REGEX_PARSE);
    if (!match) return Date.parse(value) || fallback(value);
    const [, y, mo, d, h, mi, s, ms] = match.map(Number);
    return new Date(y, mo - 1, d, h, mi, s, ms).getTime() || fallback(value);
  };
}

function fallback(value: any): number {
  console.error("[GT]: Invalid dateTime value:", value);
  return Date.now();
}

function resolveNumber(value: number, base: number): number {
  if (!Number.isFinite(value)) return fallback(value);
  value = Math.abs(value);
  if (value <= TS_THRESHOLD) return value * base + Date.now();
  return value;
}

export function resolveFormatter(formatter: ICountdownFormatter | string, showDays: boolean, showMilliseconds: boolean): ICountdownFormatter {
  if (typeof formatter === "string") {
    return buildHighPerfFormatter(formatter, { showDays, showMs: showMilliseconds });
  }
  return formatter;
}

export function resolveParser(parser: TCountdownParser, showDays: boolean): TCountdownFunctionalParser {
  if (typeof parser === "string") {
    return createCountdownParser(parser as any, showDays);
  }
  return parser;
}

export function resolveDateParser(resolver: TDateParser | TDateUnit): TDateParser {
  if (typeof resolver === "string") {
    return buildDateParser(resolver as any);
  }
  return resolver;
}

// 删除索引为 index 的元素
export function fastRemove(arr: any[], index: number) {
  const lastIndex = arr.length - 1;
  if (index !== lastIndex) {
    arr[index] = arr[lastIndex]; // 将最后一个元素移到要删除的位置
  }
  arr.pop(); // 移除最后一个元素（极快）
}

export function resolveConfig(
  defaults: Required<ICountdownOptions>,
  group?: ICountdownOptions,
  config?: ICountdownOptions,
): Required<ICountdownOptions> {
  if (!group && !config) return defaults;
  if (group && !config) return { ...defaults, ...group };
  if (!group && config) return { ...defaults, ...config };
  return { ...defaults, ...group, ...config };
}
