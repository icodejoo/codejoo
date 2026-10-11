# a9：圆角文字条（A 方案：color 透明 + 背景渐变 + border-radius + box-decoration-break:clone）

环境：Windows 11 真机桌面（Ryzen 9 7945HX / RTX 4060 Laptop，2560x1600），Chrome 154.0.8037.98，截图用 headless=new，性能用有头窗口（视口 1200x800，DPR 1）；静态服务 `bench/2026-10-09-matrix/serve.mjs`（端口 5919，测完已按 PID 关闭）。被测产物：当前工作区源码 `pnpm build` 后的 `dist/` 冻结到 `dist-snap/`。没有改 `src/`、`demo/`、`test/`。测前整机 CPU 约 4%（`wait-idle.ps1` 等 <15% 连续 6 秒），批内均值 6~9%。只测了 Chrome（本机无 Firefox/Safari）。

## 1. 方案

**现状 clip**：形状 = 字形 ∪ 一根 1.22em 的透明下划线，填充 = `background-clip:text` 的共享渐变。下划线端点是直角，没法圆角。

**A 方案**（`round.css`，叠在 `core.css` / `base.css` 之后，根上写 `skz-round` 才生效，方便同页对照）：不动现有填充（背景色 / 图 / `fixed` / `--skz-tbg` 回落沿用 clip 规则已声明的那份），只改三件事：
1. `skz-text` 元素及其后代 `text-decoration:none`（形状不再靠下划线；文字本身已被现有规则设成 `-webkit-text-fill-color:transparent`，不用再写 color）；
2. `background-clip` 由 `text` 改回 `border-box`（背景铺满行内盒的每个行片段）；
3. `border-radius`（默认 .22em，变量 `--skz-round-radius`）+ `box-decoration-break:clone` 及 `-webkit-` 前缀。

两种挂法：`skz-round`（所有 `skz-text` 走 A）、`skz-round="inline"`（混合：只有 span/a/b/strong/em/small/label/code 等天然行内标签走 A，p/h1-6/li/div 等块标签保持 clip）。

另做了 `base-roundr.css` = 把 `dist/base.css` 里的下划线声明、`background-clip:text`、圆角三条规则直接改成 A 的声明（"替换版"，不叠加），只用于性能对照，看叠加规则本身有没有额外成本。

## 2. 可行性结论

截图在 `shots/`，文件名 `c-<case>-<主题>-<效果>.png`，每张四列 = 原文 / 现状 clip / A 叠加（全部）/ A 混合（仅行内标签）。验证页 `verify.html?theme=dark|light&effect=solid|shimmer&base=core|base&cases=a,b`。

| 场景 | A 的实际表现 | 截图 |
|---|---|---|
| 单行中文 / 英文 / 中英混排 | 行内 span：每个片段圆角，宽度与 clip 一致，条高见第 3 节 | `c-zh1-*` `c-en1-*` `c-mix-*` |
| 数字行内 `余额：<span skz-text>12345</span> 元` | 圆角小条，与 clip 同宽，周围文字不受影响 | `c-num-light-solid.png` |
| 下探字形 gypqj | 无小点（A 的背景铺满内容区，不依赖加粗下划线盖字形） | `c-desc-light-solid.png` |
| 多行折行 span（220 / 300px） | **每行独立圆角**，末行自然变短，行首行尾都是圆角（`clone` 生效）；与 clip 的行宽、末行宽度逐行一致 | `c-wrap-light-solid.png` `c-wrapeven-light-solid.png` `zoom-compare-light.png`（6 倍放大） |
| 块元素直接标 `<p skz-text>` | **整块一个圆角矩形**（宽度 = 容器宽，高度 = 整段所有行），不再是逐行条；`<h3 skz-text>` 短标题也被拉成整行宽 | `c-blockp-light-solid.png` `c-blockh3-light-solid.png` `c-card-light-solid.png` |
| flex / grid 子项里的 `<span skz-text>`（被块化） | 同样整块圆角矩形（多行时是一整块而不是多条） | `c-blockflex-light-solid.png` `c-grid-light-solid.png` |
| 容器标记 `<div skz-text>混合内容` | 整行宽的矩形，clip 是文字宽度 | `c-divmix-light-solid.png` |
| 让块元素也走 A 的办法 | 见下 | `c-hkinline-*` `c-hkfit-*` |
| 嵌套 `<span skz-text>价格 <span skz-ignore>实时</span></span>` | 与 clip 一致：ignore 文字保持原色，落在灰条上，不被吃掉 | `c-ign-light-solid.png` `base-c-ign-light-solid.png` |
| 嵌套 b / a / em | 正常，一条整体灰条 | `c-nest-light-solid.png` |
| 嵌套更大字号子元素 | A 的条高由父元素字体决定，大字号子元素不会把条顶出一个凸起（clip 会凸一块），但大字号文字超出条高（文字本身透明，视觉上无影响） | `c-bigchild-light-solid.png` |
| inline-block / sup / sub 子元素 | 灰条正常，inline-block 子元素原样显示（clip 同） | `c-inlblk-light-solid.png` |
| 典型卡片（img/按钮 `skz-bone`，h3/p/span `skz-text`） | A 全部：h3 变整行宽圆角块，p 变大块；A 混合：只有 span 圆角，h3/p 仍是 clip 直角条（观感不统一） | `c-card-light-solid.png` `c-card-dark-shimmer.png` |

**让块元素也走 A 的办法，结论：没有可用的纯 CSS 办法。**
- `p[skz-text]{display:inline}`：视觉上逐行圆角（`c-hkinline-light-solid.png`），但块元素变行内后，垂直 margin 失效、宽度 / 高度失效、相邻块会接到同一行（截图里第二段紧接在第一段末行后面），布局整体改变，不可取。
- `width:fit-content`：多行时仍是整块矩形（`c-hkfit-light-solid.png`），只能让单行短文字的宽度变短。
- `::first-line` 只能给首行画背景；Custom Highlight API 不支持圆角；`display:contents` 之类没有帮助。
- CSS 也无法按计算值 `display` 选元素（`:is(span)` 只能按标签名，挡不住 flex/grid 子项被块化）。
- 所以 A 的适用前提是：`skz-text` 打在天然行内、且父级不是 flex/grid 容器的元素上；块级文字要在里面多包一层 `<span skz-text>`。

### 光带同步（`sync.html` + `scripts/sync.mjs`，`data/sync.txt`，`shots/sync-*.png`）
动画冻结到 300 / 700 / 1000 / 1300ms，对比 clip 与 A（叠加、混合）在同一视口 x 处的亮度（深色主题，光带振幅约 20 灰阶）：同 x 亮度最大差 2~4 灰阶（同一根 clip 内两行互比也有 0~2），可视为同步；一个根内多行、两个元素之间的光带竖纹对齐（见 `sync-700.png`），圆角片段上的光带正常，无断裂。`background-attachment:fixed` 与 `box-decoration-break:clone` 同时生效，每个片段取到的是视口共享渐变的对应位置。

### 主题
浅 / 深色（`data-skz-theme`）都正常，颜色沿用 `--skz-color` / `--skz-highlight`，圆角不影响色值；深色 shimmer 光带仍偏淡（颜色配置本来如此，非本方案问题）。截图 `*-dark-solid.png` `c-card-dark-shimmer.png` `c-wrap-dark-shimmer.png`。`base.css + global.css` 组合同样可用（`base-c-card-light-solid.png`）。

## 3. 条高与位置（`metrics.html` + `scripts/metrics.mjs`，`data/metrics-*.json`）

100px 字号逐像素量灰条上下沿，单位 em，相对基线（负 = 基线之上）：

| 字体 | clip 上沿 / 下沿 / 高 | A 上沿 / 下沿 / 高（= 字体内容区） |
|---|---|---|
| Microsoft YaHei | -0.92 / 0.26 / 1.18 | -1.06 / 0.26 / 1.32 |
| Segoe UI | -0.92 / 0.25 / 1.17 | -1.08 / 0.25 / 1.33 |
| system-ui（YaHei+Segoe） | -0.92 / 0.25 / 1.17 | -1.02 / 0.25 / 1.27 |
| Arial | -0.91 / 0.21 / 1.12 | 相同 |
| Georgia | -0.92 / 0.22 / 1.14 | 相同 |
| Consolas | -0.92 / 0.25 / 1.17 | 相同 |
| SimSun | -0.86 / 0.14 / 1.00 | 相同 |
| Times New Roman | -0.89 / 0.22 / 1.11 | 相同 |

要点：
- **clip 的条高实际被行内盒（内容区）截住**：背景画不出 border-box 之外，所以 1.22em 的下划线在内容区 <1.22em 的字体（Arial/Georgia/Consolas/SimSun/TNR）里被裁成内容区高度，A 与 clip **像素级相同**。
- 内容区高于 1.22em 的字体（YaHei、Segoe UI、system-ui）：A 比 clip 高 0.10~0.16em（上沿多出，下沿一致），即 16px 字号时约 2px。
- 条高与位置不随 line-height 变（1.2 / 1.8 / normal 实测完全一致），只随字体变。
- A 的条高 = 字体内容区，**CSS 里只能加高（padding-block 只增不减），不能收窄**；`--skz-round-py` 变量留了口子但默认 0。想让 YaHei 下和 clip 一致需要收窄，未找到纯 CSS 办法（`clip-path` 对多片段行内元素的参照盒是各片段合集，没试出稳定写法，未采用）。
- 字号 12 / 16 / 24 + line-height 1.2 / 1.8（`c-sz*`）：1.8 时条间距充裕，A 与 clip 观感相同，A 稍高。**line-height 1.2 时 YaHei 的 A 条（1.32em）互相重叠 0.12em**，圆角处出现凹口接缝（`c-sz16_1.2-*` `c-lh12ya-*`）；clip 的条（1.18em）几乎首尾相接，缝是一条细线。两者在 1.2 下都像一整块，A 的接缝更显眼。
- 放大对比图：`zoom-compare-light.png`、`zoom-compare-dark.png`（6 倍，同一段文字 clip 与 A 并排）。

## 4. 浏览器兼容性（以 caniuse 数据 `css-boxdecorationbreak` 为准；MDN 页标为非 Baseline，要求前缀）

| 浏览器 | `box-decoration-break` |
|---|---|
| Chrome / Edge | 22–129（Edge 79–129）只认 `-webkit-` 前缀（行内元素逐片段 clone 可用，"partial"指分栏 / 分页不支持）；**130+ 无前缀** |
| Firefox | 32+ 无前缀，原生支持 |
| Safari / iOS Safari | 6.1–18.5 / 7.0+ 只认 `-webkit-` 前缀（行内元素可用）；caniuse 数据止于 18.5，之后版本未核实 |
| Android Chrome | 4.4+ 前缀，154 起无前缀 |

- 两种写法都要写（`round.css` 已写）。不写 clone 时，浏览器按默认 `slice` 渲染：按规范推断多行折行时只有首行左端和末行右端是圆角、中间行端点是直角（降级形态，不会坏；未做截图验证）。
- 本机只验证了 Chrome 154；Firefox、Safari 没测。
- A 不依赖 `text-decoration-thickness`、`text-underline-offset`，也**不依赖"装饰线参与 background-clip:text 裁剪"**（clip 方案这一点只在 Chrome 实测过，a7 NOTES 里列为未验证风险，Firefox/Safari 可能表现为"字形灰字"）。A 只依赖 `border-radius`、背景、`color` 透明，降级形态简单得多，`_modern.scss` 的 `@supports (text-decoration-thickness) and selector(:has())` 门槛对文字条不再必要。
- `background-attachment:fixed` 在 iOS Safari 不生效，是 clip 与 A 共有的问题，库里已有 iOS 分支，与本方案无关。

## 5. 性能

页面：`perf.html`（复制自 landing 的页面，改成显式标记版：文字元素 `skz-text`、图 / 图标 / 按钮 `skz-bone`，根上不写 `skz-auto`；CSS/JS 取 `dist-snap/` 的 `base.css` + `global.css|svg.css` + `global-js.mjs|svg-js.mjs`，`enable(root,{effect:"shimmer",engine})`）。
卡片结构两种：**inl**（主表）：文字元素全是 `<span skz-text>`（包在 div 里），A 真正适用的结构；**blk**（副表）：老结构 h3 / p / span，看 A 用在块元素上的代价。分组：**ul** = `text:"underline"` 纯下划线；**clip** = 现状默认；**round** = A 叠加（`round.css` + `skz-round`）；**roundi** = A 混合；**roundr** = A 替换版。每格新鲜加载页面，3 次 trace（每次 2.5s）取中位数，开启耗时 7 次（4x 时 3 次）中位数，每批首尾金丝雀。

做法：因 4x 降速下首批的金丝雀漂移很大（见下），常速和 4x 都按"跨 3 轮（轮转组顺序）取中位数"，4x 补测批（D）还在批首加了热身格。原始数据：`results/{P,P2,P3}.jsonl`（常速 500/2000，含 blk）、`results/{R1..R3}.jsonl`（常速补 roundr）、`results/{C,C2,C3}.jsonl`（4x，无热身，漂移大）、`results/{D1..D3}.jsonl`（4x，有热身，下表采用）；汇总 `results/summary-{P,C,R,D}.md`，每格跨轮极差也在里面；脚本 `scripts/`（`gen-scenarios.mjs` 生成 `scenarios/`，`run.mjs` 加锁串行跑，`aggregate.mjs` 汇总）。

每格：fps / 样式重算 / PrePaint / Paint / GPU（ms/帧）/ 开启 ms。

### 常速（3 轮中位数；fps 受 vsync 限在 60.4，不区分）

| 场景（inl，shimmer） | ul 纯下划线 | clip 现状 | A 叠加 round | A 替换 roundr |
|---|---|---|---|---|
| global 500 卡 | 60.4 / 0.91 / 0.01 / 0.31 / 0.94 / 24.3 | 60.4 / 0.86 / 0.01 / 0.43 / 2.11 / 23.7 | 60.4 / 0.88 / 0.01 / 0.36 / 1.05 / 28.9 | — |
| svg 500 卡 | 60.4 / 0.02 / 1.05 / 0.69 / 1.52 / 41.0 | 60.4 / 0.02 / 1.33 / 1.32 / 4.25 / 40.5 | 60.4 / 0.02 / 1.35 / 1.28 / 3.35 / 46.1 | — |
| global 2000 卡 | 60.4 / 2.77 / 0.02 / 0.41 / 1.00 / 101.2 | 60.4 / 2.56 / 0.02 / 0.54 / 2.13 / 98.1 | 60.4 / 2.71 / 0.02 / 0.48 / 1.06 / 120.0 | 60.4 / 2.49 / 0.02 / 0.49 / 1.04 / 111.0 |
| svg 2000 卡 | 60.4 / 0.02 / 4.61 / 0.97 / 1.70 / 167.1 | 60.4 / 0.03 / 5.61 / 1.59 / 4.54 / 163.8 | 60.4 / 0.03 / 5.66 / 1.47 / 3.53 / 187.1 | 60.4 / 0.03 / 6.11 / 1.42 / 3.50 / 178.2 |

（2000 卡 clip / round 另有 R 批同组复测：global clip 2.62 / 0.53 / 2.12 / 100.2，round 2.55 / 0.49 / 1.01 / 116.1；svg clip PrePaint 6.41 / GPU 4.55，round 5.74 / 3.47，与上表一致。）

blk（老结构 h3/p/span，2000 卡）：

| 场景 | clip | A 叠加 round | A 混合 roundi |
|---|---|---|---|
| global | 60.4 / 2.6 / 0.02 / 0.39 / 1.73 / 106.8 | 60.4 / 3.14 / 0.02 / 0.43 / 1.21 / 165.5 | 60.4 / 3.14 / 0.02 / 0.50 / 1.82 / 148.2 |
| svg | 60.4 / 0.03 / 8.82 / 1.53 / 3.87 / 203.8 | 60.4 / 0.03 / 8.03 / 1.11 / 2.57 / 168.1 | 60.4 / 0.03 / 8.60 / 1.48 / 3.67 / 215.4 |

blk 格的开启耗时跨轮极差很大（clip global 89.9–132.3，round global 138.5–166.6），只能当量级看。

### CPU 降速 4x（2000 卡，inl；D 批，3 轮中位数，带热身）

| 场景 | ul 纯下划线 | clip 现状 | A 叠加 round | A 替换 roundr |
|---|---|---|---|---|
| global | 46.8 / 15.79 / 0.12 / 2.88 / 1.30 / 529 | 43.6 / 15.86 / 0.15 / 4.49 / 2.98 / 511 | 42.0 / 17.56 / 0.14 / 3.46 / 1.55 / 621 | 47.2 / 14.59 / 0.13 / 3.16 / 1.33 / 581 |
| svg | 40.0 / 0.09 / 22.0 / 4.08 / 1.50 / 846 | 29.2 / 0.10 / 29.17 / 7.51 / 3.71 / 850 | 32.4 / 0.10 / 26.08 / 6.33 / 3.30 / 946 | 29.2 / 0.11 / 29.65 / 7.06 / 3.00 / 933 |

跨轮极差（fps）：global ul 39.2–48.4、clip 40–45.6、round 38–50、roundr 45.6–52.4；svg ul 39.6–42.8、clip 26.4–31.6、round 31.2–33.2、roundr 25.6–30.4。4x 的 blk 对照在无热身的 C 批里（`results/summary-C.md`）：global clip 56.8 / round 56.4 fps，svg clip 26.4 / round 28.4。

### 金丝雀与漂移
- 常速：clip global 2000 inl 金丝雀，P 批第 1、2 轮的**尾部**金丝雀比首部慢约 30%（样式重算 2.56→3.33、GPU 2.28→2.67、开启 98→159，第 2 轮同样），第 3 轮和 R 批三轮的首尾金丝雀一致（样式重算 2.46–2.57、GPU 2.08–2.28、开启 97–104）。也就是 P 批前两轮的后半段有漂移；靠组顺序轮转 + 3 轮中位数抵消，各格跨轮极差（`results/summary-P.md`）除开启耗时外都很小，所以结论里只采用 GPU / Paint / PrePaint / 样式重算的相对关系，开启耗时只当量级。
- 4x（无热身的 C 批）：同一批首尾两只金丝雀 fps 26.8 vs 46、样式重算 29.7 vs 15（第 3 轮 38 vs 44.8），批首第一格严重偏慢（冷启动 / 窗口未稳）。所以 C 批的 4x fps 不采信；改用 D 批（热身 + 3 轮轮转），D 批金丝雀 45.2 / 48.8 / 47.6 fps，稳定。
- 4x 的 fps 单格跨轮极差仍有 ±5~6，global 的三组（ul / clip / A）fps 差在噪声内，**不能据此说 A 的帧率更高**；GPU / Paint / PrePaint 这几项各轮极差小，可以比。

### 性能结论
1. 常速（60 fps）三组都满帧，没有差别。
2. **GPU 成本**：A ≈ 纯下划线（global 1.0~1.05 vs 1.0），约为 clip 的一半（2.1）；svg 下 A 3.4~3.5、clip 4.5、ul 1.7。原因是 clip 方案要对每个文字条做"装饰线 + 字形"的 text 裁剪遮罩，A 不用。4x 下同样（global 1.3~1.55 vs clip 3.0）。
3. **Paint**：A 比 clip 低约 10~25%（global 2000 常速 0.48 vs 0.54；4x 3.2~3.5 vs 4.5；svg 4x 6.3~7.1 vs 7.5）。
4. **样式重算**：A 与 clip 持平（global 2000 常速 2.5~2.7 vs 2.56；4x 14.6~17.6 vs 15.9，极差重叠）。
5. **PrePaint（svg 引擎）**：A 与 clip 没有差别（2000 卡常速 5.7~6.1 vs 5.6~6.4；4x 26~30 vs 29），明显比 ul 高（4.6 / 22）——这部分来自"有背景图的元素每帧重绘失效"，与 clip 还是 A 无关。svg 引擎下 A 的主要收益只在 GPU / Paint。
6. **开启耗时**：A 比 clip 慢约 10~20%（global 2000：叠加 116~120、替换 111 vs clip 98~100；svg 2000：186 / 178 vs 164），替换版也慢，说明不是叠加规则的额外匹配成本；原因没有深挖（猜测与圆角 / `box-decoration-break` 触发的样式 / 布局调整有关），量级 +11~20ms / 20000 元素，是一次性成本。
7. 叠加版与替换版（roundr）在 GPU / Paint / 样式重算上无差别，说明叠加做法没有高估 A 的成本；A 若落地成替换版，规则还能少一批（下划线声明、1.22em / -0.92em 偏移变量、`@supports (text-decoration-thickness)` 门槛等）。
8. blk 结构（A 用在块元素上）：Paint / GPU 也更低，但那是因为整块矩形代替了逐行条，不能当优点。

## 6. 局限与没验证的部分
- 只测了 Chrome 154 单机（含 `-webkit-` 与无前缀都支持的版本），Firefox / Safari / 低版本 Chrome（<130 靠前缀）没有实测；Safari 对 `box-decoration-break:clone` + `background-attachment:fixed` + `border-radius` 的组合渲染没验证。
- 性能的 4x 降速是 CDP 粗略替身，不是真机；fps 差异落在噪声内，只有 GPU / Paint 差距可靠。
- 条高被字体内容区决定：YaHei / Segoe UI 下比 clip 高 0.1~0.16em，line-height ≤1.2 时多行条会重叠；字体不同条高不一致（clip 因被内容区截断，对多数拉丁字体与 A 相同）。
- 块元素 / flex / grid 子项上的 `skz-text` 变整块圆角矩形，无纯 CSS 补救（见第 2 节）。
- 未测：`pulse` 效果与 A 的组合（填充变量相同，预期无差别）、`skz-text="leaf"` / `explicit.css` 的交互（A 的选择器带 `[skz-round]`，不影响它们）、`display:inline` 以外的 RTL / 竖排文字。
- 没有深挖 A 的开启耗时 +10~20% 的原因。

## 7. 推荐

**不建议直接替换默认 clip；建议作为可选的"圆角"文字模式（opt-in）保留，文档写清适用前提。**
- 理由 1（阻塞项）：`skz-text` 目前允许打在 `<p>` / `<h3>` / `<li>` / `<div>`、也会落在 flex/grid 子项上，A 在这些位置全部退化成整块圆角矩形（长段落变一大块，短标题变整行宽），而块元素恰恰是最常见的打标位置；没有纯 CSS 办法补救。"混合"版又会造成同一页面里 span 圆角、p 直角的不统一。
- 理由 2（收益）：A 的 GPU 约为 clip 的一半、Paint 少 10~25%，样式重算持平；而且不依赖"装饰线参与 background-clip:text 裁剪"这一只在 Chrome 实测过的行为，降级形态简单（最差是多行时中间行直角）；CSS 更短。
- 若产品愿意改约定为"`skz-text` 只打在行内文字元素上，块级文字内层包一个 `<span skz-text>`"，那 A 可以做默认；否则保持 clip 为默认，A 以 `skz-text-mode="round"` 之类的显式开关提供。

## 8. 关键截图
- 放大对比（6 倍，clip 左 / A 右）：`shots/zoom-compare-light.png`、`shots/zoom-compare-dark.png`
- 多行折行四列对比：`shots/c-wrap-light-solid.png`
- 块元素 / 卡片的局限：`shots/c-card-light-solid.png`、`shots/c-card-dark-shimmer.png`、`shots/c-blockp-light-solid.png`、`shots/c-blockflex-light-solid.png`
- 光带同步：`shots/sync-700.png`
- 条高：`shots/metrics-normal.png`（100px 字号，每行左 clip 右 A）

## 文件
`round.css`（A 叠加）、`base-roundr.css`（A 替换版，由 dist-snap/base.css 改三条规则得到）、`verify.html` `metrics.html` `sync.html` `zoom.html` `perf.html`、`dist-snap/`（冻结的 dist）、`scripts/*.mjs|ps1`、`scenarios/`、`results/`（jsonl / 汇总 md / 运行日志 / CPU 日志）、`data/`、`shots/`。

复现：`node bench/2026-10-09-matrix/serve.mjs 5919`（在包目录）；截图 `node scripts/shots.mjs <light|dark> <solid|shimmer> [core|base] [cases]`；量条高 `node scripts/metrics.mjs normal|1.2|1.8`；同步 `node scripts/sync.mjs`；性能 `node scripts/run.mjs <P|P2|P3|C|C2|C3|R1..R3|D1..D3>`（等 CPU 安静、加锁、端口 9917，只关自己起的 Chrome）。
