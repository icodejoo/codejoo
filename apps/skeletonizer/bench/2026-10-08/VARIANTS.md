# 2026-10-08 实验：CSS 变体与测试页说明

各轮实验用到的 CSS 变体和临时测试页（`demo/.tmp-perf/`、`demo/.tmp-svg/`、`demo/.tmp-tick/`、`demo/.tmp-fb/`、`demo/.tmp-ab/`）在当时跑完后被删掉了，**文件本身已不存在**。下面逐条记录每个变体是怎么从基准 CSS 改出来的，照着做可以复原。场景文件和原始结果在 `scenarios/`、`results/`，脚本在 `scripts/`。

## 基准 CSS 的来源

| 名字 | 来源 |
| ---- | ---- |
| `base.css` | 当时的 `src/styles/skeletonizer.scss` 用 `pnpm exec sass --no-source-map` 编译出的可读版（非压缩） |
| `none.css` | 空文件，"无骨架样式"对照 |
| `final.css` | 第 8 节两项选择器优化落地后的 `src/styles/skeletonizer.scss` 编译版 |
| `prod.css` | `dist/skeletonizer.css`（正式构建，压缩 + lightningcss 降级） |
| `prodOff.css` | `prod.css` 里把 `color:rgb(from red r g b)` 全部替换为 `color:nonsense(1)`，模拟不支持 `@property` 的浏览器 |

## 第 2 轮（`scenarios/sc-exp.json` → `results/res-exp.jsonl`，性能报告 8.3）

| 变体 | 改法（在 `base.css` 上） |
| ---- | ------------------------ |
| `noT1` | 删掉所有 `@supports (text-decoration-thickness: 1em) { … }` 整块（按花括号配对删除） |
| `noT2` | 删掉所有 `@supports selector(:has(*)) { … }` 整块 |
| `noT12` | 先 `noT1` 再 `noT2` |
| `swNoSkew` | `skewX(-12deg)` 全部替换为 `skewX(0deg)` |
| `swNoWill` | 删掉 `will-change: transform;` |
| `swNoBlend` | 删掉 `mix-blend-mode: var(--x-ske-sweep-blend);`，并把 `mask-image: linear` 改成 `x-mask: linear`（让遮罩失效） |
| `swNoClip` | 删掉 `overflow-x: clip;` |
| steps 实验 | 不改 CSS，根上加内联 `style="--x-ske-shimmer-timing: steps(36)"` 或 `steps(18)` |

## 第 3 轮：逐条去掉第 2 档规则（`sc-rules.json` → `res-rules.jsonl`，8.3）

做法：把目标规则的选择器替换成永远不匹配的 `x-nope`，规则体不动。

| 变体 | 被替换的选择器 |
| ---- | -------------- |
| `r_noLeafColor` | `[x-ske][x-ske-text=leaf] *:not([x-ske-ignore])`（叶子模式文字透明） |
| `r_noLeafBone` | `[x-ske][x-ske-text=leaf] :not([x-ske-ignore] *):not([x-ske-ignore]):not(:has(*)):not(:empty)` |
| `r_noIcon` | `[x-ske] i:empty:not([x-ske-ignore]), [x-ske] [class*=icon]:empty:not([x-ske-ignore])`，以及两个 `::before` 规则改为 `x-nope::before` |
| `r_noHasIgn` | `[x-ske]:not([x-ske-text=leaf]) *:has([x-ske-ignore]):not([x-ske-ignore])` |
| `w_leafNoAnc` | 叶子骨头规则去掉 `:not([x-ske-ignore] *)` |
| `w_leafChild` | 叶子骨头规则 `:not(:has(*))` 改为 `:not(:has(> *))` |
| `w_hasIgnGated` | `*:has([x-ske-ignore])` 规则前加根门控：`[x-ske][x-ske-has-ignore]:not([x-ske-text=leaf]) *:has(…)` |
| `w_iconI` | 图标规则只保留 `i:empty`，去掉 `[class*=icon]:empty` |

## 第 4、5 轮与开启耗时（`sc-r4.json`、`sc-r5.json`、`sc-toggle.json`，8.3 / 8.4）

| 变体 | 改法 |
| ---- | ---- |
| `combo` | `w_leafChild` + `w_hasIgnGated` 两项同时做 |
| `combo2` | `combo` 再把 `[x-ske]:not([x-ske-effect]):has([x-ske-ignore])` 改成 `[x-ske]:not([x-ske-effect])[x-ske-has-ignore]` |
| `fadeNoHas` | `base` 里把隐式 fade 的 `:has([x-ske-ignore])` 规则选择器换成 `x-nope` |
| `swPaused` | sweep 光带动画末尾加 `paused` |
| `swContainPaint` / `swIsolate` / `swContainLayout` / `swContainLP` | 在 `[x-ske][x-ske-effect=sweep] { position: relative;` 后分别加 `contain: paint;` / `isolation: isolate;` / `contain: layout;` / `contain: layout paint;` |

## SVG 与根驱动研究（`sc-svg.json`、`sc-root*.json`、`sc-svgprod*.json`、`sc-tick.json`，第 9 节）

- `svg.css`：`final.css` 末尾追加实验规则：根上 `x-ske-svg` 时 `animation: none !important`，`--x-ske-bg-img` 设为 SVG data URI（shimmer：`#eceff3` 渐变光带 `<rect width=60>` + `animateTransform translate -60→110 1.5s`；pulse：`<rect>` 的 `fill` 用 `<animate values="#d9dde3;#eceff3;#d9dde3" dur=3s>`），`[x-ske][x-ske-svg] * { background-size: 100vw 100vh !important }`。
- `exp.css`：`final.css` 末尾追加：
  - A `[x-ske][x-ske-effect=pulse][x-ske-noread] { --x-ske-fill: initial; --x-ske-ul-fill: initial; }`（根照常动画、骨头不读）；
  - B `[x-ske][x-ske-js] { animation: none !important; }`（JS 驱动，页面脚本 `jsDrive` / `jsDrive2` 写根变量，见 `scripts/` 里各轮页面说明）；
  - C `[x-ske][x-ske-cp]` 根上动画 `color`，骨头 `--x-ske-fill: currentColor`，`[x-ske][x-ske-cp][x-ske-cp] * { color: inherit !important; -webkit-text-fill-color: transparent }`。
- 第 9.1 节里的 `noT12` 是在 `final.css` 上去掉第 1、2 档后再追加上面的 `exp` 规则。
- 测试页 `perf.html`（各轮略有不同）：基于 `bench/kit/perf-template.html`，第 9.1 节多了 `jsDrive(kind, fps)`（setInterval 写根变量）和 `jsDrive2(kind, mode, fps)`（rAF 写，mode=reg 写注册变量、raw 写骨头读取的最终变量）。

## 更早的 rAF 帧间隔基准（只在对话中输出、没存原始文件）

`scripts/bench.mjs`、`bench-small.mjs`、`bench-steps*.mjs`、`ab.mjs`、`proto.mjs`、`promote.mjs` 用 `demo/bench.html` 的 `bench()` 测"每帧平均间隔"。它们的输出当时只打印在终端，数值已整理进性能报告第 6、6.1、7 节；class 与属性根标记的 A/B 结果见下。

### class vs 属性根标记 A/B（`scripts/ab.mjs`，CPU 有 rustc 编译，噪声偏大）

两份 CSS 由同一份 scss 编出，`class.css` 把 `[x-ske]` 全部替换为 `.x-ske`。两种写法交替，每项 5 轮中位数（ms）：

| 测量项 | class | 属性 | 差异 |
| ------ | ----- | ---- | ---- |
| 开启 4000 元素 默认 | 21.5 | 21.3 | -0.9% |
| 开启 16000 元素 默认 | 136.2 | 170.1 | +24.9%（5 轮范围重叠：class 135~171，属性 127~182） |
| 开启 16000 元素 叶子 | 152.1 | 161.3 | +6.0% |
| 每帧 16000 fade | 16.5 | 16.6 | +0.6% |
| 每帧 4000 pulse | 70.2 | 66.2 | -5.7% |
| 每帧 4000 shimmer 叶子 | 26.2 | 25.1 | -4.2% |

结论：动画每帧无差别；16000 元素开启耗时可能有 0~25% 的额外开销但噪声范围重叠，未定论。
