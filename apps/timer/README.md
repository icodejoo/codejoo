# @codejoo/timer

> A high-performance RAF-based timing engine. One global RAF loop drives bucket-mode O(1) task scheduling, with `setTimeout / setInterval / setImmediate / countDown / countUp` all built-in. Zero plugins, zero dependencies.

**中文版**: [README.zh-CN.md](./README.zh-CN.md)

---

## Features

- **Single RAF loop, O(1) scheduling** — Tasks sharing the same interval are grouped into one bucket. `add`, `remove`, and per-tick dispatch are all O(1).
- **Pause / resume time compensation** — Paused duration is excluded from `dt`, so no task "skips frames" after resume.
- **High-precision countDown** — `new Function`-generated zero-overhead formatter, three parser modes (shared / typed / callback).
- **Money-style countUp** — Same metaprogramming approach for thousands separators & decimal formatting; mid-flight `update(newTo)` for smooth retargeting.
- **Tiny** — Zero dependencies, no plugin system, all APIs are built into the `Timer` class.

## Install

```bash
pnpm add @codejoo/timer
```

## Quick start

```ts
import { Timer, ease, buildHighPerfFormatter } from "@codejoo/timer";

const timer = new Timer();

// RAF-based timeout / interval / immediate
timer.setTimeout((task) => console.log("1s later"), 1000);
const id = timer.setInterval((task) => console.log(task.updateAt), 1000);
timer.remove(id);

// Countdown
timer.countDown(60_000, (txt) => (el.textContent = txt));

// CountUp money formatter
timer.countUp(99999, { prefix: "$" }, (txt) => console.log(txt));
```

## API

### `new Timer(options?)`

| Option     | Type     | Default | Description                                               |
| ---------- | -------- | ------- | --------------------------------------------------------- |
| `interval` | `number` | `0`     | Global frame interval (ms). `33` ≈ 30fps. `0` = uncapped. |

| Method                               | Description                             |
| ------------------------------------ | --------------------------------------- |
| `setTimeout(cb, interval?, ...args)` | One-shot timer (default 1000ms)         |
| `setInterval(cb, opts?, ...args)`    | Periodic timer                          |
| `setImmediate(cb, ...args)`          | Run on the next frame                   |
| `countDown(duration, cb, opts?)`     | Countdown                               |
| `countUp(to, opts?, cb?)`            | Money / numeric counter                 |
| `remove(id)`                         | Cancel a task                           |
| `pause() / resume()`                 | Pause/resume RAF loop, time-compensated |
| `start() / stop()`                   | Reset / cancel RAF loop                 |
| `size`                               | Active task count                       |

Callback signature is `callback(task, ...args)` — `task` is always the first argument.

### countDown

```ts
import { buildHighPerfFormatter, createCountDownParser, buildCountDownFormatter } from "@codejoo/timer";

// Default formatter: 'HH:mm:ss'
timer.countDown(60_000, (txt) => (el.textContent = txt));

// Custom formatter
const fmt = buildHighPerfFormatter("DD天 HH:mm:ss.sss");
timer.countDown(86_500_000, (txt) => {}, { interval: 100, formatter: fmt });

// Parser modes
const sharedParser = createCountDownParser("shared", true); // { d, h, m, s, sss }
const typedParser = createCountDownParser("typed", true); // Int32Array(5)
const cbParser = createCountDownParser("callback", true); // (ms, cb)

// Chain parser → formatter
const f = buildCountDownFormatter(sharedParser, (d, h, m, s) => `${d}d ${h}h ${m}m ${s}s`);
```

### countUp

```ts
import { buildCountUpFormatter, ease } from "@codejoo/timer";

const ctrl = timer.countUp(
  99999,
  {
    prefix: "$",
    suffix: "",
    thousands: ",",
    decimal: ".",
    precision: 2,
    duration: 1500,
    easing: ease.easeCountUp,
    fps: 30,
    el: "#total", // optional: writes textContent directly
  },
  (txt) => console.log(txt),
);

ctrl.update(199999); // smooth retarget
ctrl.remove();
```

### Easing functions

```ts
import { ease, easeAsymmetricS } from "@codejoo/timer";

ease.linear;
ease.easeInQuad / easeOutQuad / easeInOutQuad;
ease.easeOutCubic / easeInOutCubic;
ease.easeCountUp; // asymmetric S-curve (default for countUp)
easeAsymmetricS(0.3); // custom skew
```

## Architecture

| File              | Role                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `Timer.ts`        | RAF loop, pause/resume, plus all built-in APIs (countDown/countUp/...) |
| `TimerManager.ts` | Bucket-mode O(1) scheduler (parallel arrays + epoch guard)             |
| `TimerTask.ts`    | Per-task state container                                               |
| `TimerHelper.ts`  | Easing functions & `resolveEl` helper                                  |

## Build & test

```bash
pnpm install
pnpm dev          # vite dev server at index.html
pnpm build        # outputs dist/index.mjs + dist/index.min.js
pnpm test         # vitest run (jsdom)
```

## License

MIT
