import type {
  ICountdownContext,
  ICountdownFormatter,
  TCountdownDeadline,
  TCountdownValue,
  TDateUnit,
  TDateParser,
  TCountdownParser,
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
 * 注意：依赖 new Function，CSP 禁用 unsafe-eval 的环境需改用自定义 formatter。
 *
 * 支持的占位符：DD (天), HH (时), mm (分), ss (秒), sss (毫秒)。
 * DD/HH/mm/ss 自动补零到两位，sss 自动补零到三位。
 *
 * @param template - 模板字符串，如 "DD天 HH:mm:ss" 或 "mm:ss.sss"
 * @param options  - 配置项
 * @param options.showDays - 是否将小时拆分为天+小时。true: HH = 0~23; false: HH = 总小时数
 * @param options.showMs   - 是否计算毫秒（模板含 sss 时需开启）
 * @returns 格式化器函数 (ms: number) => string
 *
 * @example
 * const fmt = buildHighPerfFormatter('DD天 HH:mm:ss', { showDays: true })
 * fmt(90061000) // "01天 01:01:01"
 *
 * const fmt2 = buildHighPerfFormatter('HH:mm:ss')
 * fmt2(90061000) // "25:01:01"
 *
 * const fmt3 = buildHighPerfFormatter('mm:ss.sss', { showMs: true })
 * fmt3(61500) // "01:01.500"
 */
export function buildHighPerfFormatter(template: string, options = { showDays: false, showMs: false }): ICountdownFormatter {
  const { showDays, showMs } = options;

  // 紧凑形式:这个字符串会被 new Function 编译执行,JS 不在乎空白,
  // 故写成单行节省 minify 后产物体积。
  const h = showDays ? `((ms%${MS_DAY})/${MS_HOUR})|0` : `Math.trunc(ms/${MS_HOUR})`;
  const ms = showMs ? `(ms%${MS_SECOND})|0` : "0";
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
      fragments.push(`(sss < 10 ? "00" + sss : sss < 100 ? "0" + sss : "" + sss)`);
    } else if (v) {
      fragments.push(`(${v} < 10 ? "0" + ${v} : "" + ${v})`);
    } else {
      // JSON.stringify 转义模板里的引号/反斜杠，防止生成非法代码
      fragments.push(JSON.stringify(part));
    }
  }

  code += "return " + (fragments.length ? fragments.join(" + ") : '""') + ";";

  return new Function("ms", code) as (ms: number) => string;
}

// ========================= 解析器 =========================

/**
 * 创建内置倒计时解析器：剩余毫秒 → [d, h, m, s, ms] 元组。
 * 为「零分配」复用同一个长度为 5 的数组返回，**只读**——调用方不要跨调用持有引用或就地修改
 * （需要保留/修改请自行拷贝副本，如 `[...value]`）。
 *
 * @param showDays - true: 小时按天进位（HH=0~23，DD 为天数）；false: HH 为总小时数。
 */
export function createCountdownParser(showDays: boolean = false): TCountdownParser {
  // 复用同一个元组，避免每帧分配
  const v: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  return (ms: number) => {
    v[0] = Math.trunc(ms / MS_DAY);
    v[1] = showDays ? ((ms % MS_DAY) / MS_HOUR) | 0 : Math.trunc(ms / MS_HOUR);
    v[2] = ((ms % MS_HOUR) / MS_MINUTE) | 0;
    v[3] = ((ms % MS_MINUTE) / MS_SECOND) | 0;
    v[4] = (ms % MS_SECOND) | 0;
    return v;
  };
}

/**
 * 将解析器包装为字符串格式化器：解析剩余毫秒为 [d, h, m, s, ms] 后交给 format 拼接。
 *
 * @example
 * const parser = createCountdownParser(true)
 * const formatter = buildCountdownFormatter(parser, (d, h, m, s, sss) =>
 *   `${d}天 ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
 * )
 * formatter(90061500) // "1天 01:01:01"
 */
export function buildCountdownFormatter(parser: TCountdownParser, format: (d: number, h: number, m: number, s: number, sss: number) => string): ICountdownFormatter {
  return (ms: number) => {
    const v = parser(ms);
    return format(v[0], v[1], v[2], v[3], v[4]);
  };
}

/** 默认渲染：把剩余毫秒经 ctx.fmt 格式化后写入元素文本 */
export function countdownRender(el: Element, remaining: number, _value: TCountdownValue, ctx?: ICountdownContext) {
  el.textContent = ctx ? ctx.fmt(remaining, ctx) : String(remaining);
}

const REGEX_PARSE = /^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$/;

/**
 * @description 构建时间解析器：把时间字符串/Date/时间戳/时长数字解析为客户端时钟下的截止时间戳
 * @param unit 数字时长的单位（如 3 + "second" = 3 秒后），数字大于 1 年毫秒数时视为绝对时间戳
 * @returns (value, timeOffset) => 截止时间戳（毫秒，客户端时钟）
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
  return function (value: TCountdownDeadline, timeOffset = 0) {
    // 绝对时间（服务器时钟）统一减去 timeOffset 换算到客户端时钟；相对时长锚定客户端 Date.now()，与 offset 无关
    if (value instanceof Date) return value.getTime() - timeOffset;
    if (typeof value === "number") return resolveNumber(value, scale, timeOffset);
    if (!value || typeof value !== "string") return invalid(value);
    const match = REGEX_PARSE.exec(value);
    if (!match) {
      const ts = Date.parse(value);
      return Number.isNaN(ts) ? invalid(value) : ts - timeOffset;
    }
    const ts = new Date(+match[1], +(match[2] || 1) - 1, +(match[3] || 1), +(match[4] || 0), +(match[5] || 0), +(match[6] || 0), +(match[7] || "0").slice(0, 3)).getTime();
    return Number.isNaN(ts) ? invalid(value) : ts - timeOffset;
  };
}

function invalid(value: unknown): never {
  throw new Error("[GT]: Invalid dateTime value: " + String(value));
}

function resolveNumber(value: number, scale: number, timeOffset: number): number {
  if (!Number.isFinite(value) || value < 0) return invalid(value);
  if (value <= TS_THRESHOLD) return Date.now() + value * scale;
  return value - timeOffset;
}

export function resolveFormatter(formatter: ICountdownFormatter | string, showDays: boolean, showMilliseconds: boolean): ICountdownFormatter {
  if (typeof formatter === "string") {
    return buildHighPerfFormatter(formatter, { showDays, showMs: showMilliseconds });
  }
  return formatter;
}

export function resolveParser(parser: TCountdownParser | undefined, showDays: boolean): TCountdownParser {
  return parser ?? createCountdownParser(showDays);
}

export function resolveDateParser(resolver: TDateParser | TDateUnit): TDateParser {
  if (typeof resolver === "string") {
    return buildDateParser(resolver);
  }
  return resolver;
}

export function resolveConfig<T extends ICountdownOptions>(defaults: Required<Omit<ICountdownOptions, "parser" | "observer">>, group?: ICountdownOptions, config?: T): Required<Omit<ICountdownOptions, "parser" | "observer">> & T {
  if (!group && !config) return defaults as Required<Omit<ICountdownOptions, "parser" | "observer">> & T;
  return { ...defaults, ...group, ...config } as Required<Omit<ICountdownOptions, "parser" | "observer">> & T;
}
