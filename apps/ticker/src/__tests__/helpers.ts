import { Ticker } from '../Ticker'
import type { TickerPlugin } from '../Ticker'

/**
 * 创建一个**与全局 Ticker 隔离**的子类，并仅安装指定插件。
 *
 * 关键：插件 install 时通过 `clazz.prototype.foo = ...` 修改 prototype，
 * 由于 subclass 有独立 prototype，原始 Ticker.prototype 不受污染。
 * 这让我们能精确测试"未安装 X 插件时 ticker.X() 不可用"的依赖关系。
 *
 * @example
 * const T = isolatedTickerClass([animate()])  // 装 animate 但不装 tween
 * const t = new T(); t.stop()
 * expect(() => t.animate(obj, { v: 1 })).toThrow()  // tween 缺失 → 抛错
 */
export function isolatedTickerClass(plugins: TickerPlugin[]): typeof Ticker {
  class IsolatedTicker extends Ticker {}
  for (const p of plugins) IsolatedTicker.extends(p)
  return IsolatedTicker
}

/**
 * 创建一个被手动控制时间的 Ticker：
 * - 构造后立即 stop()，禁用真实 RAF 循环
 * - 通过 advance(dt) 直接调用 manager.tick(dt) 模拟时间推进
 */
export function createTestTicker(plugins: TickerPlugin[] = [], opts?: ConstructorParameters<typeof Ticker>[0]) {
  const Klass = isolatedTickerClass(plugins)
  const ticker = new Klass(opts)
  ticker.stop()
  return {
    ticker,
    Klass,
    /** 推进 dt 到指定毫秒，触发到期任务 */
    advance(dt: number) {
      ticker.manager.tick(dt)
    }
  }
}
