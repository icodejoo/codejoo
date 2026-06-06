import type {
  TCountdownFormatter,
  TDateUnit,
  TDateParser,
  TCountdownParser,
  TCountdownValue,
} from "./types";
// ========================= 常量 =========================

const MS_SECOND = 1000;
const MS_MINUTE = 60000;
const MS_HOUR = 3600000;
const MS_DAY = 86400000;

// 31536000000 代表 1971-01-01 00:00:00 的毫秒数，用来判断是否时间戳
const TS_THRESHOLD = 31536000000;

// ========================= 格式化器 =========================

/**
 * 通过元编程生成高性能倒计时格式化器。
 * 在创建时解析模板，生成一个硬编码的 `new Function`，运行时零开销。
 *
 * 支持的占位符：DD (天), HH (时), mm (分), ss (秒), sss (毫秒)。
 * HH/mm/ss 自动补零到两位，sss 自动补零到三位,DD不补零。
 *
 * @param template - 模板字符串，如 "DD天 HH:mm:ss" 或 "mm:ss.sss"
 * @returns 格式化器函数 (value: number[]) => string
 *
 * @example
 * const fmt = createHighPerfFormatter('DD天 HH:mm:ss')
 *
 * const fmt2 = createHighPerfFormatter('HH:mm:ss')
 *
 * const fmt3 = createHighPerfFormatter('mm:ss.sss')
 */
export function buildCountdownFormatter(template: string): TCountdownFormatter {
  const TOKEN_VAR: Record<string, string> = {
    DD: "v[0]",
    HH: "v[1]",
    mm: "v[2]",
    ss: "v[3]",
    sss: "v[4]",
  };

  const REGEX_FORMAT = /\[([^\]]+)]|DD|HH|mm|sss|ss/g;
  const body = template
    .replace(/[\\']/g, (m) => "\\" + m)
    .replace(REGEX_FORMAT, (match: string, lit?: string) => {
      if (lit != null) return lit;
      const val = TOKEN_VAR[match];
      return val === "v[4]"
        ? `'+(${val}<10?"00"+${val}:${val}<100?"0"+${val}:${val})+'`
        : `'+(${val}<10?"0"+${val}:${val})+'`;
    });

  return new Function("v", `return '${body}';`) as TCountdownFormatter;
}


// ========================= 解析器 =========================

export function buildCountdownParser(
  dayInHours: boolean = false
): TCountdownParser {
  const values = new Int32Array(5);
  return (ms: number) => {
    values[0] = dayInHours ? (ms / MS_DAY) | 0 : 0;
    values[1] = (dayInHours ? (ms % MS_DAY) / MS_HOUR : ms / MS_HOUR) | 0;
    values[2] = ((ms % MS_HOUR) / MS_MINUTE) | 0;
    values[3] = ((ms % MS_MINUTE) / MS_SECOND) | 0;
    values[4] = (ms % MS_SECOND) | 0;
    return values as any;
  }
}

export function countdownRender(el: Element, formatted: string, values: TCountdownValue) {
  el.textContent = formatted;
}



/**
 * @description 解析时间字符串或日期对象或时间戳或数字为时间戳
 * @param value 时间字符串或日期对象或时间戳或数字
 * @param base 基数，默认毫秒,用于将时间单位(如3周,3天、3小时、3分钟、3秒、3毫秒)转换为毫秒
 * @returns 时间戳
 */
export function buildCountdownResolver(unit: TDateUnit): TDateParser {
  const REGEX_PARSE =
    /^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$/;

  const scale = {
    millseconds: 1,
    seconds: MS_SECOND,
    minutes: MS_MINUTE,
    hours: MS_HOUR,
    days: MS_DAY,
  }[unit];
  return function (value: any) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return resolveNumber(value, scale);
    if (!value || typeof value !== "string") return fallback(value);
    const match = value.match(REGEX_PARSE);
    if (!match) return Date.parse(value) || fallback(value);
    const [, y, mo, d, h, mi, s, ms] = match;
    // 缺省的可选分组（如未写毫秒/秒）必须回退为合法默认值，
    // 否则 Number(undefined)=NaN 会让 new Date(...) 变成 Invalid Date，
    // getTime() 返回 NaN 触发 fallback(now()) → 倒计时从 0 起算并立即变负数。
    return new Date(
      +y,
      mo ? +mo - 1 : 0,
      d ? +d : 1,
      h ? +h : 0,
      mi ? +mi : 0,
      s ? +s : 0,
      ms ? +ms : 0,
    ).getTime() || fallback(value);
  };
}

function fallback(value: any): number {
  console.error("[counter-down]: Invalid dateTime value:", value);
  return Date.now();
}

function resolveNumber(value: number, base: number): number {
  if (!Number.isFinite(value)) return fallback(value);
  value = Math.abs(value);
  if (value <= TS_THRESHOLD) return value * base + Date.now();
  return value;
}

export function resolveDateParser(resolver: TDateParser | TDateUnit): TDateParser {
  if (typeof resolver === "string") {
    return buildCountdownResolver(resolver as any);
  }
  return resolver;
}

export function resolveFormatter(formatter: TCountdownFormatter | string): TCountdownFormatter {
  if (typeof formatter === "string") {
    return buildCountdownFormatter(formatter);
  }
  return formatter;
}
