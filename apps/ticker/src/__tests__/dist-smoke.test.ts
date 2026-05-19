/**
 * Smoke test against the terser-post-minified dist bundle.
 * Verifies that mangling `_*` private fields doesn't break runtime behavior.
 */
import { describe, it, expect } from 'vitest'
// @ts-ignore — minified runtime bundle, no .d.ts
import * as Dist from '../../dist/index.min.js'

const { Ticker, tween, animate, countDown, countUp, ease, buildCountUpFormatter, buildHighPerfFormatter } = Dist

describe('dist/index.min2.js smoke', () => {
  it('buildCountUpFormatter still works (new Function path)', () => {
    expect(buildCountUpFormatter({ prefix: '$' })(1234567.89)).toBe('$1,234,567.89')
  })

  it('buildHighPerfFormatter still works', () => {
    expect(buildHighPerfFormatter('HH:mm:ss')(3661000)).toBe('01:01:01')
  })

  it('Ticker + 4 plugins still install + run', () => {
    class T extends Ticker {}
    T.extends(tween()); T.extends(animate()); T.extends(countDown()); T.extends(countUp())
    const t = new T(); t.stop()

    const obj = { v: 0 }
    t.to(obj, { v: 100, duration: 100, ease: ease.linear })
    t.manager.tick(0); t.manager.tick(100)
    expect(obj.v).toBeCloseTo(100, 0)
  })

  it('animate (depends on tween)', () => {
    class T extends Ticker {}
    T.extends(tween()); T.extends(animate())
    const t = new T(); t.stop()
    const obj = { v: 0 }
    t.animate(obj, { v: 50 }, 100, ease.linear, () => {})
    t.manager.tick(0); t.manager.tick(100)
    expect(obj.v).toBeCloseTo(50, 0)
  })

  it('countDown + countUp', () => {
    class T extends Ticker {}
    T.extends(countDown()); T.extends(countUp())
    const t = new T(); t.stop()

    let cdTxt = ''
    t.countDown(2000, (txt: string) => { cdTxt = txt })
    t.manager.tick(0); t.manager.tick(1000)
    expect(cdTxt.length).toBeGreaterThan(0)

    let cuTxt = ''
    t.countUp(100, { duration: 100, fps: 0, prefix: '$' }, (txt: string) => { cuTxt = txt })
    t.manager.tick(0); t.manager.tick(100)
    expect(cuTxt.startsWith('$')).toBe(true)
  })

  it('pause / resume / setTimeout', () => {
    class T extends Ticker {}
    const t = new T(); t.stop()
    let fired = 0
    t.setTimeout(() => { fired++ }, 500)
    t.manager.tick(500)
    expect(fired).toBe(1)
    t.manager.tick(1500)
    expect(fired).toBe(1)
  })
})
