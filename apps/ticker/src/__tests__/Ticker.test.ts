import { describe, it, expect, vi, afterEach } from 'vitest'
import { Ticker } from '../Ticker'
import { createTestTicker } from './helpers'

describe('Ticker — API', () => {
  afterEach(() => vi.useRealTimers())

  it('setTimeout: 到期执行一次，返回任务 ID', () => {
    const { ticker, advance } = createTestTicker()
    const cb = vi.fn()
    const id = ticker.setTimeout(cb, 1000)
    expect(typeof id).toBe('number')
    advance(500)
    expect(cb).not.toHaveBeenCalled()
    advance(1000)
    expect(cb).toHaveBeenCalledTimes(1)
    advance(2000)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('setTimeout: 默认 1000ms', () => {
    const { ticker, advance } = createTestTicker()
    const cb = vi.fn()
    ticker.setTimeout(cb)
    advance(999)
    expect(cb).not.toHaveBeenCalled()
    advance(1000)
    expect(cb).toHaveBeenCalled()
  })

  it('setInterval: 周期触发', () => {
    const { ticker, advance } = createTestTicker()
    const cb = vi.fn()
    ticker.setInterval(cb, 1000)
    advance(1000); advance(2000); advance(3000)
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it('setInterval(boolean): immediate 语义占位（接口不抛错）', () => {
    const { ticker } = createTestTicker()
    expect(() => ticker.setInterval(() => {}, true)).not.toThrow()
  })

  it('setInterval({ interval, immediate })', () => {
    const { ticker, advance } = createTestTicker()
    const cb = vi.fn()
    ticker.setInterval(cb, { interval: 500, immediate: false })
    advance(500)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('setImmediate: 下一次 tick 立即执行', () => {
    const { ticker, advance } = createTestTicker()
    const cb = vi.fn()
    ticker.setImmediate(cb)
    advance(0)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('remove: 取消已注册任务', () => {
    const { ticker, advance } = createTestTicker()
    const cb = vi.fn()
    const id = ticker.setInterval(cb, 500)
    ticker.remove(id)
    advance(500); advance(1000)
    expect(cb).not.toHaveBeenCalled()
  })

  it('size getter: 反映 manager.size', () => {
    const { ticker } = createTestTicker()
    expect(ticker.size).toBe(0)
    ticker.setInterval(() => {}, 100)
    expect(ticker.size).toBe(1)
    ticker.setInterval(() => {}, 200)
    expect(ticker.size).toBe(2)
  })

  it('paused / pause / resume 状态切换', () => {
    const { ticker } = createTestTicker()
    expect(ticker.paused).toBe(false)
    ticker.pause()
    expect(ticker.paused).toBe(true)
    ticker.resume()
    expect(ticker.paused).toBe(false)
  })

  it('pause/resume 重复调用无副作用', () => {
    const { ticker } = createTestTicker()
    ticker.pause(); ticker.pause()
    expect(ticker.paused).toBe(true)
    ticker.resume(); ticker.resume()
    expect(ticker.paused).toBe(false)
  })

  it('多个回调可挂同一 interval', () => {
    const { ticker, advance } = createTestTicker()
    const a = vi.fn(), b = vi.fn()
    ticker.setInterval(a, 100)
    ticker.setInterval(b, 100)
    advance(100)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('Ticker.defaults: 全局默认 interval', () => {
    const original = Ticker.defaults.interval
    Ticker.defaults.interval = 33
    const t = new Ticker()
    t.stop()
    expect(t.frameInterval).toBe(33)
    Ticker.defaults.interval = original
  })

  it('start: 重置时间基准', () => {
    const { ticker } = createTestTicker()
    const before = ticker.beginAt
    ticker.start()
    ticker.stop()
    expect(ticker.beginAt).toBeGreaterThanOrEqual(before)
  })

  it('extends: 插件 install 被调用，返回类本身可链式', () => {
    const install = vi.fn()
    class T extends Ticker {}
    const r = T.extends({ name: 'test-plugin-x', install })
    expect(install).toHaveBeenCalledWith(T)
    expect(r).toBe(T)
  })

  it('extend: 旧别名等价于 extends', () => {
    const install = vi.fn()
    class T extends Ticker {}
    T.extend({ name: 'test-plugin-y', install })
    expect(install).toHaveBeenCalledWith(T)
  })

  it('installedPlugins: 记录已安装插件名', () => {
    class T extends Ticker {}
    const before = T.installedPlugins.length
    T.extends({ name: 'p1', install: () => {} })
    T.extends({ name: 'p2', install: () => {} })
    const names = T.installedPlugins
    expect(names.length).toBeGreaterThanOrEqual(before + 2)
    expect(names).toContain('p1')
    expect(names).toContain('p2')
  })
})
