/** 缓动函数签名：输入归一化时间 t(0→1)，输出归一化进度(0→1) */
export type TimerEasingFn = (t: number) => number

// ========================= 时间常量 =========================

export const MS_DAY = 86400000
export const MS_HOUR = 3600000
export const MS_MINUTE = 60000
export const MS_SECOND = 1000

// ========================= DOM 工具 =========================

/** 解析 CSS 选择器或 Element 引用为 DOM 元素 */
export function resolveEl(el: string | Element | undefined): Element | null {
  if (typeof el === "string") return el.trim() === "" ? null : document.querySelector(el.trim())
  return el ?? null
}

// ========================= 缓动函数 =========================

/**
 * 非对称 S 曲线工厂。
 *
 * 基于 smoothstep 的广义形式，通过 `skew` 控制加速段与减速段的比例：
 * - skew < 0.5：加速段短、减速段长（起步快冲，收尾慢停）
 * - skew = 0.5：对称 S（等同 smoothstep）
 * - skew > 0.5：加速段长、减速段短（起步慢热，收尾快收）
 *
 * @param skew - 拐点位置 0→1，推荐 0.25~0.35 用于金额滚动
 */
export function easeAsymmetricS(skew: number): TimerEasingFn {
  return (t: number) => {
    const s = t < skew ? (t / skew) * 0.5 : 0.5 + ((t - skew) / (1 - skew)) * 0.5
    return s * s * (3 - 2 * s)
  }
}

/**
 * 内置缓动函数集合。
 *
 * @example
 * timer.countUp(99999, { easing: ease.easeOutCubic }, callback)
 * const progress = ease.linear(0.5) // 0.5
 */
export const ease = {
  /** 匀速：无加速无减速，适合进度条、匀速滚动 */
  linear: (t: number) => t,
  /** 慢启动：开头慢结尾快，适合从静止开始的入场动画 */
  easeInQuad: (t: number) => t * t,
  /** 慢停止：开头快结尾慢，适合数字滚动、弹幕淡出 */
  easeOutQuad: (t: number) => t * (2 - t),
  /** 慢进慢出：两端慢中间快，适合页面切换、对话框展开 */
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  /** 快冲减速：开头极快结尾缓停，适合金额滚动、计数器 */
  easeOutCubic: (t: number) => --t * t * t + 1,
  /** 平滑过渡：两端极慢中间快，适合轮播、长距离位移 */
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  /** 非对称 S 曲线：起步柔和→中段爆发→收尾自然减速，大数值金额滚动首选（默认） */
  easeCountUp: easeAsymmetricS(0.3),
} satisfies Record<string, TimerEasingFn>

// ========================= countDown 类型 =========================

/** 倒计时解析结果 —— 对象形式 { d, h, m, s, sss } */
export type TCountDownObjectResult = { d: number; h: number; m: number; s: number; sss: number }
/** 倒计时解析结果 —— 元组形式 [d, h, m, s, sss] */
export type TCountDownArrayResult = [number, number, number, number, number]
/** 倒计时回调签名，接收 d/h/m/s/sss 五个参数并返回格式化字符串 */
export type TCountDownCallbackResult = (d: number, h: number, m: number, s: number, sss: number) => string

/** 倒计时格式化器：输入剩余毫秒，输出展示字符串 */
export type ICountDownFormatter = (duration: number) => string
/** 倒计时解析器 —— 对象模式 */
export type ICountDownObjectParser = (duration: number) => TCountDownObjectResult
/** 倒计时解析器 —— 数组模式 */
export type ICountDownArrayParser = (duration: number) => TCountDownArrayResult
/** 倒计时解析器 —— 回调模式 */
export type ICountDownCallbackParser = (duration: number, cb: TCountDownCallbackResult) => string

export interface ICountDownOptions {
  /** 回调间隔(ms)，默认 1000（每秒更新）。传 0 表示每帧更新（毫秒精度） */
  interval?: number
  /** 格式化器，默认 buildHighPerfFormatter('HH:mm:ss') */
  formatter?: ICountDownFormatter
}

/**
 * countDown 控制句柄，由 Timer.countDown 返回。
 *
 * @example
 * const ctrl = timer.countDown(60000, (text) => el.textContent = text)
 * ctrl.remove()  // 提前取消
 */
export interface ICountDownControl {
  /** 任务 ID */
  readonly id: number
  /** 提前取消倒计时 */
  remove(): void
}

/** countDown 内部任务结构（扩展 TimerTask，加上 remaining 字段） */
export interface ICountDownTask {
  beginAt: number
  endAt: number
  updateAt: number
  id: number
  interval: number
  immediate: boolean
  once: boolean
  args: any[]
  /** 剩余时间(ms)，每帧由 countDown 回调更新 */
  remaining: number
}

// ========================= countUp 类型 =========================

export interface ICountUpFormat {
  /** 前缀，如 "₱"、"$" */
  prefix?: string
  /** 后缀，如 "%"、"元" */
  suffix?: string
  /** 千分位分隔符，默认 "," */
  thousands?: string
  /** 小数分隔符，默认 "." */
  decimal?: string
  /** 小数位数，默认 2，设为 0 不展示小数 */
  precision?: number
  /** 是否展示千分位，默认 true */
  useGrouping?: boolean
}

export interface ICountUpOptions extends ICountUpFormat {
  /** 起始值 */
  from?: number
  /** 动画持续时间(ms) */
  duration?: number
  /** 每秒最大回调次数，0 表示每帧都回调(~60fps，具体受 Timer 帧率影响) */
  fps?: number
  /** 缓动函数，默认 easeCountUp（非对称 S 曲线）。运行时从 ease 对象读取 */
  easing?: TimerEasingFn
  /** 完全自定义格式化函数，优先于格式化配置 */
  formatter?: (value: number) => string
  /** 绑定 DOM 元素(CSS 选择器或 Element 引用)，每帧自动写入 textContent */
  el?: string | Element
}

/**
 * countUp 控制句柄，由 Timer.countUp 返回。
 *
 * @example
 * const ctrl = timer.countUp(99999, { prefix: '₱' }, (text) => { ... })
 * ctrl.update(199999)  // 从当前值平滑过渡到新目标
 * ctrl.remove()        // 停止动画
 */
export interface ICountUpControl {
  /** 任务 ID */
  readonly id: number
  /** 更新目标值，从当前动画位置平滑过渡到新目标 */
  update(to: number): void
  /** 停止并移除动画 */
  remove(): void
}

/** countUp 内部任务结构（扩展 TimerTask，加上 progress/current 字段） */
export interface ICountUpTask {
  beginAt: number
  endAt: number
  updateAt: number
  id: number
  interval: number
  immediate: boolean
  once: boolean
  args?: any[]
  /** 0→1 归一化进度，1 表示动画完成 */
  progress: number
  /** 当前插值数值（经过缓动计算后的实际值） */
  current: number
}

// ========================= countDown 格式化器/解析器 =========================

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
 * const fmt = buildHighPerfFormatter('DD天 HH:mm:ss')
 * fmt(90061000) // "01天 01:01:01"
 */
export function buildHighPerfFormatter(template: string, options = { showDays: true }): ICountDownFormatter {
  const { showDays } = options

  const h = showDays ? `((ms%${MS_DAY})/${MS_HOUR})|0` : `Math.trunc(ms/${MS_HOUR})`
  let code = `var d=Math.trunc(ms/${MS_DAY}),h=${h},m=((ms%${MS_HOUR})/${MS_MINUTE})|0,s=((ms%${MS_MINUTE})/${MS_SECOND})|0,sss=ms%${MS_SECOND}|0;`

  const TOKEN_VAR: Record<string, string> = { DD: "d", HH: "h", mm: "m", ss: "s", sss: "sss" }
  const parts = template.split(/(DD|HH|mm|sss|ss)/)
  const fragments: string[] = []

  for (const part of parts) {
    if (!part) continue
    const v = TOKEN_VAR[part]
    if (v === "sss") {
      fragments.push(`(sss < 10 ? "00" + sss : sss < 100 ? "0" + sss : "" + sss)`)
    } else if (v) {
      fragments.push(`(${v} < 10 ? "0" + ${v} : ${v})`)
    } else {
      fragments.push(`"${part}"`)
    }
  }

  code += "return " + (fragments.length ? fragments.join(" + ") : '""') + ";"

  return new Function("ms", code) as (ms: number) => string
}

/**
 * 创建倒计时时间解析器，将毫秒拆分为 天/时/分/秒/毫秒。
 *
 * 三种模式通过重载签名区分：
 * - `'shared'` — 返回复用的 `{ d, h, m, s, sss }` 对象（90% 场景推荐，零 GC）
 * - `'typed'`  — 返回复用的 `Int32Array(5)`（跨线程场景，可转移所有权）
 * - `'callback'` — 通过回调传值，零对象创建（异步消费必选，内存安全）
 */
export function createCountDownParser(mode: "shared", showDays: boolean): ICountDownObjectParser
export function createCountDownParser(mode: "typed", showDays: boolean): ICountDownArrayParser
export function createCountDownParser(mode: "callback", showDays: boolean): ICountDownCallbackParser
export function createCountDownParser(mode: any, showDays: boolean = false): any {
  let d: number, h: number, m: number, s: number, sss: number

  const compute = (ms: number) => {
    d = Math.trunc(ms / MS_DAY)
    h = showDays ? ((ms % MS_DAY) / MS_HOUR) | 0 : Math.trunc(ms / MS_HOUR)
    m = ((ms % MS_HOUR) / MS_MINUTE) | 0
    s = ((ms % MS_MINUTE) / MS_SECOND) | 0
    sss = (ms % MS_SECOND) | 0
  }

  if (mode === "shared") {
    const obj: TCountDownObjectResult = { d: 0, h: 0, m: 0, s: 0, sss: 0 }
    return (ms: number) => {
      compute(ms)
      obj.d = d
      obj.h = h
      obj.m = m
      obj.s = s
      obj.sss = sss
      return obj
    }
  }

  if (mode === "typed") {
    const arr = new Int32Array(5)
    return (ms: number) => {
      compute(ms)
      arr[0] = d
      arr[1] = h
      arr[2] = m
      arr[3] = s
      arr[4] = sss
      return arr
    }
  }

  return (ms: number, cb: TCountDownCallbackResult) => {
    compute(ms)
    return cb(d, h, m, s, sss)
  }
}

/**
 * 将任意 parser 包装为字符串格式化器。
 * 创建时通过 parser.length 区分 callback(arity=2) 和 value(arity=1) parser，
 * 运行时不做类型判断，直达分支。
 */
export function buildCountDownFormatter(
  parser: ICountDownObjectParser | ICountDownArrayParser | ICountDownCallbackParser,
  format: (d: number, h: number, m: number, s: number, sss: number) => string,
): ICountDownFormatter {
  if (parser.length === 2) {
    return (ms: number) => (parser as ICountDownCallbackParser)(ms, format)
  }

  return (ms: number) => {
    const v = (parser as ICountDownObjectParser | ICountDownArrayParser)(ms)
    return "d" in v ? format(v.d, v.h, v.m, v.s, v.sss) : format(v[0], v[1], v[2], v[3], v[4])
  }
}

// ========================= countUp 格式化器 =========================

/** 转义字符串，安全嵌入 new Function 模板。处理反斜杠、双引号、换行/回车/制表符 */
function escapeLiteral(s: string): string {
  return s.replace(/[\\"\n\r\t]/g, (ch) => (({ "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t" }) as Record<string, string>)[ch])
}

/**
 * 元编程 countUp 格式化器工厂。
 *
 * 通过 `new Function` 在创建时将 precision、thousands、decimal、prefix、suffix
 * 硬编码进函数体，运行时无配置查找开销。
 * 内部使用分段截取(Chunking)算法处理千分位，避免正则回溯。
 *
 * @example
 * const fmt = buildCountUpFormatter({ prefix: '₱', precision: 2 })
 * fmt(1234567.89) // "₱1,234,567.89"
 */
export function buildCountUpFormatter(configs: ICountUpFormat): (value: number) => string {
  const { precision = 2, thousands = ",", decimal = ".", prefix = "", suffix = "" } = configs
  const PFX = escapeLiteral(prefix)
  const SFX = escapeLiteral(suffix)
  const THO = escapeLiteral(thousands)
  const DEC = escapeLiteral(decimal)

  const decPart = precision > 0 ? `"${DEC}"+raw.substring(e+1)` : '""'
  const body =
    "return function(value){" +
    `var raw=value.toFixed(${precision}),n=value<0,d=raw.indexOf("."),s=n?1:0,e=d===-1?raw.length:d,l=e-s;` +
    `if(l<=0)return"${PFX}"+raw+"${SFX}";` +
    'var p="",f=l%3||3,i=s+f;' +
    "p=raw.substring(s,i);" +
    `while(i<e){p+="${THO}"+raw.substring(i,i+3);i+=3}` +
    `return(n?"-":"")+"${PFX}"+p+${decPart}+"${SFX}"` +
    "}"

  return new Function(body)()
}

/**
 * countUp 动画状态。封装 from/range/startDt，提供统一的 progress→value 计算。
 * RAF 回调和 control.update() 共用同一套计算逻辑，消除重复。
 */
export class CountUpState {
  declare from: number
  declare range: number
  /** 动画起始 dt，-1 表示尚未开始（下一帧初始化） */
  declare startDt: number

  constructor(from: number, to: number) {
    this.from = from
    this.range = to - from
    this.startDt = -1
  }

  progress(updateAt: number, duration: number): number {
    if (this.startDt < 0) this.startDt = updateAt
    return Math.min((updateAt - this.startDt) / duration, 1)
  }

  value(progress: number, easing: TimerEasingFn): number {
    return this.from + this.range * easing(progress)
  }

  /** 从当前动画位置重定向到新目标，重置动画时间线 */
  retarget(newTo: number, currentProgress: number, easing: TimerEasingFn) {
    this.from = this.value(currentProgress, easing)
    this.range = newTo - this.from
    this.startDt = -1
  }
}

// ========================= 默认配置 =========================

export const COUNT_DOWN_DEFAULTS: Required<ICountDownOptions> = {
  interval: 1000,
  formatter: buildHighPerfFormatter("HH:mm:ss"),
}

export const COUNT_UP_DEFAULTS: Omit<Required<ICountUpOptions>, "formatter"> & { formatter: ICountUpOptions["formatter"] } = {
  easing: ease.easeCountUp,
  prefix: "",
  fps: 30,
  precision: 2,
  from: 0,
  duration: 1000,
  el: "",
  suffix: "",
  thousands: ",",
  decimal: ".",
  useGrouping: true,
  formatter: undefined,
}
