import { describe, it, expect, vi } from 'vitest'
import { TickerManager } from '../TickerManager'

describe('TickerManager — add/remove/tick', () => {
  it('add: 返回 TickerTask，自增 id', () => {
    const m = new TickerManager()
    const t1 = m.add(() => {}, true, 100)
    const t2 = m.add(() => {}, true, 100)
    expect(t1.id).toBe(0)
    expect(t2.id).toBe(1)
    expect(m.size).toBe(2)
  })

  it('add: 相同 interval 的任务共享桶', () => {
    const m = new TickerManager()
    m.add(() => {}, false, 1000)
    m.add(() => {}, false, 1000)
    m.add(() => {}, false, 2000)
    expect(m.size).toBe(3)
  })

  it('tick: 到期才执行（dt - lastTick >= interval）', () => {
    const m = new TickerManager()
    const cb = vi.fn()
    m.add(cb, false, 1000)

    m.tick(500)
    expect(cb).not.toHaveBeenCalled()

    m.tick(1000)
    expect(cb).toHaveBeenCalledTimes(1)

    m.tick(1500)
    expect(cb).toHaveBeenCalledTimes(1)

    m.tick(2000)
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('回调签名：callback(task, ...args)', () => {
    const m = new TickerManager()
    const cb = vi.fn()
    const task = m.add(cb, true, 100, ['a', 'b'])
    m.tick(100)
    expect(cb).toHaveBeenCalledWith(task, 'a', 'b')
  })

  it('无 args 时走快路径，task 是唯一参数', () => {
    const m = new TickerManager()
    const cb = vi.fn()
    const task = m.add(cb, true, 100)
    m.tick(100)
    expect(cb).toHaveBeenCalledWith(task)
    expect(cb.mock.calls[0]).toHaveLength(1)
  })

  it('once 任务执行后自动 remove', () => {
    const m = new TickerManager()
    const cb = vi.fn()
    m.add(cb, true, 100)
    expect(m.size).toBe(1)
    m.tick(100)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(m.size).toBe(0)
    m.tick(200)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('remove: 立即移除，已 remove 的 id 再 remove 不抛错', () => {
    const m = new TickerManager()
    const cb = vi.fn()
    const t = m.add(cb, false, 100)
    m.remove(t.id)
    expect(m.size).toBe(0)
    m.tick(100)
    expect(cb).not.toHaveBeenCalled()
    expect(() => m.remove(t.id)).not.toThrow()
  })

  it('remove: O(1) swap-with-last 不会扰乱其他任务', () => {
    const m = new TickerManager()
    const calls: number[] = []
    const t1 = m.add(() => calls.push(1), false, 100)
    m.add(() => calls.push(2), false, 100)
    m.add(() => calls.push(3), false, 100)
    m.remove(t1.id)
    m.tick(100)
    expect(calls.sort()).toEqual([2, 3])
  })

  it('回调中移除其他任务安全（epoch 防重入）', () => {
    const m = new TickerManager()
    const calls: number[] = []
    const t1 = m.add(() => calls.push(1), false, 100)
    const t2 = m.add(() => {
      calls.push(2)
      m.remove(t1.id)
    }, false, 100)
    void t2
    m.tick(100)
    // t2 先被倒序执行（先 push 到 bucket 尾，倒序遍历先访问），移除 t1
    // 即便 t1 被 swap 上来，epoch 已被消费过则不会重复执行
    expect(calls).toEqual([2])
  })

  it('空桶回收：所有任务 remove 后并行数组同步收缩', () => {
    const m = new TickerManager()
    const t1 = m.add(() => {}, false, 100)
    const t2 = m.add(() => {}, false, 200)
    m.remove(t1.id)
    m.remove(t2.id)
    expect(m.size).toBe(0)
    // 再次 add 应该正常工作
    const cb = vi.fn()
    m.add(cb, true, 100)
    m.tick(100)
    expect(cb).toHaveBeenCalled()
  })

  it('多桶按各自 interval 独立到期', () => {
    const m = new TickerManager()
    const fast = vi.fn()
    const slow = vi.fn()
    m.add(fast, false, 100)
    m.add(slow, false, 500)
    m.tick(100); m.tick(200); m.tick(300); m.tick(400)
    expect(fast).toHaveBeenCalledTimes(4)
    expect(slow).toHaveBeenCalledTimes(0)
    m.tick(500)
    expect(slow).toHaveBeenCalledTimes(1)
  })
})
