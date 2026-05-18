/** 缓动函数签名：输入归一化时间 t(0→1)，输出归一化进度(0→1) */
export type TickerEasingFn = (t: number) => number

// ========================= Transform 简写映射 =========================

interface TransformDef {
  fn: string
  unit: string
  default: number
}

/** GSAP 风格 transform 简写属性 → CSS transform 函数映射 */
export const TRANSFORM_PROPS: Record<string, TransformDef> = {
  x: { fn: 'translateX', unit: 'px', default: 0 },
  y: { fn: 'translateY', unit: 'px', default: 0 },
  z: { fn: 'translateZ', unit: 'px', default: 0 },
  rotation: { fn: 'rotate', unit: 'deg', default: 0 },
  rotate: { fn: 'rotate', unit: 'deg', default: 0 },
  rotateX: { fn: 'rotateX', unit: 'deg', default: 0 },
  rotateY: { fn: 'rotateY', unit: 'deg', default: 0 },
  scale: { fn: 'scale', unit: '', default: 1 },
  scaleX: { fn: 'scaleX', unit: '', default: 1 },
  scaleY: { fn: 'scaleY', unit: '', default: 1 },
  skewX: { fn: 'skewX', unit: 'deg', default: 0 },
  skewY: { fn: 'skewY', unit: 'deg', default: 0 }
}

/** transform 合成顺序（translate → rotate → scale → skew），保证一致性 */
const TRANSFORM_ORDER = [
  'x', 'y', 'z',
  'rotation', 'rotate', 'rotateX', 'rotateY',
  'scale', 'scaleX', 'scaleY',
  'skewX', 'skewY'
] as const

/** 与 TRANSFORM_ORDER 平行：预取 fn 与 unit，热路径中避免 TRANSFORM_PROPS[prop] 查表 */
const TRANSFORM_ORDER_FN: string[] = TRANSFORM_ORDER.map(p => TRANSFORM_PROPS[p].fn)
const TRANSFORM_ORDER_UNIT: string[] = TRANSFORM_ORDER.map(p => TRANSFORM_PROPS[p].unit)

/** 每个 DOM 元素的 transform 缓存（避免重复解析 matrix） */
export const transformCache = new WeakMap<Element, Record<string, number>>()

/** 获取元素的 transform 缓存，不存在则创建 */
export function getTransformCache(el: Element): Record<string, number> {
  let cache = transformCache.get(el)
  if (!cache) {
    cache = {}
    transformCache.set(el, cache)
  }
  return cache
}

/** 将缓存中的 transform 值组合成 CSS transform 字符串 */
export function composeTransform(cache: Record<string, number>): string {
  let s = ''
  for (let i = 0; i < TRANSFORM_ORDER.length; i++) {
    const prop = TRANSFORM_ORDER[i]
    const v = cache[prop]
    if (v === undefined) continue
    s += TRANSFORM_ORDER_FN[i] + '(' + v + TRANSFORM_ORDER_UNIT[i] + ') '
  }
  return s.length === 0 ? 'none' : s.slice(0, -1)
}

// ========================= DOM / CSS 工具 =========================

/**
 * 从 CSSStyleDeclaration 中提取所有 CSS 属性名（string 值的 string key）。
 * 自动排除方法（getPropertyValue 等）和非字符串属性（length、parentRule 等）。
 */
export type CSSPropertyKey = {
  [K in Extract<keyof CSSStyleDeclaration, string>]: CSSStyleDeclaration[K] extends string ? K : never
}[Extract<keyof CSSStyleDeclaration, string>]

/** CSS 属性→动画目标值映射，IDE 自动补全所有 CSS 属性名 */
export type AnimateCSSProperties = Partial<Record<CSSPropertyKey, number | string>>

/** 不需要单位的 CSS 属性集合 */
export const UNITLESS_CSS = new Set([
  'opacity', 'zIndex', 'fontWeight', 'lineHeight',
  'orphans', 'widows', 'order', 'flexGrow', 'flexShrink',
  'columnCount', 'fillOpacity', 'strokeOpacity'
])

/** camelCase → kebab-case */
export function toKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase())
}

/** 解析 CSS 值字符串，如 "100px" → { value: 100, unit: "px" } */
export function parseCSSValue(raw: string): { value: number; unit: string } {
  const match = raw.match(/^([+-]?\d*\.?\d+)(.*?)$/)
  if (!match) return { value: 0, unit: '' }
  return { value: parseFloat(match[1]), unit: match[2].trim() }
}

/** 解析 CSS 选择器或 Element 引用为 DOM 元素 */
export function resolveEl(el: string | Element | undefined): Element | null {
  if (typeof el === 'string') return el.trim() === '' ? null : document.querySelector(el.trim())
  return el ?? null
}

/** 类型守卫：判断目标是 DOM 引用（string 选择器或 Element）还是普通对象 */
export function isElement(target: unknown): target is string | Element {
  return typeof target === 'string' || target instanceof Element
}

/** 解析动画目标值：支持绝对数字、带单位字符串 "100px"、相对值 "+=50" / "-=10" */
export function parseTarget(input: number | string, current: number): { to: number; unit: string } {
  if (typeof input === 'number') return { to: input, unit: '' }
  if (typeof input !== 'string') return { to: current, unit: '' }

  const relative = input.match(/^([+-])=(.+)$/)
  if (relative) {
    const { value, unit } = parseCSSValue(relative[2])
    return { to: current + (relative[1] === '+' ? value : -value), unit }
  }

  const { value, unit } = parseCSSValue(input)
  return { to: value, unit }
}

/** 读取目标对象/元素上某属性的当前值和单位 */
export function readCurrentValue(
  prop: string,
  el: HTMLElement | null,
  obj: Record<string, any> | null,
  computed: CSSStyleDeclaration | null
): { value: number; unit: string } {
  if (el && computed) {
    const tDef = TRANSFORM_PROPS[prop]
    if (tDef) {
      const cache = getTransformCache(el)
      return { value: cache[prop] ?? tDef.default, unit: tDef.unit }
    }
    const raw = computed.getPropertyValue(toKebab(prop)) || '0'
    const parsed = parseCSSValue(raw)
    return { value: parsed.value, unit: parsed.unit || (UNITLESS_CSS.has(prop) ? '' : 'px') }
  }
  return { value: Number(obj![prop]) || 0, unit: '' }
}

/**
 * 内置缓动函数集合。
 *
 * @example
 * ticker.countUp(99999, { easing: ease.easeOutCubic }, callback)
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
  easeCountUp: easeAsymmetricS(0.3)
} satisfies Record<string, TickerEasingFn>

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
export function easeAsymmetricS(skew: number): TickerEasingFn {
  return (t: number) => {
    const s = t < skew ? (t / skew) * 0.5 : 0.5 + ((t - skew) / (1 - skew)) * 0.5
    return s * s * (3 - 2 * s)
  }
}
