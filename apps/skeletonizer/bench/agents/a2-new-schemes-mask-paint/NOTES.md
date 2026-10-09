# a2 实验记录：shimmer 的两个替代实现（静态遮罩 + 合成器光带 / CSS Paint API）

执行者：a2。日期 2026-10-08。Chrome 154.0.8037.98，Windows 10，Intel UHD 770，刷新率约 59-60Hz，窗口 1280x900。
全部为原型，未改动 src/、test/、docs/、README* 等正式文件，未 git commit。

## 1. 方案与每个实验的目的

背景：根驱动 shimmer 每帧整棵子树样式重算（16000 元素叶子模式 22fps）；SVG 方案样式重算为 0，但 PrePaint 约 13ms/帧。目标是找一种主线程每帧开销更低、颜色仍取自 CSS 变量的实现。

- 原型 A：静态骨头遮罩 + 合成器光带。根设 `x-ske-effect="solid"` 让骨头静止；JS 一次性收集骨头矩形（计算样式 background-color 等于 --x-ske-color 的元素，用 getClientRects + border-radius），用 canvas 画白色不透明遮罩，toBlob 成 blob URL；根里追加覆盖层，用 mask-image 裁出骨头形状，内含一条 `linear-gradient(90deg, transparent, var(--x-ske-highlight), transparent)` 光带，用 transform: translateX 关键帧在合成器线程平移。ResizeObserver 监听根尺寸，变化时重画。
  - 偏离方案的两处（原因）：1）整页 16000 元素约 27 万 px 高，单张 canvas/纹理放不下（canvas 与 GPU 纹理尺寸上限），所以把遮罩切成每块 2048 css px 高的分块（4000 元素 34 块，16000 元素 133 块），每块各有遮罩和一条光带，光带动画同相位；2）渐变用 90deg 而非 100deg，倾斜渐变在分块之间会错位成断崖。
- 原型 B：CSS Paint API。注册 paint worklet（blob URL 做 addModule），inputProperties 读 --x-ske-color / --x-ske-highlight / --x-ske-sp / --x-ske-ox / --x-ske-vw，画底色 + 按位置的高光渐变；JS 一次性给每个骨头写 --x-ske-ox（骨头相对视口的 x）。
  - B1：`--x-ske-sp` 非继承（inherits:false），动画挂在每个骨头自身。目的：验证 Chrome 能否把「非继承注册属性 + paint worklet」的动画放到主线程之外。
  - B2（对照组）：`--x-ske-spi` 继承（inherits:true），动画挂在根上，同一份 worklet 逻辑。
- 对照：根驱动 shimmer 叶子（root-shimmer）、SVG 方案（svg）、静止基线（floor-solid，solid 效果无动画）。
- 诊断实验：定位原型 A 在测试页里主线程仍有 PrePaint 的原因；补充一次性成本变体（webp、批大小）；每线程 CPU 拆分；截图与像素分析。

两种测量模式（关键）：
- raf 模式：模板自带的 frames()，页面里有 requestAnimationFrame 循环（每帧强制一次主线程帧）。fps 是 rAF 帧率。
- idle 模式（trace3/trace4 新增）：页面没有 rAF 循环，只 setTimeout 等待；fps 取合成器真实交换帧数（Display::DrawAndSwap），每帧耗时按 60Hz 名义帧数归一。更接近真实页面。
raf 模式下合成器动画也会被迫触发主线程每帧 PrePaint（见实验 3），所以 A / B1 的主线程成本要看 idle 模式。

## 2. 目录文件用途

页面与 CSS：
- `prod.css`：dist/skeletonizer.css 的拷贝（正式构建，基线用）。
- `perf.html`：当前基准页（等同 perf-v4-final.html）。含原型 A（collect / buildMask / mountOverlay / protoA / testResize）、原型 B（workletSrc / protoB）、idleWait、clientBoneRects。
- `perf-v2-batched.html`：第一次可用版本（canvas 分批 6 块画 + toBlob；B 的 worklet 有重复声明 rgb 的 bug）。
- `perf-v3-prefix.html`：修好 B 的 rgb 重复声明之后、加 idleWait 之前。
- `perf-v4-final.html`：最终版（= perf.html）。
- 说明：perf.html 的最初版本（一次建全部 canvas，未分批）因被原地覆盖没有单独留存，现存最早版本为 v2。

跑测脚本：
- `run-locked.mjs`：从工具包拷来并改：锁目录和 ps 脚本指向工具包路径；可用 PERF_SCRIPT 指定要跑的脚本；给测试 Chrome 加 `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`（窗口被遮挡时 rAF 会停，见 failed-attempt-1.txt）。仍使用 bench.lock，没有绕过。
- `run-locked-v2-flags.mjs`：run-locked.mjs 加参数后的快照（内容相同）。
- `trace.mjs`：工具包 trace.mjs 的修改版：支持 `proto`（调用页面原型初始化并记录一次性成本）、`resize`（测 ResizeObserver 重画）、swapFps / drawFps（drawFps 事件名没对上，恒为 0，忽略）、Worklet 线程统计、ev 300s 超时。
- `trace-v2-timeout.mjs`：trace.mjs 快照（内容相同）。
- `trace3.mjs`：在 trace.mjs 基础上加 `pre`（跑前执行 JS）、`prepre`（原型初始化前执行 JS）、`idle` 模式、PERF_KEEP（不关浏览器）、Animation 事件摘要（实测 Chrome 154 没有此类带参数事件，无输出）。
- `trace4.mjs`：trace3 + 每线程每帧 CPU 拆分（写 diag-threads.jsonl）。
- `shot.mjs` / `shot-v1.mjs`：截图 + 像素分析脚本（两份相同）。
- `combo.mjs`：在同一把锁内顺序跑 trace3（s-oneoff-v3.json）和 shot.mjs。
- `probe.mjs`：发现测试 Chrome 的 rAF 不触发时用的探针（只读）。
- `names.json`：第一次冒烟时 trace 里事件名计数（用来确认 DrawAndSwap 事件名）。
- `failed-attempt-1.txt`：第一次完整跑失败的原因记录。
- `err-*.txt`、`combo-out.txt`：各次运行的 stderr / 杂项输出。`out-all.txt` / `err-all.txt` 是第二次完整跑的输出（与 results-v2-partial-crash-at-A16k.jsonl 相同）。
- `err-diag-a-v1-syntaxerror.txt`：trace3.mjs 第一版有语法错误，白占一次锁（教训：上锁前先 node --check）。

## 3. 场景文件对应的实验

- `s-smoke.json` / `s-smoke-v1.json`：冒烟，A-4k 单场景 + resize。
- `s-all.json` / `s-all-v1.json`：第一版全量（raf 模式，12 个场景）。两次尝试都没跑完（见 failed-attempt-1.txt；第二次跑到 A-16k 后 B1 因 worklet 重复声明 rgb 报错）。
- `s-diag-a.json`：实验 3，诊断 A 的主线程 PrePaint 来源（去遮罩、去 overflow、只留 1 块、关 leaf）。
- `s-all-v3.json`：正式全量，26 场景，raf + idle 两种模式。
- `s-oneoff-v3.json`：一次性成本变体（webp、批 16）。
- `s-threads-v4.json`：每线程 CPU 拆分。
- 截图由 shot.mjs 内置场景生成（base-root / svg / A / B1 / B2，各含默认高光与红色高光）。

## 4. 原始结果

- `results-v1-aborted-partial.jsonl`：第一次中止的运行，仅前 3 行（从当时的终端输出誊写）。
- `results-smoke-A-4k-reps1.jsonl`：冒烟（1 次，从终端输出誊写）。
- `results-v2-partial-crash-at-A16k.jsonl`：第二次完整跑，前 8 个场景（3 次取中位数），B1 处崩溃。其中 svg-16k 一行（fps 60、swapFps 2.8、几乎无主线程活动）异常：SVG 动画当时没跑起来，v3 里重测正常，该行不可用。
- `results-diag-a-v1.jsonl` / `results-diag-a.jsonl`：实验 3 原始结果（两份相同，2 次中位数）。
- `results-v3.jsonl`：正式全量，每行一个场景，3 次取中位数，原样 trace3 输出。
- `results-v3-oneoff.jsonl`：一次性成本变体。
- `results-v4-threads.jsonl` + `diag-threads.jsonl`：每线程拆分（1 次，单位 ms/名义 60Hz 帧；GpuVSyncThread 约 33 是 vsync 线程常驻，忽略）。
- `results-shots.json`：截图像素分析与「是否在动」统计。

## 5. 截图清单（`shots/`，640x480 视口裁剪，40 张）

对每个 case（base-root、svg、A、B1、B2）各有：`<case>-live0/1/2.png`（不暂停，间隔约 230ms 连拍）、`<case>-paused.png`（动画暂停在 500ms 处）；以及把根上 `--x-ske-highlight` 改成 #ff0000 的 `<case>-red-live0/1/2.png`、`<case>-red-paused.png`。

## 6. 数据（results-v3.jsonl，3 次中位数；耗时单位 ms/帧；样式重算 = UpdateLayoutTree）

| 场景 | 元素数 | fps | 合成器交换帧/s | 样式重算 | PrePaint | Paint | gpu | compositor |
|---|---|---|---|---|---|---|---|---|
| floor-solid-4k-raf | 4000 | 60.8 | 0 | 0 | 0.01 | 0 | 0 | 0.55 |
| floor-solid-16k-raf | 16000 | 60.8 | 0 | 0 | 0.01 | 0 | 0 | 0.54 |
| root-shimmer-4k-raf | 4000 | 60.4 | 60.4 | 10.37 | 1.35 | 1.95 | 6.58 | 3.54 |
| root-shimmer-16k-raf | 16000 | 22 | 22 | 38.4 | 5.48 | 2.9 | 5.9 | 4.8 |
| svg-4k-raf | 4000 | 60.4 | 47.6 | 0.09 | 4.74 | 2.52 | 7.12 | 3.73 |
| svg-16k-raf | 16000 | 58.4 | 44 | 0.05 | 13.15 | 2.29 | 5.46 | 2.84 |
| A-tiny-3cards-raf | 24 | 60.4 | 60.4 | 0.1 | 0.09 | 0 | 2.03 | 2.32 |
| A-4k-raf | 4000 | 60.4 | 60 | 0.35 | 1.84 | 0 | 2.44 | 2.77 |
| A-16k-raf | 16000 | 59.6 | 60.4 | 1.61 | 7.62 | 0 | 2.55 | 2.59 |
| B1-4k-raf | 4000 | 10 | 60.4 | 65.83 | 6.87 | 6.1 | 77.55 | 64.21 |
| B1-16k-raf | 16000 | 3.2 | 60 | 256.59 | 12.16 | 7.76 | 183.95 | 247.52 |
| B2-4k-raf | 4000 | 55.6 | 55.2 | 12.3 | 1.89 | 4.74 | 8.84 | 7.54 |
| B2-16k-raf | 16000 | 18 | 18 | 46.98 | 5.82 | 5.43 | 8.46 | 8.69 |
| floor-solid-4k-idle | 4000 | 0 | 0 | 0 | 0 | 0 | 0.01 | 0 |
| floor-solid-16k-idle | 16000 | 0 | 0 | 0 | 0 | 0 | 0.01 | 0 |
| root-shimmer-4k-idle | 4000 | 60 | 60 | 10.41 | 1.34 | 1.98 | 6.08 | 3.63 |
| root-shimmer-16k-idle | 16000 | 21.6 | 21.6 | 14.57 | 1.84 | 1.06 | 1.8 | 1.75 |
| svg-4k-idle | 4000 | 46.8 | 46.8 | 0.08 | 3.02 | 1.69 | 5.45 | 3 |
| svg-16k-idle | 16000 | 38.8 | 38.8 | 0.07 | 13.46 | 2.89 | 6.31 | 3.34 |
| A-tiny-3cards-idle | 24 | 60.4 | 60.4 | 0 | 0 | 0 | 1.87 | 2.07 |
| A-4k-idle | 4000 | 60.4 | 60.4 | 0 | 0 | 0 | 1.98 | 2.09 |
| A-16k-idle | 16000 | 60.4 | 60.4 | 0 | 0 | 0 | 2 | 2.15 |
| B1-4k-idle | 4000 | 60 | 60 | 0 | 0 | 0 | 9.67 | 5.57 |
| B1-16k-idle | 16000 | 59.6 | 59.6 | 0 | 0 | 0 | 8.6 | 9.47 |
| B2-4k-idle | 4000 | 54.4 | 54.4 | 11.64 | 1.5 | 4.55 | 7.9 | 6.99 |
| B2-16k-idle | 16000 | 16 | 16 | 14.36 | 1.68 | 1.57 | 2.43 | 2.64 |

注：-idle 行的耗时按名义 60Hz 帧数归一（不是按实际渲染帧），所以掉帧的主线程驱动方案（root-shimmer-16k）idle 行的每帧耗时偏小，其 ms/帧请看 -raf 行；-raf 行的 fps 是 rAF 帧率；-idle 行的 fps 是合成器真实帧率。root-shimmer 与 svg 是主线程驱动，idle / raf 无本质区别。

一次性成本（原型 A，PNG，ms）：

| 元素数 | 骨头矩形 | 分块 | 收集 | canvas 绘制 | toBlob | 挂载 | 首帧 | 合计 | PNG 总大小 |
|---|---|---|---|---|---|---|---|---|---|
| 4000 | 2500 | 34 | 18-29 | 9-21 | 1020-1130 | 3-5 | 14-23 | 1070-1210 | 2.7MB |
| 16000 | 10000 | 133 | 59-148 | 20-29 | 4160-6810 | 16-27 | 78-111 | 4350-7100 | 10.8MB |

- ResizeObserver 重画（把根宽度改成 1000px 触发）：4000 元素约 1250-1280ms，16000 元素约 4540-6420ms（几乎全是 toBlob）。
- webp 无损更慢（4000 元素 toBlob 2327ms，16000 元素 8727ms），批大小 16 与 6 无差别（5952ms vs 5532ms，噪声内）。
- 原型 B 一次性成本（ms）：addModule 1.3-35；收集 18-70；读 x 偏移 2-11；写样式（--x-ske-ox + 属性 + 根上属性，强制样式重算）4000 元素 26-102，16000 元素 92-320；首帧 41-130 / 118-431；合计 4000 元素 71-157，16000 元素 195-495（B1 比 B2 多是因为 B1 骨头自带动画，写样式时要建 2500 / 10000 个动画对象）。
- 每线程每帧 CPU（idle，ms，来自 diag-threads.jsonl）：
  - root-16k：CrRendererMain 33.6（占满，22fps）、Compositor 0.95、Gpu 2.1
  - svg-16k：CrRendererMain 30.1、Gpu 5.4
  - A-16k：CrRendererMain 0.07、Gpu 2.4、Viz 1.7、Compositor 1.0
  - B1-4k：CrRendererMain 0.08、AnimationWorklet 线程 10.8、Gpu 10.4、Compositor 4.5、线程池 1.5
  - B1-16k：CrRendererMain 0.06、AnimationWorklet 线程 9.5、Gpu 9.3、Compositor 9.1、线程池 1.1
  - B2-16k：CrRendererMain 33.5（与根驱动一样占满）、AnimationWorklet 2.5

## 7. 结论、解释与不成立之处

### 原型 A（成立，推荐作为 shimmer 的优先候选）
- 能实现。idle 模式下 4000 / 16000 元素均 60fps，主线程每帧 UpdateLayoutTree / PrePaint / Paint 全为 0，gpu 约 2ms、compositor 约 2ms；对比根驱动 16000 元素 22fps（样式重算 38ms+），SVG 16000 元素 PrePaint 13ms、idle 约 39fps（raf 58fps）。
- 颜色来自 CSS 变量：把根上 `--x-ske-highlight` 改成 #ff0000，光带变红（A-red-paused.png）；SVG 方案不跟随（svg-red 截图无红色，像素分析 redIn = 0）。
- 光带只出现在骨头上：卡片边框、白色背景无红色，圆形头像（50% 圆角）形状正确。results-shots.json 的像素分析 redOut 与根驱动基线同量级（该分析较粗，只作辅助，主要依据是肉眼看截图）。A 的 live0/1/2 三张截图互不相同，说明在动。
- 重要发现（raf 模式的 A 行）：只要页面里有 rAF 循环或其他主线程帧，A 的光带动画会让每个主线程帧多出 PrePaint（4000 元素 1.8-2.6ms，16000 元素 7.6-8ms，随文档大小增长；3 张卡片的小文档只有 0.09ms）。去遮罩 / 去 overflow / 只留 1 块 / 去 leaf 都没消除（实验 3），说明不是遮罩造成，而是「有合成器动画 + 每帧有主线程帧」时 PrePaint 要遍历整棵树（推测，未深挖）。没有 rAF 的 idle 模式下主线程为 0。真实页面通常有一些主线程活动，所以 A 的实际收益介于两者之间，但仍明显优于根驱动与 SVG。
- 一次性成本较高：4000 元素约 1.1s，16000 元素约 4-7s，几乎全是 canvas.toBlob 的 PNG 编码（每块 1280x2048）。对 16000 元素的整页根不可接受；落地要做按需分块（只建视口附近的块，滚动时懒建）、限制块尺寸，或换更快的遮罩生成方式。收集矩形只要 20-150ms，画 canvas 只要 10-30ms，不是瓶颈。
- 副作用：
  - 布局变化 / 内容变化不会自动更新遮罩；ResizeObserver 只能抓根尺寸变化，内部布局变化（字体加载、图片尺寸、子树增删）需要另外失效重画，重画成本与首建相同。
  - 根必须 position:relative（会改变子孙绝对定位参照）；根里会多一个覆盖层子节点（需排除出骨头选择器，测试里用 data-xa 跳过）。
  - 遮罩是位图：dpr 变化 / 缩放要重画；超长根必须分块（GPU 纹理上限）。
  - 滚动：覆盖层随根滚动，由合成器处理，无额外主线程成本。
  - 圆角：读 4 个角的计算值，支持百分比，canvas roundRect 重现，肉眼与 CSS 圆角一致。换行的内联元素用 getClientRects 逐片段画，圆角按片段近似。
  - 光带颜色取 var(--x-ske-highlight)，主题切换自动跟随；duration 取 --x-ske-duration。倾斜渐变（100deg）因分块接缝改成了 90deg，如需倾斜要用 skewX。
  - 下划线文字（非 leaf 模式）：测试只覆盖 leaf 模式；非 leaf 模式的下划线骨头没有 background-color，收集器识别不到，需要另想办法（未验证）。

### 原型 B（部分成立，不推荐落地）
- B1（非继承注册属性 + 每个骨头自己挂动画）：在 Chrome 154 上确实走了主线程之外：idle 模式下 4000 / 16000 元素 60fps，CrRendererMain 每帧仅 0.06-0.08ms，UpdateLayoutTree / PrePaint 为 0。截图确认在动（B1 live 三张互不相同）、颜色随 CSS 变量变红、只在骨头上。
  - 但代价转移到了别的线程：AnimationWorklet 线程约 10ms/帧、Gpu 约 9-10ms/帧、Compositor 4.5-9ms/帧，合计远高于 A（A 总共约 5ms）；与元素数几乎无关（只重画可见骨头）。低核心数 / 电池场景有风险。
  - raf 模式下 B1 很差：4000 元素 rAF 10fps，16000 元素 3.2fps（样式重算 66 / 257ms/帧），虽然合成器交换仍是 60fps。原因：每个骨头自带一个 CSS 动画（共 2500 / 10000 个），页面一旦有主线程帧，这些动画对象都要在主线程更新。真实页面只要有任何 rAF 或持续的主线程活动就会命中。
  - 一次性成本：写 --x-ske-ox 并建 N 个动画，4000 元素约 100ms，16000 元素约 320ms，合计 16000 元素约 0.5s，比 A 低一个量级。
  - 兼容性：CSS Paint API 仅 Chromium 系；Safari / Firefox 没有。
- B2（继承属性 + 根上动画）：不能脱离主线程。4000 元素 55fps、样式重算 12ms；16000 元素 idle 16fps、raf 18fps，比根驱动（22fps）还差。结论：继承变量的 worklet 方案与根驱动一样要整棵树样式重算，没有价值。
- 失败 / 不成立点：1）B2 完全没有收益；2）B1 的 idle 数据很好，但对主线程帧敏感，且 GPU / worklet 线程成本高；3）仅 Chromium。

### 与根驱动、SVG 方案的对比与推荐

| 方案 | 16000 元素 idle fps | 主线程每帧 | 一次性成本 | 颜色来自 CSS 变量 | 兼容性 |
|---|---|---|---|---|---|
| 根驱动（默认） | 约 22 | 样式重算约 38ms + PrePaint 5.5ms | 无 | 是 | 需 @property |
| SVG | 约 39（raf 58） | PrePaint 约 13ms | 无 | 近似（高光固定白色半透明，红色高光不生效） | 广 |
| A 遮罩 + 合成器光带 | 60 | 0（idle）；raf 下 PrePaint 约 8ms | 16000 元素 4-7s（PNG 编码），4000 元素约 1.1s | 是 | 广（mask-image、transform 动画） |
| B1 paint worklet | 60 | 0（idle）；raf 下样式重算 257ms | 约 0.5s | 是 | 仅 Chromium |
| B2 | 约 16 | 同根驱动 | 约 0.2s | 是 | 仅 Chromium |

推荐：A 值得继续，作为「大骨架 shimmer」的可选引擎，但必须先解决一次性成本（按需分块 / 只建视口附近的块 / 换更快的遮罩生成方式）并处理遮罩失效更新。B1 仅作为 Chromium 上的实验，不建议落地（线程成本高、对主线程帧敏感、兼容性差）。B2 淘汰。

### 未验证 / 局限
- 真机多刷新率、移动端、深色主题、非 leaf 模式（下划线骨头）未测。
- 测试页是同构卡片，圆角种类有限（按钮、50% 头像、4px 文字条）。
- 每个场景 3 次取中位数（线程拆分、冒烟、诊断为 1-2 次）。
- 测量期间机器上还有其他代理，CPU 基线约 15-35%；排锁等待较长。
- 基准页用的是 prod.css（dist 构建，非工作区最新 scss）。
