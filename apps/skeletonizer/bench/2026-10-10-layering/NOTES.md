# 2026-10-10 CSS 分层验证与基准

对象：CSS 分层（core.css / explicit.css / base.css / global.css 重新划分，clip 正向选择器，文字模式表，根驱动挪进各基底）。
对照：改前 = 本批开工前 `pnpm build` 的 `dist/`（第 1 批 JS 拆分已在里面）；改后 = 本批 `pnpm build` 的 `dist/`。两份都冻结成快照，不走 5188 的 vite 开发服务：

| 快照 | 路径 | 说明 |
|---|---|---|
| 改前 | `C:/Users/jelon/AppData/Local/Temp/skz-layer-before` | 改前 dist 整份（JS + CSS） |
| 改后 | `.../skz-layer-after` | 改后 dist 整份 |
| 派生变量实验 | `.../skz-layer-derive` | `make-derive.mjs` 改写改后 CSS 得到（第 4 项 A/B） |
| 选择器写法实验 | `.../skz-layer-x1`~`x6` | `make-variant*.mjs`，排查一次"回归"用，见下"会话状态陷阱" |
| demo 快照 | `.../skz-layer-demo` | `DEMO_BASE=/ pnpm build:demo` |

`serve.mjs`（`/d/before|after|derive/` 指向快照；CSS 可加 `?sim=` 把 `@supports` 条件改成恒假 / 恒真）、`serve-demo.mjs`。端口：5195 改前 / 5196 改后 / 5198 派生实验（基准页按端口选快照）、5197 / 5199 验证页、5200 demo。

## 文件

- 对比：`cssdiff.mjs`（逐规则对比两份 CSS：去注释，拆成 (上下文, 单个选择器, 单条声明) 三元组集合，合并 / 拆分规则、声明顺序不算差异）、`verify.mjs`（`diff` / `sim` / `core` / `dup` / `derive` / `shots`）、`verify-demo.mjs`（demo 的 `diff` / `tiers`）、`fw-check.mjs`（防火墙抽查）、`anim-check.mjs` / `seq-check.mjs`（动画对齐抽查）。页面：`verify.html`、`core.html`（最小 core 页面：`core-js` + `core.css`，import map）、`perf.html`。
- 基准：`gen-scenarios.mjs` → `scenarios/sc-L.json`（完整版）/ `sc-C.json`（core）/ `sc-Ls.json`、`sc-Cs.json`（同一页面顺序跑的旧版）；`gen-x.mjs`、`gen-y.mjs`；`run-batch.mjs`（等 CPU 安静 → 采样 CPU → `bench/kit/run-locked.mjs` 加锁串行，端口 9699、配置目录 `C:/Users/jelon/AppData/Local/Temp/skz-layer-chrome`、视口 1200×800、DPR 1、每格 3 次 trace 取中位数）、`summarize.mjs`、`summarize-y.mjs`；`trace.mjs` / `wait-idle.ps1` / `cpu-log.ps1` 沿用 `../2026-10-10-landing/`。
- 结果：`results/<批>-<标签>.jsonl`（采用的原始数据）、`*.tryN.jsonl`（各次尝试）、`cpu.jsonl` + `cpu-*.log`（批内整机 CPU）、`summary-*.md`（汇总）、`diff.json` / `sim.json` / `core.json` / `dup.json` / `demo.json` / `derive.json`（对比明细）；`shots/` 截图。

## 机器环境（不是安静状态）

日常工作机，后台常驻负载使整机 CPU 空闲基线约 18~22%：每次测前 `wait-idle` 等不到 <15% 连续 6 秒就超时，直接开跑，批内整机 CPU 均值接受 ≤32%（上一轮 simplify 的做法）。采用批次的均值：L 23.7~25.7%，C 26.2~27.0%（`results/cpu.jsonl`）。第一次启动的 before 批（均值 27.9%、阈值当时定的 22%）被我中止重来；那批数据没有保留。**这是 Chrome 154 单机数据，没有其他浏览器 / 真机。**

## 一、逐规则对比（`cssdiff.mjs`，去注释 + 规范化后的三元组集合）

| 入口 | 改前 | 改后 | 只在改前 | 只在改后 | 差异解释 |
|---|---|---|---|---|---|
| svg / sweep / tofu | 13 / 38 / 57 | 同 | 0 | 0 | 无差异 |
| global | 39 | 19 | 21 | 1 | 根驱动（@property、关键帧、pulse / shimmer 根规则、iOS 分支、underline / tofu 的纯色驱动）挪进各基底；防火墙里 color 驱动的挂载选择器改成排除式（见下） |
| explicit | 68 | 81 | 5 | 18 | 少了 `skz-paused`（3 条）和 `skz-cv`（2 条）；多了根驱动（18 项）。预期的行为变化 |
| base | 354 | 382 | 12 | 40 | 多了根驱动 20 项（只引 base 也有 pulse / shimmer 动画）；clip 根从排除式改成正向选择器（根上变量 4 项、撤回分支 4 项、填充规则 2 项，各按两个根重写）；color 挂载选择器改成排除式（2 项） |
| all | 488 | 496 | 15 | 23 | 只有 clip 正向选择器 + color 挂载选择器（根驱动本来就在 all.css 里，只是换了位置） |

所有差异都归为：规则挪层、合并、正向选择器、预期的行为变化，没有未解释项。

## 二、计算样式 + 整页截图对比（改前 vs 改后，Chrome 154，动画暂停在同一时刻）

页面 `verify.html`（一张卡 32 个元素：文字标签、媒体、控件、忽略区、`skz-leaf` / `skz-bone`、Web Component 宿主 `::before`，19 个计算样式属性，另加根上的变量）。

**`diff`（100 个组合）**：72 个样式与像素完全一致，28 个有差异，全部预期：

- 8 个：`all.css` × 未知取值 `skz-text="foo"`（明亮 / 深色 × 4 个效果）：clip → underline 外观（`background-clip` text → border-box，背景色退场，装饰线显示）。clip 正向选择器的预期变化。
- 4 个：`base+global`（没有 tofu.css）× `foo`，同上。
- 6 个：`base` 单独 × {pulse, shimmer} × {默认, underline, leaf}：以前退回 fade，现在有纯 CSS 动画。预期的行为变化。
- 2 个：`explicit` 单独 × {pulse, shimmer}：同上（explicit 现在也带根驱动）。
- 8 个：svg 引擎：样式差异只有根上 `--skz-bg-img` 的 blob 地址（每次加载都不同），像素差异最大通道差 1~4（SMIL 动画不受 `getAnimations().pause()` 控制，两次加载的时刻差）。
- 没有差异的关键项：`text: "tofu"` 没引 `tofu.css` 仍是 underline 外观，`leaf` 不受影响，clip 默认 / 明写 clip / underline / tofu（引 `tofu.css`）全部一致。

**`sim`（老浏览器模拟，66 个组合）**：把产物里的 `@supports` 条件逐一替换成恒假 / 恒真，条件识别和替换在 `serve.mjs` 的 `simulate()`：`all`（`text-decoration-thickness` / `:has()` / 相对颜色全不支持）、`nohas`、`not`（只有 `text-decoration-thickness` 不支持）、`norel`（无 `@property` 根驱动）、`noclip`（强制走 clip 撤回分支）、`ios`（iOS 分支生效）。58 个一致；8 个有差异，全部是 `base` 单独 × {pulse, shimmer} 在 `nohas` / `not` / `noclip` / `ios` 下（根驱动现在在 base 里，被模拟为"支持"的那几档有动画，以前是 fade）；`all` 和 `norel` 下 base 单独 pulse / shimmer 一致（根驱动被 `@supports (color: rgb(from red r g b))` 挡住，仍是 fade）。带 global 的完整版组合在六种模拟下都与改前完全一致。**没有真机 / 其他浏览器，这是 Chrome 里强制检测失败的模拟。**

**`core`（最小 core 页面：`core-js` + `core.css`，import map）**对照完整版 `all.css` 的默认文字模式（solid / fade / pulse / shimmer × 明暗，共 8 格）：样式与像素全部一致。截图 `shots/core-*.png`。`sim` 下 core 的表现：`all`（所有 `@supports` 恒假）= 第 0 档静态色块 + fade（`shots/sim-all-core-after.png`）；`nohas` / `not` = 第 0 档色块 + 根驱动动画（现代档整块被挡，`shots/sim-nohas-core-after.png`）；完整版 base.css 在同一模拟下保留 clip 文字形状（有 `text-decoration-thickness` 就有），没有退化（`shots/sim-nohas-full-clip-*.png`）。

**`dup`（重复加载，core.css 与完整版样式同时引入，96 个组合）**：`core,all` / `core,base,global`（core 在前）全部一致；core 在后（`all,core` / `base,global,core`）有 6 个组合不一致：shimmer × {underline, tofu, 未知取值}：core 的 `[skz][skz-effect=shimmer]`（同优先级、后写的赢）盖掉完整版里 underline / tofu / 未知取值根的"shimmer + pulse"双动画，这类根的装饰线 / 方块字颜色变成静态。clip（默认）、leaf、pulse、solid、fade 都一致。→ 完整版用户不要再引 `skeletonizer` 默认入口（CHANGELOG 已写）。

**`demo`**：`DEMO_BASE=/` 构建的 demo 快照，A = 页面自己按档位加载新分片，B = 把分片换成改前的 `all.css`，同一状态下逐元素（424 个）+ 整页截图对比，49 个组合（明暗 × {clip, underline, leaf, tofu} × {fade, solid, pulse, shimmer, sweep} + svg 引擎 8 个 + loading 关）：样式 49/49 一致；像素 38 个完全一致，其余 11 个是 sweep 深色（2~6 个像素，最大通道差 1）和 svg 引擎（SMIL 时刻差，最大通道差 ≤4）。档位切换 0 → 1 → 2 → 3 → 1 → 3：`vp build` 快照和 5188 开发服务两边分片都加载成功，没有请求失败。

## 三、体积（`gzip -9 -n`，字节）

| 入口 | 改前 raw | 改前 gzip | 改后 raw | 改后 gzip |
|---|---|---|---|---|
| core.css | 9830 | 1853 | 7175 | 1540 |
| explicit.css | 2463 | 792 | 3312 | 1000 |
| base.css | 7515 | 1463 | 8910 | 1757 |
| global.css | 2316 | 570 | 976 | 320 |
| svg.css | 468 | 193 | 468 | 193 |
| sweep.css | 1724 | 566 | 1724 | 566 |
| tofu.css | 4415 | 2006 | 4415 | 2006 |
| all.css | 15967 | 4114 | 16022 | 4126 |

（改前的 core.css 是第 1 批的临时组成 = base + global。）

## 四、性能

### 完整版 2000 卡（16000 元素），global + `enable()`，每格 3 次 trace 取中位数，每格都重新加载页面

格式：样式重算 ms / GPU ms；前后两个数是同一份快照在批序列里先后两次（before → after → derive → after2 → before2 → derive2）。fps 全部 60.4（canary 同）。完整表 `results/summary-L.md`。

| 场景 | 改前 | 改后 | 派生变量实验 |
|---|---|---|---|
| pulse + clip | 5.92 / 2.64，6.01 / 2.67 | 5.94 / 2.66，6.14 / 2.74 | 5.75 / 2.94，5.84 / 2.62 |
| shimmer + clip | 2.20 / 2.64，2.25 / 2.48 | 2.24 / 2.33，2.23 / 2.50 | 2.13 / 2.59，2.24 / 2.31 |
| pulse + underline | 7.94 / 1.55，8.41 / 1.29 | 8.53 / 1.35，8.41 / 1.55 | 8.70 / 1.39，8.22 / 1.27 |
| shimmer + underline | 3.19 / 1.34，3.19 / 1.32 | 3.36 / 1.20，3.45 / 1.19 | 3.29 / 1.19，3.32 / 1.23 |
| 开启耗时 ms（enable，pulse + clip） | 79.3，74.9 | 75.3，81.5 | 78.9，70.9 |

金丝雀（500 卡 shimmer clip / 2000 卡 fade）首尾和各批之间在 0.6~0.7 / 0.19~0.2 ms，GPU 2.9~3.1 / 1.4~1.8 ms 内漂动，批间漂移约 ±0.2 ms（样式重算）。**改前 vs 改后：没有可辨别的差异（差异在批间漂移之内），没有回退。**

### core 页面（第 3 批预览，`core-js` + `core.css`，2000 卡，每格新鲜加载）

| 场景 | fps / 样式重算 ms / PrePaint / Paint / GPU（两次） |
|---|---|
| fade | 60.4 / 0.19 / 0.01 / — / 1.39；60.4 / 0.23 / 0.01 / — / 1.46 |
| pulse + clip | 22.8 / 37.99 / 3.63 / 1.90 / 4.39；23.6 / 36.43 / 3.75 / 1.79 / 4.68 |
| shimmer + clip | 20.4 / 40.66 / 6.25 / 3.09 / 7.38；21.2 / 40.73 / 5.55 / 2.92 / 7.13 |
| 金丝雀 shimmer clip @500 | 60.4 / 4.05 / 0.33 / 0.68 / 2.35；60 / 4.02 …（同场景完整版 0.63~0.72） |

core 没有继承防火墙（防火墙在 `global.css` + `skeletonizer/global` 的 JS 里），pulse / shimmer 在长列表上只有约 20 fps（完整版 + 防火墙是 60 fps，样式重算 2.2~6 ms）。这是第 3 批要决定的事。

## 五、第 4 项 A/B：派生变量只在骨头上计算（`make-derive.mjs`）

做法：改写改后 CSS 文本——根上不再声明 `--skz-fill` / `--skz-bg-pos` / `--skz-ul-fill`（含 iOS、防火墙里的重声明），骨头改读原始变量（`var(--skz-fill,var(--skz-color))` → `var(--skz-pulse-c)`、`var(--skz-bg-pos,0 0)` → `calc(var(--skz-shimmer-p) * 1vw) 0`、装饰线 / 方块字的颜色同理），根上静态声明 `--skz-pulse-c: var(--skz-color)`，防火墙只剩钉两个原始变量。2000 卡 × {pulse, shimmer} × {clip, underline}，上表最后一列。

结论：**不保留**。
- 样式重算：pulse + clip 5.75 / 5.84 对改后 5.94 / 6.14（约 -4%，小于批间漂移 ±0.2 ms 的两倍）；shimmer + clip 2.13 / 2.24 对 2.24 / 2.23；underline 两格没有下降（8.70 / 8.22 对 8.53 / 8.41，3.29 / 3.32 对 3.36 / 3.45）。GPU、开启耗时无变化。没有"明显下降"。
- 正确性：验证页 `verify.mjs derive`（改后 vs 实验版，32 组合）里计算样式有差异：underline / tofu + shimmer 时根上要挂 pulse 动画才有下划线颜色，而骨头（img / 按钮 / 图标……）也改读了同一个 `--skz-pulse-c`，它们的底色会跟着脉冲（以前这些骨头的底色在 shimmer 下是静止的）——原始变量没法同时服务"下划线颜色会变"和"骨头底色不变"两个消费者，要回到按模式派生；另外宿主样式（`hosts.ts`，读 `--skz-fill`）、后代自己改 `--skz-color`、svg 引擎的静态覆盖都会受影响。
- 所以回退（实验只存在于冻结快照 `skz-layer-derive` 和 `make-derive.mjs`，`src/` 没有改动）。

## 六、会话状态陷阱（本批踩到的，下一轮基准要注意）

第一轮 L 批（场景在同一页面里顺序跑，`scenarios/sc-Ls.json`，数据在 `results/Ls-*.jsonl` / `summary-Ls.md`）里 **shimmer + underline 的样式重算改前 5.26 / 5.17、改后 7.14 / 7.08 ms，两次重复都一致**，派生变量实验 5.06 / 5.70；X 批（`results/X-*.jsonl`）同样：改前 3.86 / 5.38、改后 5.40 / 7.22。我怀疑是改后的 color 驱动挂载选择器（排除式 `:where([skz-text]:not(...):not(...))`）匹配开销更高，做了 x1~x6 六个选择器写法的变体，x2（改回显式枚举）看起来"恢复"，x1（选择器列表）更差——但 x3（x1 + x2）两次结果 7.53 / 3.85 不一致。

最后用**每格都重新加载页面**的做法（`sc-Y.json`：6 次新鲜加载 × 中位数）重测：改前 3.31、改后 3.35、x2 3.30、x4 3.29、x6 3.38 ms——**全部一致，没有差异**；`sc-L.json`（本批采用的数据）也是每格新鲜加载，改前 / 改后 / 派生都在漂移之内。

原因（`seq-check.mjs` / `anim-check.mjs`）：同一页面里先跑过 pulse 的场景后，`setup()` 清掉再重写根属性（同一个任务里，没有样式重算夹在中间），上一个场景留下的 `skz-pulse-root` 动画保留着旧的开始时间，新的 `skz-shimmer-root` 现在才开始，两个 `steps(36)` 动画的步进边界错开了一个任意的偏移（实测 -116.9 ms 与 -183.5 ms，对 41.67 ms 的步长取模分别约 8 ms 和 17 ms；前者两个边界多数落在同一帧、后者落在不同帧），不同帧各重算一次，样式重算翻倍。偏移取决于场景之间隔了多久，和 CSS 无关；新鲜加载下偏移为 0（8 次重复都是 0）。

顺带的发现（和本批无关，改前也一样，没有动）：在一个正在跑的根上切换 `effect` / `text`，旧动画会残留旧开始时间，shimmer + underline 的两个动画会错开，样式重算最多翻倍。

## 七、没做 / 没验证

- 没有 Safari / Firefox / 真机；老浏览器只是在 Chrome 里把 `@supports` 条件改成恒假 / 恒真。
- `skeletonizer/explicit.css` + 完整版 JS 的组合现在没有 `skz-paused` / `skz-cv` 样式（见 CHANGELOG），视口外的根不会暂停动画；没有加新的 `lazy.css` 入口，等第 3 批决定。
- core 没有防火墙，长列表上 pulse / shimmer 约 20 fps（上表）。
