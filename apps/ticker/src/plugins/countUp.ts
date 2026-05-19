import { Ticker, type TickerCallback, type TickerPlugin } from '../Ticker'
import { ease, resolveEl, type TickerEasingFn } from '../TickerHelper'

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
  /** 每秒最大回调次数，0 表示每帧都回调(~60fps，具体受Ticker.fps影响) */
  fps?: number
  /** 缓动函数，默认 easeCountUp（非对称 S 曲线）。运行时从 ease 对象读取 */
  easing?: TickerEasingFn
  /** 完全自定义格式化函数，优先于格式化配置 */
  formatter?: (value: number) => string
  /** 绑定 DOM 元素(CSS 选择器或 Element 引用)，每帧自动写入 textContent */
  el?: string | Element
}

/**
 * countUp 控制句柄，由 Ticker.countUp 返回。
 *
 * @example
 * const ctrl = ticker.countUp(99999, { prefix: '₱' }, (text) => { ... })
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

/** countUp 任务项，在 TickerTask 基础上扩展动画进度字段 */
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

/**
 * 元编程 countUp 格式化器工厂。
 *
 * 通过 `new Function` 在创建时将 precision、thousands、decimal、prefix、suffix
 * 硬编码进函数体，运行时无配置查找开销。
 * 内部使用分段截取(Chunking)算法处理千分位，避免正则回溯。
 *
 * @example
 * const fmt = createCountUpFormatter({ prefix: '₱', precision: 2 })
 * fmt(1234567.89) // "₱1,234,567.89"
 */
/** 转义字符串，安全嵌入 new Function 模板。处理反斜杠、双引号、换行/回车/制表符 */
function escapeLiteral(s: string): string {
  return s.replace(/[\\"\n\r\t]/g, ch => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' } as Record<string, string>)[ch])
}

export function buildCountUpFormatter(configs: ICountUpFormat): (value: number) => string {
  const { precision = 2, thousands = ',', decimal = '.', prefix = '', suffix = '' } = configs
  const PFX = escapeLiteral(prefix)
  const SFX = escapeLiteral(suffix)
  const THO = escapeLiteral(thousands)
  const DEC = escapeLiteral(decimal)

  // 紧凑单行形式:body 会丢给 new Function 编译,JS 解析对空白不敏感,
  // 故消除所有缩进/换行降低 minify 后产物体积。
  const decPart = precision > 0 ? `"${DEC}"+raw.substring(e+1)` : '""'
  const body =
    'return function(value){' +
      `var raw=value.toFixed(${precision}),n=value<0,d=raw.indexOf("."),s=n?1:0,e=d===-1?raw.length:d,l=e-s;` +
      `if(l<=0)return"${PFX}"+raw+"${SFX}";` +
      'var p="",f=l%3||3,i=s+f;' +
      'p=raw.substring(s,i);' +
      `while(i<e){p+="${THO}"+raw.substring(i,i+3);i+=3}` +
      `return(n?"-":"")+"${PFX}"+p+${decPart}+"${SFX}"` +
    '}'

  return new Function(body)()
}

/**
 * countUp 动画状态。封装 from/range/startDt，提供统一的 progress→value 计算。
 * RAF 回调和 control.update() 共用同一套计算逻辑，消除重复。
 */
class CountUpState {
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

  value(progress: number, easing: TickerEasingFn): number {
    return this.from + this.range * easing(progress)
  }

  /** 从当前动画位置重定向到新目标，重置动画时间线 */
  retarget(newTo: number, currentProgress: number, easing: TickerEasingFn) {
    this.from = this.value(currentProgress, easing)
    this.range = newTo - this.from
    this.startDt = -1
  }
}

export function countUp(pluginOptions?: ICountUpOptions): TickerPlugin {
  const baseDefaults: Omit<Required<ICountUpOptions>, 'formatter'> & { formatter: ICountUpOptions['formatter'] } = Object.assign({
    easing: ease.easeCountUp,
    prefix: '',
    fps: 30,
    precision: 2,
    from: 0,
    duration: 1000,
    el: '',
    suffix: '',
    thousands: ',',
    decimal: '.',
    useGrouping: true,
    formatter: undefined
  }, pluginOptions ?? {}) as any
  return {
    name: 'count-up',
    install(clazz: typeof Ticker) {
      clazz.prototype.countUp = function (to: number, options: any, callback?: any): ICountUpControl {
        const methodOpts: ICountUpOptions = typeof options === 'function' ? {} : (options ?? {})
        const cb: TickerCallback | null = typeof options === 'function' ? options : (callback ?? null)
        const merged = Object.assign({}, baseDefaults, methodOpts)
        // 若用户未显式提供 formatter，按当前 prefix/precision/thousands/decimal/suffix 懒构建
        const opts = Object.assign({}, merged, {
          formatter: merged.formatter ?? buildCountUpFormatter(merged)
        }) as Required<ICountUpOptions>

        const el = resolveEl(opts.el)
        if (el == null && cb == null) throw new Error('el or callback is required')

        const ticker = this
        const state = new CountUpState(opts.from ?? 0, to)
        const interval = opts.fps > 0 ? ~~(1000 / opts.fps) : 0

        const base = this.manager.add(
          function (task: ICountUpTask) {
            task.progress = state.progress(task.updateAt, opts.duration)
            task.current = state.value(task.progress, opts.easing)

            const text = opts.formatter(task.current)
            if (el) el.textContent = text
            if (cb) cb(text)

            if (task.progress >= 1) ticker.remove(task.id)
          },
          false,
          interval
        )
        const item = base as ICountUpTask
        item.progress = 0
        item.current = state.from

        return {
          get id() {
            return item.id
          },
          update(newTo: number) {
            const currentProgress = state.progress(item.updateAt, opts.duration)
            state.retarget(newTo, currentProgress, opts.easing)
          },
          remove: () => ticker.remove(item.id)
        }
      }
    }
  }
}

declare module '../Ticker' {
  interface Ticker {
    countUp(to: number, callback: TickerCallback): ICountUpControl
    countUp(to: number, options: ICountUpOptions, callback?: TickerCallback): ICountUpControl
    countUp(to: number, options: any, callback?: any): ICountUpControl
  }
}
