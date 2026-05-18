import { Ticker, type TickerCallback, type TickerPlugin } from '../Ticker'

// ========================= 类型定义 =========================

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
 * countDown 控制句柄，由 Ticker.countDown 返回。
 *
 * @example
 * const ctrl = ticker.countDown(60000, (text) => el.textContent = text)
 * ctrl.remove()  // 提前取消
 */
export interface ICountDownControl {
  /** 任务 ID */
  readonly id: number
  /** 提前取消倒计时 */
  remove(): void
}

/** countDown 任务项，在 TickerTask 基础上扩展 remaining 字段 */
interface ICountDownTask {
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

// ========================= 常量 =========================

const MS_DAY = 86400000
const MS_HOUR = 3600000
const MS_MINUTE = 60000
const MS_SECOND = 1000

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
export function buildHighPerfFormatter(template: string, options = { showDays: true }): ICountDownFormatter {
  const { showDays } = options

  // 紧凑形式:这个字符串会被 new Function 编译执行,JS 不在乎空白,
  // 故写成单行节省 minify 后产物体积。
  const h = showDays ? `((ms%${MS_DAY})/${MS_HOUR})|0` : `Math.trunc(ms/${MS_HOUR})`
  let code = `var d=Math.trunc(ms/${MS_DAY}),h=${h},m=((ms%${MS_HOUR})/${MS_MINUTE})|0,s=((ms%${MS_MINUTE})/${MS_SECOND})|0,sss=ms%${MS_SECOND}|0;`

  const TOKEN_VAR: Record<string, string> = { DD: 'd', HH: 'h', mm: 'm', ss: 's', sss: 'sss' }
  const parts = template.split(/(DD|HH|mm|sss|ss)/)
  const fragments: string[] = []

  for (const part of parts) {
    if (!part) continue
    const v = TOKEN_VAR[part]
    if (v === 'sss') {
      fragments.push(`(sss < 10 ? "00" + sss : sss < 100 ? "0" + sss : "" + sss)`)
    } else if (v) {
      fragments.push(`(${v} < 10 ? "0" + ${v} : ${v})`)
    } else {
      fragments.push(`"${part}"`)
    }
  }

  code += 'return ' + (fragments.length ? fragments.join(' + ') : '""') + ';'

  return new Function('ms', code) as (ms: number) => string
}

// ========================= 解析器 =========================

/**
 * 创建倒计时时间解析器，将毫秒拆分为 天/时/分/秒/毫秒。
 *
 * 三种模式通过重载签名区分：
 * - `'shared'` — 返回复用的 `{ d, h, m, s, sss }` 对象（90% 场景推荐，零 GC）
 * - `'typed'`  — 返回复用的 `Int32Array(5)`（跨线程场景，可转移所有权）
 * - `'callback'` — 通过回调传值，零对象创建（异步消费必选，内存安全）
 *
 * @example
 * const parse = createCountDownParser('shared', true)
 * const { d, h, m, s, sss } = parse(90061500)
 *
 * const parseCb = createCountDownParser('callback', true)
 * parseCb(90061500, (d, h, m, s, sss) => `${d}天${h}时${m}分${s}秒`)
 */
export function createCountDownParser(mode: 'shared', showDays: boolean): ICountDownObjectParser
export function createCountDownParser(mode: 'typed', showDays: boolean): ICountDownArrayParser
export function createCountDownParser(mode: 'callback', showDays: boolean): ICountDownCallbackParser
export function createCountDownParser(mode: any, showDays: boolean = false): any {
  let d: number, h: number, m: number, s: number, sss: number

  const compute = (ms: number) => {
    d = Math.trunc(ms / MS_DAY)
    h = showDays ? ((ms % MS_DAY) / MS_HOUR) | 0 : Math.trunc(ms / MS_HOUR)
    m = ((ms % MS_HOUR) / MS_MINUTE) | 0
    s = ((ms % MS_MINUTE) / MS_SECOND) | 0
    sss = (ms % MS_SECOND) | 0
  }

  if (mode === 'shared') {
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

  if (mode === 'typed') {
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
 *
 * @example
 * const parser = createCountDownParser('shared', true)
 * const formatter = createCountDownFormatter(parser, (d, h, m, s, sss) =>
 *   `${d}天 ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
 * )
 * formatter(90061500) // "1天 01:01:01"
 */
export function buildCountDownFormatter(
  parser: ICountDownObjectParser | ICountDownArrayParser | ICountDownCallbackParser,
  format: (d: number, h: number, m: number, s: number, sss: number) => string
): ICountDownFormatter {
  if (parser.length === 2) {
    return (ms: number) => (parser as ICountDownCallbackParser)(ms, format)
  }

  return (ms: number) => {
    const v = (parser as ICountDownObjectParser | ICountDownArrayParser)(ms)
    return 'd' in v ? format(v.d, v.h, v.m, v.s, v.sss) : format(v[0], v[1], v[2], v[3], v[4])
  }
}

/**
 * countDown 插件工厂。注册后为 Ticker 实例添加 `countDown` 方法。
 *
 * @example
 * import { Ticker } from './Ticker'
 * import { createTickerCountDownPlugin } from './TickerCountDown'
 *
 * Ticker.extend(createTickerCountDownPlugin())
 *
 * const ticker = new Ticker()
 * ticker.countDown(60000, (text) => {
 *   timerEl.textContent = text  // "00:59.984" → "00:59.967" → ...
 * })
 */
export function countDown(): TickerPlugin {
  const defaultOptions: Required<ICountDownOptions> = {
    interval: 1000,
    formatter: buildHighPerfFormatter('HH:mm:ss')
  }

  return {
    name: 'count-down',
    install(clazz: typeof Ticker) {
      /**
       * 倒计时。按指定频率回调格式化后的剩余时间字符串，到期自动停止。
       *
       * endAt 基于 Ticker 的 dt 参考系（非绝对 performance.now()），
       * 与 task.updateAt 同一参考系，确保 remaining 计算正确。
       *
       * @param duration  - 倒计时总时长(ms)
       * @param callback  - 每 tick 回调，参数为格式化后的剩余时间字符串
       * @param options   - 可选配置（interval、formatter）
       * @returns 控制句柄，可调用 remove() 提前取消
       *
       * @example
       * // 每秒更新（默认 interval=1000）
       * ticker.countDown(60000, (text) => {
       *   timerEl.textContent = text     // "00:01:00" → "00:00:59" → ...
       * })
       *
       * // 毫秒精度倒计时（每帧更新）
       * ticker.countDown(60000, (text) => {
       *   timerEl.textContent = text
       * }, { interval: 0, formatter: buildHighPerfFormatter('mm:ss.sss') })
       */
      clazz.prototype.countDown = function (duration: number, callback: TickerCallback, options: ICountDownOptions = defaultOptions): ICountDownControl {
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration > 1e11) throw new Error('duration must be a finite number and less than 1e11')
        if (options !== defaultOptions) {
          options = Object.assign({}, defaultOptions, options)
        }
        const opts = options as Required<ICountDownOptions>
        const ticker = this
        const endDt = this.delta + duration

        const base = this.manager.add(
          function (task: ICountDownTask) {
            task.remaining = endDt - task.updateAt
            if (task.remaining <= 0) {
              ticker.remove(task.id)
            } else {
              callback(opts.formatter(task.remaining))
            }
          },
          false,
          opts.interval
        )
        const item = base as ICountDownTask
        item.endAt = endDt
        item.remaining = duration

        return {
          get id() {
            return item.id
          },
          remove: () => ticker.remove(item.id)
        }
      }
    }
  }
}

// ========================= Module Augmentation =========================

declare module '../Ticker' {
  interface Ticker {
    countDown(duration: number, callback: TickerCallback, options?: ICountDownOptions): ICountDownControl
  }
}
