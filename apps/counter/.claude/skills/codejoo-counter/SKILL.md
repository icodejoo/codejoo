---
name: codejoo-counter
description: Work on apps/counter (@codejoo/counter) — a browser count-up/count-down engine with a shared rAF ticker and tree-shakeable render plugins (card / odometer / ring). Use when adding features, render plugins, or fixing/optimizing this package.
---

# codejoo-counter

`apps/counter` (`@codejoo/counter`): one shared `requestAnimationFrame` ticker drives all
**count-up** animations and **count-down** timers; rendering is a pluggable function.

## Architecture (src/)

- **core/** — the singleton ticker. `counter.start/stop/use(plugin)/destroy`; plugins are
  `{ name, install(now,dt), api?, dispose? }`. count-up & count-down each self-`use()` on first task.
- **groups.ts** — shared group/queue scaffold (label → `Map<id, task>`), used by both up & down.
- **count-up/** — `countup` (default export). `count-up.ts` = engine/tick, `helper.ts` = easings +
  formatter builders (internal), `type.ts` = public types.
- **count-down/** — `countdown`. `count-down.ts` = engine/tick, `helper.ts` = parsers/formatters,
  `types.ts` = public types. Non-ms tasks render only when the integer second changes (built-in throttle).
- **plugins/** — render functions, **runtime-standalone** (import count-down only via `type`):
  `card.ts` (flip/slide/calendar, `card.css`), `odometer.ts` (rolling digits, shares `cd-*`),
  `ring.ts` (circular 7-seg countdown, `ring.css`), `shared.ts` (internal-only `isDigit`/`maskOf`,
  no runtime deps, safe for every plugin entry to import without pulling anything else in).
  Each `create*Render()` returns the render fn **plus `destroy(el?)`** that releases references
  without mutating host DOM.
- **index.ts** — umbrella re-export.

## Render contract

- count-up: `render(el, value, ctx)` — `ctx` has `value/from/to/fmt/el/id/active/paused`. Don't
  pre-format; call `ctx.fmt(value)` only when you need a string.
- count-down: `render(el, remaining, value, ctx)` — `value` is the reused `[d,h,m,s,ms]` tuple;
  `ctx.fmt(remaining)` formats. `ctx.oldValue` is an independent snapshot of `value` taken right
  before the last time it actually changed (untouched on throttled/no-op frames) — use it to diff
  which units just rolled over. Contexts/tuples are **reused per frame — never hold across frames**.

## Conventions / invariants

- Zero-allocation hot path; reuse arrays/objects, no per-frame allocation in tick/render.
- State is keyed per host `Element` in a `WeakMap`, so one render instance serves many elements.
- Skip DOM writes when the value is unchanged (cache last value on the element) — avoids style
  recalc + re-raster (this is what keeps 100 ring instances at ~60fps).
- ring colours/widths are **CSS-variable driven** (`--rg-*`); options override by writing the var
  inline (option > stylesheet). Per-frame zone colour = `.rg-zone-*` class; callbacks → inline color.
- ring geometry uses **ceil-to-whole-second** so a 5s countdown shows `5…0` and the whole UI
  zeroes the instant the digits read `00:00`.

## Build / test

```sh
pnpm test            # vitest (jsdom); tests live next to source as *.test.ts
pnpm check           # vp fmt + vp lint (oxfmt/oxlint configs)
pnpm build           # multi-entry ESM (dist/*.mjs + *.d.mts) + copy css
```

- **Multi-entry build** (vite.config.ts): `index`, `count-down`, `count-up`, `card`, `odometer`,
  `ring` each emit a file; subpath exports in package.json let callers tree-shake
  (`@codejoo/counter/ring` pulls ring only).
- Lint on **test files** is not a gate (sibling tests carry warnings); source must be 0 errors.

## Manual verify / stress

- `index.html` — full API playground (open `/` via a Vite dev server: `vite --port 5191`).
  `ring-demo.html` (ring options) and `ring-stress.html` (100 instances) also exist.
- `scripts/cdp-*.mjs` drive real Chrome over CDP for FPS/memory/trace; `cdp-ring-stress.mjs`
  measures the 100-instance ring (read `pageRafFps`; disable background throttling, beware
  no-GPU/headless boxes capping fps). `glow` (drop-shadow) is the dominant GPU cost — default off.

## Gotchas

- Don't break the reuse contract: a render must tolerate being called every frame with the same
  value (idempotent, cached writes).
- `lazy` tasks anchor their deadline/animation only on entering the viewport (IntersectionObserver);
  if a lazy task is `pause()`d before it ever becomes active, activation defers anchoring the
  deadline until `resume()` — don't recompute `deadline` from the viewport-entry moment while paused.
- count-down handles cadence (per-second for non-ms tasks); don't add call-rate dedup inside
  plugins for that case. But a plugin that itself quantizes to a coarser grain than the engine does
  (e.g. ring's ceil-to-whole-second) still gets called every frame for `showMilliseconds` tasks —
  cache your own quantized key (see ring's `state.lastRemMs`) and bail before doing any formatting.
