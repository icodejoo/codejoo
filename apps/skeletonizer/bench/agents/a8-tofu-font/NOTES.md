# a8：全方块字体（tofu / redacted font）原型

环境：Chrome 154（Windows 真实窗口，独立实例端口 9588），静态服务 `scripts/serve.mjs`（端口 5198，不走 vite），CSS/JS 用 `dist/`（注意：测试中途 dist 被别人重建过一次，button 从文字标签挪进了控件骨头，之后的数据全部基于新 dist，见"坑点"）。没有改 src/、README、docs/。

## 1. 方案

一个 ~1.4 KB 的字体，所有字符画成实心方块，挂在骨架根里的文字元素上；颜色读 `--skz-ul-fill`（pulse 变色，svg 引擎静止）。不用 clip、不用 underline、不用 mask。文字仍在 DOM，字号/行高/换行/最后一行变短全部由浏览器排版自然得到。

**用户中途要求：空格也画成方块**（整行连成一条，不留词间隙）。默认已改成这样：`space`、NBSP、各种空白字符都是实心方块；`--blank-space` 可恢复留白版（`fonts-blank/`，仅供对比）。

### 字体参数（scripts/gen_tofu.py）
- UPEM 1000；ascent 850 / descent 150 / lineGap 200（`line-height: normal` 时约 1.2em）。
- 方块纵向 -100..800（0.9em，居中于行盒中线 +350）；对比了 0.8 / 0.9 / 1.0em（`fonts/v80|v90|v100-*`，截图 `shots/vcmp-dpr2.png`），选 0.9em。
- 字形 6 个：`.notdef`（方块）、`space`（0.3em 方块）、`zero`（零宽，ZWJ/变体选择符/组合记号）、`narrow`（0.52em）、`wide`（1em）、`space_wide`（U+3000，1em 方块）。
- **右侧多出 advance 的重叠量 80 单位（0.08em）**：见第 3 节，无重叠时小数像素位置会出现可见接缝。
- 窄方块 advance 推荐 0.52（见第 5 节）；任务里写的 0.55 偏宽。
- 映射：ASCII 可见字符、Latin、希腊、西里尔等 → narrow；CJK（含扩展 A/B+）、全角、假名、韩文音节、Hangul Jamo、CJK 标点 → wide；半角片假名 → narrow；PUA → wide；emoji 区 → wide。

### cmap 与浏览器接受情况（data/cmaptest.jsonl，scripts/cmaptest.mjs）
| 变体 | TTF | WOFF | WOFF2 | Chrome 154 |
|---|---|---|---|---|
| format 13 only（3,10；41 个分组） | 1256 | 880 | 552 | 接受，BMP 和增补平面（U+20000、emoji）都命中 |
| format 4 only（3,1；手写 275 段） | 5524 | 2076 | 1248 | 接受，只覆盖 BMP（emoji 回退到别的字体，实测宽度 137 而非 100） |
| format 4 + 13（"both"，最终选用） | 6040 | 2332 | 1448 | 接受 |

- **Chrome 接受 format 13**（OTS 通过，字体 status=loaded，宽度测量：A=0.52em、中=1em、空格=0.3em、NBSP=0.3em、Я=0.52、한=1、U+3000=1、𠀀=1、ZWJ=0、PUA=1）。TTF/WOFF/WOFF2 三种封装都行。
- format 4 的"多对一"用了一个技巧：同字形的长区间切成每段 ≤256 码点，所有段的 idRangeOffset 指向同一份（每字形 256 项的）glyphIdArray，所以不用每码点一个字形，6 KB 以内。手写在 `gen_tofu.py: cmap4_raw()`。
- format 12 没有"多对一"（一组一个起始字形且按序递增），多对一需要每个码点一组（12 字节/码点，约 4 万码点 ≈ 480 KB，只是估算，没生成），不可取；折中就是上面的 format 4 手写。
- **Firefox：本机没有（where firefox、常见安装路径、注册表都没有），没测。** Firefox 同样用 OTS，Chrome 通过说明字体结构合法，但不保证；保守选项是只带 format 4（1.2 KB woff2，BMP only），有 fallback 价值。**Safari 无法测**（CoreText 对 cmap 13 的行为未知）。
- 产物：`skz-tofu.ttf`（both, 6040 B）、`skz-tofu.woff2`（1448 B）、`skz-tofu-fmt13-only.ttf`（1256 B）、`fonts/*`（全部变体）。体积都远小于 10 KB 目标；data URI（base64 woff2）约 1.9 KB。

### 原型 CSS（tofu.css，叠在 dist/base.css + global/svg 之后，根上写 `skz-text="tofu"`，运行时 `enable(el, { text: "tofu" })` 即可，TS 类型要放开）
```css
@font-face{font-family:"Skz Tofu";font-display:block;font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,...) format("woff2")}
[skz][skz-text="tofu"]:not([skz-ignore]){--skz-tbg:transparent;--skz-timg:none;--skz-tradius:0px}  /* 撤掉 clip/underline 的背景填充 */
[skz][skz-text="tofu"] :is(p,span,h1..h6,a,li,label,td,th,strong,b,em,small,dt,dd,blockquote,figcaption)
  :not([skz-ignore]):not([skz-bone]):not([skz-leaf]):not([skz-leaf] *):not([skz-ignore] *){
  font-family:"Skz Tofu"!important;
  color:var(--skz-ul-fill,var(--skz-color))!important;   /* 不是 --skz-fill：global shimmer 只写 --skz-ul-fill */
  -webkit-text-fill-color:currentColor!important; text-decoration:none!important;
  background-image:none!important; background-clip:border-box!important;   /* 撤掉 clip 模式的 background-clip:text */
  letter-spacing:0!important; word-spacing:0!important; font-kerning:none!important;
  font-variant-ligatures:none!important; font-synthesis:none!important; font-feature-settings:normal!important;
  text-rendering:optimizeSpeed!important; -webkit-text-stroke:0!important; text-shadow:none!important; }
```
- `font-synthesis:none` + `@font-face font-weight:100 900` 必须有：否则 h3/strong 的粗体会被合成加粗，方块变宽。
- 文字标签清单与 dist 现状一致（button 现在是控件骨头，不在清单里）。`tofuall.css` 变体：对所有非表单/媒体后代都套字体（裸 div 文字也变方块），测下来性能和主版本无差异。
- 继承 vs 显式：只设根 font-family 不够（作者样式会覆盖、表单控件不继承），所以和 clip 一样列出文字标签。**局限：不在清单里的裸 div 文字不变方块**（`tofuall.css` 解决）。**skz-ignore 行内元素如果在文字标签里（`<p>普通 <span skz-ignore>…</span></p>`），会继承 p 的方块字体**，视觉上被当成骨头；块级 ignore（整段 `p[skz-ignore]`）正常。

## 2. 视觉验证（shots/）

- `cards-light.png / cards-dark.png`：demo 卡片（h3/small/p/图标/按钮/表单控件）深浅色；`card-{light,dark}-dpr{1,1.25,2}.png`：单卡放大。整行连成一条，行间有 0.6em（14px 字号约 8px）缝，最后一行自然变短。
- `cards-global-pulse|shimmer|svg-pulse|svg-shimmer|fade|solid.png`：各动画模式。
- `modes-tofu.png / modes-tofuall.png`：同页 leaf / underline / clip / tofu 四种根并排。
- 表单控件：input/textarea/select 的字体仍是 Arial/monospace（不是方块），仍按原控件骨头画灰底，不受影响（data/behave.json）。`skz-ignore` 块不受影响；`leaf` / `underline` / `clip` 根在同页加载了 tofu.css 后字体、装饰线、background-clip 都没变（data/modes.json）。
- button：新 dist 里 button 是整块控件骨头（圆角灰块），方块字体不碰它。

### 接缝（scripts/seam.mjs、seam2.mjs；data/seam*.jsonl，shots/seam-*.png）
测法：纯黑方块白底，截图后沿行中线扫 5 条像素行，亮度 >24（满 255）算接缝。
- **没有重叠（方块恰好等于 advance）时有接缝**：12–24px、DPR 1/1.25/2 下最亮 58–132/255（窄方块行每隔 ~6px 一条淡线），原因是方块边落在小数像素上，两边抗锯齿覆盖率相加不到 100%。CJK 整 em 在 DPR1 整数字号下才没有。
- 重叠 40：DPR1 的 10–12px 仍有 109–116 的残留；重叠 60：偶见 20；**重叠 80（0.08em）：字号 10/11/12/13/14/15/16/18/20/24 × DPR 1/1.25/2 全部 ≤2**（seam2.jsonl）。
- 最终字体（重叠 80 + 空格实心）：字号 12/14/16/32 × DPR 1/1.25/1.5/2/3，窄方块行、CJK 行、含空格行全部最亮 ≤3/255，肉眼无缝（seam.jsonl，截图在 shots/）。
- 代价：行末最后一个方块比 advance 多出 0.08em（14px ≈ 1px），可忽略。

### 换行与真实文字贴合度（scripts/widths.mjs、wrap.mjs；data/widths.json、wrap.json）
方块总宽 / 真实总宽（1.0 为贴合；narrow 0.55 / space 0.3 时）：

| 文本 | Segoe UI | Arial | Times | Verdana | Tahoma | YaHei(=本机 system-ui) | SimSun |
|---|---|---|---|---|---|---|---|
| 英文长句 | 1.14 | 1.13 | 1.24 | 0.99 | 1.13 | 1.05 | 1.01 |
| 英文 2 | 1.12 | 1.11 | 1.22 | 0.97 | 1.11 | 1.03 | 1.03 |
| 数字串 | 1.08 | 1.06 | 1.16 | 0.90 | 1.05 | 1.00 | 1.05 |
| 中英混排 | 1.08 | 1.08 | 1.13 | 0.99 | 1.07 | 1.03 | 1.00 |
| 纯中文 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

- 0.55 对 Segoe/Arial 偏宽约 12%，对 YaHei 偏宽 4%。反推：0.50 对 Segoe/Arial/Tahoma/Georgia ≈ 1.03–1.04，对 YaHei 0.95，Times 1.13，Verdana 0.90；**推荐 0.50~0.52**。
- 换行行数（4 段文本 × 4 个容器宽 180/260/360/520 = 16 组，4 种真实字体）与真实文字相同的组数：

| narrow | YaHei(system-ui) | Segoe UI | Arial | Times | 合计/64 |
|---|---|---|---|---|---|
| 0.50 | 13 | 16 | 16 | 12 | 57 |
| 0.52 | 15 | 12 | 12 | 9 | 48 |
| 0.55 | 14 | 11 | 11 | 9 | 45 |

  不同的组里方块都是多 1 行（0.50 在 YaHei 下有 3 组少 1 行）。同行数时最后一行占宽比的平均偏差：0.52 在 YaHei 0.035、Segoe 0.157；0.50 在 YaHei 0.10、Segoe 0.065。结论：贴合度取决于用户实际字体，没有一个值全吃；**0.52 是兼顾 YaHei 与西文无衬线的折中，0.50 更贴 Segoe/Arial。生成脚本默认 0.52。**纯中文/全角永远 100% 贴合（1em）。
- 内容加载后布局位移：方块宽度和真实宽度有 ±10% 差，会有约 0–1 行的高度差异（约 1/4 组），不是零位移；这是该方案固有的。**这是方块字体相对 underline/clip 的一个劣势**：下划线/clip 排版用的是真实字体，换行与真实内容完全一致，没有位移。
- `line-height: normal` 时方块行高 = 1.2em，真实字体（YaHei 14px）约 1.29em（实测 51 vs 54px/3 行），有显式 line-height 的元素无此差异。

## 3. 字体加载与失败降级（scripts/flash.mjs、csp.mjs；data/flash.json、csp.json）
- **data URI 内嵌**：`document.fonts` loading→loadingdone 只差 13ms，且早于首次绘制（first-paint 416ms / loadingdone 70ms），首帧就是方块。
- **外链慢加载**（模拟 1.5s 延迟，`font-display:block`）：block 期内文字**不可见**（screencast 红色像素=0），字体到了才出方块，**没有真实文字闪现**；代价是慢时整块骨架文字空白最多 3s（block 期上限）。
- **失败（URL 404 / CSP 挡 data:）：真实文字以骨头色显示**（`shots/flash-tofu-broken-last.png`，screencast 红色像素 3210 vs 方块 18015）。不会崩，但会露出真实内容（灰色可读文字）。
- 严格 CSP：`font-src 'self'` 会挡 data: 字体（实测 status=error）；`font-src data:` 通过；外链同源字体在 `font-src 'self'` 下通过。需要 CSP 的站点要么放行 `font-src data:`，要么用外链字体文件（这又引入加载延迟）。
- **失败检测可靠**：失败时 `document.fonts.load('1em "Skz Tofu"')` 会 reject（NetworkError），`document.fonts.check` 为 false。建议降级：enable 时 `document.fonts.load(...).catch(() => root.setAttribute("skz-text","clip"))`（clip 默认），一行代码、零额外 CSS。没做进原型，只验证了检测可行。`unicode-range` 不能做兜底（字体整体不可用时没有东西接管）。

## 4. 动画（scripts/behave.mjs；data/behave.json）
- global + pulse：h3 的 color 隔 300ms 取样 4 次，4 个不同值（220,224,229 → 236,239,243），**文字在动**。
- global + shimmer：文字 = 颜色脉冲（同 pulse），没有光带；图标/头像背景光带照常。观感：文字条整体明暗呼吸，和旁边有光带扫过的头像不同步；浅色模式高亮色 #eceff3 贴近卡片底色 #f9fafb，文字条在脉冲峰值几乎消失（underline 同样）。
- svg 引擎（pulse/shimmer）：文字**静止**（`--skz-ul-fill` 在 svg 引擎里固定为 `--skz-color`，pulse/shimmer 都靠背景图，文字没有背景）。想让 svg 引擎文字也动只能另加 CSS 动画，未做。
- fade：根 opacity 动画，整个骨架一起呼吸，文字照常。
- 可访问性/复制：文字仍在 DOM，屏幕阅读器照读真实内容（骨架已有 aria-busy，建议再配 aria-hidden/live 区策略，与现有方案相同）；`user-select:none` 已在 `[skz]` 上，无法复制。方块字体不改变这些。

## 5. 性能（run-locked.mjs，3 次取中位数；场景 data/sc-perf*.json；原始 data/perf.jsonl、perf-rerun-all.jsonl，旧批次在 data/old/）

underline = `skz-text="underline"`；clip = dist 默认；tofu = 本原型（`tofuall` 同量级，见 jsonl）。每行：fps / 样式重算 ms/帧 / PrePaint / Paint / GPU / 合成。`@2000 shimmer` 行取自 CPU 约 13–20% 的复测批（perf-rerun-all），其余取自主批（测前 CPU 17–31%，偏高，数值有噪声）。

**500 卡（4000 元素）**
| 场景 | underline | clip | tofu |
|---|---|---|---|
| pulse global | 60.4 / 2.14 / 0.06 / 0.91 / GPU 2.66 | 59.2 / 7.54 / 0.71 / 0.96 / GPU 4.14 | 60.4 / 2.45 / 0.06 / 0.91 / GPU 2.55 |
| shimmer global | 60.4 / 2.09 / 0.09 / 1.83 / GPU 4.97 | 60.4 / 2.02 / 0.10 / 2.44 / GPU 8.82 | 60.4 / 2.91 / 0.11 / 2.07 / GPU 5.90 |
| shimmer svg | 60.4 / 0.09 / 3.14 / 1.87 / GPU 3.96 | 60.4 / 0.09 / 4.37 / 3.18 / GPU 7.22 | 60.4 / 0.12 / 4.16 / 2.32 / GPU 5.92 |

**2000 卡（16000 元素）**
| 场景 | underline | clip | tofu |
|---|---|---|---|
| pulse global | 60.4 / 6.44 / 0.10 / 1.20 / GPU 1.61 | **27.6 / 28.82** / 2.60 / 1.54 / GPU 3.98 | 60.4 / 8.23 / 0.16 / 1.50 / GPU 2.14 |
| shimmer global（复测批） | 59.6 / 10.16 / 0.27 / 2.67 / GPU 7.83 | 60.4 / 7.31 / 0.21 / 2.86 / GPU 11.34 | 60.4 / 7.45 / 0.22 / 3.21 / GPU 5.28 |
| shimmer svg（复测批） | 60.4 / 0.06 / 8.97 / 1.73 / GPU 2.73 | 58.0 / 0.05 / 13.14 / 2.68 / GPU 5.84 | 60.4 / 0.07 / 8.27 / 1.76 / GPU 2.97 |

**4× CPU 降速，2000 卡 shimmer（复测批，测前 CPU 13–18%）**
| 场景 | underline | clip | tofu |
|---|---|---|---|
| global | 20.8 fps / 重算 34.8 / Paint 11.4 / GPU 4.27 | 22.4 / 33.1 / 13.4 / GPU 8.04 | 20.0 / 38.2 / 11.2 / GPU 4.42 |
| svg | 23.6 fps / PrePaint 34.6 / Paint 8.8 / GPU 2.15 | **12.4** / PrePaint 64.6 / Paint 19.7 / GPU 7.46 | 20.8 / PrePaint 40.9 / Paint 9.4 / GPU 2.47 |

**开启耗时**（`toggleMs`，7 次中位数，字体已加载的"暖"切换）：500 卡 underline 23–28ms、clip 24–25、tofu 29–35（+25–35%）；2000 卡 underline 86–104、clip 91–93、tofu 124–148（+30–45%）；svg 2000：underline 148、clip 154、tofu 190（+28%）。原因是文字要换字体重新排版，underline/clip 不换字体。
**冷启动（首次使用字体，data/cold.jsonl，2000 卡）**：从 underline 状态切到目标模式到第 2 帧，tofu 159/204/330ms（中位 204）；underline 53–88；clip 67–72。字体解码本身 ~13ms，主要是全部文字重排。

结论：
- **每帧 GPU/Paint 与 underline 同一量级，明显低于 clip**（shimmer global 5.3 vs underline 7.8 vs clip 11.3 @2000；pulse GPU 2.1 vs 1.6 vs 4.0；svg 2.7–3.0 vs 5.8）。svg 下 4× 降速 clip 掉到 12 fps，tofu 20.8 fps 接近 underline 23.6。
- 样式重算：global pulse @2000 clip 是 28.8ms（27.6 fps），tofu 8.2ms 与 underline 6.4 同量级。
- 弱项：开启耗时 +30–45%，冷启动约 3×（重排）。
- 重复测量里 fps 偶尔掉到 51–58（如 tofu svg @2000 主批 54、underline shimmer global @2000 主批 57.6），都出现在测前 CPU >20% 的批次，复测批恢复 60，当噪声看待；原始数据都在 data/old/ 与 data/perf*.jsonl。
- 第一轮（blank 空格 + 旧 dist）和中间轮次的数据在 data/old/，量级一致，未混入上表。

## 6. 转正需要动的文件（不要真改）
- `src/enable.ts`：`SkzTextMode` 加 `"tofu"`；若选择"字体失败回退 clip"，enable 里加 `document.fonts.load(...).catch(...)`；元素 / 变体入口里如果有对 `skz-text` 的枚举（element.ts、react/vue/svelte 适配）同步加。
- `src/styles/tier1.scss`（或新建 `tier1-tofu.scss`）：加 `@font-face` 和 tofu 规则；`$clip` 选择器要排除 `skz-text="tofu"`（现在 tofu 根仍匹配 clip 的 background-clip:text 规则，需要像原型那样撤掉或把 $clip 加 `:not([skz-text="tofu"])`，后者更省）。
- `src/styles/entries/*`、vite 配置：字体 base64 内联进 CSS（构建脚本生成，`scripts/` 里放 gen_tofu.py 或直接提交 woff2 + 构建时转 base64）。
- `src/styles/_lists.scss`：无需改（复用 `$text-tags`）。
- `test/styles.test.ts`：加 tofu 根的选择器/声明断言；浏览器行为测试（字体加载、接缝）靠本目录脚本，不适合单测。
- `README*.md / llms.md / CHANGELOG.md / docs/`：文字模式表、CSP 说明（font-src data:）、已知限制。
- `ARCHITECTURE.md`、`docs/design`：文字模式选型。

## 7. 建议
**做成可选 `text: "tofu"`，不建议转为默认。**
- 优点：每帧 GPU/Paint 接近 underline、明显低于 clip（svg 降速场景 clip 崩到 12 fps 而 tofu 20.8）；不依赖装饰线裁剪的规范行为；形状整齐（行间缝均匀，没有 underline 的下探/粗细问题）；样式重算在 pulse 下远低于 clip。
- 缺点：①换行不是用真实字体排的，行数约 1/4 的情况与真实文字不同，内容加载后有布局位移；underline/clip 没有这个问题。②shimmer 在文字上只剩颜色脉冲，svg 引擎下文字完全静止。③开启耗时 +30–45%、冷启动约 3×。④字体加载失败/CSP 挡 data: 时露出真实文字（需要 JS 降级）。⑤cmap format 13 在 Firefox/Safari 未验证。⑥ignore 行内元素在文字标签里会被方块化。
- 适用场景：文字很多、预算紧、可接受静态/脉冲文字的页面（大列表）；要真实排版贴合或要文字光带的，仍用 clip/underline。

## 8. 没验证的部分
Firefox / Safari / Edge（没装或无法测）；iOS；format 13 在它们里的行为；深色以外的主题；RTL / 竖排文字；`line-height: normal` 与真实字体行高的系统性差异只量了 YaHei 一种；svg 引擎下让文字也动；字体失败降级的 JS 回退只验证了可检测、没接进 enable；tofu 在 shadow DOM 里（registerCustomElements 生成的样式表）没做。

## 9. antigravity 实际做了什么
只交回一个 `scratch_gen_tofu.py`（已挪到 `scripts/antigravity_gen_tofu.py`，仅供参考）和 tofu.css/index.html（已删），结论"Chrome 应该完美支持 format 13"**是没跑浏览器的推断**，且脚本有问题：把 U+0000–10FFFF 全量塞进 format 13（含代理区）、NBSP 落在 0x21–0x52F 区间里被画成方块而不是空白、没有 format 4 回退、没有接缝重叠、`@font-face` 没写 `font-display`。我重做了字体生成、cmap（手写 format 4）、CSS，并全部实测。
