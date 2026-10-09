# skeletonizer

Skeleton screens for the web, Flutter-`skeletonizer` style: render your **real DOM** with **mock data**, and let **pure CSS** turn the leaves into skeleton bones. No hand-drawn placeholder shapes to maintain.

> 中文文档（更详细）：[README.zh-CN.md](./README.zh-CN.md)
>
> Coding agents: read [llms.md](./llms.md) for the condensed usage guide (also shipped in the npm package); see [AI coding agents](#ai-coding-agents) to wire it in.

## Contents

- [Quick start](#quick-start)
- [Entry points](#entry-points): a base plus opt-in variants
- [Which setup to use](#which-setup-to-use)
- [Comparison](#comparison): measured performance, colour, compatibility
- [Schemes in detail](#schemes-in-detail)
- [Markers](#markers) · [Theming](#theming) · [Browser support](#browser-support) · [AI coding agents](#ai-coding-agents) · [Develop](#develop)

## Quick start

```bash
pnpm add skeletonizer
```

```ts
// app entry: one base + the variants you need
import "skeletonizer/base.css"; // theme, interaction lock, inferred bones, fade / solid
import "skeletonizer/global"; // pulse / shimmer (root-driven + inheritance firewall, JS-driven SVG on old browsers), ships global.css

import { enable, Bone } from "skeletonizer";

const off = enable(document.querySelector("#card")!, { effect: "shimmer" });
// render your real component with mock data while loading:
const user = loading ? { name: Bone.text(8), bio: Bone.lines(2), avatar: Bone.image(48, 48) } : data;
// data arrived:
off();
```

Everything at once: `import "skeletonizer/all";`.

### `enable()` options

| Option     | Values                                                     | Notes                                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `effect`   | `fade` (default) / `solid` / `sweep` / `pulse` / `shimmer` | `sweep` needs `sweep.css`; `pulse` / `shimmer` need the `global` or `svg` variant (fall back to `fade` otherwise)                                                                                                                                      |
| `text`     | `underline` (default) / `leaf`                             | how text bones are drawn                                                                                                                                                                                                                               |
| `engine`   | `global` / `svg`                                           | implementation of `pulse` / `shimmer`; defaults to whichever variant is loaded (`global` wins when both are)                                                                                                                                           |
| `fallback` | `svg` (default) / `fade`                                   | what the `global` scheme does on browsers without `@property`: JS attaches an SVG animation (`svg`) or keeps the base fade (`fade`); old browsers show fade until JS runs                                                                              |
| `fps`      | number (24–30) / `"auto"`                                  | `global` scheme without list markup: drive the animation from a throttled JS ticker; ignored when the firewall finds list items                                                                                                                        |
| `fit`      | boolean (default `false`)                                  | the skeleton never grows a scrollbar: the root is capped at the space left in its scroll ancestor (or the viewport) and list items fully outside it get `display: none`; re-measured on resize. `<skz-box fit>` / React / Vue / Svelte pass it through |

Calling `enable()` again is safe: attributes are re-synced, omitted options are cleared, list items / ignore regions / theme variables are re-read.

### Framework adapters

```ts
import { vSkeleton, SkzBox, useSkeleton, SkzPlugin } from "skeletonizer/vue";
import { SkzBox, useSkeleton } from "skeletonizer/react";
import { skeleton } from "skeletonizer/svelte";
```

Adapters use the same core, so the variants imported at the app entry apply to them too. Frameworks are optional peer dependencies.

### Custom element / pure HTML

```ts
import { defineSkzBox } from "skeletonizer";
defineSkzBox();
```

```html
<skz-box loading effect="shimmer"><div class="card" skz>…</div></skz-box>
<!-- `loading` on the host is the switch; `skz` lands on its FIRST element child (the skeleton root), never on the host itself -->
<!-- SSR / no JS: write `skz` on that child yourself, e.g. <skz-box loading><div skz>…</div></skz-box>; it hits the CSS fallback layer, and enable() is idempotent once JS boots -->
<!-- no JS: write the root attributes yourself (no firewall, ticker, runtime SVG or inert lock) -->
<div skz skz-effect="shimmer">…</div>
```

`<skz-box>` only tracks its own `loading` attribute (plus `effect` / `text` / `fallback` / `engine` / `fps`). It does not use a MutationObserver: if a framework replaces the first child, toggle `loading` once (off, then on) so the new child is picked up and the old one is disabled. Moving the host to another parent keeps the loading state.

## Entry points

Styles and runtime are split into a base plus variants. Sizes are gzip.

| Entry                                                   | What                                                                                                                                               | Size                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `skeletonizer/base.css`                                 | **Base (pick one):** theme, interaction lock, four-tier bone inference, explicit markers, ignore regions, fade / solid, lazy pause, reduced motion | 1.30 KB                 |
| `skeletonizer/explicit.css`                             | **Base (pick one):** same, but **no inference rules**: only `skz-bone` / `skz-leaf` become bones; cheaper style recalc                             | 0.76 KB                 |
| `skeletonizer`                                          | Runtime core: `enable` / `disable`, `Bone`, `<skz-box>`, `registerCustomElements`. No CSS, SSR-safe                                                | 3.3 KB                  |
| `skeletonizer/vue`, `/react`, `/svelte`                 | Framework adapters                                                                                                                                 | +0.1–0.5 KB             |
| `skeletonizer/global` (`/global/js`, `global.css`)      | Root-driven `pulse` / `shimmer`, inheritance firewall, JS ticker, JS-driven SVG for old browsers                                                   | +2.4 KB JS, 0.56 KB CSS |
| `skeletonizer/svg` (`/svg/js`, `svg.css`)               | `pulse` / `shimmer` from one shared animated SVG background, exact theme colours generated at runtime                                              | +1.0 KB JS, 0.20 KB CSS |
| `skeletonizer/sweep.css`                                | Sweep highlight bar (CSS only)                                                                                                                     | 0.59 KB                 |
| `skeletonizer/all` (`/all/js`, `all.css` = `style.css`) | `base` + every variant                                                                                                                             | +2.4 KB JS, 2.07 KB CSS |

- Variant entries with CSS start with `import "./<name>.css"`, so bundlers (Vite, webpack, Next.js, Rollup) pull the styles in; `sideEffects` is declared so they are not tree-shaken.
- **No bundler / Node / SSR:** import the `/js` entry and link the matching `.css` file yourself. The core and `/js` entries import fine in Node.
- Importing only `skeletonizer/svg` leaves the firewall, ticker and root-driven CSS out of the bundle (verified with a Vite build).

## Which setup to use

| Scenario                                                        | Use                                                                                                    | Why                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Ordinary page, small skeleton (a few hundred elements)          | `base.css` (fade), optionally + `global` for shimmer                                                   | fade costs almost nothing; everything is 60 fps at this size                         |
| Long lists / feeds / tables with `shimmer` / `pulse`            | `base.css` + `global`                                                                                  | the firewall keeps off-screen items out of per-frame work: 60 fps at 16,000 elements |
| Same, bones can be marked by hand, lowest cost                  | `explicit.css` + `global`                                                                              | no inference selectors: per-frame style work drops another ~60%                      |
| Large skeleton without list markup (big form, long detail page) | `global` + `fps: "auto"`, or `svg`                                                                     | the ticker lowers the update rate; `svg` has no per-frame style work                 |
| Must animate on Chrome < 119 / Safari < 16.4 / Firefox < 128    | `global` (falls back to SVG automatically) or `svg`                                                    | SVG animation does not need `@property`                                              |
| Product mandates the old-browser effect                         | `global` + `fallback` (`svg` / `fade`)                                                                 | only applies without `@property`                                                     |
| Exact control over which elements become bones                  | `explicit.css`                                                                                         | everything unmarked renders as-is                                                    |
| Bundle-size sensitive                                           | `base.css` alone (fade only) or `base.css` + one variant                                               | pay only for what you load                                                           |
| Strict CSP                                                      | allow `img-src blob:` (the SVG scheme and the old-browser SVG fallback); `data:` only for `Bone.image` | runtime SVGs are blob URLs; no SVG data URIs ship in the CSS                         |

## Comparison

Desktop Chrome on Windows, i5-13500 with integrated GPU, a card list (~8 elements per card), median of 3 runs. "Style" is per-frame `UpdateLayoutTree` time in ms; 16.6 ms is one frame. Raw data, scripts and screenshots live in [`bench/`](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/bench/README.md). Safari, Firefox and mobile were not measured.

| Scheme                                            | 4,000 elements: fps / style | 16,000 elements: fps / style  |
| ------------------------------------------------- | --------------------------- | ----------------------------- |
| fade (default) / solid                            | 60 / 0.1                    | 60 / 0.2                      |
| sweep                                             | 60 / 0.3                    | 60 / 1.1 (+ ~6 ms PrePaint)   |
| shimmer, `global`, pure CSS (no JS)               | 57 / 12.9                   | 17 / 49.3                     |
| shimmer, `global` via `enable()` (firewall)       | 60 / 1.9                    | **60 / 6.8**                  |
| shimmer, `global` + firewall + `explicit.css`     | 60 / 1.2                    | **60 / 2.8**                  |
| shimmer, `global`, pure CSS + `explicit.css`      | 60 / 7.4                    | 24 / 31.9                     |
| shimmer, `global`, no list markup + `fps: "auto"` | 60                          | ~47 (animation ~12 updates/s) |
| shimmer, `svg`                                    | 60 / 0.1 (3.5 PrePaint)     | 54 / 0.1 (15.6 PrePaint)      |

- `pulse` / `shimmer` cost is style recalc: the animated variable on the root is inherited, so every element recalculates each frame (~2.3 µs per element).
- The **inheritance firewall** is the big win: off-screen list items pin the variables and their subtrees stop recalculating. It needs JS (`enable()` / an adapter + `global`) and list-like markup.
- `explicit.css` makes each recalculation cheaper (−35–44% without the firewall, about −60% with it).
- The JS ticker writes inline variables on the root, which bypasses the firewall (60 → 27–39 fps at 16,000 elements), so the library uses the firewall whenever it finds list items.

| Scheme           | Colour                        | Browser requirement                                                                                                                       | Main trade-off                                                                     |
| ---------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| fade / solid     | exact                         | CSS variables                                                                                                                             | fade dims everything in the root                                                   |
| sweep            | blend-mode approximation      | CSS variables, `mix-blend-mode`                                                                                                           | sets `position: relative` + `overflow-x: clip` on the root and takes its `::after` |
| global           | exact                         | `@property` (detected via relative colour syntax: Chrome 119+, Safari 16.4+, Firefox 128+), else SVG attached by JS (fade before JS runs) | slow at scale without JS; iOS shimmer becomes a colour pulse                       |
| svg              | exact via JS, fade without JS | SMIL                                                                                                                                      | underline text stays static; CSP needs `img-src blob:`                             |
| explicit markers | —                             | as the base                                                                                                                               | every bone must be marked                                                          |

Tried and not adopted: an SVG filter that silhouettes content (60 fps but loses structure and light content, breaks `skz-ignore`), a canvas mask with a compositor-driven band (4–7 s to build the mask at 16,000 elements), the CSS Paint API (heavier off-main-thread, Chromium only), per-bone animations (the old approach, removed), `steps()` throttling (no effect). Details in [`bench/`](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/bench/README.md).

## Schemes in detail

- **fade / solid** (base): fade pulses the root's opacity on the compositor. With `skz-ignore` inside the root the implicit default skips fade (it would dim the ignored content); pass `effect: "fade"` to force it.
- **global**: one CSS animation on the root drives registered properties (`@property`) that bones inherit; colours come straight from `--skz-color` / `--skz-highlight`. Shimmer uses a `background-attachment: fixed` gradient so all bones stay in sync. Through `enable()` the **firewall** finds the list items (skipping single-child wrappers) and marks off-screen ones with `skz-fw` via one shared `IntersectionObserver`; their bones stay static until 200px before they scroll in, and items inserted later join on the next `enable()` call. Without list markup, `fps` (number or `"auto"`, which adapts between every 1–4 frames) throttles updates. Without `@property` it falls back to the SVG animation (`fallback` changes that).
- **svg**: bones share one SMIL-animated SVG background, so nothing in CSS changes per frame. Through `enable()` the SVG is generated at runtime from the root's `--skz-highlight` and `--skz-duration` (blob URL, exact colours, shared and ref-counted, regenerated on system theme change). Without JS (or if blob generation fails) the root has no `skz-engine` attribute and shows the base fade; the CSS ships no SVG data URIs. Override with `--skz-svg-shimmer` / `--skz-svg-pulse`.
- **sweep**: one `::after` bar per root, moved by `transform`. Give it a dedicated, unstyled root element. `skz-sweep="bg"` uses the container colour instead of blend modes.
- **explicit.css**: only `skz-bone` / `skz-leaf` are bones; descendants of a bone are hidden; media bones push their real content out of the box. Bones keep the element's own `border-radius` (round avatars stay round). Explicit mode is only available by loading `explicit.css` instead of `base.css`; there is no per-root switch.
- **Lazy rendering**: roots scrolled out of the viewport get `skz-paused` and stop animating. `skz-cv` adds `content-visibility: auto` to the root's children (clips their overflow, slower to enable with many children).

## Markers

| Attribute                            | On      | Meaning                                                                                 |
| ------------------------------------ | ------- | --------------------------------------------------------------------------------------- |
| `skz`                                | root    | skeleton on (added by `enable()`; write it yourself in pure HTML)                       |
| `skz-effect` / `skz-text`            | root    | effect and text mode                                                                    |
| `skz-engine="svg"`                   | root    | written by the SVG scheme once its blob image is attached; no attribute means fade      |
| `skz-has-ignore`                     | root    | set by `enable()` when the root contains `skz-ignore`; **add it yourself in pure HTML** |
| `skz-cv` / `skz-sweep="bg"`          | root    | skip off-screen children / sweep container-colour mode                                  |
| `skz-bone`                           | element | force this element to be one bone (e.g. a `div` used as an image or avatar)             |
| `skz-leaf`                           | element | merge the whole subtree into one bone                                                   |
| `skz-ignore`                         | element | keep as real content; stays clickable and focusable while loading                       |
| `skz-paused` / `skz-fw` / `skz-tick` | runtime | internal state, do not write by hand                                                    |

## Theming

Variables are declared on the root itself, so override them **on the root element**, not `:root`:

```css
[skz] {
  --skz-color: #e0e0e0;
  --skz-highlight: #f0f0f0;
  --skz-radius: 6px;
  --skz-duration: 1.2s;
}
```

Dark mode follows `prefers-color-scheme`; force it with `data-skz-theme="dark"` or `"light"` on `<html>`. `prefers-reduced-motion: reduce` stops every animation. Mock data: `Bone.text(n)`, `Bone.lines(k)`, `Bone.cjk(n)`, `Bone.number(d)`, `Bone.image(w, h)`, all deterministic.

## Browser support

Progressive tiers, no UA sniffing: no CSS variables → flat grey fallback; CSS variables → tag-based bones, fade / solid / sweep, svg scheme; `text-decoration-thickness` → underline text bones; `:has()` → leaf mode and icon heuristics; `@property` → global root-driven animation (else SVG fallback). Verified on desktop Chrome only; fallbacks were simulated in Chrome. Safari, Firefox, iOS and Android WebView are untested.

## AI coding agents

Agents do not auto-load docs from `node_modules`. Paste this into your project's `AGENTS.md` / `CLAUDE.md`:

```md
## Skeleton screens

Loading states use skeletonizer. Before writing one, read `node_modules/skeletonizer/llms.md` and follow it.
```

## Develop

```bash
pnpm dev     # demo on :5188 (effect, scheme, ticker, tier, dark mode switches)
pnpm build   # multi-entry JS (dist/*.mjs + .d.mts) and six CSS entries (src/styles/entries → dist/*.css)
pnpm test    # vitest
pnpm check   # fmt + lint + type-check
```

Architecture: [ARCHITECTURE.md](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/ARCHITECTURE.md). Performance report: [docs/reports](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/reports/2026-10-08-performance.md).

MIT
