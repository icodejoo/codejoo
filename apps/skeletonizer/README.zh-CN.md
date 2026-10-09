# skeletonizer

**在线 demo：<https://icodejoo.github.io/codejoo/skeletonizer/>**（各效果、档位、深色、fit 等可交互切换）

> English docs: [README.md](./README.md)。
>
> 给 AI 编码助手：精简用法见 [llms.md](./llms.md)（随 npm 包发布），接入方式见[给 AI 编码助手](#给-ai-编码助手)。

**Web 版骨架屏方案：照 Flutter skeletonizer 的路子，真实 DOM + mock 数据 + 纯 CSS，不用手画占位形状。**

受 Flutter 的 [skeletonizer](https://pub.dev/packages/skeletonizer) 启发，解决 vue-skeletor / react-content-loader 里手写占位的痛点 —— 改个 UI 就得重新设计骨架，特别折腾。这套方案照常渲染真实组件，喂进 mock 数据，由 CSS 根据实际布局自动生成骨头，需要例外的地方才标记。

## 目录

- [怎么工作](#怎么工作)
- [快速开始](#快速开始)
- [选择入口](#选择入口)：基底 + 变体，按需加载
- [功能总表](#功能总表)：效果 / 入口 / 选项 / 自动机制 / 标记 / 主题变量 / API 的作用、用法、限制
- [方案怎么选](#方案怎么选)：按场景的建议
- [方案对比](#方案对比)：性能、颜色、兼容性实测
- [各方案详解](#各方案详解)：fade / solid、global、svg、sweep、显式标记、懒渲染
- [Bone 工具](#bone-工具) · [主题](#主题)
- [浏览器支持与降级](#浏览器支持与降级) · [已知限制与使用约束](#已知限制与使用约束)
- [在框架里怎么用](#在框架里怎么用) · [给 AI 编码助手](#给-ai-编码助手) · [开发与实验存档](#开发与实验存档)

## 怎么工作

三个部分组成：

1. **真实 DOM 渲染**：用你平常的 JSX / Vue 模板写组件，只是喂进 mock 数据而不是真实数据。
2. **Mock 数据**：用 `Bone` 工具生成文字、图片等占位内容，都是确定性的（SSR 友好，不用 `Math.random`）。
3. **CSS 自动命中**：根据标签名、元素内容、文本是否为空等启发式规则，自动把叶子替换成灰色骨头；也支持 `skz-bone` / `skz-leaf` / `skz-ignore` 裸属性来标记例外。

骨架样式是纯 CSS，分四层渐进增强（兜底 → Tier 0 → Tier 1 → Tier 2），从最老的浏览器到最新的都能用，不用 UA 嗅探，也不用 JS 闸门。

## 快速开始

### 1. 安装

```bash
pnpm add skeletonizer
```

### 2. 在应用入口引入：一个基底 + 需要的变体

```ts
import "skeletonizer/base.css"; // 基底：主题、交互锁、自动推导骨头、fade / solid
import "skeletonizer/global"; // 变体：pulse / shimmer（根驱动 + 继承防火墙，老浏览器自动降级为 SVG 动画），自带 global.css
```

不想挑：`import "skeletonizer/all";`（全部 CSS + 全部变体）。完整的入口清单和体积见[选择入口](#选择入口)。

### 3. 开启骨架

```ts
import { enable, Bone } from "skeletonizer";

const off = enable(document.querySelector("#card")!, { effect: "shimmer" });
// 数据到了：
off();
```

`enable()` 的选项：

| 选项       | 取值                                                    | 说明                                                                                                                                                                               |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effect`   | `fade`（默认）/ `solid` / `sweep` / `pulse` / `shimmer` | 动画效果；`sweep` 需引入 `sweep.css`，`pulse` / `shimmer` 需引入 `global` 或 `svg` 变体（都没引入时退回 fade）                                                                     |
| `text`     | `underline`（默认）/ `leaf`                             | 文字骨头画法，见[主题](#主题)                                                                                                                                                      |
| `engine`   | `global` / `svg`                                        | `pulse` / `shimmer` 的实现。不传时按已引入的变体决定：有 global 用 global，只有 svg 用 svg                                                                                         |
| `fallback` | `svg`（默认）/ `fade`                                   | global 方案在不支持 `@property` 的浏览器里的降级：`svg` 由 JS 挂 SVG 动画，`fade` 保持基底 fade；JS 执行前老浏览器显示 fade                                                        |
| `fit`      | 布尔，默认 `false`                                      | 骨架自身绝不撑出滚动条：根的高度被限制在滚动祖先（没有则视口）剩余空间内，完全落在外面的列表项 `display: none`，尺寸变化时自动重算。`<skz-box fit>`、React / Vue / Svelte 均可透传 |

重复调用 `enable()` 是安全的：按本次参数重新同步属性（没传的会被清掉），并重新扫描列表项、忽略区和主题变量。

### 4. 喂 mock 数据，照常渲染

```ts
const user = loading ? { name: Bone.text(8), bio: Bone.lines(2), avatar: Bone.image(48, 48) } : data;
```

### 框架适配

适配层走子路径导出，框架本身是可选 peer 依赖。它们调用同一个核心，入口处引入的变体对它们同样生效。

```ts
// Vue 3：指令 / 组件 / 组合式 / 插件
import { vSkeleton, SkzBox, useSkeleton, SkzPlugin } from "skeletonizer/vue";
// <div v-skeleton="{ loading, effect: 'shimmer' }">…</div>   或   <SkzBox :loading="loading" effect="shimmer">…</SkzBox>

// React：Hook / 组件
import { SkzBox, useSkeleton } from "skeletonizer/react";
// <SkzBox loading={loading} effect="shimmer">…</SkzBox>

// Svelte：action
import { skeleton } from "skeletonizer/svelte";
// <div use:skeleton={{ loading, effect: 'shimmer' }}>…</div>
```

### `<skz-box>` 自定义元素 / 纯 HTML

```ts
import { defineSkzBox } from "skeletonizer";
defineSkzBox();
```

```html
<skz-box loading effect="shimmer"><div class="card" skz>…</div></skz-box>

<!-- 宿主上的 loading 是开关；skz 落在它的【第一个元素子节点】（骨架根）上，宿主自己不带 skz；JS 里用 el.loading = true/false 切换 -->
<!-- SSR / 无 JS：直接在子根上写 skz，如 <skz-box loading><div skz>…</div></skz-box>，就能命中 CSS 兜底层；JS 起来后 enable 是幂等的 -->
<!-- 不用 JS：直接写根属性（拿不到防火墙、运行时 SVG 和 inert 交互锁） -->
<div skz skz-effect="shimmer">…</div>
```

`<skz-box>` 只认宿主自己的 `loading`（以及 `effect` / `text` / `fallback` / `engine`）属性。它不带 MutationObserver：框架把第一个子节点替换掉之后，由你自己处理，比如把 `loading` 关一下再开，新子根才会生效、旧子根被解除。宿主被移动到别的父节点后加载态会自然保持。

SSR 安全：`skeletonizer` 核心和 `/global/js`、`/svg/js`、`/all/js` 在 Node 里 import 都不报错；带 CSS 的变体入口（`/global`、`/svg`、`/all`）需要打包器处理 CSS，见下节。

## 选择入口

样式和运行时都拆成"基底 + 变体"，用多少引多少。表中体积为 `pnpm build` 产物按 `gzip -9` 计算（1 KB = 1024 字节；核心 = `index.mjs` + 共享的 `enable` 块；global / svg 的 JS 增量含两者共用的 SVG 块）。

### 基底（二选一）

| 入口                        | 内容                                                                                                 | 体积    |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ------- |
| `skeletonizer/base.css`     | 主题变量、交互锁、四档自动推导骨头、显式标记、忽略区、fade / solid、懒渲染与减少动态效果             | 1.28 KB |
| `skeletonizer/explicit.css` | 同上但**不含任何推导规则**，只有 `skz-bone` / `skz-leaf` 是骨头；样式重算更少（见[对比](#方案对比)） | 0.77 KB |

### 运行时核心

| 入口                                    | 内容                                                                                    | 体积                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- | -------------------- |
| `skeletonizer`                          | `enable` / `disable`、`Bone`、`<skz-box>`、`registerCustomElements`；不带 CSS，SSR 安全 | 4.1 KB               |
| `skeletonizer/vue`、`/react`、`/svelte` | 框架适配层（依赖核心）                                                                  | 核心之外 +0.1~0.5 KB |

### 变体（按需叠加）

| 变体   | 带 CSS                | 纯 JS（无打包器 / SSR）  | 纯 CSS                                  | 内容                                                          | 体积（JS 增量 + CSS） |
| ------ | --------------------- | ------------------------ | --------------------------------------- | ------------------------------------------------------------- | --------------------- |
| global | `skeletonizer/global` | `skeletonizer/global/js` | `skeletonizer/global.css`               | pulse / shimmer 根驱动、继承防火墙、老浏览器 JS 挂 SVG 降级   | 1.3 KB + 0.48 KB      |
| svg    | `skeletonizer/svg`    | `skeletonizer/svg/js`    | `skeletonizer/svg.css`                  | pulse / shimmer 用共享 SVG 动画背景、按主题运行时生成精确颜色 | 1.2 KB + 0.19 KB      |
| sweep  | —                     | —                        | `skeletonizer/sweep.css`                | 根上一条扫光条（纯 CSS）                                      | 0.55 KB               |
| all    | `skeletonizer/all`    | `skeletonizer/all/js`    | `skeletonizer/all.css`（= `style.css`） | `base` + 全部变体                                             | 1.4 KB + 1.97 KB      |

- 带 CSS / 纯 JS / 纯 CSS 三种入口的取舍见[功能总表](#功能总表)的「入口 / 变体」。
- 只引入 `svg` 时，产物里不会有防火墙和根驱动 CSS（已用 Vite 打包验证）；需要哪个方案就只为哪个方案付体积。

```ts
// 典型组合
import "skeletonizer/base.css";
import "skeletonizer/global"; // 长列表 + shimmer，最推荐

// 精确控制骨头位置
import "skeletonizer/explicit.css";
import "skeletonizer/global";

// 只要 SVG 方案（不需要 @property，老浏览器同样有动画）
import "skeletonizer/base.css";
import "skeletonizer/svg";

// 无打包器 / SSR：JS 用 /js 版，CSS 另用 <link> 引 base.css 与 global.css
import "skeletonizer/global/js";
```

## 功能总表

所有选项、属性、变量、入口和 API 的作用 / 最短用法 / 限制都在这张表里；总表放不下的细节见[各方案详解](#各方案详解)和[已知限制与使用约束](#已知限制与使用约束)。表里的性能数字（帧率 / 每帧样式重算 / 开启耗时，"4000 / 16000 元素"）都出自[方案对比](#方案对比)的矩阵：桌面 Chrome、单次正向测量，差距在 2 倍以内的别当真。

| 项                                       | 作用                                                                                                                                                                                                                                                                               | 用法                                                                                               | 受限                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **效果**                                 |                                                                                                                                                                                                                                                                                    |                                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                 |
| `fade`（默认）                           | 根整体 opacity 脉冲（1 → `--skz-fade-min`，默认 0.55），跑在合成器线程，几乎零成本；不写 `skz-effect` 就是它                                                                                                                                                                       | `enable(el)`<br>`enable(el, { effect: "fade" })`<br>`<div skz>`                                    | 根里有 `skz-ignore` 时隐式默认不开，要显式写 `effect: "fade"`；会把根里的一切（含忽略区）一起淡出；pulse / shimmer 没引入变体时也退回它<br>4000 / 16000 元素都是 60 帧、样式重算 0.10 / 0.24 ms，开启 24 / 76 ms                                                                                                                                                                                |
| `solid`                                  | 静止的骨头色，没有动画                                                                                                                                                                                                                                                             | `enable(el, { effect: "solid" })`<br>`skz-effect="solid"`                                          | 基底自带，无额外限制<br>60 帧、样式重算 0.00 ms，开启 22 / 69 ms                                                                                                                                                                                                                                                                                                                                |
| `sweep`                                  | 整个根一个 `::after` 扫光条，`transform` 平移，跑在合成器线程；浅色 lighten 混合只提亮骨头，深色用容器色叠加，按主题自动切换                                                                                                                                                       | `import "skeletonizer/sweep.css"`<br>`enable(el, { effect: "sweep" })`                             | 必须引入 `sweep.css`；根被设为 `position: relative` + `overflow-x: clip`，根的 `::after` 被占用，忽略区也会被扫到；需要 `mix-blend-mode`（浅色）；光带默认竖直，倾斜长根慎用<br>16000 元素 60 帧、样式重算 0.67 ms（深色 0.61 ms），另有 PrePaint 约 5~6 ms、GPU 约 1.4~2.2 ms；开启 16 / 63 ms（沿用原矩阵，没为合并版重测）<br>详见 [sweep](#sweep扫光条纯-css)                               |
| `pulse`                                  | 骨头颜色在 `--skz-color` 与 `--skz-highlight` 之间来回脉冲（global：根上一个动画驱动；svg：共享 SVG 动画图）                                                                                                                                                                       | `import "skeletonizer/global"`<br>`enable(el, { effect: "pulse" })`                                | 需要 `global` 或 `svg` 变体，都没引入就退回 fade；global 需 `@property`（Chrome 119+ / Safari 16.4+ / Firefox 128+），老浏览器由 JS 改挂 SVG 动画；纯 CSS 大骨架很慢<br>数据同 shimmer（矩阵里 pulse 与 shimmer 的差异在噪声范围内）                                                                                                                                                            |
| `shimmer`                                | 高光光带在视口坐标里平移，各骨头同步（`background-attachment: fixed` 渐变）                                                                                                                                                                                                        | `import "skeletonizer/global"`<br>`enable(el, { effect: "shimmer" })`                              | 同 pulse；下划线文字没法渐变，global 改为颜色脉冲、svg 保持静止；iOS Safari 没有 fixed 背景，global 改为颜色脉冲、svg 改用 pulse 图<br>`global` + `enable()`：60 帧 / 4.89 ms（16000），开启 63 ms；纯 CSS 无 JS：20.8 帧 / 41.3 ms；`explicit.css` + `global`：2.60 ms、开启 50 ms；`svg`：0.05 ms、开启 111 ms<br>无列表结构页（双栏表单）：`global` 17.2 帧 / 49.1 ms，`svg` 60 帧 / 0.04 ms |
| **入口 / 变体**                          |                                                                                                                                                                                                                                                                                    |                                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                 |
| `base.css`                               | 基底（与 `explicit.css` 二选一）：主题变量、交互锁、四档自动推导骨头、显式标记、忽略区、fade / solid、懒渲染、减少动态效果、`skz-cv`、`fit` 的 CSS                                                                                                                                 | `import "skeletonizer/base.css"`                                                                   | 1.28 KB；只带 fade / solid，pulse / shimmer / sweep 要另引变体；推导选择器让每帧样式重算比 `explicit.css` 更贵                                                                                                                                                                                                                                                                                  |
| `explicit.css`                           | 显式基底：**不含任何推导规则**，只有 `skz-bone` / `skz-leaf` 是骨头，其余元素原样显示                                                                                                                                                                                              | `import "skeletonizer/explicit.css"`（代替 `base.css`）                                            | 0.77 KB；显式模式只能靠引入它开启，没有"单个根切换"；每个骨头都要手动标；没有推导规则，`skz-text` 不起作用<br>更省：样式重算 4.89 → 2.60 ms（16000，防火墙路径），开启 62 → 50 ms，帧率没差别（都 60）                                                                                                                                                                                          |
| 核心 `skeletonizer`                      | 运行时：`enable` / `disable`、`Bone`、`<skz-box>`、`registerCustomElements`                                                                                                                                                                                                        | `import { enable, Bone } from "skeletonizer"`                                                      | 4.1 KB；不带 CSS，要另引基底；SSR / Node 里 import 不报错                                                                                                                                                                                                                                                                                                                                       |
| `global`                                 | pulse / shimmer 根驱动 + 继承防火墙 + 老浏览器 JS 挂 SVG 降级                                                                                                                                                                                                                      | `import "skeletonizer/global"`                                                                     | JS 增量 1.3 KB + CSS 0.48 KB；带 CSS 的入口需要打包器；没有列表结构的大骨架上防火墙帮不上忙（改用 `svg`）；详见 [global](#global根驱动-pulse--shimmer)                                                                                                                                                                                                                                          |
| `svg`                                    | pulse / shimmer 用一张共享 SVG 动画背景，按主题运行时生成精确颜色，不依赖 `@property`                                                                                                                                                                                              | `import "skeletonizer/svg"`                                                                        | JS 增量 1.2 KB + CSS 0.19 KB；下划线文字静止；严格 CSP 需放行 `img-src blob:`；无 JS 时退回 fade；开启比 global 贵（16000 元素 111 ms，表单页 134 ms）、PrePaint 4.7~8 ms；详见 [svg](#svg共享-svg-动画背景)                                                                                                                                                                                    |
| `sweep.css`                              | 纯 CSS 的 sweep 扫光（没有对应的 JS 变体）                                                                                                                                                                                                                                         | `import "skeletonizer/sweep.css"`                                                                  | 0.55 KB；副作用见上面 `sweep` 一行                                                                                                                                                                                                                                                                                                                                                              |
| `all`                                    | `base` + 全部变体（global、svg、sweep）                                                                                                                                                                                                                                            | `import "skeletonizer/all"`                                                                        | JS 1.4 KB + CSS 1.97 KB；global 与 svg 都在，`engine` 不传时默认 global；包体敏感时别用                                                                                                                                                                                                                                                                                                         |
| `/js` 纯 JS 入口                         | 只带运行时、不带 CSS：`skeletonizer/global/js`、`/svg/js`、`/all/js`                                                                                                                                                                                                               | `import "skeletonizer/global/js"`                                                                  | 要自己再引对应的 `.css`（`<link>` 或 import）；用于无打包器 / SSR；在 Node 里 import 不报错                                                                                                                                                                                                                                                                                                     |
| `.css` 纯 CSS 入口                       | `base.css`、`explicit.css`、`global.css`、`svg.css`、`sweep.css`、`all.css`（= `style.css`）                                                                                                                                                                                       | `<link rel="stylesheet" href="…/skeletonizer/base.css">`                                           | 没有 JS 就没有防火墙、svg 运行时图和 `inert` 交互锁；纯 CSS 的 global 在 16000 元素约 21 帧 / 41 ms                                                                                                                                                                                                                                                                                             |
| 带 CSS 的入口                            | `skeletonizer/global`、`/svg`、`/all` 产物开头是 `import "./x.css"`，打包器一并打进样式                                                                                                                                                                                            | `import "skeletonizer/all"`                                                                        | 需要 Vite / webpack / Next.js / Rollup 等打包器处理 CSS，Node / SSR 里改用 `/js`；`sideEffects` 已声明，不会被 tree-shaking 掉                                                                                                                                                                                                                                                                  |
| **`enable()` 选项**                      |                                                                                                                                                                                                                                                                                    |                                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                 |
| `effect`                                 | 动画效果，写到根的 `skz-effect`                                                                                                                                                                                                                                                    | `enable(el, { effect: "shimmer" })`                                                                | 取值 `fade`（默认）/ `solid` / `sweep` / `pulse` / `shimmer`；`sweep` 需 `sweep.css`，`pulse` / `shimmer` 需 `global` 或 `svg`，没引入就退回 fade                                                                                                                                                                                                                                               |
| `text`                                   | 文字骨头画法，写到根的 `skz-text`                                                                                                                                                                                                                                                  | `enable(el, { text: "leaf" })`                                                                     | `underline`（默认，需 `text-decoration-thickness`）：不能渐变、没有圆角；`leaf`（需 `:has()`）：多行块级文字变成一整块矩形，混合文字里的裸文字节点不出骨头；`explicit.css` 没有推导规则，不起作用                                                                                                                                                                                               |
| `engine`                                 | pulse / shimmer 的实现：`global` / `svg`                                                                                                                                                                                                                                           | `enable(el, { effect: "shimmer", engine: "svg" })`                                                 | 只对 pulse / shimmer 有效；不传时按已引入的变体决定：有 global 用 global，只有 svg 用 svg，都没引入按 global（纯 CSS 根驱动）；指定了没引入的方案，按代码逻辑会退回 fade（未单独验证）                                                                                                                                                                                                          |
| `fallback`                               | global 在不支持 `@property` 的浏览器里的降级：`svg`（默认，JS 挂 blob SVG 动画）/ `fade`（保持基底 fade）                                                                                                                                                                          | `enable(el, { effect: "shimmer", fallback: "fade" })`                                              | 只在 global 方案且浏览器不支持 `@property` 时生效；`svg` 降级需 `global` 变体的 JS，且 CSP 要放行 `img-src blob:`；JS 执行前（含 SSR 首屏）和 blob 生成失败时一律是 fade；降级分支在本机 Chrome 里只能模拟，`fallback: "fade"` 没测                                                                                                                                                             |
| `fit`                                    | 骨架自身绝不撑出滚动条：根高度限制在滚动祖先（没有则视口）的剩余空间内，完全落在外面的列表项 `display: none`                                                                                                                                                                       | `enable(el, { fit: true })`<br>`<skz-box loading fit>`                                             | 开启耗时贵：2000 张卡（16000 元素）约 520 ms（对照 61 ms），500 张约 48 ms；每帧很省（60 帧 / 3.31 ms）但 2000 项里 1994 项被隐藏；会写根的内联 `max-height` 和项的 `skz-fit-hide`；只在边界 / 窗口尺寸变化时重算，内容变了再调一次 `enable()`；SSR 里什么都不做；没有 `ResizeObserver` 时有滚动祖先只测一次                                                                                    |
| 重复调用 `enable()`                      | 幂等：按本次选项重新同步属性，重新扫描列表项、忽略区、主题变量                                                                                                                                                                                                                     | `enable(el, opts)` 多次                                                                            | 没传的选项会被清掉（不是合并）；开启后才插入的列表项、变化后的忽略区，要靠再调一次 `enable()` 纳入                                                                                                                                                                                                                                                                                              |
| **自动机制**                             |                                                                                                                                                                                                                                                                                    |                                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                 |
| 继承防火墙                               | 视口外的列表项打 `skz-fw`，CSS 把动画变量钉成静态值，它们的后代不再参与逐帧重算；16000 元素回到 60 帧                                                                                                                                                                              | 自动：`enable()` / 适配层 + `global` 变体，无需手写                                                | 只作用于 global 的 pulse / shimmer；需要 JS 与 `IntersectionObserver`（没有则跳过）；需要列表结构：从根往下跳过单子元素的包裹层，取第一个有多个子元素的层，不足 2 项不启用；双栏表单这类页面上等于没开，改用 `svg`；视口外的项里骨头静止，滚进前 200px 恢复；开启后新插入的项要再调 `enable()`；只引 `svg` 时不含防火墙<br>详见 [global](#global根驱动-pulse--shimmer)                          |
| 老浏览器 SVG 降级                        | 不支持 `@property` 时，JS 给根挂 blob 生成的 SVG 动画，颜色精确                                                                                                                                                                                                                    | 自动：引入 `global` + `enable()`；`fallback: "fade"` 可关掉                                        | 按 `CSS.supports("color", "rgb(from red r g b)")` 判断（Chrome 119+ / Safari 16.4+ / Firefox 128+），Chrome 85~118 被保守判为不支持；JS 执行前和 blob 失败时是 fade；严格 CSP 需 `img-src blob:`；降级路径没在真机验证                                                                                                                                                                          |
| 懒渲染（`skz-paused`）                   | `enable()` 开启的根滚出视口（含 100px 缓冲）时，CSS 移除它的动画，滚回来恢复；全库一个共享 `IntersectionObserver`                                                                                                                                                                  | 自动，无需配置                                                                                     | 只观察根：大根露一角就整体在动（`skz-cv` 补这个盲区）；没有 `IntersectionObserver` 时跳过；纯 HTML 手写的根没有这个机制                                                                                                                                                                                                                                                                         |
| 交互锁（`inert`）                        | `enable()` 给根加 `aria-busy="true"` 并设原生 `inert`；根里有 `skz-ignore` 时只锁不含忽略区的分支，忽略区保持可点、可聚焦                                                                                                                                                          | 自动                                                                                               | 忽略区有变化要再调一次 `enable()` 重新上锁；不支持 `inert` 的浏览器退回 CSS `pointer-events: none` + `focusin` 拦截（同样放过忽略区），该分支未在真机验证；纯 HTML 手写的根只有 CSS 层的 `pointer-events` / `user-select` 锁，没有 `inert`<br>详见 [`inert` 属性支持](#inert-属性支持)                                                                                                          |
| 减少动态效果                             | `prefers-reduced-motion: reduce` 时所有动画停止，骨头静止显示                                                                                                                                                                                                                      | 自动                                                                                               | 没有关闭开关，也不能只对某个根关掉                                                                                                                                                                                                                                                                                                                                                              |
| 自动推导骨头                             | 文字类标签（`p` `span` `h1`~`h6` `a` `li` `label` `td` `th` `strong` `b` `em` `small` `button` `dt` `dd` `blockquote` `figcaption`）、媒体与控件（`img` `video` `canvas` `picture` `iframe` `svg` `input` `textarea` `select`）、空的 `<i>` 和类名带 `icon` 的空元素，自动变成骨头 | 引入 `base.css`，根上加 `skz`                                                                      | `explicit.css` 里没有这一层；全是 div 的页面：div 里的文字由默认下划线模式覆盖，不用处理，但用 div 做的图片 / 头像 / 色块（空元素）不在范围内，要加 `skz-bone`；浏览器能力分四档渐进（见[浏览器支持与降级](#浏览器支持与降级)），图标识别、叶子模式需要 `:has()`                                                                                                                                |
| CSS 兜底层                               | 不支持 CSS 变量的老浏览器：根的直接子元素各一块灰，后代隐藏，静止                                                                                                                                                                                                                  | 引入 `base.css`，根上加 `skz`                                                                      | 粗糙；`video` / `canvas` / `iframe` 作直接子元素、`display: contents` 包装、裸文字、悬浮角标等有边界情况，详见[兜底层的边界情况](#兜底层的边界情况)                                                                                                                                                                                                                                             |
| **标记属性**                             |                                                                                                                                                                                                                                                                                    |                                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                 |
| `skz`                                    | 根：骨架开启                                                                                                                                                                                                                                                                       | `enable()` / 适配层自动加；纯 HTML：`<div skz>`                                                    | 是属性不是 class；`<skz-box>` 里写在宿主的第一个元素子节点上，宿主自己不带；纯 HTML 手写拿不到防火墙、运行时 SVG 和 `inert`                                                                                                                                                                                                                                                                     |
| `skz-effect`                             | 根：效果，值同 `effect` 选项                                                                                                                                                                                                                                                       | `<div skz skz-effect="shimmer">`                                                                   | 由 `enable()` 写入并在重复调用时按选项覆盖 / 清除；纯 HTML 手写 pulse / shimmer 没有防火墙，svg 方案没有运行时图（退回 fade）                                                                                                                                                                                                                                                                   |
| `skz-text`                               | 根：文字骨头画法，值同 `text` 选项                                                                                                                                                                                                                                                 | `<div skz skz-text="leaf">`                                                                        | 同 `text` 选项的限制                                                                                                                                                                                                                                                                                                                                                                            |
| `skz-engine`                             | 根：`svg`，SVG 方案的 blob 图挂上后由 JS 写入                                                                                                                                                                                                                                      | 不要手写                                                                                           | 没有这个属性就是基底 fade（svg 方案没有内置 SVG 兜底图）；读不到主题变量或不支持 blob 时 JS 不写                                                                                                                                                                                                                                                                                                |
| `skz-has-ignore`                         | 根：里面有 `skz-ignore`；CSS 据此关闭隐式 fade、修正下划线                                                                                                                                                                                                                         | `enable()` 自动加；纯 HTML 手写根时自己加                                                          | 手写时漏加会导致忽略区被 fade 一起淡掉、下划线沿祖先传给忽略区文字；下划线修正需 `:has()`（Tier 2）                                                                                                                                                                                                                                                                                             |
| `skz-cv`                                 | 根：直接子元素加 `content-visibility: auto`，滚出视口的子元素连样式、布局、绘制都跳过；`--skz-cv-size`（默认 `200px`）是未渲染子元素的估高                                                                                                                                         | `<div skz skz-cv>`<br>`<div skz skz-cv style="--skz-cv-size: 120px">`                              | 子元素溢出的部分被裁掉；估高不准时滚动会跳；开启慢约 3.5 倍（16000 元素 207 ms，对照 58 ms）；需浏览器支持 `content-visibility`<br>纯 CSS 无 JS：16000 元素 60 帧 / 6.76 ms（不加是 25 帧 / 35.3 ms）；叠加 `enable()` 反而更差（样式 6.63 ms + PrePaint 1.38 ms，对照 4.67 + 0.15）；有列表结构时优先用防火墙<br>详见 [懒渲染与 `skz-cv`](#懒渲染与-skz-cv)                                    |
| `skz-bone`                               | 元素：强制本元素当骨头（div 做的图片、头像、色块）                                                                                                                                                                                                                                 | `<div class="avatar" skz-bone></div>`                                                              | 骨头内部的后代被藏起来；`img` / `video` / `canvas` 骨头把真实内容推出盒子；圆角默认 `var(--skz-radius)`，元素自己写了 `border-radius` 则保留（依赖 `:where()`）；`explicit.css` 下它是唯一的骨头来源                                                                                                                                                                                            |
| `skz-leaf`                               | 元素：本元素整块当一个骨头，子树全藏                                                                                                                                                                                                                                               | `<div skz-leaf>…</div>`                                                                            | 子树的文字、下划线全部隐藏；圆角规则同 `skz-bone`                                                                                                                                                                                                                                                                                                                                               |
| `skz-ignore`                             | 元素：保持原样、可点击、可聚焦（如"取消加载"按钮）                                                                                                                                                                                                                                 | `<button skz-ignore>取消加载</button>`                                                             | 忽略区后代自带的背景在 Tier 0、1 仍会被清掉；依赖 `currentColor` 的边框 / outline / box-shadow 会露出来；绝对定位的悬浮角标不标它会被涂成一块灰；sweep 光带会扫到它<br>详见 [`skz-ignore` 区的颜色与背景](#skz-ignore-区的颜色与背景)                                                                                                                                                           |
| `skz-paused` / `skz-fw`                  | 运行时内部状态：懒渲染 / 继承防火墙                                                                                                                                                                                                                                                | 不要手写                                                                                           | 由 `enable()` 的共享观察器读写，手写会被覆盖                                                                                                                                                                                                                                                                                                                                                    |
| `skz-fit` / `skz-fit-hide`               | 运行时内部状态：`fit` 的根标记（CSS 兜底 `max-height: 100dvh` + `overflow: clip`）/ 被隐藏的列表项                                                                                                                                                                                 | 不要手写（用 `fit: true`）                                                                         | 由 `enable()` 写入、关闭时清除                                                                                                                                                                                                                                                                                                                                                                  |
| **主题变量**                             |                                                                                                                                                                                                                                                                                    |                                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--skz-color`                            | 骨头底色，默认 `#d9dde3`（深色 `#374151`）                                                                                                                                                                                                                                         | `[skz] { --skz-color: #e0e0e0 }`                                                                   | 变量声明在根自身上，要写在根元素上（内联 `style` 或命中根的选择器），写在 `:root` 上不生效                                                                                                                                                                                                                                                                                                      |
| `--skz-highlight`                        | 高光色：shimmer 光带 / pulse 亮端，默认 `#eceff3`（深色 `#4b5563`）                                                                                                                                                                                                                | `[skz] { --skz-highlight: #f0f0f0 }`                                                               | 同上；svg 方案的图由 JS 按它生成，改了之后要再调一次 `enable()` 才会重新生成                                                                                                                                                                                                                                                                                                                    |
| `--skz-radius`                           | 骨头圆角，默认 `4px`                                                                                                                                                                                                                                                               | `[skz] { --skz-radius: 6px }`                                                                      | 元素自己写了 `border-radius` 则以它为准；underline 模式的文字骨头没有圆角                                                                                                                                                                                                                                                                                                                       |
| `--skz-duration`                         | 动画时长，默认 `1.5s`                                                                                                                                                                                                                                                              | `[skz] { --skz-duration: 1.2s }`                                                                   | svg 方案按它生成图（读不出就用 1500 ms）；写在根上，不是 `:root`                                                                                                                                                                                                                                                                                                                                |
| `--skz-ul-thickness` / `--skz-ul-offset` | 下划线粗度（默认 `1em`）/ 偏移（默认 `-0.85em`）                                                                                                                                                                                                                                   | `[skz] { --skz-ul-thickness: 1.1em }`                                                              | 只对 underline 文字模式有效                                                                                                                                                                                                                                                                                                                                                                     |
| `--skz-fade-min`                         | fade 的最低不透明度，默认 `0.55`                                                                                                                                                                                                                                                   | `[skz] { --skz-fade-min: 0.4 }`                                                                    | 只影响 fade（含 pulse / shimmer 退回 fade 的情形）                                                                                                                                                                                                                                                                                                                                              |
| `--skz-sweep-w`                          | sweep 光带宽度，相对根宽，默认 `35%`                                                                                                                                                                                                                                               | `[skz] { --skz-sweep-w: 50% }`                                                                     | 要写在骨架根元素上；需 `sweep.css`                                                                                                                                                                                                                                                                                                                                                              |
| `--skz-sweep-skew`                       | sweep 光带倾斜角，默认 `0deg`（竖直）                                                                                                                                                                                                                                              | `[skz] { --skz-sweep-skew: -12deg }`                                                               | 根高超过约 16 倍根宽（1200px 宽约 19k px）时光带会移出视口，长列表别用；需 `sweep.css`                                                                                                                                                                                                                                                                                                          |
| `--skz-sweep-bg-rgb`                     | 深色主题下 sweep 的容器色（`r, g, b`），默认 `31, 41, 55`                                                                                                                                                                                                                          | `[skz] { --skz-sweep-bg-rgb: 17, 24, 39 }`                                                         | 取根里最亮的那种容器背景色；必须写在骨架根元素本身，写在祖先上会被 `[skz]` 的深色默认值盖掉；浅色模式不用它                                                                                                                                                                                                                                                                                     |
| 深色模式切换                             | 默认跟随 `prefers-color-scheme: dark`；也可在 `<html>` 上强制，影响 `--skz-color` / `--skz-highlight` 和 sweep 的深色参数                                                                                                                                                          | `<html data-skz-theme="dark">`<br>`<html data-skz-theme="light">`                                  | 属性要写在 `<html>` 上；svg 方案的图只在系统深浅色切换时自动重新生成，手动切 `data-skz-theme` 后要再调一次 `enable()`（按代码推断，未实测）                                                                                                                                                                                                                                                     |
| `--skz-svg-shimmer` / `--skz-svg-pulse`  | svg 方案的动画背景图（`url(…)`）                                                                                                                                                                                                                                                   | 一般不用写                                                                                         | 通过 `enable()` 时由 JS 写入根的内联样式，会盖掉你写的值；纯 HTML 手写 `skz-engine="svg"` 时可自己提供（未验证）                                                                                                                                                                                                                                                                                |
| 其余 `--skz-*`                           | `--skz-fill` / `--skz-bg-img` / `--skz-bg-pos` / `--skz-bg-size` / `--skz-pulse-c` / `--skz-shimmer-p` / `--skz-sweep-a` / `-rgb` / `-blend` / `-bleed` / `-mask` 等是样式内部变量                                                                                                 | 不要手写                                                                                           | 随版本可能变动，不属于公开契约                                                                                                                                                                                                                                                                                                                                                                  |
| **API**                                  |                                                                                                                                                                                                                                                                                    |                                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                 |
| `enable(el, opts?)`                      | 开启骨架：给根加 `skz`、`aria-busy="true"`、锁交互，返回关闭函数                                                                                                                                                                                                                   | `const off = enable(el, { effect: "shimmer" })`                                                    | 前提：入口处已引入基底样式和需要的变体；需要 DOM，不能在服务端调用；根里空元素没有尺寸、不出骨头；选项见上面「`enable()` 选项」                                                                                                                                                                                                                                                                 |
| `disable(el)`                            | 关闭骨架，恢复真实内容；没开启过什么都不做                                                                                                                                                                                                                                         | `disable(el)`（或调用 `enable()` 返回的 `off()`）                                                  | 会清掉 `skz`、`aria-busy`、`skz-effect`、`skz-text`、`skz-has-ignore` 以及 fit / 防火墙 / svg 留下的标记和内联样式                                                                                                                                                                                                                                                                              |
| `toggle(el, loading, opts?)`             | 按布尔值开 / 关，各适配层共用                                                                                                                                                                                                                                                      | 自己写：`loading ? enable(el) : disable(el)`                                                       | 没有从包入口导出（`skeletonizer` 的导出里没有它），只在适配层内部使用                                                                                                                                                                                                                                                                                                                           |
| `<skz-box>`                              | 自定义元素：`loading` 是开关，另有 `effect` / `text` / `fallback` / `engine` / `fit` 属性；骨架状态作用在它的第一个元素子节点上                                                                                                                                                    | `<skz-box loading effect="shimmer"><div class="card">…</div></skz-box>`<br>`el.loading = true`     | 先调一次 `defineSkzBox()`；light DOM、不用 shadow；`loading="false"` 视为关闭；不带 `MutationObserver`，框架把第一个子节点替换掉后要自己把 `loading` 关一下再开；宿主被移动到别的父节点后加载态自然保持；在 Vue 里要把它配成自定义元素                                                                                                                                                          |
| `defineSkzBox(tag?)`                     | 注册 `<skz-box>`，可改标签名                                                                                                                                                                                                                                                       | `defineSkzBox()`                                                                                   | 重复调用安全；没有 `customElements` 的环境（SSR）什么都不做                                                                                                                                                                                                                                                                                                                                     |
| `registerCustomElements(root?, opts?)`   | 给 Web Component 宿主（Shadow DOM）生成骨架样式表，返回 `{ refresh, dispose }`                                                                                                                                                                                                     | `const { refresh, dispose } = registerCustomElements(document, { watch: true })`                   | 宿主被 `visibility: hidden` + `::before` 铺骨头，宿主自己的背景色也会被藏掉；新增的自定义元素要 `refresh()` 或开 `watch`；`opts.tags` 可补充标签名；每次调用各持一张样式表，`dispose` 只清自己的；跳过 `<skz-box>` 自己<br>详见 [Web Component 宿主](#web-component-宿主)                                                                                                                       |
| `registerExtension(ext)` / `ROOT_ATTR`   | 注册方案扩展（`global` / `svg` 入口加载时自动调用）/ 根标记属性名常量（`"skz"`）                                                                                                                                                                                                   | 一般不需要手动调用                                                                                 | 面向变体入口的内部扩展点；同名重复注册以后者为准                                                                                                                                                                                                                                                                                                                                                |
| Vue：`vSkeleton` / `SkzPlugin`           | 指令 / 插件（全局注册 `v-skeleton` 与 `<SkzBox>`）                                                                                                                                                                                                                                 | `<div v-skeleton="{ loading, effect: 'shimmer' }">`<br>`app.use(SkzPlugin)`                        | `import … from "skeletonizer/vue"`；Vue ≥ 3（可选 peer 依赖）；值可以是布尔，也可以是带 `loading` 的对象                                                                                                                                                                                                                                                                                        |
| Vue：`SkzBox` / `useSkeleton`            | 组件 / 组合式                                                                                                                                                                                                                                                                      | `<SkzBox :loading="loading" effect="shimmer">…</SkzBox>`<br>`useSkeleton(elRef, loadingRef, opts)` | 模板里写 `<SkzBox>`，写成 `<skz>` 会解析成原生自定义元素；`SkzBox` 有 `as` 属性（默认 `div`）；`useSkeleton` 的 `opts` 不是响应式的，只在 `loading` 变化时同步                                                                                                                                                                                                                                  |
| React：`SkzBox`                          | 组件：渲染一个包裹元素并按 `loading` 开关骨架                                                                                                                                                                                                                                      | `<SkzBox loading={loading} effect="shimmer">…</SkzBox>`                                            | `import … from "skeletonizer/react"`；React ≥ 16.8（可选 peer 依赖）；只透传 `className`，`as` 默认 `div`，其余 props 都当骨架选项                                                                                                                                                                                                                                                              |
| React：`useSkeleton`                     | Hook：`loading` 为真时开启，变假或卸载时关闭                                                                                                                                                                                                                                       | `useSkeleton(ref, loading, { effect: "pulse" })`                                                   | `opts` 里的字段请传原始值（字段变化时重新同步）；ref 指向的元素要已挂载                                                                                                                                                                                                                                                                                                                         |
| Svelte：`skeleton`                       | action                                                                                                                                                                                                                                                                             | `<div use:skeleton={{ loading, effect: "shimmer" }}>…</div>`                                       | `import { skeleton } from "skeletonizer/svelte"`；只有 action，没有组件，包里没声明 svelte 依赖                                                                                                                                                                                                                                                                                                 |
| `Bone.text(n, opts?)`                    | 生成 n 个字符的方块词占位文本，词间空格，可自然换行                                                                                                                                                                                                                                | `Bone.text(8)`<br>`Bone.text(30, { seed: 1 })`                                                     | 确定性（不用 `Math.random`，SSR / 水合安全）；`seed` 改变词长分布；`n <= 0` 返回空串                                                                                                                                                                                                                                                                                                            |
| `Bone.lines(k, opts?)`                   | 约 k 行的占位段落                                                                                                                                                                                                                                                                  | `Bone.lines(3, { perLine: 30 })`                                                                   | `perLine`（默认 40）只是每行预估字符数，实际行数取决于容器宽度                                                                                                                                                                                                                                                                                                                                  |
| `Bone.cjk(n, opts?)`                     | 中日韩文本占位：纯方块，每隔 3~6 个字符放一个零宽空格用于断行                                                                                                                                                                                                                      | `Bone.cjk(20)`                                                                                     | `n` 不含零宽空格                                                                                                                                                                                                                                                                                                                                                                                |
| `Bone.number(digits?)`                   | 固定位数的数字占位（全宽方块）                                                                                                                                                                                                                                                     | `Bone.number(4)`                                                                                   | 默认 3 位                                                                                                                                                                                                                                                                                                                                                                                       |
| `Bone.image(w?, h?)`                     | 透明占位图：不传 = 1×1 GIF data URI；传 `w` = 方形透明 SVG；传 `w`、`h` = 带固有宽高比的透明 SVG                                                                                                                                                                                   | `Bone.image(48)`<br>`Bone.image(160, 100)`                                                         | 不传参的 GIF 没有固有宽高，要用 `width` / `height` 或 CSS 给尺寸；参数非法（0、负数）退回 1px GIF；严格 CSP 不放行 `img-src data:` 时请改用自托管的透明图                                                                                                                                                                                                                                       |
| `Bone.GIF_1PX`                           | 1×1 透明 GIF 的 data URI 常量                                                                                                                                                                                                                                                      | `img.src = Bone.GIF_1PX`                                                                           | 同上；`Bone` 只有静态成员，不能 `new`（会抛 `TypeError`）                                                                                                                                                                                                                                                                                                                                       |

## 方案怎么选

| 场景                                                             | 推荐组合                                                                            | 理由（数据见[方案对比](#方案对比)）                                                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 一般页面，骨架不大（几百个元素以内）                             | `base.css` + 默认 fade                                                              | fade 4000 / 16000 元素都是 60 帧、样式重算不到 0.3 ms；小骨架下所有方案都是 60 帧                                                                                |
| 长列表、信息流、表格要 shimmer / pulse                           | `base.css` + `global`（`enable()` 自动带继承防火墙）                                | 16000 元素 60 帧、样式重算约 4.9 ms；同样的骨架纯 CSS（无 JS）只有约 21 帧、41 ms                                                                                |
| 同上，且骨头位置可以逐个标记，想要更低开销                       | `explicit.css` + `global`                                                           | **帧率没有差别**（都是 60 帧），只是更省：16000 元素样式重算 4.89 → 2.60 ms，开启 62 → 50 ms                                                                     |
| 没有列表结构的大骨架（大表单、长详情页）要 shimmer / pulse       | `engine: "svg"`（或只引 `skeletonizer/svg`）                                        | 防火墙找不到列表项就帮不上忙：双栏表单 16003 元素 global 只有 17 帧 / 49 ms，svg 是 60 帧 / 0.04 ms                                                              |
| 纯 CSS、不想引 JS 的大骨架                                       | 根上写 `skz-cv`                                                                     | 16000 元素 60 帧 / 6.8 ms（同条件不加是 25 帧 / 35 ms）；叠加 `enable()` 反而更差，开启慢约 3.5 倍，还会裁掉溢出内容                                             |
| 要合成器动画、主线程长任务期间动画也不停                         | `sweep.css`                                                                         | 光带是 `transform` 平移，16000 元素 60 帧、样式重算 0.7 ms。视觉取舍：浅色只提亮骨头，深色是容器色扫光（骨头被压暗成扫过的暗影），见 [sweep](#sweep扫光条纯-css) |
| 老浏览器（Chrome < 119 / Safari < 16.4 / Firefox < 128）也要动画 | `global`（自动降级为 SVG 动画）或直接用 `svg`                                       | SVG 动画不依赖 `@property`                                                                                                                                       |
| 产品指定老浏览器里的效果                                         | `global` + `fallback`（`svg` / `fade`）                                             | 只在不支持 `@property` 时生效                                                                                                                                    |
| 放量占位列表，不想让骨架撑出滚动条                               | `enable(el, { fit: true })`                                                         | 16000 元素 60 帧、样式重算 3.3 ms；代价是开启耗时约 520 ms（2000 张卡）                                                                                          |
| 设计稿要求精确决定哪些元素出骨头                                 | `explicit.css`                                                                      | 只有 `skz-bone` / `skz-leaf` 是骨头，其余原样显示                                                                                                                |
| 包体敏感、只要一种效果                                           | `base.css`（只 fade，1.28 KB）或 `base.css` + 单一变体                              | 变体按需加载                                                                                                                                                     |
| SSR / Node / 无打包器                                            | 核心 + `/js` 变体 + `.css` 子路径                                                   | 带 CSS 的入口需要打包器                                                                                                                                          |
| 严格 CSP                                                         | 放行 `img-src blob:`（svg 方案与老浏览器 SVG 降级）；`data:` 只有 `Bone.image` 需要 | 运行时 SVG 走 blob URL，CSS 里不再内置任何 SVG data URI                                                                                                          |
| 快速原型、不在乎体积                                             | `skeletonizer/all`                                                                  | 一次全部引入                                                                                                                                                     |

> 「要合成器动画、主线程长任务期间动画也不停」这条是按 `transform` 动画走合成器线程的机制推出来的，没有单独测过主线程长任务期间的表现。

## 方案对比

### 性能

数据全部来自[全量性能矩阵（控制变量版）](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/reports/2026-10-09-benchmark-matrix.md)和其中 sweep 修复后的补测。每格是"帧率 / 每帧样式重算 ms"，16.6 ms 是一帧预算；卡片列表每张 8 个元素（4000 元素 = 500 张，16000 = 2000 张），文字为下划线模式。

| 方案（引入）                                         | 4000 元素：帧率 / 样式重算 | 16000 元素：帧率 / 样式重算 | 开启耗时（4000 / 16000） |
| ---------------------------------------------------- | -------------------------- | --------------------------- | ------------------------ |
| fade（`base.css`，默认）                             | 60.4 / 0.10                | 60.4 / 0.24                 | 24 / 76 ms               |
| solid（`base.css`）                                  | 60.8 / 0.00                | 60.8 / 0.00                 | 22 / 69 ms               |
| sweep，浅色（`sweep.css`，lighten 混合）             | 60.0 / 0.24                | 60.4 / 0.67                 | 16 / 63 ms               |
| sweep，深色（容器色）                                | 60.4 / 0.60                | 60.4 / 0.61                 | 16 / 63 ms               |
| shimmer，`global` **纯 CSS 无 JS**                   | 60.0 / 9.90                | 20.8 / 41.3                 | 15 / 80 ms               |
| shimmer，`global` + `enable()`（防火墙）             | 60.4 / 1.75                | **60.4 / 4.89**             | 15 / 63 ms               |
| shimmer，`explicit.css` + `global` + `enable()`      | 60.4 / 1.14                | **60.4 / 2.60**             | 16 / 50 ms               |
| shimmer，`svg`                                       | 60.4 / 0.07                | **60.4 / 0.05**             | 27 / 111 ms              |
| 无列表结构页（双栏表单）：shimmer，`global` + 防火墙 | 52.4 / 14.7                | 17.2 / 49.1                 | 21 / 84 ms               |
| 无列表结构页（双栏表单）：shimmer，`svg`             | 60.4 / 0.05                | **60.4 / 0.04**             | 32 / 134 ms              |
| `fit: true`（shimmer，`global` + `enable()`）        | —                          | 60.4 / 3.31                 | — / 519 ms               |
| `skz-cv`（shimmer，`global` 纯 CSS）                 | 60.4 / 2.12                | 60.4 / 6.76                 | 13 / 207 ms              |

**测试条件**：Windows 10 桌面，Intel Core i5-13500（14 核 20 线程）+ Intel UHD 770 集显，31.7 GB 内存；Chrome 154.0.8037.98，独立用户目录、前台窗口，视口 1200×800、DPR 1；`pnpm build` 的正式构建（`dist/` 原样加载，基线 f735d65），同一份卡片列表模板；每格 3 次 trace 取中位数。测试机是日常工作机，**CPU 不是空闲状态**：批内 CPU 均值 17%~27%（含 Chrome 自己的占用）；只有一遍正向、没做反向复测，差距在 2 倍以内的结论别当真。

- fade / solid 取自 A 组；shimmer 前四行取自 B 组（同一批）；双栏表单两行取自 D 组；`fit`（E1）、`skz-cv`（E3）取自 E 组，同组对照是 `global` + `enable()` 的 16000 元素 4.67 ms、纯 CSS 的 25.2 帧 / 35.3 ms。不同组不在同一批里测，跨组比较留有余量。
- sweep 两行是**修复后**的数据：旧版光带在根高超过约 19~20k px 时看不见，原矩阵里那几行测的是看不见的动画（原数在报告里保留并已标注）。合并后每帧另有 PrePaint 约 5~6 ms、GPU 约 1.4~2.2 ms（16000 元素）；开启耗时沿用原矩阵 A3，没为合并版重测。
- 纯 CSS 16000 元素的帧率在不同批里相差较大（13~25 帧，负载越高越低）；表中取 B 组的 20.8 帧。
- 开启耗时是真实 `enable()`（含防火墙、inert、blob），纯 CSS 行量的是切 `skz` 属性。svg 开启耗时在 A 组里有一次 287 ms 的单次异常，没重测。

**没测**：低端机 / CPU 降速（4× 降速那组没跑，没有数据）；Safari、Firefox、移动端；DPR > 1；删除 `fps` 计时器后没有重跑全量矩阵（只重跑了 sweep；被删的代码不在上表任何一行的路径上，但没有逐行复测）。

要点：

- **默认 fade 无论多大都是 60 帧**，开启成本只有一次样式计算。
- **pulse / shimmer 的成本在样式重算**：根上的动画变量每帧变化，继承它的每个元素都要重算。纯 CSS 下 16000 元素只有约 21 帧。
- **继承防火墙**是最大的一项优化：视口外的列表项不参与重算，16000 元素回到 60 帧，开启耗时和纯 CSS 基本一致。它需要 JS（`enable()` / 适配层 + `global` 变体）和列表结构；双栏表单这类"根下只有几个大块、且都在视口里"的页面上防火墙等于没开。
- **`explicit.css`** 去掉推导选择器，每个元素的重算更便宜：防火墙路径样式重算降 35%~47%，纯 CSS 路径帧率 20.8 → 34.4；但防火墙路径两者都是 60 帧。
- **svg 方案**每帧样式重算接近 0，所有结构下都是 60 帧，代价是 PrePaint 4.7~8 ms（16000 元素）和更贵的开启耗时。
- **sweep** 是合成器动画，样式重算很低，代价是固定的 PrePaint / GPU 开销，以及对根元素的样式副作用。

### 颜色、兼容性与代价

| 方案             | 颜色                                          | 浏览器要求                                                                                       | 需要 JS           | 主要代价                                                                                 |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------- |
| fade / solid     | 精确（主题变量）                              | 支持 CSS 变量                                                                                    | 否                | fade 会把根里的一切一起淡入淡出                                                          |
| sweep            | 浅色混合提亮 / 深色容器色扫光                 | 支持 CSS 变量与 `mix-blend-mode`                                                                 | 否                | 根被设为 `position: relative` + `overflow-x: clip`，占用根的 `::after`，忽略区也会被扫到 |
| global（根驱动） | 精确                                          | `@property`（按相对颜色语法判断：Chrome 119+ / Safari 16.4+ / Firefox 128+），否则自动降级为 SVG | 否；防火墙要 JS   | 纯 CSS 时大骨架慢；iOS 上 shimmer 改为颜色脉冲（无 fixed 背景）                          |
| svg              | 通过 JS：精确（运行时生成）；无 JS：退回 fade | SMIL（所有现代浏览器及多数老浏览器）                                                             | 否；精确颜色要 JS | 下划线文字静止；CSP 需 `img-src blob:`；iOS 上 shimmer 改为 pulse                        |
| 显式标记         | —                                             | 同基底                                                                                           | 否                | 每个骨头都要手动标 `skz-bone`                                                            |

### 实验过但没有采用的方案

| 方案                                     | 结论       | 原因                                                                                                                                                                                                    |
| ---------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SVG 滤镜把内容剪影成骨头                 | 不采用     | 16000 元素 60 帧，但文字只是字形剪影、卡片结构和浅色内容丢失、深色主题更差、`skz-ignore` 原理上无法生效                                                                                                 |
| canvas 静态遮罩 + 合成器光带             | 不采用     | 每帧主线程为 0、颜色精确，但生成遮罩一次要 4~7 秒（16000 元素）                                                                                                                                         |
| CSS Paint API（Houdini）                 | 不采用     | 能在主线程外运行，但 worklet 和 GPU 更重，且只有 Chromium                                                                                                                                               |
| 每个骨头各挂一个动画（旧方案）           | 已移除     | 被 `!important` 颜色压住，pulse 看不出效果却照样耗时；备份在 `archive/2026-10-08-element-anim/`                                                                                                         |
| `content-visibility`（`skz-cv`）         | 保留为可选 | 长列表每帧开销低，但子元素多时开启慢约 3 倍、会裁掉溢出内容；有列表结构时防火墙更优                                                                                                                     |
| fps JS 计时器（`fps` 选项）              | 已删除     | 真实页面里防火墙总是先启用，计时器几乎走不到；强制走到时 16000 元素 45 帧 / 10.8 ms，仍不如 svg 的 60 帧 / 0.04 ms                                                                                      |
| `steps()` 降帧（`--skz-shimmer-timing`） | 已删除     | 16000 元素 25.2 帧 / 35.6 ms 对 25.2 帧 / 35.3 ms，没有差别                                                                                                                                             |
| 只给可见项挂动画（方案 A）               | 未采用     | 原型可行：2000 张卡样式重算降到 0.7~1.2 ms；但这台机器上防火墙已经 60 帧，只有 CPU 4×/6× 降速时才拉开，还带来"漏项就静止"等新风险，Safari / Firefox 没验证；原型与数据见 `bench/agents/a6-visible-anim` |

详细数据与过程见 [`bench/`](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/bench/README.md) 下各子代理目录的 `NOTES.md`。

## 各方案详解

### fade / solid（基底自带）

- **fade**（默认，不写 `skz-effect` 就是它）：根整体做 opacity 脉冲，跑在合成器线程，几乎零成本，元素再多也不卡。根里有 `skz-ignore` 时，隐式默认不开 fade（否则会把忽略区一起淡掉）；想强制开就显式写 `effect: "fade"`。
- **solid**：静止，没有动画。

### global：根驱动 pulse / shimmer

```ts
import "skeletonizer/global"; // 或 /global/js + global.css
enable(el, { effect: "shimmer" }); // 或 "pulse"
```

- **原理**：根上一个 CSS 动画驱动用 `@property` 注册的变量（流光位置、脉冲颜色），骨头只读继承下来的值，自己不挂动画。颜色取自 `--skz-color` / `--skz-highlight`，精确跟主题走。
- **shimmer**：流光用 `background-attachment: fixed` 的渐变在视口坐标里平移，各骨头同步；下划线模式的文字没法渐变，改为颜色脉冲。
- **继承防火墙（自动）**：通过 `enable()` / 适配层开启时，库从根往下找列表项（自动跳过只有一个子元素的包裹层，"根 > 列表容器 > 卡片"会命中卡片），用一个共享的 `IntersectionObserver` 给视口外的项打 `skz-fw`，CSS 在这些项上把动画变量钉成静态值，它们的后代就不再参与逐帧重算。视口外项里的骨头是静止的，滚进视口前 200px 恢复；开启后才插入的新项要等下次调用 `enable()` 才纳入（期间照常动画，只是没省下开销）。
- **老浏览器降级**：不支持 `@property` 时，JS 默认改挂 SVG 动画（blob 生成，颜色精确），`fallback: "fade"` 可改为保持基底 fade；JS 执行前（含 SSR 首屏）和 blob 生成失败时，老浏览器显示 fade。

### svg：共享 SVG 动画背景

```ts
import "skeletonizer/svg"; // 只引入 svg 时，pulse / shimmer 默认就走 svg
enable(el, { effect: "shimmer" }); // 同时引入了 global 时写 engine: "svg"
```

- **原理**：骨头背景叠一张带 SMIL 动画的 SVG，所有骨头共用这一张图，CSS 每帧不变，没有样式重算；不依赖 `@property`。
- **颜色**：通过 `enable()` 开启时，按根上的 `--skz-highlight` 和 `--skz-duration` 现生成 SVG（blob URL），颜色和时长与主题完全一致；同参数共用一份，没人用时释放；系统深浅色切换时自动重新生成。没有 JS 或读不到主题变量时，根上不会有 `skz-engine` 属性，显示基底的 fade（CSS 里不再内置 SVG 兜底图）。通过 `enable()` 开启时，这两张图以内联变量 `--skz-svg-shimmer` / `--skz-svg-pulse` 写在根上；纯 HTML 手写 `skz-engine="svg"` 时可以自己提供这两个变量（未验证）。
- **代价**：下划线文字无法贴图，保持静止（叶子模式没有这个问题）；严格 CSP 需放行 `img-src blob:`（运行时图）；iOS 不支持 fixed 背景，shimmer 改用 pulse 图。

### sweep：扫光条（纯 CSS）

```ts
import "skeletonizer/sweep.css";
enable(el, { effect: "sweep" });
```

整个根一个 `::after` 扫光条，`transform` 平移，跑在合成器线程；光带默认竖直（`--skz-sweep-skew` 可选倾斜，长根慎用）。只有一种 sweep，按主题自动切换：浅色用 lighten 混合，只提亮骨头；深色自动用容器色扫光（光带色取 `--skz-sweep-bg-rgb`，默认 `31, 41, 55`），容器不漏光。它会改根元素自身的样式：

- 根被设成 `position: relative`，根内绝对定位的后代会改以根为参照；
- 根被加上 `overflow-x: clip`，伸出根左右边界的下拉框、角标会被裁掉；
- 根的 `::after` 被占用，业务写在根上的 `::after` 会被覆盖。

建议给 sweep 单独包一层不带业务样式的 div 当根。换了深色主题的容器色，就覆盖根上的 `--skz-sweep-bg-rgb`（取根里最亮的那种容器背景色）。注意必须写在骨架根元素本身，写在祖先上会被 `[skz]` 的深色默认值盖掉。

### 显式标记：`explicit.css`

```ts
import "skeletonizer/explicit.css"; // 代替 base.css
```

```html
<div skz>
  <img skz-bone src="..." />
  <h3 skz-bone>标题</h3>
  <p>这段不会变成骨头，原样显示</p>
</div>
```

只有 `skz-bone` / `skz-leaf` 是骨头，骨头内部的后代藏起来，媒体骨头把真实内容推出盒子。不含任何推导选择器，所以每帧样式重算和开启都更快（见[对比](#方案对比)）。骨头圆角默认 `var(--skz-radius)`，但元素自己写了 `border-radius`（如圆形头像）会保留它的形状。

### 懒渲染与 `skz-cv`

懒渲染只观察根：根很大、只露一角在视口里时，整个根的动画都在跑。`skz-cv` 补这个盲区，让根的直接子元素在视口外时整个跳过渲染；但它和 `enable()`（继承防火墙）叠加反而更差，有列表结构时优先用防火墙。两者的触发条件、代价和数据见[功能总表](#功能总表)的「懒渲染」和「`skz-cv`」两行。

## Bone 工具

`Bone` 类提供静态方法来生成占位数据，所有结果都是确定性的（不用 `Math.random`），SSR 时同样的输入永远得到同样的输出，天然支持水合。

### 文字占位

```js
Bone.text(n, { seed });
```

生成 n 个字符的占位文本，词与词之间用空格，可以自然换行。`seed` 参数用来改变词长分布（默认 0）。

```js
Bone.text(12); // "███ ████ ███"（词长为示意）
Bone.text(30, { seed: 1 }); // 相同的 seed 永远得到相同的分布
```

### 段落占位

```js
Bone.lines(k, { perLine, seed });
```

生成大约 k 行的占位段落。`perLine` 是每行预估字符数（默认 40）。

```js
Bone.lines(3); // 120 个字符（3 × 40）的占位文本
Bone.lines(3, { perLine: 30 }); // 90 个字符
```

### 中日韩文本占位

```js
Bone.cjk(n, { seed });
```

生成中日韩文本的占位串：纯方块，每隔 3~6 个字符放一个零宽空格用于断行。

```js
Bone.cjk(20); // 20 个方块，带合理的断点
```

### 数字占位

```js
Bone.number(digits);
```

生成固定位数的数字占位（全宽方块）。

```js
Bone.number(4); // "████"（4 位）
Bone.number(); // "███"（默认 3 位）
```

### 图片占位

`Bone.image(w?, h?)` 按参数个数走三种形态：

```js
Bone.image(); // 不传：1×1 透明 GIF 的 base64 data URI，兼容性最好
Bone.image(48); // 只传 w：h 默认等于 w，48×48 的方形透明 SVG
Bone.image(160, 100); // 传 w、h：160×100 的透明 SVG，带固有宽高比
```

- **不传参**：GIF 没有固有宽高，要用 `width` / `height` 属性或 CSS 指定尺寸，否则会塌成 1px。
  `<img :src="Bone.image()" width="160" height="100" />`
- **传尺寸**：SVG 自带宽高比，不容易引起布局跳动，头像、图标用 `Bone.image(48)` 最顺手。
- 参数非法（0、负数）会退回 1px GIF。

**注意：** 严格 CSP 若不放行 `img-src data:`，请改用自托管的透明图。

## 主题

### 文字骨头模式

- **`underline`**（默认，需 `text-decoration-thickness`）：在真实文字下面画一条粗下划线，沿真实文字行延伸，最后一行自然变短，混合文字（`价格：<b>¥5</b>`）也覆盖。代价是不能渐变，shimmer 时文字改为颜色脉冲。
- **`leaf`**（需 `:has()`）：没有子元素、但有文字的元素整块变成骨头，可以 shimmer、有圆角。代价是多行块级文字会变成一整块矩形，混合文字里的裸文字节点不出骨头。

```html
<div skz skz-text="leaf">...</div>
```

### 自定义颜色、圆角、时长

主题变量声明在根元素自身上，所以要**写在根元素上**（内联 `style` 或命中根的选择器），写在 `:root` 上不生效：

```css
[skz] {
  --skz-color: #e0e0e0; /* 骨头色（默认 #d9dde3，深色 #374151） */
  --skz-highlight: #f0f0f0; /* 高光色：shimmer 光带、pulse 亮端（默认 #eceff3，深色 #4b5563） */
  --skz-radius: 6px; /* 骨头圆角（默认 4px） */
  --skz-duration: 1.2s; /* 动画时长（默认 1.5s） */
  --skz-ul-thickness: 1em; /* 下划线粗度 */
  --skz-ul-offset: -0.85em; /* 下划线偏移 */
}
```

深色模式切换（`prefers-color-scheme` / `data-skz-theme`）、sweep 与 fit 的变量、减少动态效果等见[功能总表](#功能总表)的「主题变量」和「自动机制」。

## 浏览器支持与降级

样式分档渐进增强，浏览器自动取其所能，不嗅探 UA：

| 浏览器能力                        | 得到什么                                                           |
| --------------------------------- | ------------------------------------------------------------------ |
| 无 CSS 变量                       | 兜底：根的直接子元素各一块灰，后代隐藏，静止                       |
| CSS 变量                          | 第 0 档：标签白名单骨头、fade / solid / sweep、svg 方案            |
| `text-decoration-thickness`       | 第 1 档：下划线法文字骨头                                          |
| `:has()`                          | 第 2 档：叶子模式、图标识别、忽略区下划线修正                      |
| `@property`（借相对颜色语法判断） | global 方案的根驱动 pulse / shimmer；否则默认降级为 SVG 动画       |
| `:where()`                        | 骨头圆角让位于元素自己的 `border-radius`；不支持时骨头没有默认圆角 |
| `IntersectionObserver`            | 懒渲染、继承防火墙；不支持时跳过（仍有动画，只是没有优化）         |
| iOS Safari（无 fixed 背景）       | shimmer 改为颜色脉冲（global）或 pulse 图（svg）                   |

**验证状态**：桌面 Chrome 全部实测；Safari、Firefox、iOS、Android WebView、旧浏览器**未实测**，降级路径只在 Chrome 里用"把检测条件改成必然不成立"的方式模拟验证过。

## 已知限制与使用约束

### 兜底层的边界情况

这些是兜底层（仅 `base.scss`）的限制，Tier 0 以上可能部分改善或完全解决：

1. **`video` / `canvas` / `iframe` 作根的直接子元素**：真实内容仍会盖在灰块上。解决方案：自己包一层 `div`。

   ```html
   <!-- ❌ 不行 -->
   <div skz>
     <video width="160" height="100"></video>
   </div>

   <!-- ✅ 要这样 -->
   <div skz>
     <div><video width="160" height="100"></video></div>
   </div>
   ```

2. **`display: contents` 包装**：没有盒子涂不上色，后代又被 `visibility:hidden` 藏起来，那块会变成**空白**。

   ```html
   <!-- ❌ 不行 -->
   <div skz>
     <div style="display:contents">
       <p>段落一</p>
       <p>段落二</p>
     </div>
   </div>

   <!-- ✅ 用普通 div 包装 -->
   <div skz>
     <div>
       <p>段落一</p>
       <p>段落二</p>
     </div>
   </div>
   ```

3. **裸文字**：直接放在根下的裸文字节点不会被藏起来，会露出真实文字。

   ```html
   <!-- ❌ 不行 -->
   <div skz>这是裸文字，会露出来</div>

   <!-- ✅ 用 span 或其他元素包住 -->
   <div skz>
     <p>这是段落，会被处理</p>
   </div>
   ```

4. **绝对定位的悬浮角标**：会被涂成一块灰。需要保持原样就标 `skz-ignore`。

   ```html
   <div skz style="position:relative;">
     <span class="badge" skz-ignore style="position:absolute;right:0;top:0;">new</span>
     <div>卡片内容</div>
   </div>
   ```

5. **icon-font 星标**（Tier 0）：icon-font 的字形会露出来。Tier 2 有启发式规则识别图标，改善这个问题。

### `skz-ignore` 区的颜色与背景

骨架藏文字用的是 `-webkit-text-fill-color`，不动 `color`，所以 `skz-ignore` 区及其后代的文字色在各档都保持原样。剩下几点要注意：

- 忽略区后代自带的**背景**在 Tier 0、1 仍会被清掉，Tier 2 的叶子背景模式才精确保留。
- 骨架里容器上依赖 `currentColor` 的边框 / outline / box-shadow 会露出来；不想要就给它们写明确的颜色，或在骨架态下单独处理。
- 仅兜底层（不支持 CSS 变量的老浏览器）里，忽略区没写颜色时仍会继承到透明。

### Web Component 宿主

Web Component 宿主（Shadow DOM）的处理：需要调用 `registerCustomElements()` 才能生成宿主样式表。

```js
import { registerCustomElements } from "skeletonizer";

// 生成宿主样式表（adoptedStyleSheets 或降级 <style>）
const { refresh, dispose } = registerCustomElements(document, { watch: true });
// 如果后来新增了自定义元素，调用 refresh() 重扫
refresh();
```

宿主会被 `visibility:hidden` + `::before` 伪元素铺骨头，宿主自己的背景色也会被 `visibility` 藏掉。

### `inert` 属性支持

`enable()` 默认用原生 `inert` 锁定交互。根里有 `skz-ignore` 时不锁整个根，只锁不含忽略区的分支，忽略区保持可点击、可聚焦（开启后忽略区有变化，再调一次 `enable()` 即可重新上锁）。不支持 `inert` 的浏览器会降级到 CSS `pointer-events:none` + `focusin` 事件拦截（同样放过忽略区），但该降级分支未在真机验证过。

## 在框架里怎么用

skeletonizer 是标准 Web Component / ESM。Vue / React / Svelte 另有开箱即用的适配层（见上文「框架适配」，子路径 `skeletonizer/vue` 等）；下面是不用适配层、直接接入的写法。

无论哪种写法，都要在应用入口按[选择入口](#选择入口)引入一次基底样式和需要的变体，例如 `import "skeletonizer/base.css"; import "skeletonizer/global";`。适配层和直接调用 `enable()` 共用同一个核心，变体导入一次全局生效。

### Vue 3

用 `isCustomElement` 让 Vue 不去处理 `skz-box` 标签（用适配层的 `<SkzBox>` 组件则不需要这一步）：

```js
// vite.config.js
export default {
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === "skz-box",
        },
      },
    }),
  ],
};
```

在模板里直接用：

```vue
<template>
  <skz-box :loading="isLoading" effect="pulse">
    <div class="card">
      <h3>{{ user.name }}</h3>
      <p>{{ user.bio }}</p>
    </div>
  </skz-box>
</template>

<script setup>
import { defineSkzBox } from "skeletonizer";

defineSkzBox();

const isLoading = ref(true);
const user = ref({ name: "", bio: "" });

onMounted(async () => {
  const data = await fetchUser();
  user.value = data;
  isLoading.value = false;
});
</script>
```

### React 18+

React 18 原生支持自定义元素属性为字符串，直接用：

```jsx
import { defineSkzBox } from "skeletonizer";

defineSkzBox();

export function CardSkeleton({ isLoading, user }) {
  return (
    <skz-box loading={isLoading} effect="pulse" text="underline">
      <div className="card">
        <h3>{user.name}</h3>
        <p>{user.bio}</p>
      </div>
    </skz-box>
  );
}
```

如果在 React 17 或需要更细的控制，用 `enable()` / `disable()`：

```jsx
import { useEffect, useRef } from "react";
import { enable, disable } from "skeletonizer";

export function CardSkeleton({ isLoading, user }) {
  const ref = useRef(null);

  useEffect(() => {
    if (isLoading) {
      const off = enable(ref.current, { effect: "pulse" });
      return () => off();
    } else {
      disable(ref.current);
    }
  }, [isLoading]);

  return (
    <div ref={ref}>
      <div className="card">
        <h3>{user.name}</h3>
        <p>{user.bio}</p>
      </div>
    </div>
  );
}
```

### Svelte

Svelte 直接支持自定义元素：

```svelte
<script>
  import { defineSkzBox } from 'skeletonizer';
  import { onMount } from 'svelte';

  defineSkzBox();

  let isLoading = true;
  let user = { name: '', bio: '' };

  onMount(async () => {
    user = await fetchUser();
    isLoading = false;
  });
</script>

<skz-box loading={isLoading} effect="pulse" text="underline">
  <div class="card">
    <h3>{user.name}</h3>
    <p>{user.bio}</p>
  </div>
</skz-box>
```

或用适配层的 action `use:skeleton`：

```svelte
<script>
  import { skeleton } from 'skeletonizer/svelte';

  let isLoading = true;
</script>

<div use:skeleton={{ loading: isLoading, effect: 'pulse' }}>
  <div class="card"><!-- 内容 --></div>
</div>
```

## 给 AI 编码助手

编码助手不会自动读取 `node_modules` 里的文档。把下面这段贴进你项目的 `AGENTS.md` / `CLAUDE.md`，它写骨架屏时就一定会先看用法：

```md
## 骨架屏

加载态统一用 skeletonizer。写之前先读 `node_modules/skeletonizer/llms.md` 并照做。
```

## 开发与实验存档

```sh
pnpm dev     # demo（http://localhost:5188/demo/index.html），可切效果、方案、档位、深色
pnpm build   # vp pack：多入口 JS（dist/*.mjs + .d.mts）与 6 个 CSS 入口（src/styles/entries/*.scss → dist/*.css）
pnpm test    # vitest：运行时、防火墙、SVG 生成、方案选择、样式入口组成
pnpm check   # oxfmt + oxlint（含类型检查）
```

- 源码结构见 [ARCHITECTURE.md](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/ARCHITECTURE.md)。
- 性能实验的工具包、各轮脚本 / 场景 / 原始数据、子代理实验与结论都在 [`bench/`](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/bench/README.md)；结论汇总在[性能报告](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/reports/2026-10-08-performance.md)。

## 路线图

- [x] 基底 + 变体拆分、按需加载、`/all` 全量入口
- [x] 根驱动 pulse / shimmer、继承防火墙、svg 方案运行时精确颜色、显式标记基底
- [ ] Playwright 三引擎视觉快照回归（Chrome / Firefox / Safari）
- [ ] 真机验证：iOS Safari（fixed 背景、`inert`）、Firefox、Safari、Android WebView
- [ ] 首次发布 npm

## 文档与参考

- [设计总结](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/design/overview.md)
- [性能报告](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/reports/2026-10-08-performance.md)
- [当前状态与待办](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/status.md)
- [文档索引](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/README.md)

## License

[MIT](./LICENSE)

## 致谢

设计灵感来自 Flutter 的 [skeletonizer](https://pub.dev/packages/skeletonizer)、[vue-skeletor](https://www.npmjs.com/package/vue-skeletor) 的占位思路，以及实战中对"改个 UI 就得重画骨架"这一痛点的反思。
