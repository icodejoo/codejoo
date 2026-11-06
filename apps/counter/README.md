# @codejoo/counter

A tiny, high‑performance counting engine for the browser. One shared `requestAnimationFrame`
ticker drives every **count‑up** animation and **count‑down** timer, with pluggable render
functions — plain text by default, or rich SVG/DOM render plugins (flip cards, odometer, ring).

- **count‑up** — animate a number `from → to` with easing, fps throttling, custom format/render, lazy start, grouping, pause/resume.
- **count‑down** — count down to a deadline (ms / unit / `Date` / date‑string) with formatter, lazy start, grouping and lifecycle hooks.
- **One ticker** — a single rAF loop runs all tasks; auto‑starts on the first task, auto‑stops when idle. Zero‑allocation hot path.
- **Render plugins** — opt‑in, separately importable (tree‑shakeable), runtime‑independent of the core:
  - **card** — flip / slide / calendar flip‑clock digit cards.
  - **odometer** — rolling‑digit odometer (`minimal` / `full`).
  - **ring** — circular seven‑segment countdown: tick ring + dual decorative arcs + draining progress ring.

## Install

```sh
pnpm add @codejoo/counter
```

## Quick start

```ts
import { countup, countdown } from "@codejoo/counter";

countup(1234, "#total"); // animate 0 → 1234
countup(0, 99.9, { duration: 2000, fmt: (n) => n.toFixed(1) });
countdown(60_000, "#timer", { fmt: "mm:ss" }); // 1-minute countdown
countdown("2026-12-31 23:59:59", "#newyear", { fmt: "DD HH:mm:ss" });
```

## Render plugins

Plugins are separate entry points, so you only ship what you import:

```ts
import { countdown } from "@codejoo/counter/count-down";
import { createCardRender } from "@codejoo/counter/card";
import "@codejoo/counter/card.css";
countdown(3600_000, "#clock", { render: createCardRender({ effect: "flip" }) });
```

```ts
import { countup } from "@codejoo/counter/count-up";
import { createOdometerRender } from "@codejoo/counter/odometer";
import "@codejoo/counter/card.css"; // odometer shares the cd-* styles
countup(0, 1234567, "#odo", { render: createOdometerRender({ strip: "full" }) });
```

```ts
import { countdown } from "@codejoo/counter/count-down";
import { createRingRender } from "@codejoo/counter/ring";
import "@codejoo/counter/ring.css";
countdown(300_000, "#ring", { fmt: "mm:ss", render: createRingRender() });
```

Per-plugin options & API: [card](./docs/card.md) · [odometer](./docs/odometer.md) · [ring](./docs/ring.md).

## Entry points

| Import                        | Contents                                            |
| ----------------------------- | --------------------------------------------------- |
| `@codejoo/counter`            | everything (core + count-up + count-down + plugins) |
| `@codejoo/counter/count-down` | `countdown` + types                                 |
| `@codejoo/counter/count-up`   | `countup` + types                                   |
| `@codejoo/counter/card`       | `createCardRender`                                  |
| `@codejoo/counter/odometer`   | `createOdometerRender`                              |
| `@codejoo/counter/ring`       | `createRingRender`                                  |

Each render plugin is runtime-standalone (it depends on count-down only via types), so importing
`/ring` pulls in `ring` alone — nothing else.

## API essentials

**`countup(...)`** — overloads: `countup(to)`, `countup(to, label)`, `countup(to, opts)`,
`countup(from, to, label)`, `countup(from, to, opts)`, `countup({ el, from, to, ...opts })`.
Options: `duration` (ms, default 1000), `easing` `(t)=>t`, `fps` (0 = every frame), `fmt`
`(value, ctx)=>string`, `render`, `lazy` (default true), `observer`, `lazyTimeout`, `label`,
`autoKill` (default true — drop the task & call the render's destroy on finish), `muteHidden` (default true, see below), and hooks `onStart/onUpdate/onDone/onPause/onResume`. Returns a numeric task id.
Management: `countup.remove(id, label?)`, `.pause`, `.resume`, `.clear(label?)`, `.group(label, config)`, `.defaults`.

**`countdown(deadline, el, opts | label)`** — `deadline` is a ms duration / `Date` / date-string
(use `dateParser` for unit durations). Options: `fmt` (template like `HH:mm:ss` / `DD HH:mm:ss.sss`,
or a function), `showDays`, `showMilliseconds`, `timeOffset`, `dateParser`, `render`, `lazy`,
`autoKill`, `observer`, `lazyTimeout`, `label`, `fps` (render-rate cap for `showMilliseconds` tasks; whole-second tasks only render when the second changes), `muteHidden` (default true), hooks `onStart/onUpdate/onDone/onDestroy/onPause/onResume`.
A relative duration (`countdown(60000, …)`) runs on the **monotonic clock**, so changing the system time
never shifts it (an absolute `Date` / timestamp / date-string follows the wall clock; after
`pause()` → `resume()` any task continues on the monotonic clock). Time the machine spent asleep while
the page was hidden is added back when the page becomes visible again.
Same management methods as count-up. `render`/hooks receive a shared `ctx` with `value` (the
reused `[d,h,m,s,ms]` tuple, mutated every tick) and `ctx.oldValue` — an independent snapshot of
`value` right before the last time it actually changed (untouched on frames the tick throttles
away), handy for diffing which units just rolled over.

**core** — `import { counter, createLazyObserver } from "@codejoo/counter"`. `counter` exposes
`start() / stop() / use(plugin) / destroy()`; count-up & count-down self-register on first use.
`createLazyObserver(opts)` builds a reusable `IntersectionObserver` for `lazy` tasks.

## Develop

```sh
pnpm dev      # watch build
pnpm build    # multi-entry ESM build + copy css
pnpm test     # vitest (jsdom)
pnpm check    # format + lint
```

Manual API playground: open `/` (index.html) under a Vite dev server (`vite`).

## Power & visibility

- **One shared ticker, sleeps when it can.** A plugin's `install(now, dt)` may return `true` (next frame), `false`
  (idle) or a positive number — "call me again in at least N ms". When every busy plugin returns a number the
  ticker stops polling every frame and sleeps on one timer; adding/resuming/removing tasks wakes it. A page of
  1-second countdowns created together costs ~1 wake-up per second instead of 60 frames.
- **Hidden tab.** `requestAnimationFrame` stops in background tabs, so the ticker switches to timers while the
  page is hidden: `onDone` still fires on time (about 1 s granularity, the browser's limit) instead of waiting for
  the user to come back.
- **`muteHidden` (default `true`).** While the page is hidden or the element is outside the viewport the task skips
  `render` / `onUpdate`; progress and completion still follow real time, and it refreshes to the current value the
  moment it is visible again. Count-up tasks without an `el` are never muted. Pass `muteHidden: false` to keep updating.
