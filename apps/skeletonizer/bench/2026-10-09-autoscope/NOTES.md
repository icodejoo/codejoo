# 自动作用域属性 skz-auto：选择器开销实验（2026-10-09）

## 1. 要验证的问题
打算新增 `skz-auto`：自动推导规则只在 `skz-auto` 元素（根本身或根内后代）的子树里生效。推断是：没有 `skz-auto` 祖先的"标记模式区"里，浏览器的祖先 Bloom 过滤器应能在第一步拒掉推导规则，开销应接近 explicit.css。**结论：数据不支持这个推断**（见第 6 节）。

## 2. 组别（页面参数 `css=<文件>&mode=<模式>`，场景里直接写在 `css` 字段）
| 组 | CSS | 根属性 | 内容 | 目的 |
|---|---|---|---|---|
| A | auto.css（base + global，现状） | `skz` | 不带标记 | 基线 |
| B | scoped.css | `skz`（无 skz-auto） | 全带 `skz-bone` | 标记区能否被过滤器拒掉 |
| C | scoped.css | `skz skz-auto` | 不带标记 | 双写前缀让全自动变慢多少 |
| D | explicit.css（explicit + global） | `skz` | 全带 `skz-bone` | 理论上限 |
| E | scoped.css | `skz` | 前 90% 卡片带 `skz-bone`，后 10%（200 张）包 `<div skz-auto>` 不带标记 | 第三方库自动 + 自己代码标记 |
| B2 | split.css | 同 B | 同 B | 诊断，见下 |
| B3 | class.css | 同 B | 同 B | 诊断，见下 |
| C2 | split.css | 同 C | 同 C | 诊断，见下 |
| E2 | split.css | 同 E | 同 E | 诊断，见下 |

CSS 变体怎么来的（`build.mjs` 用 sass 从 `src/styles` 编译，变体源码是它的拷贝，没动 src）：
- `scoped.css`（B/C/E，按任务要求）：`styles-scoped/` 里把推导规则前缀改成 `[skz][skz-auto] X` 与 `[skz] [skz-auto] X` 两种。base.scss 兜底层和 tier0 展开成两条规则（tier0 用 `@each $a in $auto-parts` 套一层）；tier1 / tier2 用 `$auto = :is([skz][skz-auto], [skz] [skz-auto])` 合成一条。`_marks.scss` 的显式标记 / 忽略区规则、`global` 变体不改。
- `split.css`（B2/C2/E2，**诊断**）：在 scoped 基础上把 tier1 / tier2 也展开成两条，不用 `:is()`。要验证：Blink 的祖先过滤器收集不了 `:is(a, b)` 里的多选择器，B 没提速会不会只是 `:is` 的锅。
- `class.css`（B3，**诊断**）：在 split 基础上把 `[skz-auto]` 属性换成 `.skz-auto` 类（含 base.scss 兜底层）。要验证：Bloom 过滤器是否只收 tag / id / class、不收属性名；如果类版本能拒掉而属性版本不能，就该改成类。
- C2 / E2：确认 split 展开对全自动（C）和混合（E）的影响。
- 体积：A 的 auto.css 8216 B / gzip-9 1663 B；scoped.css 11362 B / 1834 B。**B 组 CSS 比 A 多 3146 B 原始（+38%），gzip -9 多 171 B（+10%）**（只算 base 部分同样 +3146 B 原始 / +167 B gzip；split 版再多约 1.8 KB 原始）。体积用 node zlib level 9 量，`gzip -9` 命令行各多约 30 B 文件头。

## 3. 文件清单
- `build.mjs`：编译 auto / explicit / scoped / split / class 五份 CSS（压缩输出）并打印体积；`styles-scoped/`、`styles-split/`、`styles-class/` 为变体源。
- `perf-auto.html`：基准页（`?css=&mode=`，mode：auto / mark / autoroot / mix，诊断用 mixplain / mixautomarked）。卡片结构、`Bone.*` 调用、16000 元素规模（n=2000）与 `2026-10-09-entries/perf-bone.html` 一致，换成了 `skz` 命名。
- `gen-scenarios.mjs`：生成 `sc-<组>.json`，每组 8 个场景（见第 4 节）。`sc-dbg.json` + `dbg-fw.mjs` 是排查防火墙失效时用的诊断场景 / 脚本。
- `run-all.sh`：依次跑若干组（调 `bench/kit/run-locked.mjs`，端口 9334），带看门狗：单组超过 300 s 视为卡死，杀掉后只重跑未完成的场景（`rest.mjs` 算剩余场景），记 `results/watchdog.log`。
- `summarize.mjs`：汇总成表（`VALID=1` 剔除防火墙失效的 enable 运行；`RAW=1` 打印每轮原始值；分组用环境变量 `GRP`）。`summary-main.md`（A~E，r1~r3）、`summary-diag.md`（A/B2/B3/C2/E2/D，r4~r5）是汇总输出。
- `shot.mjs` + `run-shot-locked.mjs`：正确性截图与计算样式；产物在 `shots/`。
- `results/<轮>-<组>.log`：原始结果（每行一个场景，每帧耗时为 3 次 trace 的中位数）；`.err` 里有 CPU 采样；`r5-B2.partial-aborted` 是被中止的残缺数据，不参与统计。

## 4. 场景与实验的对应
沿用 entries 实验（`sc-explicit.json`）的方法：Chrome Tracing 拆每帧，每场景 3 次 trace 取中位数，n=2000（16000 元素），`toggleN=7` 取中位。每组 8 个场景：
- **L 系列**（和 entries 一致，根上 `skz-text="leaf"`）与 **U 系列**（不写 text，默认下划线模式，更接近真实默认用法）各 4 个：
  - 纯 CSS fade / pulse / shimmer：根上直接写属性（`skz-effect` 等），**没有继承防火墙**，`#root` 下是 2000 张平铺卡片，不经 `enable()`；
  - `enable()` shimmer：走真实 `enable(root, { effect: "shimmer", text })`，**启用继承防火墙**（页面 import 了 `src/variants/global.ts`；root 的子元素 = 卡片，视口外 1992 张被打 `skz-fw`，只剩视口内约 8 张参与重算）。
- 注意：这个页面**有"列表结构"**（root 直接子元素是 2000 张同构卡片），所以 `enable()` 场景里防火墙会掩盖选择器成本；纯 CSS 场景没有防火墙，才能反映选择器成本。entries 实验同样如此（纯 CSS 与 enable 两类场景），设置一致。
- 开启耗时 `toggleMs`：每个场景在 trace 之后单独测 7 次（切 `skz` 后强制样式 + 布局）取中位数，与效果基本无关；表里用各组 24 个值（8 场景 × 3 轮）的中位数。
- 与 entries 的差别：entries 的 explicit 对比用的是旧名 `x-ske` 与旧版 CSS，不能直接拼表，这里 A 与 D 是同批重测。
- E 组里外壳 `<div skz-auto>` 也带了同样的 `skz-text`（L 系列）：规则里的 `[skz-text=leaf]` 挂在"作用域元素自身"上，根上写的 text 到不了外壳（新属性的设计要处理这一点，见第 7 节）。E 里 `enable()` 的防火墙仍在 root 的子元素这一层生效，外壳 div 是其中一个"项"。

## 5. 结果（16000 元素，3 轮中位数；fps 的 60.4 是 vsync 上限）
样式重算 = 每帧 UpdateLayoutTree ms。fade 全部 0.15~0.25 ms、60.4 fps，无差别，不列。enable 行已剔除防火墙失效的运行（见第 8 节）。

**U 系列（默认下划线模式）**
| 指标 | A 现状 | B 标记区 | C 全自动 | D explicit | E 混合 |
|---|---|---|---|---|---|
| 开启耗时 ms（24 值中位） | 63.8 | 62.9 | 69.8 | 47.7 | 64.0 |
| pulse 重算 ms / fps | 37.3 / 23.6 | 37.7 / 22.8 | 44.5 / 20.4 | 19.1 / 46.4 | 33.3 / 26.4 |
| shimmer 重算 ms / fps | 37.1 / 24.0 | 41.9 / 18.8 | 46.0 / 19.2 | 23.8 / 34.0 | 36.5 / 23.2 |
| enable shimmer（防火墙）重算 ms / fps | 4.7 / 60.4 | 4.4 / 60.4 | 5.6 / 60.4 | 2.4~7.8 / 60.4 | 6.5 / 60.4 |

**L 系列（leaf，entries 同款）**
| 指标 | A 现状 | B 标记区 | C 全自动 | D explicit | E 混合 |
|---|---|---|---|---|---|
| pulse 重算 ms / fps | 32.4 / 28.4 | 37.8 / 23.2 | 41.6 / 22.0 | 20.4 / 42.0 | 38.8 / 22.4 |
| shimmer 重算 ms / fps | 35.4 / 24.8 | 39.9 / 20.8 | 42.8 / 20.8 | 23.2 / 34.8 | 40.8 / 20.4 |
| enable shimmer（防火墙）重算 ms / fps | 4.6 / 60.4 | 4.6 / 60.4 | 6.2 / 60.4 | 2.3 / 60.4 | 4.6 / 60.4 |

**诊断变体（r4~r5，2 轮；A 与 B2 只有 r4 一轮，r5 被中止；重算 ms / fps）**
| | A | D | B2（split） | B3（class） | C2（split 全自动） | E2（split 混合） |
|---|---|---|---|---|---|---|
| U pulse | 37.4 / 23.6 | 21.4 / 42.8 | 37.3 / 22.4 | 35.8 / 28.0 | 80.0 / 14.4 | 36.5 / 24.0 |
| U shimmer | 39.4 / 22.4 | 28.4 / 28.0 | 50.8 / 16.0 | 56.2 / 22.4 | 69.3 / 13.6 | 38.9 / 22.8 |
| L pulse | 34.8 / 26.0 | 28.3 / 46.8 | 38.4 / 22.4 | 44.4 / 20.4 | 126.0 / 8.0 | 40.1 / 25.2 |
| L shimmer | 37.3 / 23.6 | 26.8 / 36.8 | 38.5 / 21.6 | 56.4 / 17.6 | 93.0 / 9.6 | 40.5 / 21.2 |
| 开启耗时（全场景中位） | 68.0 | 51.3 | 85.2 | 77.4 | 130.7 | 66.1 |

各轮原始值：`RAW=1 node summarize.mjs r1 r2 r3`。D 的 L pulse 在 r4 / r5 分别是 19.0 / 28.3，轮间波动不小。

## 6. 结论
1. **B 没有明显快于 A，也不接近 D。** U 系列 pulse 37.7 vs 37.3（持平）、shimmer 41.9 vs 37.1（反而略慢）；L 系列 B 比 A 慢约 5 ms。D 是 19~24 ms。标记区里推导规则并没有被"第一步拒掉"：A 与 D 之间约 15 ms 的差距，B 一毫秒都没追回来。split（B2）、类选择器（B3）同样没追回，所以不是 `:is()` 的问题，也不像是"属性名不进 Bloom 过滤器"的问题（类版本同样没拒掉）。真正原因本实验没查出来。
2. **C 比 A 慢**：U 系列慢约 7~9 ms（pulse 44.5 vs 37.3、shimmer 46.0 vs 37.1，fps 24 → 19~20）；L 系列慢约 7~9 ms（41.6 vs 32.4、42.8 vs 35.4）；开启耗时慢约 6 ms（69.8 vs 63.8）。如果 tier1 / tier2 也展开成两条规则（C2），全自动重算翻倍以上（70~126 ms，fps 8~14），所以实现时必须用 `:is()` 合并（或换别的写法），不能简单展开前缀。
3. **E 的表现基本等于 A / B，不靠近 D**：U 系列 pulse 33.3、shimmer 36.5，略好于 A（可能是噪声）；L 系列 38.8 / 40.8，与 B 同。没有出现"按标记比例下降"的收益。E2（split）与 E 无差别。
4. 防火墙开着（`enable()`，视口内只有约 8 张卡参与重算）时，A~E 全部 4~6 ms、60 fps，选择器成本被盖住，看不出差别（D 约 2.3~2.9 ms）。作用域属性的收益只可能出现在无防火墙的场景（根内没有"列表项"结构，或视口内元素很多）。
5. 综上：**`skz-auto` 作为"让标记区更快"的手段，在本实验形式下不成立；作为功能（作用域）它的代价是全自动区 +7~9 ms、CSS +3.1 KB（gzip +171 B），仍然拿不到 explicit.css 的收益。** 想要 D 的性能，目前只有 explicit.css 这条路。

## 7. 数据还不足以回答的问题（没有继续加测）
- **为什么 Bloom 过滤器没生效**：本实验只有端到端的 UpdateLayoutTree，没有选择器级统计。缺的数据是 Chrome 的 SelectorStats（DevTools Performance 的 "Enable advanced rendering instrumentation" / trace 类别里的 Selector Stats：每条选择器的尝试次数、fast-reject 次数、匹配次数、耗时）。有了它才能区分"过滤器没拒掉"还是"规则拒掉了、成本在别处"（例如以 `*` 收尾的标记规则 `[skz] [skz-ignore] *`、动画变量继承带来的重算）。
- 作用域设计本身：`skz-text` / `skz-has-ignore` 这类根属性规则在作用域子树里怎么取（目前挂在作用域元素自身上，E 里外壳要同步一份）没有定论，也没测；只测了默认 tier0 / 1 / 2 的前缀替换。
- 其他浏览器（Safari / Firefox）没测，Bloom 过滤器各引擎实现不同。

## 8. 测量口径、CPU 与可信度
- 页面由 vite 开发服务（端口 5188，实验期间由我启动，结束后已停止）提供；Chrome 是 `run-locked.mjs` 起的独立实例（端口 9334，配置目录放在 scratchpad，已删），窗口 1280x900。
- 重算 / 总帧耗时来自 CDP Tracing（`trace.mjs`），每场景 3 次 2.5 s trace 取中位，再对 3 轮（A~E 的 r1~r3）取中位；轮次顺序：r1 A-B-C-D-E，r2 E-D-C-B-A（B、A 因卡死重跑），r3 C-A-E-B-D；诊断 r4 A-B2-B3-C2-E2-D，r5 D-E2-C2-B3（之后按指示收尾）。`mainBusy` 有重复计数，没用。
- **CPU**：`run-locked.mjs` 每组开始前采样 3 次整机 CPU（在各 `.err`）。r1：8~29；r2：A 29.5/12/17.9、B 51.3/24.8/18.6、**C 69.6/63/64.6（偏高）**、D 25.1/22.5/13.9、E 12.2/24.8/12；r3：A/C/D/E 约 9~15，**B 27.5/49.7/51.6（偏高）**；r4：B2 一次 41.1/25.2/48.5，E2 30.2/24.8/23.9，其余 10~27；r5：B3 29.6/28.6/41.3，D 41.8/21.5/25.1，其余 12~20。机器空闲基线约 8~15%（用户在用 Zed 与一批 MCP / 开发服务进程，测量期间还见过 `vp fmt` / `vp lint`），不是干净环境。C 的 L pulse 三轮 41.1 / 41.6 / 41.8 很稳，说明高 CPU 采样对中位数影响有限，但 B、C 的差距仍建议当"量级判断"。
- **异常点**：
  1. `enable()` 防火墙有时不生效（重算 40~47 ms、fps ≈ 20，与无防火墙持平）：C L 2/3、D L 1/3、D U 1/3、E L 1/3、E U 1/3、B3 2/2、C2 1/2 次，与组别无明显关系，更像 IntersectionObserver 时序问题；单独复现 E 时防火墙正常（`sc-dbg.json`：`skz-fw` 项数、外壳状态都对）。汇总时已剔除这些运行，`summary-*.md` 末尾有每组失效次数。
  2. `trace.mjs` 在 16000 元素下偶发卡死（r2-B、r2-A 各一次；CDP 调用没有超时，和 a4 实验的崩溃记录相似），加了 300 s 看门狗后只重跑未完成场景（`results/watchdog.log`）。
  3. 开启耗时偶发离群（B 118.6、D 161.1 等），用中位数处理。
  4. 按指示实验被提前收尾：r5 只跑了 D、E2、C2、B3，r5-B2 被中止（残缺数据留作 `r5-B2.partial-aborted`），r5-A 未跑；所以诊断表里 A 与 B2 只有一轮，B3 的 enable 全部失效（无有效值）。
- 轮间波动：L pulse 的 A 三轮 36.7 / 32.4 / 31.9，D 20.4 / 20.4 / 19.2；A、B、E 之间 2~5 ms 的差别与这个波动同量级，只有"D 明显更快（约 -40%）"和"C 更慢（+7~9 ms）"是稳定的。"B ≈ A、E ≈ B"可信，"B 略慢于 A"不可信。

## 9. 正确性抽查（`shots/`，prefers-reduced-motion 冻结动画；计算样式见 `shots/shot-computed-styles.json`）
每组 × (U / L) 一张，E 另有滚到 `skz-auto` 外壳的 `-autozone` 截图。探针：根里插入的未标记 `<p>`。
- A / C：未标记元素都有推导骨头。
- B / D：标记区里只有 `skz-bone` 元素是骨头，未标记的 `<p>`、卡片外层 div 保持正常（`-webkit-text-fill-color` 黑、无背景）。
- E：标记区的探针是正常文字；`skz-auto` 外壳里的探针和后 10% 卡片都有推导骨头（U 系列是下划线粗线，L 系列是整块圆角骨头）。
- 视觉上与旧 entries 实验一致：`<i>` 空图标无尺寸看不到，按钮保留原生边框。

## 10. 怎么重跑
1. 在包目录起 vite：`pnpm exec vp dev --port 5188 --strictPort --open false`（实验结束时已停）。
2. `node bench/2026-10-09-autoscope/build.mjs`；`cd bench/2026-10-09-autoscope && node gen-scenarios.mjs`。
3. 在包目录：`bash bench/2026-10-09-autoscope/run-all.sh <轮名> "A B C D E" <Chrome 配置目录>`；汇总：`cd bench/2026-10-09-autoscope && VALID=1 node summarize.mjs r1 r2 r3`。
