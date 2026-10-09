# a4 实验笔记：只认 x-ske-bone（显式模式）vs 自动推导

## 1. 方案与目的
问题：不再靠选择器推导，只有带 `x-ske-bone` 的元素才是骨头，性能能提升多少。
- A 基线：perf.html（卡片无标记）+ prod.css（正式 dist）。
- B 只加标记：perf-bone.html（卡片 img/h3/p/span/i/button 加 x-ske-bone）+ prod.css。目的：确认光加属性本身有没有代价。
- C 显式模式：perf-bone.html + explicit.css（只有 `[x-ske] [x-ske-bone]` 一套规则 + effects）。
- C2：explicit-nodesc.css（去掉 `[x-ske] [x-ske-bone] *{visibility:hidden}`）。目的：量化“骨头内部后代”规则成本（C vs C2）。
- 正确性截图：C、C2、A 叶子模式、关闭态各一张。
- 机器上还有其他代理在跑，所以 n=2000 时有较大噪声（见第 6 节），部分场景重跑了。

## 2. 文件清单
- prod.css：dist/skeletonizer.css 的拷贝（正式 CSS）。
- explicit.scss / explicit.css：C 方案源与编译结果（按任务给的内容，@use 都放文件开头）。
- explicit-nodesc.scss / explicit-nodesc.css：C2 方案。
- perf.html：基准页（工具包模板原样拷贝，卡片不带标记）。
- perf-bone.html：卡片内 img/h3/p/span/i/button 全加 x-ske-bone。
- sA.json / sB.json / sC.json：场景文件（见第 3 节）。
- sB2-n2000.json、sA2-n2000-rerun.json、sC2-n2000-rerun.json、sA3-shimmer-n2000.json、sA3-leaf-n2000.json：重跑/补跑用场景文件。
- runall.sh、runall2.sh、runall3.sh、runall4.sh：依次启动 run-locked.mjs 的批处理脚本。
- shot.mjs：拿锁期间截图并读计算样式的 CDP 脚本；run-shot.mjs：套在锁里的启动器；run-shot-v1-broken.mjs：第一版（PERF_HOST 用了未定义变量 host，报 ReferenceError，保留）；err-shot-v1.txt：其报错。
- out-*.txt / err-*.txt：每次运行的 stdout / stderr 原样；results-*.jsonl：同样的 trace 输出 JSONL 拷贝（见第 4 节）。
- shot-*.png：截图（第 5 节）。
- alldone*.txt：批处理完成标记。

## 3. 场景文件对应关系
每个场景：n=500（约 4000 元素）与 n=2000（约 16000 元素），toggle=true、toggleN=9，每个场景 3 次取中位数。
- sA.json（perf.html + prod）：pulse、shimmer、fade（不写 effect）、shimmer-leaf（x-ske-text=leaf），共 8 项。
- sB.json（perf-bone.html + prod）：同上 8 项。
- sC.json（perf-bone.html，C 用 explicit，C2 用 explicit-nodesc）：C 的 pulse/shimmer/fade + C2 的 pulse/shimmer，共 10 项。
- 重跑文件见上。

## 4. 原始结果
- results-A.jsonl：A 全部 8 项（第一次，n=2000 的数据有明显噪声，见第 6 节）。
- results-B-n500-and-partial.jsonl：B 的 n=500 四项；n=2000 时 trace.mjs 崩溃（Runtime.evaluate 返回 undefined，TypeError，原因应是 16000 元素页面卡死/CDP 响应异常，错误见 err-B.txt），未产出。
- results-B2-n2000.jsonl：B 的 n=2000 四项补跑。
- results-C-C2.jsonl：C、C2 全部 10 项。
- results-A2-n2000-rerun-pulse.jsonl：A pulse n=2000 重跑（重跑里 shimmer 时 trace 再次崩溃，见 err-A2.txt，所以 shimmer/leaf 另补跑）。
- results-A3-shimmer-n2000.jsonl、results-A3-leaf-n2000.jsonl：A 的 shimmer、leaf n=2000 补跑。
- results-C-C2-n2000-rerun.jsonl：C/C2 n=2000 重跑。
- results-shot-computed-styles.txt：截图时的计算样式读数。

## 5. 截图
- shot-C-explicit.png：C，显式模式（6 张卡片，prefers-reduced-motion 冻结动画）。
- shot-C2-explicit-nodesc.png：C2。
- shot-A-leaf.png：A 叶子模式对照。
- shot-off.png：未开启骨架的原样（对照，文字用的是 Bone.text 的方块字形）。

## 6. 数据（样式重算 = UpdateLayoutTree ms/帧；Paint/PrePaint ms/帧；开启 = toggleMs）
n=500（4000 元素）
| 场景 | fps | 样式重算 | PrePaint | Paint | 开启ms |
|---|---|---|---|---|---|
| A pulse | 46.0 | 10.67 | 0.84 | 0.76 | 22.4 |
| A shimmer | 48.8 | 12.01 | 2.22 | 1.92 | 22.3 |
| A fade | 60.4 | 0.13 | 0.01 | - | 28.2 |
| A shimmer-leaf | 59.2 | 11.42 | 2.40 | 2.47 | 23.3 |
| B pulse | 59.6 | 10.71 | 0.73 | 0.77 | 21.3 |
| B shimmer | 60.4 | 10.61 | 0.88 | 1.19 | 17.8 |
| B fade | 60.4 | 0.14 | 0.01 | - | 17.7 |
| B shimmer-leaf | 60.0 | 10.94 | 1.17 | 1.90 | 24.8 |
| C pulse | 60.4 | 6.56 | 0.93 | 0.88 | 16.5 |
| C shimmer | 60.4 | 7.35 | 1.69 | 2.08 | 14.7 |
| C fade | 60.4 | 0.11 | 0.01 | - | 21.0 |
| C2 pulse | 60.4 | 6.21 | 1.04 | 0.81 | 11.8 |
| C2 shimmer | 60.4 | 7.48 | 1.59 | 1.95 | 15.0 |

n=2000（16000 元素）。A 括号内是第一次跑（受其他代理负载干扰，明显偏高，弃用），C/C2 括号内是重跑。
| 场景 | fps | 样式重算 | PrePaint | Paint | 开启ms |
|---|---|---|---|---|---|
| A pulse（重跑） | 24.8 (首跑 11.6) | 34.41 (47.14) | 3.53 (11.58) | 1.48 (2.52) | 71.5 (97.0) |
| A shimmer（补跑） | 18.4 (9.2) | 42.40 (49.61) | 6.50 (12.86) | 3.29 (3.07) | 71.6 (99.9) |
| A fade（仅首跑） | 60.4 | 0.29 | 0.02 | - | 115.5（偏高，噪声） |
| A shimmer-leaf（补跑） | 22.4 (16.4) | 37.62 (43.83) | 4.95 (11.45) | 2.63 (3.61) | 72.6 (111.6) |
| B pulse | 24.0 | 35.58 | 4.07 | 1.66 | 66.4 |
| B shimmer | 22.4 | 37.90 | 4.72 | 2.42 | 66.7 |
| B fade | 60.4 | 0.24 | 0.01 | - | 81.4 |
| B shimmer-leaf | 21.6 | 39.66 | 5.27 | 3.22 | 69.5 |
| C pulse | 37.2 (36.4) | 22.53 (23.58) | 2.69 (2.80) | 1.54 (1.25) | 51.9 (52.4) |
| C shimmer | 29.6 (29.2) | 27.12 (26.35) | 4.74 (5.38) | 2.89 (3.02) | 51.7 (55.8) |
| C fade | 60.4 | 0.21 | 0.01 | - | 51.6 (68.3) |
| C2 pulse | 38.0 (37.6) | 22.13 (21.96) | 2.87 (3.25) | 1.48 (1.38) | 54.2 (49.8) |
| C2 shimmer | 30.0 (29.6) | 26.32 (26.32) | 4.72 (5.42) | 2.93 (3.45) | 53.0 (62.9) |

## 7. 结论
1. 显式模式 vs 基线（取可信数据）：
   - 样式重算：n=500 pulse 10.7 -> 6.4（约 -40%），shimmer 12.0 -> 7.4（约 -38%）；n=2000 pulse 34.4 -> 约 23（-33%），shimmer 42.4 -> 约 26.7（-37%）。
   - 帧率：n=500 基线 pulse/shimmer 46~49fps（首跑带噪声）-> 显式稳 60；n=2000 pulse 24.8 -> 约 36.8（+48%），shimmer 18.4 -> 约 29.4（+60%）。
   - 开启耗时：n=500 约 22 -> 12~16ms（-25%~-45%）；n=2000 约 71 -> 约 52ms（-27%）。fade 开启耗时数据噪声大（A 115 / B 81 / C 52~68），方向同样是下降但幅度不可信。
   - fade 每帧样式重算本来就近 0（0.1~0.3ms），帧率全 60，显式模式对 fade 的收益只体现在开启耗时。
   - 剩余的 23ms（16000 元素）是根驱动动画本身：@property 继承变量逐帧变化，每个元素都要重算样式（约 1.4µs/元素），与选择器是否匹配无关。所以靠砍选择器最多省 1/3 左右，想继续降要改动画方式（如 fade、或减少被继承的元素数）。
2. 只加标记（B vs A）：基本没影响，n=500 样式重算 10.71 vs 10.67，n=2000 35.6 vs 34.4，在噪声范围内；加属性本身代价可以忽略。
3. “骨头内部后代”规则（C vs C2）：看不出成本。n=2000 pulse 22.5/23.6 vs 22.1/22.0，shimmer 27.1/26.4 vs 26.3/26.3，开启耗时也在噪声内。注意本基准卡片里的骨头基本没有元素后代（img/i 无子节点，h3/p/span/button 只有文本，Bone.lines 若不产生子元素），所以这条规则几乎匹配不到元素，结论仅适用这种结构；骨头里嵌了深层子树的场景该规则会真的起作用，需另测。
4. 正确性：C 截图中 img、标题、段落、span、按钮都画成灰块，文字不可见（计算样式 color 为全透明，背景 rgb(217,221,227)）；icon `<i>` 是空元素、无尺寸，在 A 和 C 里都看不出来。差异：C 的头像是 4px 圆角方块，A（及 prod）是正圆。原因是页面里 `.card img{border-radius:50%}`（特异性 0,1,1）被 explicit 规则 `[x-ske] [x-ske-bone]{border-radius:var(--x-ske-radius)}`（0,2,0）覆盖；正式 CSS 对 img 没有覆盖圆角。若采用显式模式，要么该条圆角不写，要么只在元素自身没设圆角时才设。这是方案内容本身（按任务给的原样）带来的视觉差异，不是实验失败。按钮在 A 和 C 里都保留了原生边框（按钮 border 不是骨头的一部分）。
5. 噪声与失败说明：机器上多个代理共用，A 的 n=2000 首跑（pulse 47ms、fps 11.6、Commit 32ms）明显被干扰，已用重跑数据替代，首跑数据保留在 results-A.jsonl。trace.mjs 在 n=2000 的 B 首跑和 A 重跑中途各崩溃一次（Runtime.evaluate 返回 undefined），已拆成单独场景补跑。fps 值有 60.4 的上限是 vsync，不是真正的“性能余量”。
