# skeletonizer — usage guide for coding agents

Skeleton screens from the **real component tree**: while loading, render the same components the page uses, fed with **mock data** from `Bone`, inside a skeleton **root**. Pure CSS turns the leaves into grey bones. There are no separate placeholder components to write.

## Steps

1. **Import one base and the variants you need, once, at the app entry.** Without a base stylesheet nothing changes on screen.

   ```ts
   import "skeletonizer/base.css"; // base: bones inferred from markup, fade / solid (or "skeletonizer/explicit.css": only skz-bone)
   import "skeletonizer/global"; // pulse / shimmer, root-driven + inheritance firewall + JS-driven SVG on old browsers; brings global.css
   // alternatives: "skeletonizer/svg" (SVG-animated pulse / shimmer), "skeletonizer/sweep.css", "skeletonizer/tofu.css" (block-font text mode, only needed for `text: "tofu"`), or "skeletonizer/all" for everything
   ```

   - No bundler, or code that runs in Node / SSR: use the `/js` entries (`skeletonizer/global/js`, `/svg/js`, `/all/js`) and link the matching `.css` (`skeletonizer/global.css` …) yourself. Entries without `/js` import a `.css` file and need a bundler.
   - The core `skeletonizer` entry has no CSS and is safe to import anywhere.
   - No bundler in the browser: use an import map (map only the entry files; serve the whole `dist/` as-is, the files reference shared chunks relatively) and `<link>` the CSS. The package is not published to npm yet, so the CDN URLs only work after the first release.

     ```html
     <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/skeletonizer/dist/base.css" />
     <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/skeletonizer/dist/global.css" />
     <script type="importmap">
       { "imports": { "skeletonizer": ".../dist/index.mjs", "skeletonizer/global/js": ".../dist/global-js.mjs" } }
     </script>
     <script type="module">
       import { enable } from "skeletonizer";
       import "skeletonizer/global/js";
     </script>
     ```

     Entry files: `skeletonizer` → `dist/index.mjs`, `/global/js` → `dist/global-js.mjs`, `/svg/js` → `dist/svg-js.mjs`, `/all/js` → `dist/all-js.mjs`; CSS: `dist/base.css`, `explicit.css`, `global.css`, `svg.css`, `sweep.css`, `tofu.css`, `all.css`.

2. **Wrap the loading region in a root**, using the adapter for the project's framework:

   | Stack        | Code                                                                                                                                                                                                                                                                                                                                              |
   | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | React        | `import { SkzBox } from "skeletonizer/react"` → `<SkzBox loading={loading} effect="shimmer">…</SkzBox>`                                                                                                                                                                                                                                           |
   | React (hook) | `useSkeleton(ref, loading, { effect })` with `ref` attached to an existing element                                                                                                                                                                                                                                                                |
   | Vue 3        | `import { vSkeleton } from "skeletonizer/vue"` → `<div v-skeleton="loading">` or `v-skeleton="{ loading, effect: 'shimmer' }"`                                                                                                                                                                                                                    |
   | Vue 3 (comp) | `<SkzBox :loading="loading">…</SkzBox>` (register via `app.use(SkzPlugin)` or import `SkzBox`)                                                                                                                                                                                                                                                    |
   | Svelte       | `import { skeleton } from "skeletonizer/svelte"` → `<div use:skeleton={{ loading }}>`                                                                                                                                                                                                                                                             |
   | Vanilla JS   | `const off = enable(el, { effect })`, then `off()` when data arrives                                                                                                                                                                                                                                                                              |
   | HTML / CE    | `import { defineSkzBox } from "skeletonizer"; defineSkzBox();` → `<skz-box loading>…</skz-box>` (`loading` on the host is the switch; `skz` lands on the first element child. SSR / no-JS: write `skz` on that child, e.g. `<skz-box loading><div skz>…</div></skz-box>`. No MutationObserver: if the child gets replaced, toggle `loading` once) |

3. **Feed the real components mock data while loading.** Every text node and image box needs content or size, otherwise there is nothing to paint. Build mock objects with `Bone` and render the normal component with them:

   ```ts
   import { Bone } from "skeletonizer";
   const mockUser = { name: Bone.text(8), bio: Bone.lines(2), avatar: Bone.image(48, 48), score: Bone.number(3) };
   const user = loading ? mockUser : data;
   ```

   - `Bone.text(n)`: exactly `n` chars of block "words".
   - `Bone.lines(k, { perLine })`: about `k` lines.
   - `Bone.cjk(n)`: CJK-width blocks.
   - `Bone.number(d)`: `d` digit-wide blocks.
   - `Bone.image(w, h)`: transparent image with intrinsic size; `Bone.image()` is a 1px GIF that needs width/height from CSS.

   All output is deterministic (SSR / hydration safe). For lists, render the expected number of mock items (e.g. `Array.from({ length: 5 }, () => mockItem)`).

4. **Done when** the page shows grey bones in the shape of the real layout while `loading` is true, and the real content with no leftover `skz*` attributes once it is false.

## Reference

### `enable(el, opts?)` and `disable(el)`

| Option     | Values                                           | Default                                                                                          |
| ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `effect`   | `fade` / `solid` / `sweep` / `pulse` / `shimmer` | `fade`                                                                                           |
| `text`     | `clip` / `underline` / `leaf` / `tofu`           | `clip`                                                                                           |
| `engine`   | `global` / `svg`                                 | follows the loaded variants: `global` if loaded, else `svg` if only svg is loaded, else `global` |
| `fallback` | `svg` / `fade`                                   | `svg` (what `global` does on browsers without `@property`)                                       |
| `fit`      | boolean                                          | `false`                                                                                          |

- `enable` returns an off function; `disable(el)` does the same (no-op if never enabled). Calling `enable` again re-syncs from the new options: omitted ones are cleared, not merged.
- Types: `import type { EnableOptions, SkzEffect, SkzTextMode, SkzFallback, SkzEngine } from "skeletonizer"`.
- The CSS for `fit` is part of `base.css` / `explicit.css`; nothing else to import.
- Naming a variant that is not loaded (Chrome 154): only `global` loaded + `engine: "svg"` still runs global's root-driven shimmer (just no firewall, no old-browser SVG fallback); only `svg` loaded + `engine: "global"` falls back to the base `fade`.

### `<skz-box>` attributes

`loading` (the switch: present and not `"false"`; also `el.loading = true | false`), `effect`, `text`, `fallback`, `engine`, `fit` (present and not `"false"`). Same values as the options above.

### Adapter exports

| Import                | Exports                                                                                                                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skeletonizer/vue`    | `vSkeleton` (`v-skeleton="loading"` or `="{ loading, effect, text, fallback, engine, fit }"`), `SkzBox` (props `loading`, `effect`, `text`, `fallback`, `engine`, `fit`, `as` = `"div"`), `useSkeleton(elRef, loadingRef, opts?)`, `SkzPlugin`, type `SkzBinding` |
| `skeletonizer/react`  | `SkzBox` (props `loading`, `as` = `"div"`, `className`, `children` + every option), `useSkeleton(ref, loading, opts?)`, type `SkzProps`                                                                                                                           |
| `skeletonizer/svelte` | `skeleton` action: `use:skeleton={{ loading, effect, text, fallback, engine, fit }}`, type `SkzParams`                                                                                                                                                            |

### Markers (HTML attributes)

| Attribute    | Where   | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skz`        | root    | Skeleton on. Set by every adapter; write it yourself only for pure HTML / SSR output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `skz-effect` | root    | `fade` (default) / `solid` / `shimmer` / `pulse` / `sweep`. Adapters take it as the `effect` option.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `skz-text`   | root    | `clip` (default when omitted: underline shape filled by `background-clip: text`, so text gets a real shimmer band, also under svg; costlier than underline, see [the benchmark report](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/reports/2026-10-09-benchmark-matrix.md); browsers without `background-clip: text` fall back to underline via `@supports not`; decoration-in-clip verified only in Chrome, Firefox / Safari untested) / `underline` (explicit; bars follow real text lines; colour pulse only, static under svg; the cheapest, pick it for low-end devices; also needed for text written directly in divs, which clip does not show) / `leaf` (rounded block per text leaf, needs `:has()`) / `tofu` (needs `skeletonizer/tofu.css`; text switches to a block font `skz-tofu`, colour pulse only, static under svg; GPU close to underline; wrapping can differ from the real text by a line; without `tofu.css` it looks like underline; the font is a data URI, so a strict CSP must allow `font-src data:` or the real text shows through in the bone colour; inline `skz-ignore` content makes its parent fall back to underline). |
| `skz-bone`   | element | Force this element to be one bone. Use it on a `div` acting as an image, avatar, icon or colour block (empty divs are not inferred).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `skz-leaf`   | element | Merge the whole subtree into one bone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `skz-ignore` | element | Keep as real content and keep it clickable/focusable (e.g. a "cancel" button).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Bones are inferred (with `base.css`, not `explicit.css`) from: text tags (`p` `span` `h1`-`h6` `a` `li` `label` `td` `th` `strong` `b` `em` `small` `dt` `dd` `blockquote` `figcaption`), media (`img` `video` `canvas` `picture` `iframe` `svg`), **controls (`input` `textarea` `select` `button`: one whole block each, no underline; a `button`'s inner `span` / icons are hidden, its own `border-radius` is kept, otherwise `--skz-radius`; put `skz-ignore` on the button itself to keep it as-is; inside an ignore region it is not a bone but its background is cleared)**, empty `<i>` and empty elements whose class contains `icon`. Internal markers, never write them: `skz-engine`, `skz-paused`, `skz-fw`, `skz-fit`, `skz-fit-hide`, `skz-x` (a specificity placeholder in the CSS); `skz-has-ignore` is added by `enable()` (write it yourself only on hand-written roots that contain `skz-ignore`).

### Choosing an effect

- `fade`: root-level opacity pulse, composited, free at any size. The default.
- `shimmer` / `pulse`: the most polished look; need the `global` or `svg` variant (otherwise they fall back to `fade`). With `global`, the shimmer band updates 24 times per second by default (`--skz-shimmer-timing: steps(36)`, tied to the 1.5s `--skz-duration`: steps = seconds × 24); set `--skz-shimmer-timing: linear` on the root for per-frame smoothness or `steps(18)` for cheaper. The svg engine is not throttled. With `global`, browsers without `@property` get an SVG animation attached by JS (`fallback: "fade"` keeps the base fade instead); before JS runs, and if the blob cannot be built, they show `fade`.
- `solid`: no animation.
- `sweep`: needs `skeletonizer/sweep.css`. One mode, switched by theme: light brightens only the bones (`lighten` blending); dark automatically uses a container-colour sweep (override `--skz-sweep-bg-rgb` on the skeleton root itself when you change the theme; on an ancestor it is overridden by the `[skz]` dark default). The bar is tilted 12° by default; on very tall roots (taller than ~16× the root width, ~5.9k px on a 375px-wide phone) it can slide out of view, so set `--skz-sweep-skew: 0deg` on the root or use `fit`.
- Lists (cards, rows) with `shimmer` / `pulse`: import `skeletonizer/global`; nothing else to configure. `enable()` / the adapters automatically "firewall" off-screen items so only visible items animate (16,000 elements stays at 60 fps). Keep the items as children of the root or of a single wrapper inside it.
- Large skeletons without list structure: use `skeletonizer/svg` (one shared animated SVG background; exact theme colours when enabled through JS; explicit `underline` / `tofu` text stays static, default clip text moves). With both variants loaded, pick svg per root via `engine: "svg"`.
- Exact control over which elements become bones: use `skeletonizer/explicit.css` instead of `base.css` and mark bones with `skz-bone` (descendants of a bone are hidden). This is also the fastest base (no inference selectors). Explicit mode is only available through `explicit.css`; there is no per-root switch or `mode` option.
- Large skeletons in pure CSS (no JS, so no firewall): add `skz-cv` on the root so off-screen children skip rendering (clips each child's overflow; set `--skz-cv-size` to the typical child height). Do not combine it with `enable()`: the firewall is already faster, and `skz-cv` makes enabling about 3.5× slower (measured with underline text).
- Placeholder lists of unknown length (e.g. 100 mock rows): pass `fit: true` (`<skz-box fit>`, also accepted by the adapters). The root is capped to the space left in its nearest scroll container (or the viewport), rows fully outside get `display: none`, and it re-measures on resize, so the skeleton itself never causes a scrollbar. If the boundary scrolls anyway (content below, or the skeleton starts below the fold) it relaxes to one screen. Enabling costs one extra layout (about 0.77 s for 16,000 elements with the default clip text, vs 85 ms without `fit`; measured with underline: 0.52 s vs 61 ms; see [the benchmark report](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/reports/2026-10-09-benchmark-matrix.md)).

### Theming

Variables are declared on the root itself, so override them **on the root element** (inline `style` or a selector that targets the root), not on `:root`:

```html
<div skz style="--skz-color:#e5e7eb; --skz-highlight:#f3f4f6; --skz-radius:6px; --skz-duration:1.2s">…</div>
```

| Variable                                 | Default                            | Notes                                                                                                                                                           |
| ---------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--skz-color`                            | `#d9dde3` (dark `#374151`)         | bone colour                                                                                                                                                     |
| `--skz-highlight`                        | `#eceff3` (dark `#4b5563`)         | shimmer band / pulse peak; for the svg engine call `enable()` again after changing it                                                                           |
| `--skz-radius`                           | `4px`                              | an element's own `border-radius` wins; underline / clip text bars have no radius                                                                                |
| `--skz-duration`                         | `1.5s`                             | animation duration                                                                                                                                              |
| `--skz-shimmer-timing`                   | `steps(36)`                        | shimmer band timing, 24 updates/s at 1.5s (steps = seconds × 24, change both together); `steps(18)` cheaper, `linear` smooth; `global` only, not the svg engine |
| `--skz-fade-min`                         | `0.55`                             | minimum opacity of `fade` (also when pulse / shimmer fall back to fade)                                                                                         |
| `--skz-ul-thickness` / `--skz-ul-offset` | `1em` (clip: `1.15em`) / `-0.85em` | thickness / offset of the underline text bars (underline and clip modes)                                                                                        |
| `--skz-sweep-w`                          | `35%`                              | sweep band width relative to the root; needs `sweep.css`                                                                                                        |
| `--skz-sweep-skew`                       | `-12deg`                           | sweep tilt; `0deg` for very tall roots                                                                                                                          |
| `--skz-sweep-bg-rgb`                     | `31, 41, 55`                       | dark-theme sweep container colour (`r, g, b`); set it on the root itself                                                                                        |
| `--skz-cv-size`                          | `200px`                            | estimated child height for `skz-cv`                                                                                                                             |
| `--skz-svg-shimmer` / `--skz-svg-pulse`  | written by `enable()` (svg engine) | do not set                                                                                                                                                      |

All `--skz-*` variables not listed here are internal and may change. Set them on the root, and `--skz-shimmer-timing` on the root or any ancestor.

Dark mode follows `prefers-color-scheme`. Force it with `data-skz-theme="dark"` or `"light"` on `<html>`.

## Gotchas

- **Vue component name is `SkzBox`.** In templates write `<SkzBox>`; `<skz-box>` resolves to the native custom element instead (the switch there is the `loading` attribute / property on the host; the skeleton state lands on its first element child).
- **Empty elements produce no bones.** A `div` with no text and no size renders nothing; give it mock text, a size, or `skz-bone`.
- **Images:** pass `Bone.image(w, h)` as `src` so the box keeps its size; real image URLs still download and may show through.
- **Pure HTML attributes skip the JS features.** Writing `skz` by hand gives the CSS look only: no `inert` lock, no off-screen pause. Use an adapter or `enable()` when those matter.
- **Off-screen roots pause** (`skz-paused` is added automatically). One huge root keeps animating while any part is visible; split long pages into several roots.
- **`skz-ignore` inside a root disables the implicit `fade`**, since fading would dim the ignored content. Set `effect="fade"` explicitly to force it.
- **Pure HTML roots with `skz-ignore` need `skz-has-ignore` on the root.** Adapters and `enable()` add it automatically; the CSS keys off this attribute instead of a slow `:has()`.
- **Old browsers (no `@property`) and `pulse` / `shimmer`?** With `global` they get a JS-attached SVG animation by default (`fallback: "svg"`); pass `fallback: "fade"` to keep the base fade. They show `fade` until JS runs. The SVG is a blob URL, so a strict CSP needs `img-src blob:` (`data:` is only needed by `Bone.image`).
- **`sweep`** sets `position: relative` and `overflow-x: clip` on the root and uses the root's `::after`. Wrap content in a dedicated unstyled root element before choosing it.
- **Shadow DOM components** (third-party web components) are opaque to page CSS. Call `registerCustomElements(document, { watch: true })` once; each host becomes one bone. Call `dispose()` on teardown.
- **React `useSkeleton`**: pass `effect` / `text` as plain values; the hook re-runs when they change.
- **`prefers-reduced-motion`** stops all animations, including `fade`. This is intended.
- **Verified on desktop Chrome only.** Safari, Firefox and mobile are untested.
