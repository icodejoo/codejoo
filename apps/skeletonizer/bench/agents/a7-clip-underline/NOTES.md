# a7 下划线当形状 + background-clip:text 当填充（原型，未改 src/文档）

环境：Chrome 154（Windows，真实窗口），页面由 `bench/2026-10-09-matrix/serve.mjs` 起的静态服务提供（见坑点），CSS/JS 用 `dist/` 现有产物 + 本目录 `clip.css` 叠加。

## 坑点
5188 的 Vite dev 服务会把 dist 里的 mjs 转换成不同实例，`index.mjs` 与 `svg-js.mjs`/`global-js.mjs` 不共享 enable 注册表，svg 引擎和防火墙都不会生效（根上没有 skz-engine）。本次全部用静态服务（5191，测完已关）。

## 方案（clip.css）
1. shimmer/pulse 根上把 `--skz-tbg/--skz-timg` 改回 `var(--skz-fill,var(--skz-color))` / `var(--skz-bg-img)`：文字标签原有的第 0 档 bg 声明（位置/尺寸/fixed）直接复用，和图标、图片骨头同一套变量，没有另起一套。
2. 文字标签（base 里那份标签列表）加 `background-clip:text`。排除 skz-ignore / skz-bone / skz-leaf 及其后代。
3. 所有后代（`:not([skz-ignore])`）`text-decoration-color:transparent`。必须是所有后代：祖先块的下划线会穿过后代文字（装饰传播），只清文字标签的话中间的 div 仍画出不透明条盖住渐变（第一版踩过）。
4. `--skz-ul-thickness:1.15em`，偏移不变（-0.85em）。
变体：clipall.css（非标签但直接含文字的元素，如裸 div/code 也画 bg+clip）、clipnp.css（global 引擎 shimmer 不再同时驱动 pulse-c 动画）。

## 下探字形
descender.html + shots/desc*.png。1em/-.85em 在 YaHei 16px 下探处有小点；1.15em/-.85em 在 Microsoft YaHei / Georgia / Consolas / Segoe UI，12/14/16/32px，CJK+拉丁(gypqj)下均无小点；条顶边不变，底边下移 0.15em。1.2em/-.9em 也干净但顶边上移。验证页里的真实卡片放大图 shots/zoom-*.png 同样无小点。

## 正确性（scripts/verify.mjs，data/verify.jsonl，shots/v-*.png）
每组合连拍 6 帧（间隔 250ms+截图耗时），逐像素对比，下表为 maxΔ亮度/变化像素数（h3，深色，shimmer）：
| 组合 | h3 | 说明 |
|---|---|---|
| 现状 global | 18.8 / 6384 | 只是颜色脉冲，全条同时变色，无光带 |
| clip global | 20.5 / 2324 | 光带扫过 |
| 现状 svg | 0 / 0 | 文字完全静止 |
| clip svg | 20.5 / 2217 | 文字里有 SVG 光带在动 |
- 光带与图片骨头同步：各骨头 background-position 字符串相同（global 同时刻取样完全一致），svg 引擎下 bg-pos 恒 0 0，同一张 fixed 100vw×100vh 图，像素上 img 与文字都在动。
- 多行段落每行一条、末行短；`价格：<b>¥5</b>` 正常；按钮文字有条；skz-ignore 区计算样式 clip=border-box、bg 透明、文字原色，像素 0 变化；skz-bone 的 h3 clip=border-box（整块 bone 不被裁掉）；skz-leaf 区不受影响。
- 深/浅色截图正常。浅色下光带本来就弱，深色 #374151→#4b5563 只差约 20 灰阶，光带在深色下依然偏淡（颜色是库的配置，不是本方案的问题）。
- skz-text="leaf" 模式：clip.css 不匹配（选择器含 :not([skz-text=leaf])），运动像素与现状同；explicit：真正落地时规则在 tier1，explicit.css 不含 tier1，天然不受影响（用 explicit.css 单独加载验证过无变化）。
- 局限：不在标签列表里却直接含文字的元素（裸 div 文本，clip 版）变成不可见；clipall 补上，但性能更差。
- pulse + clip：global 下和现状一样（颜色脉冲）；svg 下 pulse 图填进文字，文字也会呼吸（现状静止）。

## 防火墙（scripts/firewall.mjs，data/firewall.jsonl）
2000 卡片 global+enable shimmer：现状/clip/clipnp 三组一致：1992 项打 skz-fw，视口外 h3 背景位置恒 -720px、300ms 后不变；视口内 546->981px 在动。clip 方案不需要改防火墙规则（文字复用 --skz-bg-pos，原本就被重声明）。

## 性能（scripts：run-locked.mjs + data/sc-perf.json，data/perf.jsonl；每场景 3 次取中位数，开启耗时 7 次中位数；测前 CPU 约 6~9%）
单位 ms/帧（toggle 为 ms）。fps 在本机被 2.5s 窗口/vsync 限在 57.2，看不出差别；金丝雀 CANa/CANb（2000 现状）UTree 3.61/3.54，漂移小。视口内只有约 6 张卡。
| 场景 | fps | 样式重算 | PrePaint | Paint | GPU | 开启 |
|---|---|---|---|---|---|---|
| 500 global+enable 现状 | 57.2 | 1.13 | 0.04 | 0.71 | 2.04 | 14.1 |
| 500 global+enable clip | 57.2 | 1.50 | 0.05 | 0.98 | 5.64 | 17.1 |
| 500 global+enable clipall | 57.2 | 1.89 | 0.05 | 1.24 | 8.80 | 18.0 |
| 2000 global+enable 现状 | 57.2 | 3.78 | 0.08 | 1.09 | 2.29 | 55.3 |
| 2000 global+enable clip | 57.2 | 4.45 | 0.09 | 1.40 | 5.70 | 64.1 |
| 2000 global+enable clipall | 57.2 | 5.70 | 0.10 | 1.76 | 8.91 | 71.5 |
| 2000 global+enable clipnp | 57.2 | 4.59 | 0.09 | 1.44 | 5.76 | 62.5 |
| 500 svg 现状 | 57.6 | 0.04 | 0.77 | 0.73 | 1.60 | 23.2 |
| 500 svg clip | 57.2 | 0.04 | 2.21 | 1.79 | 5.41 | 32.6 |
| 500 svg clipall | 57.6 | 0.04 | 2.30 | 2.53 | 8.72 | 31.8 |
| 2000 svg 现状 | 57.2 | 0.05 | 3.31 | 1.14 | 1.87 | 88.3 |
| 2000 svg clip | 57.2 | 0.04 | 7.70 | 2.01 | 5.52 | 105.3 |
| 2000 svg clipall | 57.2 | 0.05 | 9.84 | 3.13 | 8.75 | 122.1 |
CPU 降速 4x（2000 卡，3 次中位数，data/perf-cpu4.jsonl）：global 现状 44 fps -> clip 35.6 fps；svg 现状 56.8 fps -> clip 26.4 fps（PrePaint 13.1 -> 31.4）。
结论：GPU 约 2.5 倍，svg 下 PrePaint 约 2.3 倍；中高端机 fps 不掉，低端/降速下 svg 明显吃亏。clipnp 与 clip 无差别，pulse-c 动画不是成本来源，不用做。

## 其他引擎
本机没有 Firefox（Program Files、x86、LocalAppData、注册表 App Paths 均无），未测。Safari 无法测。Edge 同 Chromium 内核，不具参考价值。

## 降级
`@supports (-webkit-background-clip:text)` 只能判断 background-clip:text 是否存在，无法判断装饰线是否参与裁剪。三种情形：
1. 不支持 background-clip:text：背景不裁，文字元素整个盒子被 --skz-tbg 填成灰块（装饰线透明）。看起来是整块矩形而不是条，不是空白，但也和预期不同。
2. 支持 clip:text 但装饰线不参与裁剪（未测，Firefox/Safari 都可能）：只剩字形轮廓被渐变填充，文字透明装饰线透明，表现为"字形形状的灰字"或接近不可见，骨架感丢失。
3. 老 Chrome（120 前仅 -webkit- 前缀）：需同时写前缀，已写。
所以不建议默认开启：应做成显式开关 `skz-text="clip"`（用户自己验过目标浏览器），默认仍 underline。无法做运行时像素探测（DOM 不可读像素）。
## 文件
clip.css clipall.css clipnp.css perf.html verify.html descender.html scripts/*.mjs data/*.jsonl|json shots/*.png
