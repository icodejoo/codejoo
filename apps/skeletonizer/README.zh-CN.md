# skeletonizer

> English docs: [README.md](./README.md)。
>
> 给 AI 编码助手：精简用法见 [llms.md](./llms.md)（随 npm 包发布），接入方式见[给 AI 编码助手](#给-ai-编码助手)。

**Web 版骨架屏方案：照 Flutter skeletonizer 的路子，真实 DOM + mock 数据 + 纯 CSS，不用手画占位形状。**

受 Flutter 的 [skeletonizer](https://pub.dev/packages/skeletonizer) 启发，解决 vue-skeletor / react-content-loader 里手写占位的痛点 —— 改个 UI 就得重新设计骨架，特别折腾。这套方案照常渲染真实组件，喂进 mock 数据，由 CSS 根据实际布局自动生成骨头，需要例外的地方才标记。

## 目录

- [怎么工作](#怎么工作)
- [快速开始](#快速开始)
- [选择入口](#选择入口)：基底 + 变体，按需加载
- [方案怎么选](#方案怎么选)：按场景的建议
- [方案对比](#方案对比)：性能、颜色、兼容性实测
- [各方案详解](#各方案详解)：fade / solid、global、svg、sweep、显式标记、懒渲染
- [标记词汇表](#标记词汇表) · [Bone 工具](#bone-工具) · [主题](#主题)
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
| `fps`      | 数字（建议 24~30）/ `"auto"`                            | global 方案在**没有列表结构**时改用 JS 计时器降低更新频率；有列表结构时被继承防火墙取代                                                                                            |
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
<!-- 不用 JS：直接写根属性（拿不到防火墙、计时器、运行时 SVG 和 inert 交互锁） -->
<div skz skz-effect="shimmer">…</div>
```

`<skz-box>` 只认宿主自己的 `loading`（以及 `effect` / `text` / `fallback` / `engine` / `fps`）属性。它不带 MutationObserver：框架把第一个子节点替换掉之后，由你自己处理，比如把 `loading` 关一下再开，新子根才会生效、旧子根被解除。宿主被移动到别的父节点后加载态会自然保持。

SSR 安全：`skeletonizer` 核心和 `/global/js`、`/svg/js`、`/all/js` 在 Node 里 import 都不报错；带 CSS 的变体入口（`/global`、`/svg`、`/all`）需要打包器处理 CSS，见下节。

## 选择入口

样式和运行时都拆成"基底 + 变体"，用多少引多少。表中体积为 gzip 后。

### 基底（二选一）

| 入口                        | 内容                                                                                                 | 体积    |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ------- |
| `skeletonizer/base.css`     | 主题变量、交互锁、四档自动推导骨头、显式标记、忽略区、fade / solid、懒渲染与减少动态效果             | 1.30 KB |
| `skeletonizer/explicit.css` | 同上但**不含任何推导规则**，只有 `skz-bone` / `skz-leaf` 是骨头；样式重算更少（见[对比](#方案对比)） | 0.76 KB |

### 运行时核心

| 入口                                    | 内容                                                                                    | 体积                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- | -------------------- |
| `skeletonizer`                          | `enable` / `disable`、`Bone`、`<skz-box>`、`registerCustomElements`；不带 CSS，SSR 安全 | 3.3 KB               |
| `skeletonizer/vue`、`/react`、`/svelte` | 框架适配层（依赖核心）                                                                  | 核心之外 +0.1~0.5 KB |

### 变体（按需叠加）

| 变体   | 带 CSS                | 纯 JS（无打包器 / SSR）  | 纯 CSS                                  | 内容                                                                   | 体积（JS 增量 + CSS） |
| ------ | --------------------- | ------------------------ | --------------------------------------- | ---------------------------------------------------------------------- | --------------------- |
| global | `skeletonizer/global` | `skeletonizer/global/js` | `skeletonizer/global.css`               | pulse / shimmer 根驱动、继承防火墙、JS 计时器、老浏览器 JS 挂 SVG 降级 | 2.4 KB + 0.56 KB      |
| svg    | `skeletonizer/svg`    | `skeletonizer/svg/js`    | `skeletonizer/svg.css`                  | pulse / shimmer 用共享 SVG 动画背景、按主题运行时生成精确颜色          | 1.0 KB + 0.20 KB      |
| sweep  | —                     | —                        | `skeletonizer/sweep.css`                | 根上一条扫光条（纯 CSS）                                               | 0.59 KB               |
| all    | `skeletonizer/all`    | `skeletonizer/all/js`    | `skeletonizer/all.css`（= `style.css`） | `base` + 全部变体                                                      | 2.4 KB + 2.07 KB      |

- **带 CSS 的入口**（`skeletonizer/global` 等）产物开头是 `import "./global.css"`，Vite / webpack / Next.js / Rollup 等打包器会一并打进样式；包的 `sideEffects` 已声明，不会被 tree-shaking 掉。
- **没有打包器、或在 Node 里跑**：用 `/js` 版加对应的 `.css` 子路径分开引入。
- 只引入 `svg` 时，产物里不会有防火墙、计时器和根驱动 CSS（已用 Vite 打包验证）；需要哪个方案就只为哪个方案付体积。

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

## 方案怎么选

| 场景                                                             | 推荐组合                                                                            | 理由                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 一般页面，骨架不大（几百个元素以内）                             | `base.css` + 默认 fade，或再加 `global` 用 shimmer                                  | fade 几乎零成本；小骨架下所有方案都是 60 帧                            |
| 长列表、信息流、表格（成千上万个元素）要 shimmer / pulse         | `base.css` + `global`                                                               | 继承防火墙自动生效，只有视口内的项参与逐帧重算，16000 元素也稳定 60 帧 |
| 同上，且骨头位置可以逐个标记、追求最低开销                       | `explicit.css` + `global`                                                           | 不含推导规则，每帧样式重算再降约 60%，开启更快                         |
| 没有列表结构的大骨架（大表单、长详情页）要 shimmer / pulse       | `global` + `fps: "auto"`，或改用 `svg`                                              | 防火墙找不到列表项时，用计时器降更新频率；svg 方案每帧没有样式重算     |
| 必须覆盖 Chrome < 119 / Safari < 16.4 / Firefox < 128 也要有动画 | `global`（自动降级为 SVG 动画）或直接用 `svg`                                       | SVG 动画不依赖 `@property`                                             |
| 产品指定老浏览器里的效果                                         | `global` + `fallback`（`svg` / `fade`）                                             | 只在不支持 `@property` 时生效                                          |
| 设计稿要求精确决定哪些元素出骨头                                 | `explicit.css`                                                                      | 只有 `skz-bone` / `skz-leaf` 是骨头，其余原样显示                      |
| 包体敏感、只要一种效果                                           | `base.css`（只 fade，1.39 KB）或 `base.css` + 单一变体                              | 变体按需加载                                                           |
| SSR / Node / 无打包器                                            | 核心 + `/js` 变体 + `.css` 子路径                                                   | 带 CSS 的入口需要打包器                                                |
| 严格 CSP                                                         | 放行 `img-src blob:`（svg 方案与老浏览器 SVG 降级）；`data:` 只有 `Bone.image` 需要 | 运行时 SVG 走 blob URL，CSS 里不再内置任何 SVG data URI                |
| 快速原型、不在乎体积                                             | `skeletonizer/all`                                                                  | 一次全部引入                                                           |

## 方案对比

测试环境：Windows 桌面 Chrome，i5-13500 + 集显，卡片列表（每张约 8 个元素），每项 3 次取中位数；"样式重算"是每帧 `UpdateLayoutTree` 耗时（ms），16.6ms 即一帧预算。原始数据、脚本、截图在 [`bench/`](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/bench/README.md)，分析见[性能报告](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/reports/2026-10-08-performance.md)。只测了桌面 Chrome，Safari / Firefox / 移动端未测。

### 性能

| 方案（引入）                                  | 4000 元素：帧率 / 样式重算 | 16000 元素：帧率 / 样式重算       | 开启耗时（16000） |
| --------------------------------------------- | -------------------------- | --------------------------------- | ----------------- |
| fade（`base.css`，默认）                      | 60 / 0.1                   | 60 / 0.2                          | 约 65 ms          |
| solid（`base.css`）                           | 60 / 0                     | 60 / 0                            | 约 65 ms          |
| sweep（`sweep.css`）                          | 60 / 0.3                   | 60 / 1.1（另有 PrePaint 约 6 ms） | —                 |
| shimmer，global，**纯 CSS 无 JS**             | 57 / 12.9                  | 17 / 49.3                         | 约 70 ms          |
| shimmer，global，**`enable()` + 防火墙**      | 60 / 1.9                   | **60 / 6.8**                      | 约 80 ms          |
| shimmer，global + 防火墙 + **`explicit.css`** | 60 / 1.2                   | **60 / 2.8**                      | 约 61 ms          |
| shimmer，global，纯 CSS + `explicit.css`      | 60 / 7.4                   | 24 / 31.9                         | —                 |
| pulse，global，纯 CSS，`base.css`             | 60 / 11.2                  | 19 / 46.7                         | —                 |
| pulse，global，纯 CSS，`explicit.css`         | 60 / 7.0                   | 31 / 26.1                         | —                 |
| shimmer，global，无列表结构 + `fps: "auto"`   | 60                         | 约 47（动画每秒约 12 次）         | —                 |
| shimmer，svg 方案                             | 60 / 0.1（PrePaint 3.5）   | 54 / 0.1（PrePaint 15.6）         | 约 86 ms          |

要点：

- **默认 fade 无论多大都是 60 帧**，开启成本只有一次样式计算。
- **pulse / shimmer 的成本在样式重算**：根上的动画变量每帧变化，继承它的每个元素都要重算（约 2.3µs/元素）。纯 CSS 下 16000 元素只有 17 帧。
- **继承防火墙**是最大的一项优化：视口外的列表项不参与重算，16000 元素回到 60 帧，开启耗时几乎不变。它需要 JS（`enable()` / 适配层 + `global` 变体）和列表结构。
- **`explicit.css`** 去掉推导选择器，每个元素的重算更便宜：无防火墙时降 35%~44%，有防火墙时再降约 60%。
- **svg 方案**每帧样式重算为 0，但每帧要通知所有用到 SVG 图的骨头（PrePaint），16000 元素 54 帧；有列表结构时不如 global + 防火墙，没有列表结构时更稳。
- **JS 计时器（`fps`）与防火墙互斥**：计时器写根的内联变量会穿过防火墙（实测 16000 元素从 60 掉到 27~39 帧），库在找得到列表项时自动只用防火墙。

### 颜色、兼容性与代价

| 方案             | 颜色                                          | 浏览器要求                                                                                       | 需要 JS                  | 主要代价                                                                                 |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------- |
| fade / solid     | 精确（主题变量）                              | 支持 CSS 变量                                                                                    | 否                       | fade 会把根里的一切一起淡入淡出                                                          |
| sweep            | 混合模式近似提亮                              | 支持 CSS 变量与 `mix-blend-mode`                                                                 | 否                       | 根被设为 `position: relative` + `overflow-x: clip`，占用根的 `::after`，忽略区也会被扫到 |
| global（根驱动） | 精确                                          | `@property`（按相对颜色语法判断：Chrome 119+ / Safari 16.4+ / Firefox 128+），否则自动降级为 SVG | 否；防火墙 / 计时器要 JS | 纯 CSS 时大骨架慢；iOS 上 shimmer 改为颜色脉冲（无 fixed 背景）                          |
| svg              | 通过 JS：精确（运行时生成）；无 JS：退回 fade | SMIL（所有现代浏览器及多数老浏览器）                                                             | 否；精确颜色要 JS        | 下划线文字静止；CSP 需 `img-src blob:`；iOS 上 shimmer 改为 pulse                        |
| 显式标记         | —                                             | 同基底                                                                                           | 否                       | 每个骨头都要手动标 `skz-bone`                                                            |

### 实验过但没有采用的方案

| 方案                             | 结论       | 原因                                                                                                    |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| SVG 滤镜把内容剪影成骨头         | 不采用     | 16000 元素 60 帧，但文字只是字形剪影、卡片结构和浅色内容丢失、深色主题更差、`skz-ignore` 原理上无法生效 |
| canvas 静态遮罩 + 合成器光带     | 不采用     | 每帧主线程为 0、颜色精确，但生成遮罩一次要 4~7 秒（16000 元素）                                         |
| CSS Paint API（Houdini）         | 不采用     | 能在主线程外运行，但 worklet 和 GPU 更重，且只有 Chromium                                               |
| 每个骨头各挂一个动画（旧方案）   | 已移除     | 被 `!important` 颜色压住，pulse 看不出效果却照样耗时；备份在 `archive/2026-10-08-element-anim/`         |
| `steps()` 降帧                   | 无效       | CSS 动画哪怕值没变也每帧触发重算                                                                        |
| `content-visibility`（`skz-cv`） | 保留为可选 | 长列表每帧开销低，但子元素多时开启慢约 3 倍、会裁掉溢出内容；有列表结构时防火墙更优                     |

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
- **JS 计时器（`fps`）**：找不到列表项时生效。`fps: 24` 每秒最多更新 24 次；`fps: "auto"` 写入后下一帧明显变慢就改为每 2~4 帧写一次，持续流畅再加快。值没变的帧不写，视口外的根和"减少动态效果"时不写。代价是光带略顿、`--skz-shimmer-timing` 不生效。
- **老浏览器降级**：不支持 `@property` 时，JS 默认改挂 SVG 动画（blob 生成，颜色精确），`fallback: "fade"` 可改为保持基底 fade；JS 执行前（含 SSR 首屏）和 blob 生成失败时，老浏览器显示 fade。

### svg：共享 SVG 动画背景

```ts
import "skeletonizer/svg"; // 只引入 svg 时，pulse / shimmer 默认就走 svg
enable(el, { effect: "shimmer" }); // 同时引入了 global 时写 engine: "svg"
```

- **原理**：骨头背景叠一张带 SMIL 动画的 SVG，所有骨头共用这一张图，CSS 每帧不变，没有样式重算；不依赖 `@property`。
- **颜色**：通过 `enable()` 开启时，按根上的 `--skz-highlight` 和 `--skz-duration` 现生成 SVG（blob URL），颜色和时长与主题完全一致；同参数共用一份，没人用时释放；系统深浅色切换时自动重新生成。没有 JS 或读不到主题变量时，根上不会有 `skz-engine` 属性，显示基底的 fade（CSS 里不再内置 SVG 兜底图）。也可以用 `--skz-svg-shimmer` / `--skz-svg-pulse` 换成自己的 SVG。
- **代价**：下划线文字无法贴图，保持静止（叶子模式没有这个问题）；严格 CSP 需放行 `img-src blob:`（运行时图）；iOS 不支持 fixed 背景，shimmer 改用 pulse 图。

### sweep：扫光条（纯 CSS）

```ts
import "skeletonizer/sweep.css";
enable(el, { effect: "sweep" });
```

整个根一个 `::after` 扫光条，`transform` 平移，跑在合成器线程；浅色用 lighten、深色用 soft-light 混合，主要提亮骨头。它会改根元素自身的样式：

- 根被设成 `position: relative`，根内绝对定位的后代会改以根为参照；
- 根被加上 `overflow-x: clip`，伸出根左右边界的下拉框、角标会被裁掉；
- 根的 `::after` 被占用，业务写在根上的 `::after` 会被覆盖。

建议给 sweep 单独包一层不带业务样式的 div 当根。容器色模式：根上再写 `skz-sweep="bg"`，高光取容器背景色（`--skz-sweep-bg-rgb`），不用混合模式。

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

显式模式只能通过引入 `explicit.css`（和 `base.css` 二选一）开启，没有"单个根切换"的开关。

### 懒渲染与 `skz-cv`

- **懒渲染（自动）**：通过 `enable()` 开启的根，滚出视口（含 100px 缓冲）时被打上 `skz-paused`，CSS 移除它的动画，滚回来再恢复。全库一个共享 `IntersectionObserver`，只观察根。
- **`skz-cv`（可选）**：根上写 `skz-cv`，根的直接子元素加上 `content-visibility: auto`，滚出视口的子元素连样式、布局、绘制都跳过。代价：子元素溢出的部分会被裁掉；还没渲染过的子元素按 `--skz-cv-size`（默认 200px）估高，估不准滚动时会跳；子元素很多时开启慢约 3 倍。有列表结构时优先用防火墙。

## 标记词汇表

| 属性                                 | 写在哪           | 含义                                                                                                        |
| ------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `skz`                                | 根               | 骨架开启；`enable()` / 适配层自动加，纯 HTML 自己写                                                         |
| `skz-effect`                         | 根               | `fade` / `solid` / `sweep` / `pulse` / `shimmer`                                                            |
| `skz-text`                           | 根               | `underline`（默认）/ `leaf`                                                                                 |
| `skz-engine`                         | 根               | `svg`：SVG 方案的 blob 图挂上后由 JS 写入（不要手写）；没有这个属性就是基底 fade                            |
| `skz-has-ignore`                     | 根               | 根里有 `skz-ignore` 时由 `enable()` 自动加；**纯 HTML 手写根时要自己加**，CSS 据此关闭隐式 fade、修正下划线 |
| `skz-cv`                             | 根               | 直接子元素在视口外时跳过渲染                                                                                |
| `skz-sweep`                          | 根               | `bg`：sweep 用容器色模式                                                                                    |
| `skz-bone`                           | 元素             | 强制本元素当骨头（如用 div 做的图片、头像、色块）                                                           |
| `skz-leaf`                           | 元素             | 本元素整块当一个骨头，子树全藏                                                                              |
| `skz-ignore`                         | 元素             | 保持原样、可点击、可聚焦（如"取消加载"按钮）                                                                |
| `skz-paused` / `skz-fw` / `skz-tick` | 根 / 列表项 / 根 | 运行时内部状态（懒渲染、继承防火墙、计时器），不要手写                                                      |

**全是 div 的页面怎么办：** div 里的文字由默认的下划线模式覆盖，不用处理；用 div 当图片 / 图标（背景图头像、封面、色块）的空元素不在自动推导范围里，加 `skz-bone` 即可。

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

### 深色模式

自动跟随 `prefers-color-scheme: dark`。也可以在 `<html>` 上强制：`data-skz-theme="dark"` 或 `"light"`。

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

svg 方案的图由 JS 按这些颜色和时长现生成；没有 JS 时不显示 SVG，退回基底的 fade。

### 减少动态效果

尊重 `prefers-reduced-motion: reduce`：所有动画停止，骨头静止显示。

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

用 `isCustomElement` 让 Vue 不去处理 `skz` 标签：

```js
// vite.config.js / vue.config.js
export default {
  // Vite
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'skz',
        },
      }),
    }),
  ],
  // 或 Vue CLI
  chainWebpack: (config) => {
    config.module
      .rule('vue')
      .use('vue-loader')
      .loader('vue-loader')
      .tap((opts) => ({
        ...opts,
        compilerOptions: {
          isCustomElement: (tag) => tag === 'skz',
        },
      }));
  },
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
    <div ref={ref} className={isLoading ? "skz" : ""}>
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

或用指令 `use:enable`：

```svelte
<script>
  import { enable, disable } from 'skeletonizer';

  let isLoading = true;

  function enableSkeleton(node) {
    if (isLoading) {
      const off = enable(node, { effect: 'pulse' });
      return { destroy: off };
    }
  }
</script>

<div use:enableSkeleton class={isLoading ? 'skz' : ''}>
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
pnpm dev     # demo（http://localhost:5188/demo/index.html），可切效果、方案、计时器、档位、深色
pnpm build   # vp pack：多入口 JS（dist/*.mjs + .d.mts）与 6 个 CSS 入口（src/styles/entries/*.scss → dist/*.css）
pnpm test    # vitest：运行时、防火墙、计时器、SVG 生成、方案选择、样式入口组成
pnpm check   # oxfmt + oxlint（含类型检查）
```

- 源码结构见 [ARCHITECTURE.md](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/ARCHITECTURE.md)。
- 性能实验的工具包、各轮脚本 / 场景 / 原始数据、子代理实验与结论都在 [`bench/`](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/bench/README.md)；结论汇总在[性能报告](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/reports/2026-10-08-performance.md)。

## 路线图

- [x] 基底 + 变体拆分、按需加载、`/all` 全量入口
- [x] 根驱动 pulse / shimmer、继承防火墙、JS 计时器、svg 方案运行时精确颜色、显式标记基底
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
