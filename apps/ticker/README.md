# @codejoo/ticker

> A high-performance RAF-based timing & animation engine. One global RAF loop drives bucket-mode O(1) task scheduling, with `tween / animate / countDown / countUp` plugins layered on top.

**中文版**: [README.zh-CN.md](./README.zh-CN.md)

---

## Features

- **Single RAF loop, O(1) scheduling** — Tasks sharing the same interval are grouped into one bucket. `add`, `remove`, and per-tick dispatch are all O(1).
- **Pause / resume time compensation** — Paused duration is excluded from `dt`, so no task "skips frames" after resume.
- **GSAP-like Tween** — `to / from / fromTo`, `pause / play / reverse / seek / restart / kill`, `repeat`, `yoyo`, `delay`, chained `onComplete`.
- **jQuery-style animate** — Backed by Tween, with all four overload signatures.
- **High-precision countDown** — `new Function`-generated zero-overhead formatter, three parser modes (shared / typed / callback).
- **Money-style countUp** — Same metaprogramming approach for thousands separators & decimal formatting; mid-flight `update(newTo)` for smooth retargeting.
- **Tiny** — Zero dependencies, ~10 KB minified.

## Install

```bash
pnpm add @codejoo/ticker
```

## Quick start

```ts
import { Ticker, tween, animate, countDown, countUp, ease } from '@codejoo/ticker'

// Install only what you need — tree-shaking removes unused exports
Ticker.extends(tween())
Ticker.extends(animate())     // animate runtime-depends on tween, install tween first
Ticker.extends(countDown())
Ticker.extends(countUp())

const ticker = new Ticker()

// RAF-based timeout / interval (core, no plugin needed)
ticker.setTimeout(task => console.log('1s later'), 1000)
const id = ticker.setInterval(task => console.log(task.updateAt), 1000)
ticker.remove(id)

// Tween with chain
ticker.to('#box', {
  left: 200, duration: 800, ease: ease.easeOutCubic,
  onComplete: chain => chain.to({ top: 100, duration: 400 })
})

// jQuery-style animate
ticker.animate('#box', { left: '+=100' }, 400)

// Countdown
ticker.countDown(60_000, txt => el.textContent = txt)

// CountUp money formatter
ticker.countUp(99999, { prefix: '$' }, txt => console.log(txt))
```

> **Note**: The package ships as a single `dist/index.mjs` with `"sideEffects": false`.
> If you only import `{ Ticker, countDown }`, your bundler's tree-shaker will drop
> tween / animate / countUp from the final bundle.

## API

### `new Ticker(options?)`

| Option     | Type     | Default | Description                                 |
|------------|----------|---------|---------------------------------------------|
| `interval` | `number` | `0`     | Global frame interval (ms). `33` ≈ 30fps. `0` = uncapped. |

| Method                            | Description                                  |
|-----------------------------------|----------------------------------------------|
| `setTimeout(cb, interval?, ...args)` | One-shot timer (default 1000ms)           |
| `setInterval(cb, opts?, ...args)`    | Periodic timer                            |
| `setImmediate(cb, ...args)`          | Run on the next frame                     |
| `remove(id)`                         | Cancel a task                             |
| `pause() / resume()`                 | Pause/resume RAF loop, time-compensated   |
| `start() / stop()`                   | Reset / cancel RAF loop                   |
| `size`                               | Active task count                         |

Callback signature is `callback(task, ...args)` — `task` is always the first argument.

### Tween plugin

```ts
import { tween, ease } from '@codejoo/ticker'
Ticker.extend(tween())

const tw = ticker.to(target, {
  // CSS properties or any object keys
  left: 200, opacity: 0.5, x: 100, rotate: 45,
  // config
  duration: 800, ease: ease.easeOutCubic, delay: 100,
  repeat: 2, yoyo: true,
  onStart, onUpdate, onComplete, onRepeat
})

tw.pause(); tw.play(); tw.reverse()
tw.seek(0.5); tw.restart(); tw.kill()
```

- **CSS shorthand transforms**: `x / y / z / rotate / rotateX / rotateY / scale / scaleX / scaleY / skewX / skewY`
- **Relative values**: `'+=20'`, `'-=10px'`
- **Targets**: CSS selector / Element / plain object
- **Chain**: `onComplete: chain => chain.to({ ... })`

### animate plugin (jQuery-style)

```ts
import { animate } from '@codejoo/ticker'
Ticker.extend(animate())

ticker.animate('#box', { left: 200 })
ticker.animate('#box', { left: 200 }, 400)
ticker.animate('#box', { left: 200 }, 400, () => console.log('done'))
ticker.animate('#box', { left: 200 }, 400, ease.easeOutCubic, done)
ticker.animate('#box', { left: 200 }, {
  duration: 400, easing: ease.easeOutCubic,
  progress: (p, remaining) => {}, complete: chain => {}
})
```

### countDown plugin

```ts
import {
  countDown,
  buildHighPerfFormatter,
  createCountDownParser,
  buildCountDownFormatter
} from '@codejoo/ticker'
Ticker.extend(countDown())

// Default formatter: 'HH:mm:ss'
ticker.countDown(60_000, txt => el.textContent = txt)

// Custom formatter
const fmt = buildHighPerfFormatter('DD天 HH:mm:ss.sss')
ticker.countDown(86_500_000, txt => {}, { interval: 100, formatter: fmt })

// Parser modes
const sharedParser = createCountDownParser('shared', true)    // { d, h, m, s, sss }
const typedParser  = createCountDownParser('typed', true)     // Int32Array(5)
const cbParser     = createCountDownParser('callback', true)  // (ms, cb)

// Chain parser → formatter
const f = buildCountDownFormatter(sharedParser, (d, h, m, s) => `${d}d ${h}h ${m}m ${s}s`)
```

### countUp plugin

```ts
import { countUp, buildCountUpFormatter } from '@codejoo/ticker'
Ticker.extend(countUp())

const ctrl = ticker.countUp(99999, {
  prefix: '$', suffix: '',
  thousands: ',', decimal: '.', precision: 2,
  duration: 1500, easing: ease.easeCountUp,
  fps: 30,
  el: '#total'   // optional: writes textContent directly
}, txt => console.log(txt))

ctrl.update(199999)   // smooth retarget
ctrl.remove()
```

### Easing functions

```ts
import { ease, easeAsymmetricS } from '@codejoo/ticker'

ease.linear
ease.easeInQuad / easeOutQuad / easeInOutQuad
ease.easeOutCubic / easeInOutCubic
ease.easeCountUp           // asymmetric S-curve (default for countUp)
easeAsymmetricS(0.3)       // custom skew
```

## Architecture

| File                | Role                                                          |
|---------------------|---------------------------------------------------------------|
| `Ticker.ts`         | RAF loop, pause/resume, plugin entry                          |
| `TickerManager.ts`  | Bucket-mode O(1) scheduler (parallel arrays + epoch guard)    |
| `TickerTask.ts`     | Per-task state container                                      |
| `TickerHelper.ts`   | CSS/transform utils, easing functions                         |
| `TickerTween.ts`    | GSAP-like tween engine                                        |
| `TickerAnimate.ts`  | jQuery-style facade over Tween                                |
| `TickerCountDown.ts`| Countdown + metaprogrammed formatters & parsers               |
| `TickerCountUp.ts`  | Money/numeric counter + metaprogrammed formatter              |

## Build & test

```bash
pnpm install
pnpm dev          # vite dev server at index.html
pnpm build        # tsc + vite library build → dist/index.es.js
pnpm test         # vitest run (jsdom)
```

## License

MIT
