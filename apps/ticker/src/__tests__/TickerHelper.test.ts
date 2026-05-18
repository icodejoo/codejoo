import { describe, it, expect } from 'vitest'
import {
  ease,
  easeAsymmetricS,
  parseCSSValue,
  parseTarget,
  toKebab,
  resolveEl,
  isElement,
  composeTransform,
  getTransformCache
} from '../TickerHelper'

describe('ease — 内置缓动函数', () => {
  it('linear: 恒等', () => {
    expect(ease.linear(0)).toBe(0)
    expect(ease.linear(0.5)).toBe(0.5)
    expect(ease.linear(1)).toBe(1)
  })

  it('easeInQuad: t^2', () => {
    expect(ease.easeInQuad(0)).toBe(0)
    expect(ease.easeInQuad(0.5)).toBe(0.25)
    expect(ease.easeInQuad(1)).toBe(1)
  })

  it('easeOutQuad: t*(2-t)', () => {
    expect(ease.easeOutQuad(0)).toBe(0)
    expect(ease.easeOutQuad(1)).toBe(1)
    expect(ease.easeOutQuad(0.5)).toBe(0.75)
  })

  it('其他缓动端点恒为 0/1', () => {
    for (const fn of [ease.easeInOutQuad, ease.easeOutCubic, ease.easeInOutCubic, ease.easeCountUp]) {
      expect(fn(0)).toBeCloseTo(0, 5)
      expect(fn(1)).toBeCloseTo(1, 5)
    }
  })
})

describe('easeAsymmetricS(skew)', () => {
  it('端点恒为 0/1', () => {
    const fn = easeAsymmetricS(0.3)
    expect(fn(0)).toBeCloseTo(0, 5)
    expect(fn(1)).toBeCloseTo(1, 5)
  })

  it('skew=0.5 等同对称 smoothstep', () => {
    const fn = easeAsymmetricS(0.5)
    expect(fn(0.5)).toBeCloseTo(0.5, 5)
  })
})

describe('parseCSSValue', () => {
  it('"100px" → 100, px', () => {
    expect(parseCSSValue('100px')).toEqual({ value: 100, unit: 'px' })
  })
  it('"1.5em" → 1.5, em', () => {
    expect(parseCSSValue('1.5em')).toEqual({ value: 1.5, unit: 'em' })
  })
  it('"-10" → -10, ""', () => {
    expect(parseCSSValue('-10')).toEqual({ value: -10, unit: '' })
  })
  it('不可解析 → 0,""', () => {
    expect(parseCSSValue('abc')).toEqual({ value: 0, unit: '' })
  })
})

describe('parseTarget', () => {
  it('数字直接返回', () => {
    expect(parseTarget(100, 0)).toEqual({ to: 100, unit: '' })
  })
  it('"+=50" 相对当前值', () => {
    expect(parseTarget('+=50', 10)).toEqual({ to: 60, unit: '' })
  })
  it('"-=20px" 相对值带单位', () => {
    expect(parseTarget('-=20px', 100)).toEqual({ to: 80, unit: 'px' })
  })
  it('"100px" 绝对值带单位', () => {
    expect(parseTarget('100px', 0)).toEqual({ to: 100, unit: 'px' })
  })
})

describe('toKebab', () => {
  it('camelCase → kebab-case', () => {
    expect(toKebab('backgroundColor')).toBe('background-color')
    expect(toKebab('marginLeft')).toBe('-margin-left'.slice(1))  // 'margin-left'
    expect(toKebab('x')).toBe('x')
  })
})

describe('resolveEl / isElement', () => {
  it('resolveEl: 选择器 / Element / undefined', () => {
    const div = document.createElement('div')
    div.id = 'my-test-el'
    document.body.appendChild(div)
    expect(resolveEl('#my-test-el')).toBe(div)
    expect(resolveEl(div)).toBe(div)
    expect(resolveEl(undefined)).toBeNull()
    expect(resolveEl('')).toBeNull()
    document.body.removeChild(div)
  })

  it('isElement: 类型守卫', () => {
    expect(isElement('#x')).toBe(true)
    expect(isElement(document.createElement('div'))).toBe(true)
    expect(isElement({ x: 1 })).toBe(false)
  })
})

describe('transformCache / composeTransform', () => {
  it('空 cache → "none"', () => {
    expect(composeTransform({})).toBe('none')
  })

  it('单一属性正确拼接', () => {
    expect(composeTransform({ x: 100 })).toBe('translateX(100px)')
  })

  it('按 TRANSFORM_ORDER 顺序合成', () => {
    expect(composeTransform({ rotate: 45, x: 10, scale: 2 }))
      .toBe('translateX(10px) rotate(45deg) scale(2)')
  })

  it('getTransformCache: 同一元素返回同一缓存', () => {
    const el = document.createElement('div')
    const c1 = getTransformCache(el)
    const c2 = getTransformCache(el)
    expect(c1).toBe(c2)
  })
})
