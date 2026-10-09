# demo/.tmp-a3 实验笔记（代理 a3）

执行者：a3（只按方案实测，不改正式代码；未改 `src/ test/ docs/ README*`，未 git commit）。
环境：Windows，Chrome（调试端口 9343，配置目录 `<scratchpad>/chrome-prof-a3`），1280x900 视口，只测了 Chrome，**Safari / Firefox 均未测**。
测试页由 http://localhost:5188 开发服务提供。所有浏览器操作都经过 `bench-kit/bench.lock` 排队。

---

## 1 方案与实验目的

底座：现有 SVG 引擎（根上 `x-ske-engine="svg"`）= 骨头 `background-color: var(--x-ske-color)` + `background-image` 叠一张带 SMIL 动画的 SVG（白色半透明光带，fixed 铺满视口 `100vw 100vh`）。缺点：高光是白色近似，`--x-ske-highlight`、`--x-ske-duration` 不生效。

| 实验 | 目的 |
|---|---|
| 1a | SVG 当 `mask-image`，骨头底色/高光色都由 CSS 决定；确认 mask 会不会连底色一起遮掉 |
| 1b | 底色=高光色，SVG 画"黑色凹口"（光带处透明）+ `background-blend-mode`（normal/multiply/luminosity） |
| 1c | 单张通用白色光带 + `background-blend-mode`（soft-light/overlay/screen/normal），浅/深/自定义三种颜色，测不同峰值不透明度 |
| 1d（追加探索） | 1c 的改进：单张 α=1 软光 + 一层"底色面纱"（`color-mix` 的底色渐变，alpha=β）衰减高光强度 |
| 2 | SVG 写法对比：2a rect+animateTransform、2b-1 渐变 x1/x2、2b-2 gradientTransform、2c 动 viewBox、2d 最短写法（reflect 渐变）、2e animate x、2f/2g 更短；另测 fixed→scroll 的成本 |
| 3 | `--x-ske-duration` 能否生效；不能时按档备图的 CSS 体积 |
| 4（追加） | SVG 精灵：外部 sprite.svg + `<view>` 片段（4.1）、`#svgView(...)`（4.2）、data URI + `#片段`（4.3）、base64 精灵+片段（4.4）、URL 编码精灵+片段（4.5） |
| 5（追加） | 运行时按根上 `--x-ske-color/highlight/duration` 生成 SVG → Blob → `createObjectURL` 写回 `--x-ske-svg-shimmer/pulse`；含 blob(sprite)+片段 |

颜色测量方法：`colors*.html` 里每个变体一行整屏宽的骨头（`<p>`），全部 fixed 背景同步；用 `Page.captureScreenshot`（png，DPR=1）截 12 张（每张间隔不同相位），页内 canvas 读每行像素，取"整行最亮像素"=高光峰值、"最暗像素"=底色，跨 12 张取极值。精确参照 `ref` 行 = 根驱动 shimmer 的 `linear-gradient(100deg, transparent, var(--x-ske-highlight) 50%, transparent)` 冻结在 `--x-ske-shimmer-p:20` 的位置（实测与理论高光色差 ≤1，是测量底噪）。ΔE 为 CIE76。
性能：`trace-a3.mjs`（工具包 trace.mjs 的副本，见下）16000 元素叶子模式 shimmer，`attrs = [["x-ske-effect","shimmer"],["x-ske-text","leaf"],["x-ske-engine","svg"]]`，每场景 3 次取中位数（每次 2.5s trace）。

### 重要过程事故（保留的失败产物，勿当有效数据）
1. **v1：Chrome 窗口被遮挡 → `document.visibilityState === "hidden"` → SMIL 动画不推进**。所有 `*-v1-*` 文件（`colors-result-v1-hidden-window.json`、`shot-v1-*.png`、`shot5-v1-hidden-*.png`、`sync-v1-hidden-*.png`、`diag-v1-hidden-*.png`、`session-v1.log`）里白色光带"从不出现"、1b 凹口停在 t=0，数据无效。修复：session.mjs 起 Chrome 时加 `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`（v2 起 `diag-v2-*.png` 与 `visibilityState=visible` 为证）。
2. **blob5.js 初版（`blob5-v1.js`、`blob5-v2-badprobe.js`）读高光色的探针用了 `color`，被骨头规则 `color: transparent !important` 吃掉，读到 `rgba(0,0,0,0)`，导致生成的 SVG 光带透明、blob 行"没有光带"**。`colors5-result.json`、`colors6-result.json`、`shot5-*.png`（非 v1 的）、`shot6-*.png` 里的 blob 行（blobA/B/C、blob）全部因此无效（其中非 blob 行有效）。修复版 `blob5.js` 用 `border-top-color` 取色，结果见 `colors7-result.json`。
3. **2f 的 viewBox 起点算错**（光带从屏幕中间出发，几乎不入屏），`colors6-result.json` 的 `s2f*` 行、`p-2f-v1-badviewbox.css` 作废；修正版是 2g（`svgs.mjs: band2g`、`p-2f.css` 现为 2g 内容、`colors7` 的 `s2g*` 行）。
4. `session-v3.log` 的性能 trace 在第 4 个场景因 `Runtime.evaluate` 无结果（渲染进程偶发失联）而整体崩溃，只留下前 3 个场景（`results-v3-partial-3scen-then-crash.jsonl`，可用）。`trace-a3.mjs` 改成失败重试（旧版留作 `trace-a3-v1.mjs`），性能改为按场景分块重跑（v5 A~E）。
5. `check-v3.mjs base+blob ...`（`sync-base+blob-*.png`）里 blob 无光带是**测试页缺陷**：`sync.html` 在样式表加载完成前就调用 `Blob5.apply`，读到未定义的变量（颜色/时长为空，`dur="NaNms"`）。blob 的正确性以 `colors7`（页内先等样式表）和性能场景 e5-blob 为准。这也暴露一个实现约束：生成 SVG 必须在样式表生效之后读变量，并对读不到的值回退（见结论）。

---

## 2 目录文件用途

### 工具 / 驱动
- `lock.mjs`：排队锁 + 起 Chrome + CDP 封装；环境变量 `A3_SESSION=1` 时改为连接已有 Chrome（不拿锁）。
- `session.mjs`：拿一次 `bench.lock`、起一次 Chrome（带防遮挡参数），依次以子进程跑多个步骤（`A3_HOLD=1` 可跳过拿锁，用于手工接管锁时）。`session-v1.mjs` 是不带防遮挡参数的旧版。
- `trace-a3.mjs`：工具包 `trace.mjs` 副本（去掉 `Browser.close`，加失败重试，输出多一个 `reps`）；`trace-a3-v1.mjs` 为仅去掉 Browser.close 的第一版。
- `colors.mjs` / `colors5.mjs` / `colors6.mjs` / `colors7.mjs`：颜色像素对比脚本（分别对应 colors.html / colors5.html / colors6.html / colors7.html 及 rows*.json）。
- `check.mjs`、`check-v2.mjs`（加 `A3_NOOVR` 开关）、`check-v3.mjs`（支持 `名字+blob`）：显示 / 动画 / 同步检查，对 8 行骨头读最亮像素的 x 与亮度，6 张截图。
- `diag.mjs` / `diag.html`：诊断 visibilityState 与 SMIL 是否推进。
- `gen-colors*.mjs`、`gen-perf.mjs`、`gen-perf2.mjs`、`gen-sprite.mjs`、`gen-exp4.mjs`：生成测试页 / 变体 CSS / 场景 / 精灵。
- `sizes.mjs`、`sizes-v2.mjs`、`sizes3.mjs`、`sizes3-v2.mjs`、`sizes4.mjs`：体积统计脚本；产物 `sizes-svg-result.txt`、`sizes-v2-result.txt`、`sizes3-result.json`、`sizes3-v2-result.json`、`sizes4-result.json`。
- `svgs.mjs`：全部 SVG 变体的生成器（`band2a / dip / band2b1 / band2b2 / band2c / band2e / band2d / band2f(作废) / band2fBlk / band2g / curShimmer`）及 data URI 编码函数 `uri(svg, "safe"|"short")`。
- `blob5.js`：实验 5 的运行时生成器 `window.Blob5`（read / apply / revokeAll / shimmerSvg / pulseSvg / mk）；`blob5-v1.js`、`blob5-v2-badprobe.js` 为有缺陷的旧版。
- `perf.html`：工具包基准页副本 + 引入 `blob5.js` + `jsDrive("blob")` 钩子。
- `sync.html` / `sync-v1.html`：同步 / 动画检查页（?css=&effect=&theme=&blob=）。
- `colors.html` / `colors5.html` / `colors6.html` / `colors7.html`：颜色测试页（行 id 见各 `rows*.json`）。

### 样式
- `styles/`：`src/styles` 的复制品，仅在 `_mixins.scss` 里加了 `background-attachment: var(--x-ske-bg-att, fixed)` 和 `background-blend-mode: var(--x-ske-bg-blend, normal)` 两个变量钩子；用 sass 编出：
  - `base.css`（展开）、`base.min.css`（compressed，体积统计用）：带钩子的现役 CSS，**所有变体的底**。
  - `stock.css`、`stock.min.css`：不带钩子的复制品编译产物（对照体积；差约 365 B）。
  - `prod.css`：`dist/skeletonizer.css` 拷贝。
- 变体 CSS（= `base.css` + 追加一条覆盖规则）：
  - `p-1b-normal/multiply/luminosity.css`（实验 1b）
  - `p-1c-soft-light/overlay/screen/normal.css`（1c）
  - `p-1d-atten.css`（1d）
  - `p-2a.css`、`p-2b1.css`、`p-2b2.css`、`p-2c.css`、`p-2e.css`、`p-2d.css`、`p-2f.css`（= 2g 内容）、`p-2f-v1-badviewbox.css`（作废）、`p-2a-scroll.css`（实验 2）
  - `e4-sprite.css`、`e4-svgview.css`、`e4-svgview-par.css`、`e4-dataview.css`、`e4-dataview-short.css`、`e4-b64.css`（实验 4）
  - 实验 5 没有单独 CSS，用 `base.css` + `perf.html` 的 `jsDrive("blob")`。
- `sprite.svg`（可读）/ `sprite.min.svg`（单行）：4 个 `<view>`（shimmer-light / shimmer-dark / pulse-light / pulse-dark，区域间隔 300 单位）。

### 场景文件
- `sc-all.json`（第一版全量）→ `sc-all-v2-prev.json`（追加 p-1d 之前）→ `sc-all-v2.json`（全量，含 p-1d-atten、p-2f）：实验 1/2/4/5 全量场景，session v3 用它（崩溃）。
- `sc-chunk-A.json`（实验 1b + 1c-soft-light + 现状 + 根驱动对照）、`sc-chunk-B.json`（1c overlay/screen/normal、1d、2a）、`sc-chunk-C.json`（实验 2 各写法 + scroll）、`sc-chunk-D.json`（实验 4 + 实验 5 blob）、`sc-chunk-E.json`（复测：2 轮交替，用来看噪声）。
- `rows.json`、`rows5.json`、`rows6.json`、`rows7.json`：各颜色页的行 id 列表；`variants.json`：变体声明长度。

### 原始结果
- 性能 trace 原样输出（JSONL）：`results-v5-A.jsonl` … `results-v5-E.jsonl`（有效，分块重跑）、`results-v3-partial-3scen-then-crash.jsonl`（有效但仅 3 场景）；完整日志 `session-v3.log`、`session-v5-A..E.log`。
- 颜色 / 时长 / 成本原始数据：`colors-result.json`（v2，**有效**，实验 1/1c 颜色，3 场景 x 34 行）、`colors-result-v1-hidden-window.json`（无效）、`colors5-result.json` / `colors6-result.json`（非 blob 行有效，blob 行无效，含 1d 衰减行和 custom2）、`colors7-result.json`（**有效**，blob 修正版 + 时长 + 成本）；对应日志 `session-v2.log`（colors/colors5/check 含 e4/p-2* 的同步检查）、`session-v3.log`、`session-v4.log`（colors7 + check）、`colors.log`（被终止的排队进程）。
- 体积：见上面 sizes*。

### 截图清单
- `shot-light/dark/custom.png`：实验 1 全部 34 行，三种配色（v2 有效；第 4 行是 1a-mask，可见骨头只在光带处可见，其余露出白底 = 不可行的证据）。`shot-v1-*.png` 无效（窗口被遮挡）。
- `shot5-*.png`、`shot6-*.png`：colors5/colors6 各场景（blob 行因探针缺陷是空的，非 blob 行有效）；`shot7-*.png`：colors7 各场景（有效，light / dark / custom / custom2 / dur3 / dur750ms / dur1.5）。
- `sync-*.png`：各 css 变体的显示 / 动画检查（base、p-1c-soft-light、p-2a/2b1/2b2/2c/2d/2e/2f、e4-sprite/svgview/svgview-par/dataview/dataview-short/b64，及 pulse）；`sync-v1-hidden-*` 无效；`sync-base+blob-*` 见事故 5。
- `diag-v1-hidden-*.png`（窗口被遮挡）与 `diag-v2-*.png`（正常，三张间隔 350ms 的 img / background / fixed background 动画对照）。

---

## 3 场景文件 ↔ 实验

| 场景 / 页面 | 实验 |
|---|---|
| `colors.html` + `colors.mjs` | 1a、1b、1c（以及现役 SVG 的误差基线） |
| `colors6.html`（att 行）/ `gen-colors6.mjs` | 1d |
| `colors5/6/7.html` | 5（颜色 / 时长 / 成本 / blob 片段），7 为有效版 |
| `sc-chunk-A.json` | 1b / 1c 性能 |
| `sc-chunk-B.json` | 1c、1d 性能 |
| `sc-chunk-C.json` | 2（含 scroll） |
| `sc-chunk-D.json` | 4、5 性能 |
| `sc-chunk-E.json` | 复测（噪声评估：base、soft-light、2g、1b-normal、1d、blob、sprite、svgview-par 各 2 轮） |
| `sizes3*.mjs` | 3（体积） |
| `sizes4.mjs`、`sizes.mjs`、`sizes-v2.mjs` | 4 / 2 的体积 |
| `check*.mjs` + `sync.html` | 4 的"显示 / 动 / 同步"，也检查了 2 的各写法是否在动 |

---

## 4 结果与结论

### 4.0 噪声说明
同一份 CSS 的帧率在多次测量里波动 ±10%，偶有离群（`p-1b-normal` 三次 58.4 / 50.8 / 32.8，`p-2a` 与 `p-1c-soft-light` 内容完全相同却测出 35.6 与 50.8~56）。下面的性能表按"多次测量的中位数 + 范围"报，单次数据只当参考。基线 `base`（现役 data URI）共测 8 次：fps 51.6~58.4，中位 ≈ 55；PrePaint 14.0~16.0 ms；Paint 2.1~2.7 ms；gpu 5.9~6.8 ms；样式重算 0.06 ms。
根驱动 shimmer 叶子（对照）：19.6 fps，样式重算 42 ms/帧。

### 4.1 实验 1：颜色全由 CSS 决定、SVG 只负责动

**1a mask**：**不可行**。`mask-image` 作用于整个元素（含 `background-color`），遮罩外全部透明，骨头只在光带处可见，其余露出页面底色（浅色截图里是白底，实测骨头"底色"读数变成 255,255,255；`shot-light.png` 第 4 行）。要让底色保留，遮罩必须处处不透明，也就失去了遮罩的意义。性能未测。

**1b 底色=高光 + 黑色凹口**（峰值处 = 高光色，精确；代价是**大面积底色变成近似**）：
`dip` 的基底不透明度 α 取 .074（浅色，由 1-C/H 推出）或 .23（深色）。normal / multiply / luminosity 的**颜色完全相同**（黑色源，三种模式结果一样）。

| 场景 | 变体 | 峰值 ΔE（对 H） | 底色 RGB 差（对 C） | 底色 ΔE |
|---|---|---|---|---|
| 浅色 | α=.074 | 0 | +1,0,-2 | 1.09 |
| 浅色 | α=.23（深色用的图） | 0 | -36,-37,-40 | 13.4 |
| 深色 | α=.23 | 0 | +3,0,-5 | 3.37 |
| 深色 | α=.074 | 0 | +14,+14,+11 | 6.35 |
| 自定义（C=#cfe3ff H=#e8f2ff） | α=.074 | 0 | +8,-3,-19 | 8.94 |

结论：峰值精确，但占面积最大的底色变成近似，自定义色下偏差明显；而且每个主题要各备一张 α 不同的图，没解决"任意色"问题。性能：multiply / luminosity 明显更贵（单次 36~37 fps，PrePaint 24~25 ms，gpu 13~15 ms）；normal 与现状相当但复测有离群（58.4 / 50.8 / 32.8）。

**1c 单张白色光带 + `background-blend-mode`**（底色 = CSS 色，精确；高光是近似）。三种配色下峰值与精确高光的差（RGB 差 / ΔE76）：

浅色（C=217,221,227 H=236,239,243）

| 模式 \ 峰值 α | .25 | .4 | .55 | .75 | 1 |
|---|---|---|---|---|---|
| soft-light | 4.92 | 3.95 | 3.15 | 2.06 | **0.72**（-1,-2,-2） |
| overlay | 3.15 | 1.51 | 1.14 | 2.82 | 6.12 |
| screen | 同 overlay（浅色下两者读数一致） | | | | |
| normal（=现役，.55） | | | 1.14（+2,+1,-1） | | |

深色（C=55,65,81 H=75,85,99）

| 模式 \ 峰值 α | .15 | .25 | .4 | .55 | .75 | 1 |
|---|---|---|---|---|---|---|
| soft-light | 4.84 | 2.10 | 2.46 | 6.27 | 11.5 | 17.9 |
| overlay | 5.08 | 4.19 | 5.53 | 8.88 | 14.3 | 20.7 |
| screen | 3.58 | 11.7 | 22.9 | 33.7 | 47.8 | 64.9 |
| normal（现役深色图，.1） | | | | | | 0.51 |

自定义（C=#cfe3ff H=#e8f2ff，浅色主题）

| 模式 \ α | .25 | .4 | .55 | .75 | 1 |
|---|---|---|---|---|---|
| soft-light | 7.92 | 6.62 | 5.32 | 3.30 | **0.72** |
| overlay / screen | 5.32 | 2.59 | 0.35 | 4.17 | 8.89 |
| 现役浅色图 normal .55 | | | 0.35 | | |

要点：
- soft-light + α=1 在浅色和浅色自定义下很准（ΔE .72），因为 soft-light 对白色的响应约等于 `sqrt(C)`，恰好接近默认高光；
- 同一张图在深色下 α=1 会过亮（ΔE 17.9）；深色需要 α≈.25~.4（ΔE 2.1~2.5）。**同一张图、同一个混合模式没有一个 α 能同时服务浅色和深色**；
- 现役 normal 白色近似在默认两套主题里已经很好（浅 1.14，深 0.51）；对"接近默认色相"的自定义色（#e8f2ff）也不错（.35）；用错主题的图（浅色图放深色主题，ΔE 33.7；深色图放自定义浅色，ΔE 8.0）才会出大错；
- **高光比底色更暗或带色相时（custom2：C=#c7d2fe H=#818cf8）白色光带无法表达**（所有 1c 变体 ΔE 44~59）。
性能：soft-light 的 gpu 从 6 升到 ~10 ms，fps 中位 52.8（50.8~56），比 base 低约 5%；overlay 53.6，screen 50.4。

**1d（追加探索）单张 α=1 软光 + 底色面纱层**：`background-image: linear-gradient(color-mix(in srgb, var(--x-ske-color) β, transparent) 两端), url(白色光带 α=1)`，`background-blend-mode: normal, soft-light`。深色下 β=.69 → 峰值 75,85,101（对 H 差 0,0,+2，ΔE 1.26）；β=.6 → 2.8；β=.75 → 2.1。浅色下 β 越大越差（β=0 最优 .72），自定义色同理。即：同一张图，浅色 β=0、深色 β≈.69 可行，但需要一个按主题切换的 β 变量。性能：fps 中位 48.8（46~50.8），gpu 11~12.8 ms，Paint 3.5~3.75 ms（两层背景），比现状差约 10%。值得省的只有 SVG 字符串数量（4 → 2），代价是 GPU 和一次 `color-mix` 依赖；**不推荐**。

**实验 1 总结**：纯 CSS 驱动色（SVG 当遮罩）不可行；让高光色"精确"的 CSS 路线不存在（SVG 内部拿不到 CSS 变量，混合模式只能做逐通道近似）；现役 normal 白色光带在默认主题的误差已经 ≤1.2 ΔE，改成 soft-light / 1b 都不会更好，还更耗 GPU。想要任意高光色精确，只有"运行时按颜色生成 SVG"（实验 5）。

### 4.2 实验 2：SVG 写法
体积（字节；raw=SVG 源，safe=`<>#` 全转义 data URI，short=只转义 `#`，均含 `url("data:image/svg+xml,...")` 里的 URI 部分，见 `sizes-v2-result.txt`）：

| 写法 | raw | safe | short |
|---|---|---|---|
| 现役（浅色 .55） | 485 | 567 | 519 |
| 2a rect + animateTransform | 473 | 555 | 507 |
| 2b-1 渐变 x1/x2 各一个 animate | 517 | 591 | 551 |
| 2b-2 gradientTransform animateTransform | 471 | 541 | 505 |
| 2c 动 viewBox | 443 | 513 | 477 |
| 2e animate x | 422 | 496 | 456 |
| 2d reflect 渐变两个 stop + animate x | 399 | 467 | 431 |
| 2g（最短：viewBox 起点 60，rect 默认 x=0，`to` 单端动画，α=1 省 stop-opacity） | **372** | **436** | **400** |

动不动、同步不同步（`check*.mjs`，6 张截图，8 行骨头峰值 x 完全一致）：2a、2b-1、2b-2、2c（动 viewBox，Chrome 支持）、2d、2e、2g 全部在动、各骨头同步，峰值亮度一致（230 vs 230，同 soft-light α=.5）。第一个 stop 不写 `stop-color`（透明黑 → 白）会出黑边：底色被拉低 ΔE 1.5~3.2（`s2f-blk` 行），所以两个 stop 都要写 `stop-color='white'`。

性能（16000 元素叶子 shimmer，soft-light α=.5，同一混合模式下对比写法）：

| 写法 | fps | PrePaint ms | Paint ms | gpu ms |
|---|---|---|---|---|
| base 现役（normal，中位） | ≈55 | ≈14.5 | ≈2.3 | ≈6.1 |
| 2a（=p-1c-soft-light 复测 3 次） | 50.8 / 52.8 / 56 | 14.6~16.7 | 2.3~2.6 | ≈10 |
| 2b-1 | 53.6 | 15.8 | 2.66 | 10.5 |
| 2b-2 | 54.4 | 14.1 | 2.49 | 9.8 |
| 2c | 56.8 | 14.0 | 2.42 | 9.1 |
| 2e | 56.0 | 14.4 | 2.17 | 8.7 |
| 2d | 52.8 | 15.9 | 2.63 | 9.0 |
| 2g（p-2f，3 次） | 50.8 / 54 / 54.8 | 14.7~16.7 | 2.6~2.8 | 9.1~9.8 |

结论：**写法对性能没有可辨别的影响**（差异都在 ±10% 噪声内，样式重算全是 0.05 ms），光看体积选最短的。
**去掉 `background-attachment: fixed`（scroll，`bg-size:100% 100%`）**：fps 55.6，PrePaint 14.6（不变），Paint 4.06（高 ~1.7 ms），Layout 0.16（高 ~0.1 ms），gpu 9.7。fixed 本身并不贵，反而 scroll 下每个骨头要各自绘制一份图像、Paint 略增。（scroll 会失去骨头同步，不作为方案。）

### 4.3 实验 3：时长可配
- **CSS 无法改 SMIL 时长**：在 `x-ske-duration` 为 3s / 750ms / 1.5s 的根上，现役 data URI 光带的屏幕速度分别 1426 / 1299 / 1459 px/s（恒定约 1450），不随变量变化。
- 替代 A（备图按档切换）：CSS 体积（sass compressed，在带钩子的 `base.min.css` 上增删 SVG 声明，`sizes3-v2-result.json`；括号内为 gzip / brotli）：

| 方案 | 字节 | gzip | brotli |
|---|---|---|---|
| 去掉所有 SVG（下限） | 14637 | 2175 | 1931 |
| 现状：浅/深 × shimmer/pulse，深色出现两次 | 17605 | 2581 | 2273 |
| B 通用 2 张（只有 1.5s） | 15462 | 2528 | 2242 |
| C 通用 × 3 档（1s/1.5s/2s，6 张；按根属性 `x-ske-speed` 切换） | 17144 | 2571 | 2269 |
| D 主题化 × 3 档（12 张，深色两次） | 23538 | 2679 | 2353 |

  也就是说：只要图通用（不分主题）三档也比现状的 4 张主题图还小；但"通用图"在实验 1 里无法同时精确服务浅/深；若保持主题化，三档要 23.5 KB（gzip 只多 ~100 B，因为重复内容压缩得很好）。
  `--x-ske-duration` 变量本身没法选图（CSS 里没有"按变量值切 url"的办法，`@container style()` 的主体不能查自己，根上设的变量根自己查不到），所以需要另设属性。
- 替代 B（实验 5）：运行时按读到的时长生成 SVG。实测 3s 时光带速度 714 px/s（≈1.5s 时 1318~1394 的一半），750ms 时 1984~2387 px/s（≈2 倍）。**时长任意可配**。

### 4.4 实验 4：SVG 精灵 + 片段（只测 Chrome）
全部 6 种写法**都能显示、都在动、各骨头同步**（峰值 x 8 行一致，pulse 亮度序列与 data URI 方案一致）：

| 写法 | 显示/动/同步 | fps（中位；样本） | PrePaint ms | Paint ms | CSS 字节（compressed，对 18557） | gzip（对 2623） |
|---|---|---|---|---|---|---|
| 现状 4 张 data URI | 是 | ≈55（8 次 51.6~58.4） | ≈14.5 | ≈2.3 | 18557 | 2623 |
| 4.1 外部 `sprite.svg#shimmer-light` | 是 | 52.8（52.8 / 46 / 52.8） | 15.4~18.2 | **4.2~4.7** | 14936（-3621）+外部文件 1844（gz 494） | 2223 |
| 4.2 `sprite.svg#svgView(viewBox(...))` | 是 | 50.0（1 次） | 16.8 | 4.15 | 15052（-3505）+1844 | 2244 |
| 4.2b `#svgView(viewBox(..);preserveAspectRatio(none))` | 是 | **41.2 / 44 / 40.4** | **19.5~21.2** | 4.5~5.4 | 15208 | 2265 |
| 4.3/4.5 data URI 精灵（`<>#` 编码）+ `#片段` | 是（Chrome 支持 data URI 片段） | 53.6（1 次） | 15.4 | 3.8 | 27182（+8625） | 2800（+177） |
| 4.3 只转义 `#` 的变体 | 是（未单独测性能，`e4-dataview-short.css`） | | | | 26174（+7617） | 2780 |
| 4.4 base64 精灵 + 片段 | 是 | 56.4（1 次） | 13.1 | 3.5 | 29792（+11235） | 3565（+942） |

结论：
- **片段（`<view>` / `svgView`）在 Chrome 里全部可用，data URI 末尾加 `#id` 也可用**；
- 性能：Paint 多 1.2~2.4 ms（片段 URL 要为每个骨头走一次片段解析/视图计算），fps 在噪声内略低；`svgView + preserveAspectRatio` 复测三次都明显更慢（≈41 fps），不要用；
- 体积：外部文件能让 CSS 缩 3.5 KB，但多一个网络请求、首帧前没有光带（未量化），库作者要保证与 CSS 的相对路径一致，还会碰到 CSP / 打包器路径问题；data URI + 片段把整张精灵复制 4 份进 CSS（+8.6 KB，gzip 只多 177 B），base64 更糟；
- 本方案本质上不省 SVG 内容，只省"外部引用"；没有性能收益，不推荐。
- Safari / Firefox 对 `<view>` / `svgView` / data URI 片段的行为**未测**。

### 4.5 实验 5：运行时 Blob SVG（只测 Chrome）
生成源码见 `blob5.js`（shimmer：`stop-opacity 0→1→0` 的高光色渐变 + `animate x -60→110`，`dur = 读到的时长`；pulse：`fill=高光色` 的 `opacity 0;1;0`，`dur = 时长×2`，spline）。

颜色（峰值 / 底色，对根驱动 shimmer 同位置像素）：**与根驱动 `ref` 完全一致**——

| 场景 | blob 峰值 | 精确高光 | ΔE（对 H） | 现役近似 ΔE |
|---|---|---|---|---|
| 浅色 | 237,240,244 | 236,239,243 | 0.35（=ref 测量底噪） | 1.14（+2,+1,-1） |
| 深色 | 75,86,100 | 75,85,99 | 0.51（=ref） | 0.51 |
| 自定义 #cfe3ff/#e8f2ff | 233,243,255 | 232,242,255 | 0.61（=ref） | 0.35（浅色图）；深色主题图下 8.04 |
| custom2 高光比底色暗（#c7d2fe/#818cf8） | 与 ref 完全一致（199,210,254 ↔ 129,140,248） | | 0（相对 ref） | 现役白色近似无法表达，ΔE 46~59 |

（blobA = 经根属性 `--x-ske-svg-shimmer` 注入，blobB = 页内直接 blob URL，blobC = 同一 SVG 的 data URI；三者读数一致。）

时长：根上 `--x-ske-duration: 3s` 时光带速度 714 px/s（1.5s 时 1318~1394）= 约一半；750ms 时 1984~2387 px/s（≈2 倍）。✅

成本（页内 10 行骨头的测试页，`colors7-result.json`，7 个场景取中位 / 范围；机器同时被其他任务影响，数字偏噪）：
- 首次生成（读变量 + 拼 SVG + 2 次 `createObjectURL` + 写根样式）：中位 9.9 ms（2.0~14.5）；其中 `Image.decode` 加载 SVG 约 4.5 ms（1.7~7.5）；
- 同参数命中缓存：0.4 ms（0.3~0.7）；
- 切深色并重新生成（缓存未命中）：中位 2.4 ms（1.8~21）；切回（命中）1.3 ms；
- 注意：测试页只有 10 行，**没有在 16000 元素页里量 `read()` 探针的样式重算**（它会在大树里触发一次增量样式重算，未量化，推荐实现里改用 `getComputedStyle(root)` 直接读自定义属性字符串再转 rgb，不插探针）。

性能（16000 元素叶子 shimmer，blob 注入）：fps 56 / 54.4 / 52.4（中位 54.4），PrePaint 14.6~16.3，Paint 2.2~3.0，gpu 5.5~5.7（无混合模式，与 base 持平），样式重算 0.05。**与现役 data URI 没有可辨别的差别。**

**blob(sprite) + `#片段`**：`url("blob:...#shimmer-light")` 在 Chrome 可用，显示并在动（`blobfrag` 行，ΔE 与精灵里的现役白光带一致 1.14）。

### 4.6 推荐

**推荐落地形态：JS 生成（Blob SVG）为主，CSS 内置的现役 data URI 作兜底**，这个组合合理：
- 有 JS 且样式表已生效 → `enable()` 读 `--x-ske-color/--x-ske-highlight/--x-ske-duration`，按 (底色, 高光, 时长) 缓存生成 blob，写在**根的内联样式** `--x-ske-svg-shimmer/--x-ske-svg-pulse`（内联优先于样式表里的主题规则，不需要改 CSS 选择器）。颜色与根驱动完全一致（含高光比底色暗的自定义色），时长可配，性能与现役持平；
- 无 JS（纯 HTML 用法）、生成失败、CSP 不允许 `blob:`（`img-src` 需包含 `blob:`）、读到空值 → 不写内联变量，沿用 CSS 里的 data URI（精度见下，默认两个主题误差 ≤1.2 ΔE）；
- 需要处理：主题切换（`prefers-color-scheme` / `data-x-ske-theme` 变化时重新生成，命中缓存 ~1 ms，未命中 ~2~10 ms）；`disable()` 时 `revokeObjectURL` 并移除内联变量（缓存按引用计数）；读变量必须在样式表加载后（我的测试页因此踩坑），读不到时回退不写；颜色统一转 rgb；`--x-ske-duration` 要同时支持 `s` / `ms`；颜色变化 / 时长变化需要 MutationObserver（可选）；iOS 不支持 fixed 背景的分支保持现状（shimmer→pulse 图）。

**CSS 兜底 SVG 推荐写法**：用 2g/2d 的结构（reflect 渐变两个 stop，两个 stop 都写 `stop-color='white'`，`animate` 单端 `to`），比现役短 ~100~150 B（每张），性能无差别，颜色与现役一致。作为兜底继续用 normal 混合 + 白色半透明 α（浅 .55 / 深 .1），不要换成 soft-light 或 1d（GPU 更贵，精度没有更好，且深浅主题仍需两套）。
- 浅色 shimmer（2g 结构 + α=.55，**α 版本未在浏览器里单独跑过**；α=1 的 2g 与 soft-light 已实测，同结构的 2d 带 α=.5 实测过）：

```svg
<svg xmlns='http://www.w3.org/2000/svg' viewBox='60 0 100 100' preserveAspectRatio='none'><linearGradient id='g' x2='.5' spreadMethod='reflect'><stop stop-color='white' stop-opacity='0'/><stop offset='1' stop-color='white' stop-opacity='.55'/></linearGradient><rect width='60' height='100' fill='url(#g)'><animate attributeName='x' to='170' dur='1.5s' repeatCount='indefinite'/></rect></svg>
```
（深色把 `.55` 换成 `.1`。`viewBox` 起点 60 + rect 默认 x=0 = 起点在视口左缘外 60；`to='170'` 行程 170，与现役 -60→110 一致。）

```css
[x-ske] {
  --x-ske-svg-shimmer: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='60 0 100 100' preserveAspectRatio='none'%3E%3ClinearGradient id='g' x2='.5' spreadMethod='reflect'%3E%3Cstop stop-color='white' stop-opacity='0'/%3E%3Cstop offset='1' stop-color='white' stop-opacity='.55'/%3E%3C/linearGradient%3E%3Crect width='60' height='100' fill='url(%23g)'%3E%3Canimate attributeName='x' to='170' dur='1.5s' repeatCount='indefinite'/%3E%3C/rect%3E%3C/svg%3E");
}
```

**与现状相比的改进**：（1）颜色精确（ΔE ≈ ref，现役最多差 1.2，换到非默认色相/比底色暗的高光时差 8~59）；（2）`--x-ske-highlight`、`--x-ske-duration` 生效；（3）性能不变；（4）兜底 SVG 缩短 ~25%。
**仍剩的限制**：依赖 JS 才能精确；`blob:` 受 CSP 约束；主题/变量变化需要重新生成；下划线文字仍无法贴图（保持静止）；iOS 无 fixed 背景；Safari / Firefox 对 SMIL + blob + 片段的行为未测；blob 的内存生命周期要管理（revoke）。

### 4.7 遗留未验证
- Safari / Firefox 全部未测。
- 兜底 SVG 的 α=.55/.1 版本（2g 结构）没有单独跑浏览器。
- 16000 元素页里 `Blob5.apply` 的耗时（含探针样式重算）没量。
- 1a 没有性能数据（已判定不可行）。1b-multiply / luminosity、1c-screen / overlay / normal 只有 1~3 次测量，受噪声影响较大。
- 性能分块（A~E）在不同时间段跑，全局漂移约 ±10%；以每块里的 base 对照读。
