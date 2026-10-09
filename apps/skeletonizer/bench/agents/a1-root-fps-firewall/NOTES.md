# a1 实验笔记（继承防火墙 + 自适应写入频率）

执行：子代理 a1。端口 9341，Chrome 配置目录 `<scratchpad>/chrome-prof-a1`。所有基准都通过 bench.lock 串行跑。未改 src/ test/ docs/ README*，未 commit。

## 1. 方案与目的

- 实验 1a：验证"继承防火墙"机制。给根的直接子元素（卡片）打 `x-ske-fw`，CSS 里让卡片自己声明固定的注册变量值，看根变量变化时子树是否不再重算样式。
  - 先测任务给定的字面版（只重置 `--x-ske-pulse-c` / `--x-ske-shimmer-p`），再测扩展版（连同派生变量一起重置，见下文）。再测"只给一半卡片打"的对照。
- 实验 1b：实用版。JS 里用 IntersectionObserver（rootMargin 100px）观察根的直接子元素，离开视口打 `x-ske-fw`，进入去掉。
  - 两种启动方式：`io` = 先全部不打，等 observer 初次回调再打离屏的；`iopre` = 先全部预打，observer 初次回调把视口内的摘掉。
  - 对比 `x-ske-cv`（content-visibility）和不处理的基线。测每帧样式重算、帧率、开启耗时、滚到中间后的每帧开销，并截图验证。
- 实验 2a：原型计时器（共享 rAF、到点才写、值不变跳过），固定每 N 帧写一次，N=1/2/3。
- 实验 2b：自动档。写入后看下一帧 rAF 间隔，>20ms 则 N+1（上限 4）；连续 30 帧 <17ms 则 N-1。额外测了上限 8 和中间规模（1000/1400 卡片）。

## 2. 文件清单

| 文件 | 用途 |
|---|---|
| `perf.html` | 基准页（从 perf-template.html 改）。额外暴露：`jsDrive(modeStr,arg)` 启动防火墙/计时器/滚动；`toggleCost()` 重写为"开启到第一帧完成（+IO 初次回调后再一帧）"；`statReset/statGet` 读写入频率；默认 css 为 base |
| `base.css` | `sass src/styles/skeletonizer.scss` 编出的当前源码可读版（含 x-ske-tick、x-ske-cv），基线 |
| `fw0.css` | base + 任务给定的字面防火墙规则（只重置两个注册变量） |
| `fw1.css` | base + 扩展防火墙规则（再重置 `--x-ske-fill` / `--x-ske-ul-fill` / `--x-ske-bg-pos`） |
| `trace-a1.mjs` | trace.mjs 副本：增加读取计时器写入统计（wps、avgN）、toggleFirstMs |
| `run-a1.mjs` | run-locked.mjs 副本：锁目录与 ps 脚本仍指向工具包，仅换成调用 trace-a1.mjs |
| `verify-a1.mjs` | 正确性验证脚本（同样拿锁）：读计算样式采样 + 截图，输出 `shots/` |
| `s1a.json` `s1b.json` `s2.json` `s2b.json` | 场景文件，见下 |
| `results-1a.jsonl` `results-1b.jsonl` `results-2.jsonl` `results-2b.jsonl` | trace 原始输出（每行一个场景，原样） |
| `results-*.err` `results-1b-verify.txt/.err` | 运行日志 / 验证脚本输出 |
| `r1a.txt` `r1a.err` `results-1b.jsonl.bak` | 重复拷贝，内容同 results-1a / results-1b，保留未删 |
| `shots/` | 截图 |

## 3. 场景文件与实验对应

- `s1a.json`：实验 1a。pulse/shimmer（叶子模式）× 4000/16000 元素 × {baseline, fw0 全部, fw1 全部, fw1 一半（隔一张打）}。`js=["fwall"|"fwhalf",0]`。
- `s1b.json`：实验 1b。pulse/shimmer × 4000/16000 × {baseline, io, iopre, cv} × {top 顶部, mid 滚到中间}，均带 toggle（7 次取中位数）。
- `s2.json`：实验 2a/2b。pulse/shimmer × 4000/16000 × {css-animation, fixed N=1/2/3, auto cap4, auto cap8}。
- `s2b.json`：实验 2b 补充。8000/11200 元素 × {css-animation, fixed-N1, auto-cap4}，看自动档在中间规模的自适应。
- 页面 `?css=` 选 CSS；场景里 `attrs` 数组 = 纯 CSS 路径（根属性）；计时器场景给根加了 `x-ske-tick`，让 CSS 停掉根动画，由原型计时器写 `--x-ske-pulse-t` / `--x-ske-shimmer-p`。

## 4. 结果与结论

计量说明：样式重算 = UpdateLayoutTree ms/帧（每帧中位数，3 次取中位）。机器被三个代理共用，基线帧率有波动（16000 元素 shimmer 基线 14~20fps，任务给的参考是 22fps），所以每个对比以同一批次内的基线为准。

### 实验 1a：成立（但必须用扩展版）

字面版不成立。原因：根上的 `--x-ske-fill: var(--x-ske-pulse-c)`、`--x-ske-bg-pos: calc(var(--x-ske-shimmer-p) * 1vw) 0`、`--x-ske-ul-fill` 是未注册的自定义属性，var() 在根上就被展开成字符串再被继承。根变量每变一次，这些字符串也变，所有后代照样重算；卡片只重置两个注册变量拦不住。所以 shimmer 字面版毫无改善（58ms vs 51ms 基线），pulse 只略降。扩展版在卡片上用同样的 var() 表达式重新声明派生变量（值取自卡片自己的固定值），卡片自己重算但计算值不变，后代不再重算，机制成立。

| 场景 | 元素 | 帧率 | 样式重算 ms | PrePaint ms |
|---|---|---|---|---|
| pulse baseline | 4000 | 58.4 | 9.65 | 1.38 |
| pulse fw0 字面 全部 | 4000 | 58.4 | 5.48 | 0.59 |
| pulse fw1 扩展 全部 | 4000 | 60.4 | 1.18 | 0.01 |
| pulse fw1 一半 | 4000 | 60 | 6.12 | 0.65 |
| pulse baseline | 16000 | 14 | 48.62 | 9.18 |
| pulse fw0 字面 全部 | 16000 | 18.4 | 31.38 | 7.03 |
| pulse fw1 扩展 全部 | 16000 | 60.4 | 4.82 | 0.01 |
| pulse fw1 一半 | 16000 | 27.6 | 22.25 | 4.23 |
| shimmer baseline | 4000 | 60 | 10.7 | 2.15 |
| shimmer fw0 字面 全部 | 4000 | 60 | 10.86 | 1.75 |
| shimmer fw1 扩展 全部 | 4000 | 60.4 | 2.48 | 0.02 |
| shimmer fw1 一半 | 4000 | 56.8 | 9.2 | 2.69 |
| shimmer baseline | 16000 | 14.4 | 51.57 | 15.64 |
| shimmer fw0 字面 全部 | 16000 | 12.4 | 58.47 | 18.99 |
| shimmer fw1 扩展 全部 | 16000 | 60.4 | 4.84 | 0.02 |
| shimmer fw1 一半 | 16000 | 32.8 | 22.1 | 6.25 |

剩余的 4.8ms ≈ 2000 张卡片 × 约 2.4µs，和"卡片数 × 单元素成本"吻合；打一半则开销约线性减半（22ms）。全部打了防火墙后 PrePaint 降到约 0（屏蔽的骨头颜色不再变化，不用重绘）。

### 实验 1b：成立，推荐 iopre 版，优于 x-ske-cv

CSS 用 fw1.css。开启耗时的定义（和模板 toggleCost 不同）：从 `setAttribute("x-ske")` 到第一帧完成（rAF 后再 setTimeout 0）= first；io/iopre 再加"observer 初次回调完成后的下一帧完成" = settled（toggleMs）。基线和 cv 的 first=settled。注意 `toggleFirstMs` 只是最后一次重复的值，不是中位数；`toggleMs`（settled）是 7 次中位数。

| 场景（16000 元素） | 帧率 | 样式重算 ms | PrePaint | 开启 first ms | 开启 settled ms |
|---|---|---|---|---|---|
| shimmer baseline 顶部 | 18.8 | 46.3 | 6.37 | 125.6 | 96.7 |
| shimmer baseline 中间 | 18.8 | 46.9 | 5.94 | 97.3 | 97.3 |
| shimmer io 顶部 | 60.4 | 5.39 | 0.23 | 98.6 | 192.8 |
| shimmer io 中间 | 60.4 | 6.16 | 0.24 | 107.5 | 210.5 |
| shimmer iopre 顶部 | 60.4 | 5.73 | 0.21 | 91.3 | 114.9 |
| shimmer iopre 中间 | 60.4 | 5.37 | 0.21 | 101.1 | 103.6 |
| shimmer cv 顶部 | 60.4 | 8.28 | 0.44 | 249.8 | 256.4 |
| shimmer cv 中间 | 54 | 7.87 | 2.16 | 252.2 | 268.7 |
| pulse baseline 顶部 | 26.4 | 34.5 | 3.72 | 82.2 | 76.2 |
| pulse baseline 中间 | 25.2 | 36.4 | 3.37 | 95.1 | 86.1 |
| pulse io 顶部 | 60.4 | 4.66 | 0.10 | 73.8 | 150.4 |
| pulse io 中间 | 60.4 | 5.19 | 0.10 | 93.6 | 174 |
| pulse iopre 顶部 | 60.4 | 4.64 | 0.12 | 74.3 | 87 |
| pulse iopre 中间 | 60.4 | 4.90 | 0.10 | 78.9 | 96.5 |
| pulse cv 顶部 | 60 | 7.75 | 0.21 | 310 | 266.6 |
| pulse cv 中间 | 59.2 | 7.42 | 1.63 | 258.9 | 273.1 |

4000 元素（500 卡片）也都 60fps（shimmer baseline 中间 54.8）：基线样式重算 9.2~12.3ms，io/iopre 1.4~1.9ms，cv 2.3~3.5ms；开启耗时基线 25~29ms，iopre 35~37ms，io 36~59ms，cv 约 21~24ms（小规模 cv 没有明显开启代价）。完整数据见 results-1b.jsonl。

要点：
- iopre 的开启耗时基本等于基线（约 100ms，主要是首次样式匹配本身的成本，与是否带动画无关），io 因为第一帧仍是全量动画、回调后还要再一帧，settled 约翻倍。cv 开启耗时约 250~310ms，是基线的 2.5~3 倍。
- 滚到中间后每帧开销与顶部基本相同（样式重算 5~6ms，PrePaint 无明显增加）；cv 在中间 PrePaint 升到 1.6~2.2ms，shimmer 掉到 54fps。
- 视觉验证（verify-a1.mjs，输出 `results-1b-verify.txt`，截图见下）：视口内卡片的计算样式随时间变化（shimmer 的 background-position 每次采样都在动；pulse 的颜色在变）；视口外第 1000 张的值恒定（shimmer -758.4px，pulse rgb(217,221,227)）；2000 张里 1993 张带 fw，视口内 0 张带 fw；滚到中间后视口内 6 张全部不带 fw、动画继续；滚回顶部后 2 帧内的采样就是动画在走。截图肉眼可见视口内有高光，没有静止的占位卡片。
- 没有测连续滚动时的帧率和 observer 回调开销（只测了静止在中间的每帧开销），这是未验证部分。

### 实验 2：成立（自动档上限 4 已能达到 ≥45fps）

| 场景 | 元素 | 帧率 | 样式重算 ms | PrePaint | 每秒写入次数 | 平均 N |
|---|---|---|---|---|---|---|
| shimmer css-animation | 16000 | 20 | 42.84 | 6.76 | - | - |
| shimmer fixed N=1 | 16000 | 20.4 | 42.49 | 5.22 | 20.1 | 1 |
| shimmer fixed N=2 | 16000 | 36.8 | 20.18 | 2.51 | 18.2 | 2 |
| shimmer fixed N=3 | 16000 | 44.4 | 12.47 | 1.82 | 14.7 | 3 |
| shimmer auto 上限 4 | 16000 | 47.6 | 9.38 | 1.33 | 11.8 | 4 |
| shimmer auto 上限 8（额外） | 16000 | 53.6 | 4.65 | 0.70 | 6.7 | 8 |
| pulse css-animation | 16000 | 25.6 | 36.0 | 3.12 | - | - |
| pulse fixed N=1 | 16000 | 36.4 | 16.86 | 2.60 | 17.5 | 1 |
| pulse fixed N=2 | 16000 | 43.2 | 12.2 | 2.30 | 15.8 | 2 |
| pulse fixed N=3 | 16000 | 47.6 | 8.66 | 1.69 | 12.2 | 3 |
| pulse auto 上限 4 | 16000 | 50.4 | 7.13 | 1.30 | 10.6 | 4 |
| pulse auto 上限 8（额外） | 16000 | 52.4 | 4.53 | 0.82 | 6.0 | 8 |
| shimmer css-animation | 4000 | 60.4 | 10.68 | 1.49 | - | - |
| shimmer fixed N=1 / 2 / 3 | 4000 | 60.4 | 10.25 / 4.70 / 3.25 | 1.36 / 0.49 / 0.35 | 59.9 / 30.2 / 20.2 | 1 / 2 / 3 |
| shimmer auto 上限 4 | 4000 | 60.4 | 9.3 | 1.12 | 54.4 | 1.19 |
| pulse fixed N=1 / 2 / 3 | 4000 | 60.4 | 3.17 / 3.05 / 2.15 | 0.45 / 0.36 / 0.28 | 21 / 21 / 14.7 | 1 / 2 / 3 |
| pulse auto 上限 4 | 4000 | 60.4 | 3.58 | 0.48 | 20.3 | 1 |

中间规模（s2b，自动档自适应）：

| 场景 | 元素 | css 帧率 | fixed-N1 帧率 | auto 帧率 | auto 写入/秒 | auto 平均 N |
|---|---|---|---|---|---|---|
| shimmer | 8000 | 40.4 | 37.2 | 58.8 | 31 | 1.93 |
| pulse | 8000 | 47.6 | 59.6 | 60.4 | 21.9 | 1 |
| shimmer | 11200 | 31.2 | 28.8 | 56.8 | 14.5 | 3.97 |
| pulse | 11200 | 36 | 50.8 | 58.8 | 17.1 | 2.5 |

结论：
- 固定 N 在 16000 元素 shimmer 下需要 N≥3 才接近 45fps，N=1 与 CSS 动画无差别（每帧都写）。pulse 的 N=1 写入已被量化（32 级，约 17~21 次/秒），所以本就比 CSS 动画快。
- 自动档（上限 4）在 16000 元素下：shimmer 47.6、pulse 50.4，都 ≥45，写入频率降到约 11/s、10.6/s；平均 N 就是上限 4，说明在这个规模下一直顶在上限，没有在 N 之间来回震荡。上限放到 8 帧率更高（53 左右）但动画只有 6~7 次/秒，会很卡顿，不建议。
- 中间规模自动档能自适应：8000 元素 shimmer 平均 N=1.93，帧率 58.8（固定 N=1 只有 37）；11200 元素 shimmer 平均 N≈4，56.8fps。小规模（4000）自动档基本停在 N=1，与 CSS 动画一样。
- 帧率不随 N 线性提升：写入帧的耗时可能超过 2 个 vsync，N 增大的收益递减。
- shimmer 比 pulse 贵：每次写入 2 个变量，且 background-position 变了要重画，PrePaint 更高。

## 5. 截图清单（`shots/`）

均为 fw1.css + io 防火墙，16000 元素（2000 卡片）：
- `shimmer-top-a.png` / `shimmer-top-b.png`：顶部，间隔 300ms，高光位置不同
- `shimmer-mid-a.png` / `shimmer-mid-b.png`：滚到中间，间隔 300ms
- `shimmer-back.png`：滚回顶部后
- `shimmer-jump-immediate.png`：跳到 1/4 处后立即截图（视口内已有高光，没有静止卡片）
- `pulse-*`：同上 6 张。

## 6. 推荐与副作用

1. 防火墙（iopre + fw1 的 CSS）值得落地：16000 元素 shimmer 从约 19fps 到 60fps，开启耗时与基线基本持平，没有 cv 的开启代价，也不裁剪溢出。落地做法：
   - CSS：在 effects.scss 加扩展规则——卡片声明 `[x-ske] > [x-ske-fw] { --x-ske-pulse-c: <静态色>; --x-ske-shimmer-p: -60 }`，同时按效果重声明 `--x-ske-fill` / `--x-ske-ul-fill` / `--x-ske-bg-pos`。静态色要跟主题走（用 `var(--x-ske-color)` 之类；本原型写死了 #d9dde3，暗色主题需要核对）。
   - JS：enable() 里对根的直接子元素用 IntersectionObserver（rootMargin 100px 或更大）；开启时先全部预打 `x-ske-fw`，回调里按是否相交 toggle；子元素增删要用 MutationObserver 补观察；disable 时断开并清掉属性。
2. 副作用：
   - 只作用于根的直接子元素。如果页面只有一两个很大的直接子元素，没有收益。
   - 防火墙卡片里的骨头是静止的，只能用于视口外。快速滚动或程序跳转后，新进入视口的卡片要等 observer 回调（通常一两帧）才恢复动画，会有一瞬间静态；加大 rootMargin 可缓解。
   - 开启时 iopre 的视口内卡片第一帧是静止的，回调后才动（约一帧内）。
   - 连续滚动时每次 observer 回调要改属性触发样式失效，这部分未测。
3. 计时器自动档（上限 4）可作为 `fps` 选项的补充，用于无法打防火墙的场景：16000 元素 shimmer 47.6fps，但动画只剩约 12 次/秒。和防火墙叠加没有必要，防火墙单独已经 60fps。
