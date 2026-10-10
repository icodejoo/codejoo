# 2026-10-10 落地复测

对象：把降频（`--skz-shimmer-timing: steps(36)`，只对 global）、clip 下不挂 pulse、防火墙补钉 `--skz-tbg` / `--skz-timg`、可选 tofu 落到 `src/` 之后的 `dist/`。

## 方法

- `pnpm build` 的 `dist/` 冻结成快照（`Temp/skz-land-dist`），`serve.mjs`（端口 5194）吐出；不走 5188 的 vite dev。
- `perf.html`（沿用 `../2026-10-09-clip-steps/perf.html`）新增令牌 `tofu`（加载 `dist/tofu.css`）和 `oldglobal`（把 `global.css` 换成 `old/global.css`）。
- `old/global.css` = `git show HEAD:…/_global.scss`（落地前：shimmer linear、一律挂 pulse、防火墙没钉 `--skz-tbg`）叠在落地后的基底上；对照"落地前"用的就是它。`old/global-ios.css` = 落地后的 global 把 `@supports (-webkit-touch-callout: none)` 换成 Chrome 满足的条件，用来模拟 iOS 分支。
- `run-batches.mjs` → `bench/kit/run-locked.mjs` 加锁串行（端口 9633，配置目录 `C:/Users/jelon/AppData/Local/Temp/skz-land-chrome`），trace 用本目录的 `trace.mjs`；每格 3 次 trace 取中位数；视口 1200×800、DPR 1；测前等 CPU 安静（<15% 连续 6 秒，最长 10 分钟）。
- 批：A = 2000 卡 {shimmer global, pulse global, shimmer svg} × {clip, underline, tofu}（新）+ 落地前对照；B = 4× CPU 降速的 shimmer global；C = 4× 降速 + `--skz-shimmer-timing: steps(18)`（`gen-scenarios.mjs` 生成 `scenarios/sc-*.json`）。每批首尾各一对金丝雀。
- 批内 CPU：A 前两次尝试均值 41.6%，作废，用第 3 次（25.8%）；B 三次 26.0 / 23.8 / 25.1%，取最低的第 2 次；C 只跑一次（26.2%）。机器是日常工作机，CPU 不是空闲状态。

## 数据（`results/summary.md` 是全表，`results/*.jsonl` 是采用的原始数据，`*.tryN.jsonl` 是各次尝试）

每格：fps / 样式重算 ms / PrePaint ms / GPU ms / 有绘制帧占比。

| 场景（2000 卡） | clip（默认） | underline | tofu |
|---|---|---|---|
| shimmer global | 60.4 / 3.19 / 0.10 / 3.05 / 40% | 60.4 / 3.81 / 0.09 / 1.63 / 40% | 60.4 / 3.96 / 0.09 / 1.85 / 40% |
| shimmer global（落地前） | 60.4 / 7.30 / 0.26 / 10.44 / 101% | 60.4 / 10.26 / 0.27 / 5.35 / 101% | — |
| pulse global | 60.4 / 6.95 / 0.14 / 3.63 / 44% | 60.4 / 9.66 / 0.10 / 1.63 / 45% | 60.4 / 10.20 / 0.12 / 2.04 / 44% |
| pulse global（落地前） | 22.8 / 33.72 / 3.99 / 4.22 / 56% | 60.4 / 9.24 / 0.15 / 1.76 / 44% | — |
| shimmer svg（没降频） | 50.4 / 0.06 / 16.95 / 8.63 / 101% | 60.4 / 0.07 / 10.45 / 2.87 / 73% | 60.4 / 0.08 / 10.19 / 3.93 / 72% |
| 4× shimmer global steps(36) | 18.4 / 38.62 / 0.99 / 8.78 / 100% | 14.0 / 55.84 / 0.90 / 4.56 / 103% | 14.0 / 59.98 / 0.81 / 5.11 / 100% |
| 4× shimmer global（落地前） | 18.0 / 39.09 / 1.09 / 9.08 / 102% | 14.0 / 55.92 / 1.65 / 4.47 / 103% | — |
| 4× shimmer global steps(18) | 40.0 / 12.83 / 0.33 / 2.69 / 31% | 14.8 / 55.14 / 1.26 / 5.15 / 100% | 14.0 / 57.87 / 0.89 / 4.79 / 103% |

结论与没验证的部分见 `../../docs/reports/2026-10-09-benchmark-matrix.md`「落地复测」。要点：降频和防火墙修复都生效；4× 降速下默认档没收益（需要 steps(18)，且只有 clip 受益）；svg 引擎没降频，本批 clip+svg 50.4 帧但没有落地前对照，批间漂移，不据此说变差。

## 正确性验证（`verify.mjs`，Chrome 154，端口 9622，临时 user-data-dir；`wcsvg.mjs`；`shots/`）

- `anim`：默认 / clip / leaf 的 shimmer 根只有 `skz-shimmer-root`（`steps(36)`）；underline / tofu 多一个 `skz-pulse-root`（也是 `steps(36)`）；pulse 效果仍是 `ease-in-out`；根上写 `linear` / `steps(18)` 生效；`steps(calc(var(--skz-duration) / 1s * 24))` @3s 解析为 `steps(72)`（Chrome 154，其他浏览器没验证，所以不作默认）。
- `steps`：`--skz-shimmer-p` 每秒变化 24 次、每步 4.72vw；clip 文字条、图标、头像的 `background-position` 逐帧一致；underline / tofu 的下划线 / 文字颜色逐步变化。
- `fw`（200 卡）：不可见卡片的 `--skz-tbg`：pulse + clip 落地前逐帧变化，落地后固定为 `rgb(217, 221, 227)`；underline 根为 transparent 不受影响。
- `ios`（模拟）：根动画含 pulse，`bg-image: none`，可见卡片背景随 pulse 变，196/200 卡被防火墙钉住且背景不变。**没有真机。**
- `tofu`：字体 loaded；h3 / li / code 是 skz-tofu，button / input 不是；方块宽度 A=0.52em、中=1em、空格=0.3em、ZWJ=0、emoji=1em；没引 `tofu.css` 时根上是 underline（thickness 14px、文字透明）。含行内 `skz-ignore` 的父元素不套方块（根上有 `skz-has-ignore` 时）。
- `shots`：clip / underline / leaf / tofu / tofu 没引 css / shimmer 变体 × 浅深色；`band-*.png` 是隔 ~42ms 的光带序列（`bandP` 依次 -55.3, -31.7, -12.8, 1.4, …）；`wc-*.png` 是 Web Component 宿主。
- `wc`（`registerCustomElements` 宿主 `::before`）：global shimmer 的宿主 `background-position` 随帧变化（36 个取值）且与头像一致、`background-attachment: fixed`；global pulse 宿主底色逐帧变化（28 个取值）；svg shimmer / pulse 用 `wcsvg.mjs` 逐帧截图比对，宿主区域像素在变，shimmer 时宿主与头像的状态哈希同步；fade 根 opacity 变化、solid 静止。

## 文件

`gen-scenarios.mjs` `scenarios/` 场景；`perf.html` 基准页；`trace.mjs` `serve.mjs` `run-batches.mjs` `wait-idle.ps1` `cpu-log.ps1` `summarize.mjs` 沿用上一轮；`old/` 落地前 / iOS 模拟的 CSS；`verify.html` `verify.mjs` `wcsvg.mjs` `lib.mjs` 正确性验证；`results/` `batches.log` `batchesC.log` 数据与日志；`shots/` 截图。

## simplify 后复测

对象：/simplify 之后的一批"不改变行为"的改动——clip 根上去掉 `--skz-tbg` / `--skz-timg` 别名（文字条背景在文字元素自己身上读 `--skz-fill` / `--skz-bg-img`）、防火墙不再为 clip 根钉这两个变量、`--skz-ul-fill` 只挂 underline / tofu 根、装饰线透明改成根上 `--skz-dc: transparent`（少一条后代通配规则）、控件后代的下划线规则删掉（只留 `select *`）。

### 方法

- 改前 = 改动前先 `pnpm build` 冻结的 `dist/`（`Temp/skz-simp-dist-before`，静态服务端口 5195）；改后 = 改动后的 `dist/`（`Temp/skz-simp-dist-after`，端口 5196）。同一个 `serve.mjs` / `perf.html`，只有端口（即 dist 快照）不同。
- 场景 `scenarios/sc-S.json`（`gen-simplify.mjs` 生成）：2000 卡 × {pulse global, shimmer global} × {clip, underline}，首尾各一对金丝雀。
- `run-simplify.mjs`（`run-batches.mjs` 的参数化版）→ `bench/kit/run-locked.mjs` 加锁串行，端口 9655，配置目录 `C:/Users/jelon/AppData/Local/Temp/skz-simp-chrome`，每格 3 次 trace 取中位数，视口 1200×800、DPR 1。批次顺序 before → after → after2 → before2，用来看批间漂移。
- **CPU 不安静**：测前等安静的上限缩到 120 秒（`IDLE_TIMEOUT`），每批测前都没等到 <15%（测前 14~34%），批内整机 CPU 均值 before 33.8%、after 28.9%、after2 38.7%、before2 39.8%（before2 第一次尝试 71.3% 作废重跑），接受上限放宽到 40%（`MAX_MEAN`）。比上一轮（批内 23.8~26.2%）噪声更大。第一次启动的 before 批（CPU 31.9%）因为单次等待太久被我中止，原始数据留在 `results/S-before.firstattempt-cpu31.jsonl`，没有采用。
- 数据：`results/S-<标签>.jsonl`；表由 `summarize-simplify.mjs` 生成。

### 数据

每格：fps / 样式重算 ms / PrePaint ms / Paint ms / GPU ms。

| 场景（2000 卡） | 上一轮落地数字（参考，另一天） | before | after | after2 | before2 |
|---|---|---|---|---|---|
| pulse global clip | 60.4 / 6.95 / 0.14 / — / 3.63 | 60.4 / 8.91 / 0.16 / 1.33 / 4.15 | 60.4 / 8.09 / 0.20 / 1.66 / 4.67 | 60.0 / 9.85 / 0.21 / 1.68 / 5.49 | 60.4 / 9.18 / 0.20 / 1.54 / 4.65 |
| shimmer global clip | 60.4 / 3.19 / 0.10 / — / 3.05 | 60.4 / 3.26 / 0.16 / 1.76 / 4.44 | 60.4 / 3.15 / 0.15 / 1.61 / 4.58 | 60.4 / 3.52 / 0.17 / 1.90 / 5.47 | 60.4 / 3.25 / 0.15 / 1.51 / 4.42 |
| pulse global underline | 60.4 / 9.66 / 0.10 / — / 1.63 | 60.4 / 11.11 / 0.18 / 1.57 / 2.49 | 60.4 / 10.37 / 0.17 / 1.32 / 2.33 | 59.6 / 11.63 / 0.22 / 1.92 / 3.30 | 57.6 / 12.48 / 0.20 / 1.74 / 2.61 |
| shimmer global underline | 60.4 / 3.81 / 0.09 / — / 1.63 | 60.4 / 6.78 / 0.22 / 2.23 / 3.93 | 60.4 / 6.52 / 0.19 / 2.02 / 3.27 | 59.6 / 9.62 / 0.33 / 3.43 / 5.60 | 59.6 / 9.76 / 0.30 / 3.25 / 5.42 |

金丝雀（500 卡 shimmer clip 样式重算 / GPU）：首 1.63 / 6.12（before）、1.30 / 5.36（after）、1.41 / 5.17（after2）、1.62 / 6.06（before2）；尾 1.16 / 4.39、1.04 / 4.66、1.43 / 5.57、1.59 / 6.70。2000 卡 fade 金丝雀 GPU 在 1.98~8.46 ms 之间漂，before2 尾部掉到 54.8 帧——这批机器明显比上一轮忙。

### 结论（不美化）

- **pulse + clip 的样式重算没有可辨别的下降**：before 8.91 / 9.18，after 8.09 / 9.85，同一批次内的前后差（约 0.8 ms、-0.7 ms）比批间漂移（after 与 after2 差 1.8 ms）小。预期的"6.95 ms 往下"没有被这批数据支持；这批的 before 本身就是 8.9~9.2（上一轮同场景 6.95，机器当天更忙，不能直接对比）。已知的 6.95 → 更低要在 CPU 安静时重测才能下结论。
- 其余三格（shimmer clip、两种 underline）前后同样在噪声之内；underline 的 shimmer 两次 before / after 之间漂了 3 ms，说明这批的分辨率不够看到 0.5 ms 级的差别。
- fps 全部 ≥57.6，没有掉帧回归；没有任何一格出现明显变差。
- 这批没有证据表明改动让性能变差，也没有证据表明变好；改动的价值目前只能算"少了一层别名和几条规则"（`dist/base.css` 7954 → 7478 B、`dist/global.css` 2468 → 2316 B，gzip 后基本持平）。

### 正确性（`simp-verify.mjs`，`simp.html`，Chrome，端口 9644，临时 user-data-dir）

- `diff`：改前 / 改后各加载一份冻结 dist，暂停动画并定在同一时刻（`currentTime = 700`），逐元素（第一张卡的 32 个元素，含 `button > span`、`select > option`、`textarea`、忽略区里的 `p` / `skz-x`、`skz-leaf`、`skz-bone`、宿主 `wc-card`）对比 18 个计算样式属性。48 个组合：global {浅, 深} × {默认, clip, underline, leaf, tofu} × {solid, fade, pulse, shimmer} + svg 引擎 {默认, underline, leaf, tofu} × {pulse, shimmer}。**所有组合的背景色 / 背景图 / 位置 / clip / 文字色 / 字体 / 可见性 / 圆角都一致**；逐项不一致只有下面三类，都不可见：
  1. 控件（button / input / select / option / textarea）和忽略区里的 `p`：`text-decoration-color` 由 `transparent` 变成 `currentcolor`（这些元素 `text-decoration-line` 本来就是 `none`，不绘制）；
  2. `button > span`（button 的后代，tier0 里 `visibility: hidden`）：`text-decoration-line` 由 `none` 变成 `underline`——删掉的就是这条规则，元素是隐藏的，不绘制；
  3. 根上 `--skz-ul-fill` 在 clip / 默认 / leaf 的 pulse 下不再有值（没人读）。
  另有 svg 引擎根上 `--skz-bg-img` 的 blob 地址不同（每次页面加载都不同，不是样式差异）。
- `ff`（把 `@supports not (background-clip:text)` 换成恒真，强制走撤回分支）：clip 根退回 underline 外观，其余与改前一致；**pulse + 撤回下装饰线颜色由逐帧脉冲变成静态 `--skz-color`**（rgb(217,221,227) 对 rgb(225,229,234)），这是任务里接受的变化。
- `steps`：shimmer clip / underline / tofu 的根 `--skz-shimmer-p` 每秒变化 24 次、步长 4.72vw、文字条 / 图标 / 头像的 `background-position` 逐帧一致（36 个取值）；underline / tofu 的装饰线 / 文字色逐步变化（23 个取值）。pulse + clip：文字条背景色 38 个取值、按钮背景 38 个取值（仍在脉冲）；pulse + underline / tofu：装饰线（和 tofu 文字色）38 个取值。改前改后一致。
- `fw`（200 卡）：pulse / shimmer × clip / underline / tofu 都是 197 张卡被防火墙标记，视口外卡片的文字背景 / 位置 / 装饰线 / 文字色静止，近处卡片仍在变，改前改后一致。
