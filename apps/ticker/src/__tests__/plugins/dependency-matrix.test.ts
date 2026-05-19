/**
 * 插件依赖矩阵 —— 把每个插件之间的依赖关系做成显式矩阵证明。
 *
 * 当前依赖关系:
 *
 * |              | tween | animate | countDown | countUp |
 * |--------------|:-----:|:-------:|:---------:|:-------:|
 * | tween        |   —   |    ←    |     ·     |    ·    |
 * | animate      |  依赖 |    —    |     ·     |    ·    |
 * | countDown    |   ·   |    ·    |     —     |    ·    |
 * | countUp      |   ·   |    ·    |     ·     |    —    |
 *
 *  ← 表示"被依赖":animate 依赖 tween,tween 不依赖 animate。
 *  · 表示无依赖关系。
 *
 * 用每个 plugin 单装的方式验证:
 *  - 装 X 后 ticker.X 可用
 *  - 装 X 后 ticker.{其他} 仍然不可用(除非 X 依赖那个其他)
 *  - 装 animate 但不装 tween → animate 调用抛错
 */
import { describe, it, expect } from 'vitest'
import { tween, animate, countDown, countUp } from '../../index'
import { createTestTicker } from '../helpers'

const API: Record<string, string[]> = {
  tween: ['to', 'from', 'fromTo'],
  animate: ['animate'],
  countDown: ['countDown'],
  countUp: ['countUp']
}

const FACTORY = { tween, animate, countDown, countUp } as const
type PluginName = keyof typeof FACTORY

function tickerWith(...names: PluginName[]) {
  return createTestTicker(names.map(n => FACTORY[n]()))
}

describe('依赖矩阵 — 单装某 plugin,其他 plugin 的 API 都不可用', () => {
  for (const [name, methods] of Object.entries(API)) {
    it(`单装 ${name}: 仅 ${methods.join('/')} 可用`, () => {
      // animate 单装会因依赖 tween 而调用失败,但接口还是会被装上(install 不报错)
      const { ticker } = tickerWith(name as PluginName)
      for (const m of methods) {
        expect(typeof (ticker as any)[m]).toBe('function')
      }
      // 其他 plugin 的 API 都不该挂上
      const otherMethods = Object.entries(API)
        .filter(([n]) => n !== name)
        .flatMap(([, ms]) => ms)
      for (const m of otherMethods) {
        expect((ticker as any)[m]).toBeUndefined()
      }
    })
  }
})

describe('依赖矩阵 — animate 运行时依赖 tween', () => {
  it('animate 单装: install 不报错,但调用 ticker.animate(...) 抛 TypeError', () => {
    const { ticker } = tickerWith('animate')
    expect(typeof ticker.animate).toBe('function')
    expect(() => ticker.animate({ v: 0 }, { v: 100 }, 100)).toThrow(TypeError)
  })

  it('tween + animate: 二者皆可用', () => {
    const { ticker, advance } = tickerWith('tween', 'animate')
    const obj = { v: 0 }
    ticker.animate(obj, { v: 100 }, 100)
    advance(0); advance(100)
    expect(obj.v).toBeCloseTo(100, 0)
  })

  it('安装顺序: tween 必须在 animate 之前', () => {
    // 反过来 install: animate 先,tween 后。install 不报错(install 只设原型方法),
    // 实际调用时,因 animate 调用的是 this.to —— 此时 tween 已装 → 也能工作。
    // 所以顺序在 install 时不严格,但调用 animate 前必须保证 tween 已装。
    const { ticker, advance } = createTestTicker([animate(), tween()])
    const obj = { v: 0 }
    expect(() => ticker.animate(obj, { v: 100 }, 100)).not.toThrow()
    advance(0); advance(100)
    expect(obj.v).toBeCloseTo(100, 0)
  })
})

describe('依赖矩阵 — countDown / countUp 之间互不依赖', () => {
  it('countDown 单装: countUp 不可用,countDown 可用', () => {
    const { ticker } = tickerWith('countDown')
    expect(typeof ticker.countDown).toBe('function')
    expect((ticker as any).countUp).toBeUndefined()
  })

  it('countUp 单装: countDown 不可用,countUp 可用', () => {
    const { ticker } = tickerWith('countUp')
    expect(typeof ticker.countUp).toBe('function')
    expect((ticker as any).countDown).toBeUndefined()
  })

  it('countDown + countUp 二者共存: 互不干扰', () => {
    const { ticker, advance } = tickerWith('countDown', 'countUp')
    let cdTxt = ''
    let cuTxt = ''
    ticker.countDown(2000, t => (cdTxt = t))
    ticker.countUp(100, { duration: 200, fps: 0 }, t => (cuTxt = t))
    advance(0); advance(200); advance(1000); advance(2000)
    expect(cdTxt.length).toBeGreaterThan(0)
    expect(cuTxt.length).toBeGreaterThan(0)
  })
})

describe('依赖矩阵 — tween 自身无任何插件依赖', () => {
  it('单装 tween: to/from/fromTo 全可用', () => {
    const { ticker } = tickerWith('tween')
    expect(typeof ticker.to).toBe('function')
    expect(typeof ticker.from).toBe('function')
    expect(typeof ticker.fromTo).toBe('function')
    expect((ticker as any).animate).toBeUndefined()
    expect((ticker as any).countDown).toBeUndefined()
    expect((ticker as any).countUp).toBeUndefined()
  })

  it('单装 tween 可独立完成动画(不需要任何其他插件)', () => {
    const { ticker, advance } = tickerWith('tween')
    const obj = { v: 0 }
    ticker.to(obj, { v: 100, duration: 100 })
    advance(0); advance(100)
    expect(obj.v).toBeCloseTo(100, 0)
  })
})

describe('依赖矩阵 — 全装场景', () => {
  it('全装 4 个插件: 所有 API 都可用', () => {
    const { ticker } = tickerWith('tween', 'animate', 'countDown', 'countUp')
    const allMethods = Object.values(API).flat()
    for (const m of allMethods) {
      expect(typeof (ticker as any)[m]).toBe('function')
    }
  })
})
