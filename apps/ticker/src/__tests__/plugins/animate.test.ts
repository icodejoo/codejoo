/**
 * animate 插件端到端测试。
 *
 * **重要**:animate 插件依赖 tween。本测试同时验证:
 * 1. 仅装 animate 不装 tween → 调用抛错(依赖证明)
 * 2. 装 tween + animate → 正常工作(各种重载)
 */
import { describe, it, expect, vi } from 'vitest'
import { tween, animate, ease } from '../../index'
import { createTestTicker } from '../helpers'

describe('animate — 依赖关系证明(必须先装 tween)', () => {
  it('仅装 animate(未装 tween): ticker.animate(...) 抛 TypeError', () => {
    const { ticker } = createTestTicker([animate()])
    // animate 内部调用 this.to(...),tween 未装则 to 是 undefined
    expect(() => ticker.animate({ v: 0 }, { v: 100 })).toThrow(TypeError)
  })

  it('装 tween + animate: 调用正常', () => {
    const { ticker, advance } = createTestTicker([tween(), animate()])
    const obj = { v: 0 }
    ticker.animate(obj, { v: 100 }, 200, ease.linear, () => {})
    advance(0); advance(200)
    expect(obj.v).toBeCloseTo(100, 0)
  })

  it('单装 tween(不装 animate): ticker.animate 不存在', () => {
    const { ticker } = createTestTicker([tween()])
    expect((ticker as any).animate).toBeUndefined()
    // 但 to 应在
    expect(typeof (ticker as any).to).toBe('function')
  })
})

describe('animate — 多种重载', () => {
  it('(target, props)', () => {
    const { ticker, advance } = createTestTicker([tween(), animate()])
    const obj = { v: 0 }
    ticker.animate(obj, { v: 100 })
    advance(0); advance(400)
    expect(obj.v).toBeCloseTo(100, 0)
  })

  it('(target, props, duration)', () => {
    const { ticker, advance } = createTestTicker([tween(), animate()])
    const obj = { v: 0 }
    ticker.animate(obj, { v: 100 }, 200)
    advance(0); advance(200)
    expect(obj.v).toBeCloseTo(100, 0)
  })

  it('(target, props, duration, complete)', () => {
    const { ticker, advance } = createTestTicker([tween(), animate()])
    const obj = { v: 0 }
    const done = vi.fn()
    ticker.animate(obj, { v: 100 }, 200, done)
    advance(0); advance(200)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('(target, props, duration, easing, complete)', () => {
    const { ticker, advance } = createTestTicker([tween(), animate()])
    const obj = { v: 0 }
    const done = vi.fn()
    ticker.animate(obj, { v: 100 }, 200, ease.linear, done)
    advance(0); advance(100)
    expect(obj.v).toBeCloseTo(50, 0)
    advance(200)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('(target, props, options)', () => {
    const { ticker, advance } = createTestTicker([tween(), animate()])
    const obj = { v: 0 }
    const progress = vi.fn()
    const complete = vi.fn()
    ticker.animate(obj, { v: 100 }, {
      duration: 200,
      easing: ease.linear,
      progress,
      complete
    })
    advance(0); advance(100); advance(200)
    expect(progress).toHaveBeenCalled()
    expect(complete).toHaveBeenCalledTimes(1)
  })
})

describe('animate — 控制句柄', () => {
  it('stop(): 保留当前位置', () => {
    const { ticker, advance } = createTestTicker([tween(), animate()])
    const obj = { v: 0 }
    const ctrl = ticker.animate(obj, { v: 100 }, 400, ease.linear, () => {})
    advance(0); advance(200)
    const mid = obj.v
    ctrl.stop()
    advance(400)
    expect(obj.v).toBe(mid)
  })

  it('stop(true): 跳到终态', () => {
    const { ticker, advance } = createTestTicker([tween(), animate()])
    const obj = { v: 0 }
    const ctrl = ticker.animate(obj, { v: 100 }, 400, ease.linear, () => {})
    advance(0); advance(200)
    ctrl.stop(true)
    expect(obj.v).toBeCloseTo(100, 0)
  })

  it('id getter 返回任务 ID', () => {
    const { ticker } = createTestTicker([tween(), animate()])
    const ctrl = ticker.animate({ v: 0 }, { v: 1 }, 100)
    expect(typeof ctrl.id).toBe('number')
  })
})

describe('animate — DOM 目标 + relative', () => {
  it('"+=" 相对动画', () => {
    const { ticker, advance } = createTestTicker([tween(), animate()])
    const el = document.createElement('div')
    document.body.appendChild(el)
    el.style.left = '50px'
    ticker.animate(el, { left: '+=50' }, 200, ease.linear, () => {})
    advance(0); advance(200)
    expect(parseFloat(el.style.left)).toBeCloseTo(100, 1)
    document.body.removeChild(el)
  })
})
