# @codejoo/skeletonizer

Skeleton screens for the web, Flutter-`skeletonizer` style: render your **real DOM** with **mock data**, and let **pure CSS** turn the leaves into skeleton bones. No hand-drawn placeholder shapes to maintain.

> 中文文档：[README.zh-CN.md](./README.zh-CN.md)

## Install

```bash
pnpm add @codejoo/skeletonizer
```

```ts
import "@codejoo/skeletonizer/style.css";
import { enable, Bone, defineXSke } from "@codejoo/skeletonizer";

const off = enable(document.querySelector("#card")!, { effect: "pulse" });
// data arrived:
off();
```

```html
<x-ske loading effect="pulse"><div class="card">…</div></x-ske>
```

## Markers

| Attribute                     | Meaning                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `x-ske-bone`                  | force this element to be a bone                                               |
| `x-ske-leaf`                  | merge the whole subtree into one bone                                         |
| `x-ske-ignore`                | keep as-is, never a bone                                                      |
| `x-ske-effect` / `x-ske-text` | on the root: `fade` / `solid` / `pulse` / `shimmer`, and `underline` / `leaf` |

## Framework adapters

Sub-path exports; frameworks are optional peer dependencies.

```ts
import { vSkeleton, XSke, useSkeleton, XSkePlugin } from "@codejoo/skeletonizer/vue";
import { XSke, useSkeleton } from "@codejoo/skeletonizer/react";
import { skeleton } from "@codejoo/skeletonizer/svelte";
```

## Mock data

`Bone.text(n)`, `Bone.lines(k)`, `Bone.cjk(n)`, `Bone.number(d)`, `Bone.image(w, h)` — all deterministic (SSR-safe, no `Math.random`).

## Browser support

CSS variables are assumed (Chrome 49 / Firefox 52 / Safari 10 / Edge 15). JS is ES2015, ESM only. `<x-ske>` needs Custom Elements v1 and is skipped where unavailable. Full design and the CSS tiers: see the Chinese README and [ARCHITECTURE.md](./ARCHITECTURE.md).

## Develop

```bash
pnpm dev     # demo on :5188
pnpm check   # fmt + lint + type-check
pnpm test
pnpm build   # vp pack → dist/
```

MIT
