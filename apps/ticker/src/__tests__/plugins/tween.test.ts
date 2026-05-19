/**
 * tween 插件端到端测试。
 *
 * 隔离方式：通过 createTestTicker([tween()]) 创建独立子类，
 * 与其他测试的 prototype 不共享。
 */
import { describe, it, expect, vi } from 'vitest'
import { tween, ease } from '../../index'
import { createTestTicker } from '../helpers'

describe('tween — 对象目标', () => {
  it('to: 在 duration 内插值，end 触发 onComplete', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 0 }
    const onStart = vi.fn()
    const onUpdate = vi.fn()
    const onComplete = vi.fn()
    ticker.to(obj, { v: 100, duration: 1000, ease: ease.linear, onStart, onUpdate, onComplete })

    advance(0)
    expect(onStart).toHaveBeenCalledTimes(1)

    advance(500)
    expect(obj.v).toBeCloseTo(50, 1)

    advance(1000)
    expect(obj.v).toBeCloseTo(100, 1)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalled()
  })

  it('from: 起始值为 vars，结束回到当前值', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 100 }
    ticker.from(obj, { v: 0, duration: 1000, ease: ease.linear })
    expect(obj.v).toBe(0)
    advance(0); advance(500)
    expect(obj.v).toBeCloseTo(50, 1)
    advance(1000)
    expect(obj.v).toBeCloseTo(100, 1)
  })

  it('fromTo: 显式起止', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 0 }
    ticker.fromTo(obj, { v: 10 }, { v: 20, duration: 1000, ease: ease.linear })
    expect(obj.v).toBe(10)
    advance(0); advance(500)
    expect(obj.v).toBeCloseTo(15, 1)
    advance(1000)
    expect(obj.v).toBeCloseTo(20, 1)
  })

  it('delay: 在 delay 完成前不开始', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 0 }
    const onStart = vi.fn()
    ticker.to(obj, { v: 100, duration: 500, delay: 500, ease: ease.linear, onStart })
    advance(0); advance(300)
    expect(onStart).not.toHaveBeenCalled()
    expect(obj.v).toBe(0)
    advance(600)
    expect(onStart).toHaveBeenCalled()
  })

  it('repeat + onRepeat', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 0 }
    const onRepeat = vi.fn()
    ticker.to(obj, { v: 100, duration: 200, repeat: 2, ease: ease.linear, onRepeat })
    advance(0); advance(200); advance(400)
    expect(onRepeat).toHaveBeenCalledTimes(2)
  })

  it('yoyo: 偶数次回到起点', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 0 }
    const onComplete = vi.fn()
    ticker.to(obj, { v: 100, duration: 200, repeat: 1, yoyo: true, ease: ease.linear, onComplete })
    advance(0); advance(200); advance(400)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(obj.v).toBeCloseTo(0, 0)
  })

  it('infinite repeat 不触发 onComplete', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 0 }
    const onComplete = vi.fn()
    ticker.to(obj, { v: 100, duration: 100, repeat: -1, ease: ease.linear, onComplete })
    for (let t = 0; t <= 1000; t += 100) advance(t)
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe('tween — 控制句柄', () => {
  it('pause / play', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 0 }
    const tw = ticker.to(obj, { v: 100, duration: 1000, ease: ease.linear })
    advance(0); advance(300)
    tw.pause()
    const snapshot = obj.v
    advance(500); advance(700)
    expect(obj.v).toBe(snapshot)
    tw.play()
    advance(900); advance(1900); advance(2000)
    expect(obj.v).toBeCloseTo(100, 0)
  })

  it('kill: 立即停止', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 0 }
    const tw = ticker.to(obj, { v: 100, duration: 1000, ease: ease.linear })
    advance(0); advance(300)
    const before = obj.v
    tw.kill()
    advance(500); advance(1000)
    expect(obj.v).toBe(before)
  })

  it('seek: 跳到指定进度', () => {
    const { ticker } = createTestTicker([tween()])
    const obj = { v: 0 }
    const tw = ticker.to(obj, { v: 100, duration: 1000, ease: ease.linear })
    tw.seek(0.5)
    expect(obj.v).toBeCloseTo(50, 1)
    tw.seek(1)
    expect(obj.v).toBeCloseTo(100, 1)
    expect(tw.progress).toBe(1)
  })

  it('reverse: 反向播放', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 0 }
    const tw = ticker.to(obj, { v: 100, duration: 1000, ease: ease.linear })
    advance(0); advance(500)
    tw.reverse()
    advance(700); advance(1000)
    expect(obj.v).toBeLessThan(50)
  })

  it('restart: 重置进度', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 0 }
    const tw = ticker.to(obj, { v: 100, duration: 1000, ease: ease.linear })
    advance(0); advance(800)
    tw.restart()
    advance(900)
    expect(obj.v).toBeLessThan(50)
  })

  it('isActive: 活跃状态', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const tw = ticker.to({ v: 0 }, { v: 1, duration: 100, ease: ease.linear })
    expect(tw.isActive).toBe(true)
    tw.pause()
    expect(tw.isActive).toBe(false)
    tw.play()
    advance(0); advance(100)
    expect(tw.isActive).toBe(false)
  })
})

describe('tween — DOM 目标', () => {
  it('CSS 普通属性', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const el = document.createElement('div')
    document.body.appendChild(el)
    el.style.left = '0px'
    ticker.to(el, { left: 100, duration: 100, ease: ease.linear })
    advance(0); advance(100)
    expect(el.style.left).toBe('100px')
    document.body.removeChild(el)
  })

  it('Transform 简写: x → translateX', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const el = document.createElement('div')
    document.body.appendChild(el)
    ticker.to(el, { x: 50, duration: 100, ease: ease.linear })
    advance(0); advance(100)
    expect(el.style.transform).toContain('translateX(50px)')
    document.body.removeChild(el)
  })

  it('relative "+=" 语法', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const el = document.createElement('div')
    document.body.appendChild(el)
    el.style.left = '10px'
    ticker.to(el, { left: '+=20', duration: 100, ease: ease.linear })
    advance(0); advance(100)
    expect(parseFloat(el.style.left)).toBeCloseTo(30, 1)
    document.body.removeChild(el)
  })

  it('选择器字符串', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const el = document.createElement('div')
    el.id = 'tween-target-isolated'
    document.body.appendChild(el)
    ticker.to('#tween-target-isolated', { x: 100, duration: 100, ease: ease.linear })
    advance(0); advance(100)
    expect(el.style.transform).toContain('translateX(100px)')
    document.body.removeChild(el)
  })

  it('找不到元素 → 抛错', () => {
    const { ticker } = createTestTicker([tween()])
    expect(() => ticker.to('#absolutely-no-such-element', { x: 100 })).toThrow()
  })
})

describe('tween — chain', () => {
  it('onComplete chain.to 串联下一段', () => {
    const { ticker, advance } = createTestTicker([tween()])
    const obj = { v: 0 }
    let chained: any = null
    ticker.to(obj, {
      v: 100, duration: 100, ease: ease.linear,
      onComplete: chain => { chained = chain.to({ v: 200, duration: 100, ease: ease.linear }) }
    })
    advance(0); advance(100)
    expect(chained).not.toBeNull()
    advance(200); advance(300)
    expect(obj.v).toBeCloseTo(200, 0)
  })
})
