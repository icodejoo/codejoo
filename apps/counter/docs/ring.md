# ring — circular seven‑segment countdown

`createRingRender(options?)` → a **count‑down** render plugin drawing four concentric layers
(outer→inner): **tick ring** (one mark per second of the current minute), **arcA / arcB**
(two decorative arcs spinning opposite ways, meeting at zero), and an **inner progress ring**
that drains each second (last minute split red/yellow/green by threshold). Needs `ring.css`.

```ts
import { countdown } from "@codejoo/counter/count-down";
import { createRingRender } from "@codejoo/counter/ring";
import "@codejoo/counter/ring.css";

countdown(300_000, "#ring", { fmt: "mm:ss", render: createRingRender() });
```

## Top‑level options

| option | type | default | notes |
| --- | --- | --- | --- |
| `redAt` / `yellowAt` | `number` | `3` / `10` | seconds thresholds for the last‑minute colour zones |
| `clockwise` | `boolean` | `true` | direction of tick drain / inner drain / arc rotation |
| `glow` | `boolean` | `false` | `drop-shadow` glow (GPU‑heavy; off by default — enable for a few instances only) |
| `colors` | `Partial<IRingColors>` | — | `{ normal, green, yellow, red, off }`; also written as CSS vars `--rg-*` (options win over the stylesheet) |
| `ticks` `arcA` `arcB` `inner` `digit` | `false \| {…}` | shown | per‑part config; `false` (or `{ display:false }`) skips generating that SVG entirely |

## Per‑part config

- **`ticks`**: `count` (60), `radius` (46.5), `width` (2.6), `length` (8.5), `colorAt(info)→string|undefined`, `render(frame)`.
- **`arcA` / `arcB`**: `radius`, `width`, `segments` (3), `span` (deg, 60), `colorAt(info)→string`, `render(frame)`.
- **`inner`**: `radius` (27.5), `width` (2.8), `track` (base colour), `colorAt(minuteInfo)→string` (per‑minute colour; last minute stays tri‑colour), `render(frame)`.
- **`digit`**: `mode` (`"segment"` default | `"text"`), `size` (46), `font`, `colorAt(info)→string`, `render(frame)`.

Callbacks (don't duplicate count‑down's lifecycle hooks):
`colorAt({ remaining, totalMin, sec, colors })` overrides the current theme colour;
`ticks.colorAt({ index, total, on, finalMin, … })` colours each mark;
`inner.colorAt({ index, count, fromMs, toMs, … })` colours each minute (its `count` is the total
minutes, computed from the initial duration). Any part's `render(frame)` takes over drawing with
pre‑computed params + the host `<g>` (e.g. `ticks` frame gives `lit` / `zoneAt`, `inner` gives `angleAt` / `total`).

```ts
createRingRender({
  glow: true,
  colors: { normal: "#22d3ee" },
  digit: { mode: "text", font: "Orbitron, monospace" },
  arcB: false,                                   // hide the inner arc ring
  inner: { colorAt: ({ index }) => palette[index] },
});
```

## Returns

Render function plus `destroy(el?)` (release element state / drop all state; never mutates host DOM).

Colours/line‑widths are CSS‑variable driven (`--rg-normal`, `--rg-w-arcA`, `--rg-glow`, …); the
seconds value is rounded up to whole seconds (a 5s countdown starts at `5`, hits `0` exactly).
