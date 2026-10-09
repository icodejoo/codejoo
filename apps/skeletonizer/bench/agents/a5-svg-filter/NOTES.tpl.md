# 实验 a5：SVG 滤镜"剪影"骨架屏原型 —— NOTES

日期 2026-10-08。执行者只做原型与实测，未改 `src/ test/ docs/ README*`，未 commit。
机器：Windows 10，Intel UHD 770 集显，Chrome（端口 9345，配置目录 `<scratchpad>/chrome-prof-a5`），视口 1280x900，每格数据为 3 次 trace 的每帧中位数。

## 1. 方案与实验目的

不用选择器推骨头，给根加 `filter:url(#x-ske-f-*)`，由滤镜把"渲染结果"按亮度抠成剪影、膨胀合并成条、再填骨头色。
滤镜链：`feColorMatrix`（alpha=2.4-3*亮度，浅色版；深色版 alpha=3*亮度-0.6）-> `feComposite in SourceAlpha`（排除透明像素）-> `feComponentTransfer discrete`（二值化）-> `feMorphology dilate`（默认 4 3）-> `feFlood` + `feComposite in`。

| 实验 | 目的 | 对应场景文件 |
|---|---|---|
| E1 滤镜 V-A（静止/pulse/shimmer 覆盖层/滚动） | 验证"剪影"方案是否让 pulse/shimmer 摆脱每帧样式重算 | `scen-A.json`（前 2 项有效，其后被打断，见 §6）+ `scen-A-rest.json`（补跑其余 6 项） |
| E2 V-B（骨头叠原背景）、V-C（模糊后再二值化=圆角） | 看保留卡片底/边框的成本，以及圆角的成本与效果 | `scen-BC.json` |
| E3 对照组 prod.css（默认=fade、叶子、叶子+shimmer；静止/滚动） | 现状基线 | `scen-prod.json` |
| E4 额外：膨胀半径 2 2 / 6 4、深色主题 | 半径档位的成本；深色滤镜的成本 | `scen-extra.json` |
| E5 开启动作 trace（额外） | 看"开启一次"在主线程/GPU 上的总开销（toggleMs 只含同步样式+布局，漏掉绘制） | `scen-toggle.json` + `trace-toggle-a5.mjs` |
| E6 视觉 | 看字是否连条、图片、浅色区域、白字按钮、边框 | `visual.html` + `shot-a5.mjs` / `shot-a5-b.mjs` |
| E7 有效性校验 | 确认 27 万像素高的根上滤镜真的生效、滚动场景真的在滚 | `shot-a5-perf.mjs` |
| smoke | 冒烟 | `scen-smoke.json` |

## 2. 文件清单

生成/源文件
- `gen.mjs`：生成全部滤镜（浅/深 x A / A-r22 / A-r64 / B / C 共 10 个），输出 `filters.inc.html` 与 `filter-<主题>-<变体>.svg`。
- `filter-light-A.svg`（V-A，4 3）、`filter-light-A-r22.svg`（2 2）、`filter-light-A-r64.svg`（6 4）、`filter-light-B.svg`（V-B）、`filter-light-C.svg`（V-C）；`filter-dark-*.svg` 同理（骨头色 #374151，亮度判断反向）。
- `filters.inc.html`：上述 10 个滤镜合在一个 `<svg width=0 height=0>` 里，由 build 内联进测试页。
- `filter.css`：方案指定的最小 CSS（按原文），其后追加 shimmer 覆盖层样式与变体选择器（`x-ske-f="B|C"`、`x-ske-f-r="22|64"`）。
- `perf.src.html` -> `build.mjs` -> `perf.html`：性能页（从 `perf.template-orig.html` 改，后者是工具包原件）。`visual.src.html` -> `visual.html`：视觉页。`build.mjs` 只在内容变化时才写（见 §6 教训）。
- `prod.css`：`dist/skeletonizer.css` 的拷贝（对照组）。
- `scen-*.json`：场景。
- `trace-a5.mjs`：工具包 `trace.mjs` 的改版（加 `scroll` 字段、`toggleFrameMs`、evaluate 超时）；`trace-toggle-a5.mjs`：开启动作 trace。
- `run-locked-a5.mjs`：工具包 `run-locked.mjs` 的改版（可指定脚本；加防窗口遮挡标志；仍用工具包同一把 `bench.lock`）。
- `shot-a5.mjs`（第一批视觉截图）、`shot-a5-b.mjs`（第二批：深色主题媒体浅底、2x 放大）、`shot-a5-perf.mjs`（性能页有效性校验截图 + 滚动校验）。
- `run-all.sh`、`run-A-rest.sh`、`run-after.sh`：把各步骤串起来的脚本（每步各自拿锁）。`probe.mjs`：排查窗口 hidden 用的探针。
- `NOTES.tpl.md` / `make-notes.py`：本文的模板与填表脚本（把 `results/table-*.md` 填进来）。
- `results/`：原始结果，见 §3。`shots/`：截图，见 §5。

## 3. 原始结果文件（results/）
- `results-A.jsonl`：E1 前 2 行（static/pulse n500）有效，其后因 perf.html 被我重写触发 vite 重载而崩溃（`results-A-v1-crashed-by-reload.err`、`results-A-v1-partial.jsonl` 是留档）。
- `results-A-rest.jsonl`：E1 补跑的其余 6 行。
- `results-BC.jsonl`（E2）、`results-prod.jsonl`（E3）、`results-extra.jsonl`（E4）、`results-toggle.jsonl`（E5）。
- `smoke.jsonl`；`smoke-v1-hidden-hang.*` 是第一次冒烟（窗口 hidden 导致 rAF 不触发而挂起，见 §6）。
- `shots.log/err`、`shots-b.log/err`、`shots-perf.log/err`：截图脚本输出。
- `table-steady.md`、`table-toggle.md`：由 jsonl 汇总的表（下方 §4 同）。

## 4. 数据

指标均为"每帧中位数 ms"（`-` 表示该项在 trace 里为 0 / 未记录）。`raster` 在 GPU 光栅下基本不出现在 CompositorTileWorker，看 `gpu` 与 `compositor`。fps 受 rAF 限制上限约 60，所以低成本场景都是 60.x。
toggleMs = 同步切开关属性 + 强制样式布局的耗时（9 次中位数）；toggleFrameMs = 切开关后再过两帧 rAF 的耗时（主线程视角，不含异步光栅）。

@@T1@@

对照读法：
- n=2000（16000 元素）：现状 叶子+shimmer 21.6fps、样式重算 38.7ms/帧；滤镜 V-A 的 shimmer 覆盖层 60.4fps、样式重算 0.1ms/帧、gpu 2.4ms。滚动同理（20.8fps vs 60.4fps）。n=500：现状 shimmer 58.8fps（滚动 48.8fps），滤镜 60.4fps。
- 滤镜 pulse = 根 opacity 动画，成本与现状默认模式（fade）同量级（gpu 1.5 vs 1.5）；shimmer 覆盖层比 pulse 多约 0.9ms gpu（光带 + `mix-blend-mode: lighten`）。
- B/C 与 A 在静止/滚动下没有可测差异；半径 2 2 / 6 4、深色也无差异。
- 滚动时滤镜与现状默认模式一样主线程近乎 0（合成器滚动）；"滚动 + 滤镜"gpu 约 2.0~2.4ms，现状默认 1.7ms。

### 开启一次的总开销（E5，trace 开启动作后 2 秒，单位 ms，非每帧总量）

@@T2@@

读法：n=2000 时滤镜开启的主线程合计约 249ms，其中 Paint 130ms（根获得 filter 效果节点后整棵子树要重新记录绘制）；现状默认模式约 134ms，几乎没有 Paint。n=500 时两者接近（约 55 vs 58）。注意 prod 默认模式这 2 秒里有 fade 动画在跑，所以它的 gpu/compositor 比滤镜静止版大，两列不可直接比；主线程各列才可比。Layout 滤镜也略高（42 vs 25），原因未深究。

## 5. 截图清单（shots/）与逐张描述

页面：`visual.html`，3 列卡片 + 1 张通栏长文字。含：真实截图图片（`docs/assets/tier0-top.png`、`sweep-light.png` 浅色、`sweep-dark.png` 深色、`sweep-bg-light.png`）、深色按钮配白字、蓝色按钮、彩色标签（实色）、浅色底标签、带 1px 边框的卡片与空盒、浅灰小字（#9aa0a6）与更浅灰字（#c5c9ce）、绿色细条、输入框、长文字。

- `01-raw-light.png` 原样（基准）。
- `02-A-light.png` V-A 浅色（半径 4 3）：
  - 字：标题、正文、长文字都连成实心条，中文几乎完全成条；英文连续段也成条，条上下沿有字母高低造成的锯齿。长文字四行之间有约 1~3px 细缝，没有粘连（行高 22px）。
  - 图片：深色图片（sweep-dark）整块成一个圆角实心块，符合预期；**浅色截图类图片（tier0-top、sweep-light、sweep-bg-light）大面积是白底，几乎全部丢失**，只剩零星灰块与右侧滚动条碎片，像"破碎的残影"而不是一个块。
  - 浅色区域：#c5c9ce 的更浅灰字完全丢失（该行是空的）；#9aa0a6 浅灰小字勉强成条；浅蓝/浅黄底标签的底色丢失，只剩文字条；实色标签（绿/橙/红/紫）、蓝按钮、深色按钮都是整块实心。
  - 白字深色按钮：整块实心，没有出洞（白字笔画间隙被 4x3 膨胀填满；更大字号下是否出洞未测）。
  - 边框：卡片 1px 浅灰边框整体消失（浅色不算墨迹）；空盒的 1px 边框也消失。绿色 6px 细条保留为条。输入框、按钮因 filter.css 把媒体兜底成黑底而成实心块。
- `03-B-light.png` V-B（骨头叠原背景）：卡片白底与 1px 边框保留，文字成条。**但原内容会泄露**：浅色图片原有内容（截图里的灰块、文字）仍清晰可见，只是被条盖了一部分；#c5c9ce 浅灰字原样显示；彩色标签边缘有一圈原色残边；个别数字碎片露出。骨架屏要隐藏真实内容，B 对浅色内容的泄露是硬伤。
- `04-C-light.png` V-C（模糊 σ=2 再二值化）：条的端头、转角变圆，字间小缺口被抹平，条边缘是"波浪/气泡"状；比 A 更软，但轮廓偏肿，行间缝隙比 A 窄。
- `05-raw-dark.png` 深色主题原样（`data-x-ske-theme=dark`，卡片 #1b1f27，字 #eee）。
- `06-A-dark.png` 深色 V-A：文字成条；白色/浅色图片整块成实心块；深色图片（sweep-dark）几乎丢失；**深色主题下 filter.css 把按钮/输入框兜底成 #000 黑底，在深色滤镜里不算墨迹，所以按钮只剩文字条、输入框成空框**（性能页里的头像 mock 图黑底也消失，见 perf-n2000-A-dark-*）；空盒的浅色边框（#d0d7de 在深色卡片上算亮色）被膨胀成约 9x7px 的粗框。
- `07-B-dark.png` 深色 V-B：保留卡片底和边框，同样有原内容泄露（深色图片原样可见、深灰字 #777/#444 原样可见），黑底按钮变成黑块、红色标签有残边。
- `08-A-light-r22.png` 半径 2 2：中文大体成条，**英文字母间仍有明显缺口，条断成小块**，细字更碎；行间干净。
- `09-A-light-r64.png` 半径 6 4：所有字连成粗条，**行间缝隙缩到约 0~1px，局部相邻两行粘连**（长文字第 2/3 行）；标签、按钮略显肿。
- `10-A-dark-mediabg-light.png` / `11-B-dark-mediabg-light.png`：深色主题下把媒体兜底底色改成 #ddd 的补充对照：按钮、输入框、图片区域恢复成实心块；深色图片仍丢失。结论：filter.css 里"媒体兜底 #000"在深色主题要换成浅色。
- `12-raw-zoom2x-*`、`13-A-zoom2x-*`、`14-A-r22-zoom2x-*`、`15-A-r64-zoom2x-*`、`16-C-zoom2x-*`：2x 放大的第一张卡片文字（`-card1`）与长文字（`-longtext`）对照；2x 下滤镜依然生效（按设备像素算），条边缘更细腻，结论同上。
- `perf-n500-...` / `perf-n2000-A-{light,shimmer,dark}-{top,mid,bottom}.png`：性能页有效性校验，n=2000 时文档高约 270629px，顶/中/底三处视口都被滤镜成功处理，shimmer 光带可见。`perf-n500-raw-top.png` 为无滤镜对照。
- 滚动有效性：`results/shots-perf.log` 末尾 `scroll-check`：1000ms 内 57 帧，scrollY=342（=57x6），滚动场景确实在滚。

## 6. 过程中的失败与处理（均保留）
1. 首次冒烟（`results/smoke-v1-hidden-hang.*`）：测试 Chrome 窗口被判定 hidden，`requestAnimationFrame` 不触发，`frames()` 永久挂起约 14 分钟；我手动终止了自己的进程并释放自己持有的锁。处理：`run-locked-a5.mjs` 给 Chrome 加 `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`，`trace-a5.mjs` 的 evaluate 加 180s 超时（另一个代理 a2 遇到的是同一问题）。
2. E1 中途崩溃：我在基准运行期间执行了 `build.mjs`，它重写了 `perf.html`（内容相同），vite 整页重载，trace 的 `Runtime.evaluate` 返回 undefined。处理：`build.mjs` 改为内容不变不写；E1 后半补跑为 `results-A-rest.jsonl`。
3. 锁排队很长（10~20 分钟一次），已按要求不绕过。

## 7. 结论与解释

### 性能：成立（有前提）
- 稳态：滤镜把"每帧样式重算 30~38ms"降到 0.1~0.2ms，pulse/shimmer 在 16000 元素、27 万像素高的根上仍是 60fps，主线程几乎空闲。原因：滤镜作用在根上，骨头不再由 CSS 选择器推导，动画只动根的 opacity 或根同级覆盖层的 transform，都是合成器线程动画，样式系统不参与。
- 成本被"搬走"而不是消失：一次性开启时根获得 filter 效果节点，n=2000 主线程多一次约 130ms 的 Paint（现状几乎为 0），开启总主线程 249ms vs 现状 134ms；n=500 时两者持平。GPU 侧稳态约 2ms/帧，与现状同量级；但这是集显 Intel UHD 770 上的数据，低端手机/更弱 GPU 上 feMorphology + 渲染表面的成本没测，要单独验证。
- V-B、V-C、半径档位、深色主题在性能上都无可测差异，所以选哪个变体应由视觉决定。

### 视觉：只有部分成立
- 成立：文字（中英）连成条、行间不粘连（4 3）、实色/深色元素整块、深色图片成块、白字按钮不出洞（本页字号下）。
- 不成立 / 问题清单：
  1. **浅色内容丢失**：白底浅色图片、更浅灰字（亮度大于约 0.63）、浅色底标签的底、1px 浅灰边框都不算墨迹，直接消失；浅色图片留下破碎残影，不是一个块。这是"按亮度抠"原理决定的，滤镜里无法区分"浅色图片"与"空白"。
  2. **V-B 泄露原内容**：没被识别的像素原样保留，浅色图片、浅灰字、标签边缘都会漏出真实内容，违背骨架屏目的；不建议。
  3. **深色主题要换判断方向且媒体底色要改**：现有 `background-color:#000 !important` 在深色里不是墨迹，按钮/输入框/头像消失；浅色边框在深色里被膨胀成粗框；深色图片在深色里丢失。浅/深必须由使用者指定，不能自动。
  4. 半径需要折中：2 2 英文碎，6 4 行间粘连，4 3 在 14px/行高 22px 下刚好；行高小、字号大时 4 3 会粘行，需要按字号/行高调（整个根统一，无法按元素自适应）。
  5. V-C 圆角有效，但轮廓偏肿、行缝更窄；性能无额外成本。若要圆角，C 是唯一方案。

### 是否值得落地为一种模式
- 值得做成**可选的"高成本动画专用"模式**：适用场景是元素多（几千以上）且要 pulse/shimmer 的列表页，浅色或深色主题固定、内容以文字与深色/实色块为主、可接受浅色图片丢失或自行给图片占位提供深色底。它是本批实验里唯一让大页面 pulse/shimmer 保持 60fps 的方案（现状 21fps）。
- 不适合作默认模式：浅色图片/浅灰字/边框的丢失与 B 的泄露，需要使用者按内容保证。

### 主要风险
1. **`x-ske-ignore` 无法生效**：滤镜对根的最终像素整体处理，子元素无法"豁免"（后代逃不出祖先的 filter）；想保留某块真实内容，只能把它移出滤镜根的 DOM 子树，或在滤镜根上方叠一份克隆。与现有"在 DOM 里标记 ignore"的语义不兼容。（原理推断，未做实验。）
2. **亮度判断**：阈值固定，浅/深主题需显式指定，混合主题页面（浅色页里的深色块、深色页里的浅色块）表现不一致；半透明、渐变、阴影、图片内部明暗都会影响结果。
3. **性能热点**：开启时主线程 Paint（n=2000 约 130ms）；根被迫成为很大的渲染表面（27 万像素高仍正常，低端设备/内存未测）；feMorphology 半径越大越贵（本机无可测差异，弱 GPU 上不一定）；shimmer 覆盖层的 `mix-blend-mode: lighten` + `will-change` 额外约 0.9ms gpu。
4. 兜底样式（`filter.css` 里对 img/button/input 等强制 #000 底）会改变真实 UI，需限定在 `[x-ske-f]` 范围内且随主题变化。
5. 无障碍：真实文本仍在 DOM，需要 `aria-busy` 之类另行处理；`pointer-events:none`、`user-select:none` 已在根上。
6. 浏览器兼容未测：只在 Chrome（Windows）测过；Safari/Firefox 对大尺寸 SVG 滤镜的上限与性能不同。
