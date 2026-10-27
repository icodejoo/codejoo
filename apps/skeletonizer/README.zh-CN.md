# skeletonizer

**在线 demo：<https://icodejoo.github.io/codejoo/skeletonizer/>**（各效果、档位、深色、fit 等可交互切换）

> English docs: [README.md](./README.md)。
>
> 给 AI 编码助手：精简用法见 [llms.md](./llms.md)（随 npm 包发布），接入方式见[给 AI 编码助手](#给-ai-编码助手)。

**Web 版骨架屏方案：照 Flutter skeletonizer 的路子，真实 DOM + mock 数据 + 纯 CSS，不用手画占位形状。**

受 Flutter 的 [skeletonizer](https://pub.dev/packages/skeletonizer) 启发，解决 vue-skeletor / react-content-loader 里手写占位的痛点 —— 改个 UI 就得重新设计骨架，特别折腾。这套方案照常渲染真实组件，喂进 mock 数据，你用 `skz-text` / `skz-bone` / `skz-leaf` 标出哪些元素是骨头，CSS 按实际布局把它们画出来。

包提供两个构建，**二选一**（各自自包含，同一页面不要同时引）：

- **完整版（默认）**：`import "skeletonizer"` 一行搞定（样式 + 运行时 + 全局 `skz`）。功能齐全：继承防火墙（长列表）、SVG 方案与老浏览器降级、四种文字模式、懒渲染，规模上限高得多。
- **lite**：`import "skeletonizer/lite"`。包最小、规则最简单，面向现代浏览器里的中小骨架（单个根约 2000 元素以内）。

两者怎么选，看[下面的对比表](#完整版还是-lite)。0.3.0 起入口就只有这两个加框架适配层；从 0.2.x 升级见[升级到 0.3.0](#升级到-030)。

骨头由你**自己标**（0.2.0 起的默认）：没标的内容原样显示。给无法改标记的第三方组件，可以开一块 `skz-auto` 区域，区域内退回按标签推导。从 0.1.x 升级见[升级到 0.2.0](#升级到-020)。

## 目录

- [怎么工作](#怎么工作)
- [完整版还是 lite](#完整版还是-lite)：并列对比表
- [快速开始](#快速开始)：完整版和 lite 各一行引入，外加[怎么标记骨头](#5-标记骨头)
- [选择入口](#选择入口)：各文件的内容与体积
- [升级到 0.3.0](#升级到-030) · [升级到 0.2.0](#升级到-020)
- [功能总表](#功能总表)：效果 / 入口 / 选项 / 自动机制 / 标记 / 主题变量 / API 的作用、用法、限制，每项标明属于 lite 还是完整版
- [标记与属性参考](#标记与属性参考)：元素标记 / 根属性 / 运行时属性，以及它们在各文字模式、入口、动画效果、浏览器档位下的表现
- [类型](#类型)：`EnableOptions`、各联合类型、类型怎么随版本变宽、适配层类型、`SkzBox` 类
- [方案怎么选](#方案怎么选)：按场景的建议
- [方案对比](#方案对比)：性能、颜色、兼容性实测（含 [lite 的规模上限](#lite-的规模上限)）
- [各方案详解](#各方案详解)：fade / solid、global、svg、标记与 `skz-auto`、懒渲染
- [Bone 工具](#bone-工具) · [主题](#主题)
- [浏览器支持与降级](#浏览器支持与降级) · [已知限制与使用约束](#已知限制与使用约束)
- [在框架里怎么用](#在框架里怎么用) · [给 AI 编码助手](#给-ai-编码助手) · [开发与实验存档](#开发与实验存档)

## 怎么工作

三个部分组成：

1. **真实 DOM 渲染**：用你平常的 JSX / Vue 模板写组件，只是喂进 mock 数据而不是真实数据。
2. **Mock 数据**：用 `Bone` 工具生成文字、图片等占位内容，都是确定性的（SSR 友好，不用 `Math.random`）。
3. **你标记，CSS 来画**：用裸属性 `skz-text`（文字）、`skz-bone`（图片、头像、按钮、色块）、`skz-leaf`（把一棵子树合成一块骨头）、`skz-ignore`（保持原样）说明哪些元素是骨头，没标的内容原样显示。无法改标记的第三方组件放进 `skz-auto` 区域，区域内才按标签名和内容推导（见[标记骨头](#5-标记骨头)）。

骨架样式是纯 CSS，不用 UA 嗅探，也不用 JS 闸门：**CSS 可以完全脱离 JS 运行，只靠根上的 `skz` 属性开关**（JS 只负责切开关、写根属性）。两种用法的渐进方式不同：

- **lite**：目标线是 Chrome 119+ / Safari 16.4+ / Firefox 128+（`@property`、相对颜色、`:has()`、`text-decoration-thickness`、`background-clip: text` 都具备）。过线的浏览器走“现代档”（一个 `@supports`：`skz-text` 文字条用 round / clip 画法，另有控件整块、图标识别和 `skz-auto` 区域里的其他推导），`pulse` / `shimmer` 由根上的一个 CSS 动画驱动。**低于线的浏览器只有第 0 档（按标签铺静态色块，仅 `skz-auto` 区域）、`skz-bone` / `skz-leaf` 标记和 fade，`skz-text` 文字条需要达到现代档**；没有逐档渐进。
- **完整版**：三层渐进（第 0 档 → 第 1 档 → 第 2 档），从 Chrome 88 到最新的都有对应效果，外加老浏览器的 SVG 动画降级。各档的推导只在 `skz-auto` 区域里生效，`skz-text` 标记由第 1 / 2 档负责。

## 完整版还是 lite

| 维度                              | **完整版（默认）**                                                                                                    | **lite**                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 适用场景                          | 长列表 / 信息流 / 大表单；要兼容老浏览器的动画；要多种文字模式、懒渲染等；要精细调性能；"什么都能用"                  | 现代浏览器里的中小骨架：卡片、详情页、几十条以内的列表；想要"包最小"                                                                                        |
| 浏览器门槛                        | 最佳效果同一条线；往下有第 1 / 2 档渐进，pulse / shimmer 在老浏览器里自动降级为 SVG 动画                              | Chrome 119+ / Safari 16.4+ / Firefox 128+；低于门槛有第 0 档静态色块（`skz-auto` 区域）、`skz-bone` / `skz-leaf` 标记和 fade，`skz-text` 文字条需要达到门槛 |
| 验证状态                          | **仅 Chrome 实测**；Firefox / Safari 按规范默认兼容，未实测                                                           | 同左                                                                                                                                                        |
| 规模建议                          | 上限高得多：继承防火墙下，正常速度 2000 卡（16000 元素）仍是 60 帧；4× 降速下 4000 元素掉到 47.6~57.6 帧              | 单个根约 2000 元素以内（数据见 [lite 的规模上限](#lite-的规模上限)）                                                                                        |
| 效果                              | fade / solid / pulse / shimmer；pulse / shimmer 可选 global / svg 两种实现                                            | fade（默认）/ solid / pulse / shimmer；pulse / shimmer 是纯 CSS 根驱动，光带降频到 24 次/秒                                                                 |
| 文字模式                          | round（默认）/ clip / underline / leaf                                                                                | round（默认）/ clip                                                                                                                                         |
| 标记与推导                        | 标记；`skz-auto` 区域里第 0 / 1 / 2 档逐档按能力取舍                                                                  | 标记（`skz-text` / `skz-bone` / `skz-leaf` / `skz-ignore`）；`skz-auto` 区域里另有第 0 档标签白名单 + 一个 `@supports` 的现代档                             |
| 继承防火墙                        | 有（`global` 方案）                                                                                                   | 无                                                                                                                                                          |
| svg 方案                          | 有（`svg` 方案，不依赖 `@property`）                                                                                  | 无                                                                                                                                                          |
| 懒渲染（`skz-paused`）与 `skz-cv` | 有                                                                                                                    | 无                                                                                                                                                          |
| 导入方式                          | `import "skeletonizer"`                                                                                               | `import "skeletonizer/lite"`                                                                                                                                |
| CSS                               | `full.mjs` 开头是 `import "./full.css"`，打包器会带上样式；SSR 首屏 / 无打包器 / CDN 时单独引 `skeletonizer/full.css` | `lite.mjs` 开头是 `import "./lite.css"`；上述场景单独引 `skeletonizer/lite.css`                                                                             |
| 体积（gzip）                      | JS 3.91 KB + CSS 2.32 KB = **6.23 KB**                                                                                | JS 2.27 KB + CSS 1.98 KB = **4.26 KB**                                                                                                                      |
| SSR                               | JS 里带 CSS 导入，要打包器（见 [SSR 与 Node](#ssr-与-node)）；全局 `skz` 导入即挂                                     | 同左                                                                                                                                                        |
| 类型                              | `EnableOptions` 多出 `text` / `shimmerMode` / `engine` / `fallback`，适配层同步变宽                                   | `EnableOptions` 只有 `effect` / `fit`，`SkzEffect` 四个值                                                                                                   |

体积口径：`pnpm build` 产物按 `gzip -9 -n` 逐文件压缩（1 KB = 1024 字节）；每个 JS 文件都自包含，所以"JS"就是那一个文件。明细在[选择入口](#选择入口)。

一句话挑：**默认就是完整版**；包体最敏感、骨架又小，换 `skeletonizer/lite`。留在（或换到）完整版的理由：

- 单个根超过约 2000 元素，还要 pulse / shimmer（lite 没有继承防火墙；桌面 CPU 上实测到约 4000 元素还是 60 帧，慢设备要少得多，数据见 [lite 的规模上限](#lite-的规模上限)）；
- 浏览器门槛以下的用户也要有动画（完整版有 SVG 降级）；
- 需要 underline / leaf 文字、懒渲染；
- 没有列表结构的大骨架（大表单、长详情页）要 shimmer：`svg` 方案。

**`skeletonizer` 和 `skeletonizer/lite` 不要在同一页面同时引**：各自带一份 core，扩展注册表和全局 `skz` 会分家（后加载的占全局 `skz`）。

## 快速开始

### 1. 安装

```bash
pnpm add skeletonizer
```

### 2. 完整版（默认）：一行引入

```ts
import "skeletonizer"; // 样式（full.css）+ 运行时 + 全局 skz，一行搞定
```

之后在任何地方都可以直接用全局 `skz`（不用再 import）：

```ts
const off = skz.enable(document.querySelector("#card")!, { effect: "shimmer" });
const user = { name: skz.bone.text(8), bio: skz.bone.lines(2) };
// 数据到了：
off();
```

也可以具名导入，类型提示更完整（`skz` 的成员见[全局变量 skz](#全局变量-skz)）：

```ts
import { enable, Bone } from "skeletonizer";
```

> `import skz from "skeletonizer"` 拿到的就是全局上的那个 `skz` 对象（`skeletonizer` 与 `skeletonizer/lite` 成员相同）；全局名字被别人占用时，默认导入照样可用。

完整版已经内置 global、svg 两个方案，没有别的要引、要挑的；方案在运行时用 `engine` 选项选。

**单独引 `skeletonizer/full.css` 的场景**：入口在打包器里自带样式，下面几种情况要自己引：

- **SSR 首屏**：服务端渲染的 HTML 里直接写 `<link rel="stylesheet" href="…/skeletonizer/full.css">`，根上写 `skz`，首屏就是骨架，JS 起来后 `enable()` 接管（幂等）。服务端跑 JS 的注意事项见 [SSR 与 Node](#ssr-与-node)。
- **无打包器**：`<link>` 引 `full.css` + import map，见[无打包器](#无打包器浏览器直接用import-map)。
- **CDN**：同上，URL 换成 CDN 地址。

### 3. lite：更小的构建

```ts
import "skeletonizer/lite"; // 样式（lite.css）+ core 运行时 + 全局 skz
```

第 2 步里的用法（`skz`、具名导入、`import skz from "skeletonizer/lite"`、单独引 `skeletonizer/lite.css`）全部同样适用。lite 没有的东西见[完整版还是 lite](#完整版还是-lite)。**`skeletonizer` 和 `skeletonizer/lite` 不要同时引。**

### 4. 开启骨架

```ts
import { enable, Bone } from "skeletonizer"; // lite 写 "skeletonizer/lite"

const off = enable(document.querySelector("#card")!, { effect: "shimmer" });
// 数据到了：
off();
```

`enable()` 的选项（"版本"列：两者 = lite 和完整版都有；仅完整版 = lite 里传了会被忽略）：

| 选项       | 版本     | 取值                                           | 说明                                                                                                                                                                               |
| ---------- | -------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effect`   | 两者     | `fade`（默认）/ `solid` / `pulse` / `shimmer`  | 动画效果。lite 的 pulse / shimmer 开箱即用（根驱动 CSS 在 `lite.css` 里）；完整版里 `pulse` / `shimmer` 的实现可选 `global` / `svg`，都没引入变体时按 global 的纯 CSS 根驱动       |
| `text`     | 仅完整版 | `round`（默认）/ `clip` / `underline` / `leaf` | 文字骨头画法，写到根的 `skz-text-mode`，见[文字骨头模式](#文字骨头模式)；lite 只有 round / clip，不认这个选项（不写 = round，与纯 CSS 一致）                                       |
| `engine`   | 仅完整版 | `global` / `svg`                               | `pulse` / `shimmer` 的实现。不传时按已引入的变体决定：有 global 用 global，只有 svg 用 svg；指定了没引入的方案时的表现见[功能总表](#功能总表)的 `engine` 一行，开发模式会警告一次  |
| `fallback` | 仅完整版 | `svg`（默认）/ `fade`                          | global 方案在不支持 `@property` 的浏览器里的降级：`svg` 由 JS 挂 SVG 动画，`fade` 保持基底 fade；JS 执行前老浏览器显示 fade                                                        |
| `fit`      | 两者     | 布尔，默认 `false`                             | 骨架自身绝不撑出滚动条：根的高度被限制在滚动祖先（没有则视口）剩余空间内，完全落在外面的列表项 `display: none`，尺寸变化时自动重算。`<skz-box fit>`、React / Vue / Svelte 均可透传 |

`fit` 的 CSS 已包含在 `lite.css` / `full.css` 里，无需另引。

重复调用 `enable()` 是安全的：按本次参数重新同步属性（没传的会被清掉），并重新扫描列表项、忽略区和主题变量。

### 5. 标记骨头

没标记的内容原样显示。在根里用裸属性标出哪些元素是骨头：

```html
<!-- 根是你调用 enable() 的元素 / 包住内容的 <SkzBox>，由它们写上 skz -->
<div class="card">
  <img skz-bone src="…" width="48" height="48" />
  <h3><span skz-text>昵称</span></h3>
  <p><span skz-text>一段会折成好几行的简介文字。</span></p>
  <div skz-leaf class="stats"><b>128</b> 篇 · <b>3.2k</b> 关注</div>
  <button skz-bone>关注</button>
  <a skz-ignore href="/cancel">取消</a>
</div>
```

| 属性         | 写在哪                           | 效果                                                                                                                                                                                                    |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skz-text`   | 文字元素（根的后代）             | 整个子树的文字按真实文字行出条（最后一行较短），`价格：<b>¥5</b>` 这类混合内容也覆盖。**推荐打在块元素内层的 `<span>` 上**：默认的 `round` 下块元素会变成整块圆角矩形，行内 `<span>` 才是每行一条圆角条 |
| `skz-bone`   | 图片、头像、按钮、色块           | 本元素整块当一块骨头，子树隐藏；媒体内容被推出盒子                                                                                                                                                      |
| `skz-leaf`   | 容器                             | 把整棵子树合成一块骨头                                                                                                                                                                                  |
| `skz-host`   | Web Component 宿主（Shadow DOM） | 宿主被藏起来，由 `::before` 铺一整块骨头，shadow 里的内容保持隐藏，见 [Web Component 宿主](#web-component-宿主)                                                                                         |
| `skz-ignore` | 任意元素                         | 保持原样、可点击、可聚焦。放在 `skz-text` / `skz-auto` 内时它的文字会显示在骨头条之上；想要干净的忽略区，写成兄弟元素：`<span skz-text>价格</span> <span skz-ignore>实时</span>`                        |
| `skz-auto`   | 根自身，或根内任意后代           | 只对该子树开启按标签的自动推导，给无法改标记的第三方组件用（见下）                                                                                                                                      |

完整的属性清单（元素标记、根属性、库自己写的运行时属性）以及它们在各文字模式 / 入口 / 动画效果 / 档位下的表现，见[标记与属性参考](#标记与属性参考)。

`skz-text` / `skz-bone` / `skz-leaf` 在根下任何位置都生效，不管在不在 `skz-auto` 区域里；写在根自身上不会被读取。文字条的外观跟随根上的 `skz-text-mode`（即 `text` 选项）：默认 `round`，见[文字骨头模式](#文字骨头模式)。

**`skz-auto` 区域**：在根或根内任意元素上写裸属性 `skz-auto`，按标签的自动推导只作用于这棵子树：文字标签（`p` `span` `h1`~`h6` `a` `li` 等）、媒体与控件（`img` `video` `canvas` `svg` `input` `button` 等）、空的 `<i>` 和类名带 `icon` 的空元素。局限：规则基于标签白名单，CSS 又选不到文本节点，所以 **直接写在 `div`、自定义元素、`code` 里的裸文字不在范围内（round / clip 下不可见）**，要包进 `p` / `span` 或自己标 `skz-text`；块级文字标签在 `round` 下是整块圆角矩形；用 div 做的头像 / 色块（空元素）不会被识别，要加 `skz-bone`。

### 6. 喂 mock 数据，照常渲染

```ts
const user = loading ? { name: Bone.text(8), bio: Bone.lines(2), avatar: Bone.image(48, 48) } : data;
```

### 框架适配

适配层走子路径导出，框架本身是可选 peer 依赖。适配层只是薄薄一层胶水（每个 gzip 约 0.5–0.9 KB），**不含 core 代码**：它们通过私有全局键 `globalThis[Symbol.for("skeletonizer")]` 找到 `enable` / `disable`，这个键由 `skeletonizer`（完整版）或 `skeletonizer/lite` 在导入时挂上。所以**应用入口要导入且只导入其中一个、一次**（样式也随它带上）；适配层本身不带样式、不挂全局。两个都没导入时，开发模式下 `console.warn` 一次（"No implementation found"），适配层的调用什么也不做。适配层的选项类型以 `skeletonizer/lite` 为底，项目里导入了 `skeletonizer` 就跟着变宽（见[类型](#类型)）：lite 下写完整版选项是类型错误，完整版下运行时才真正生效。

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

// Solid：指令 / 组件（适配层不用 JSX，无需编译插件）
import { skeleton, SkzBox } from "skeletonizer/solid";
// <div use:skeleton={{ loading: loading(), effect: 'shimmer' }}>…</div>   or   <SkzBox loading={loading()} effect="shimmer">…</SkzBox>
// skeleton 只出现在 `use:` 里时，TypeScript 会把这个 import 当成未使用删掉：加一行 `void skeleton;` 保住它

// Angular：没有适配层，自己写个十来行的指令调用 enable / disable，或用 <skz-box>，见下文「在框架里怎么用 → Angular」
```

### `<skz-box>` 自定义元素 / 纯 HTML

```ts
import "skeletonizer"; // 或 "skeletonizer/lite"：提供 enable / disable，<skz-box> 只是转发给它
import { defineSkzBox } from "skeletonizer/element"; // 导入没有副作用，需要手动注册
defineSkzBox();
```

```html
<skz-box loading effect="shimmer"><div class="card" skz>…</div></skz-box>

<!-- 宿主上的 loading 是开关；skz 落在它的【第一个元素子节点】（骨架根）上，宿主自己不带 skz；JS 里用 el.loading = true/false 切换 -->
<!-- SSR / 无 JS：直接在子根上写 skz，如 <skz-box loading><div skz>…</div></skz-box>；CSS（标记，以及 `skz-auto` 里的推导）不用 JS 就生效，JS 起来后 enable 是幂等的 -->
<!-- 不用 JS：直接写根属性（lite：拿不到 inert 交互锁；完整版另拿不到防火墙和运行时 SVG） -->
<div skz skz-effect="shimmer">…</div>
```

`<skz-box>` 在独立入口 `skeletonizer/element`（只有胶水，不含 core 代码、不带 CSS；和适配层一样经私有全局键取 `enable` / `disable`，所以应用入口要导入一次 `skeletonizer` 或 `skeletonizer/lite`，否则开发模式警告一次）。它只认宿主自己的 `loading`（以及 `effect` / `text` / `fallback` / `engine` / `fit`）属性；lite 下 `text` / `engine` / `fallback` 被忽略。它不带 MutationObserver：框架把第一个子节点替换掉之后，由你自己处理，比如把 `loading` 关一下再开，新子根才会生效、旧子根被解除。宿主被移动到别的父节点后加载态会自然保持。

### 编辑器代码提示（`skz-*` 属性）

手写的属性（`skz`、`skz-text`、`skz-bone`、`skz-leaf`、`skz-host`、`skz-ignore`、`skz-auto`、`skz-effect`、`skz-text-mode`、`skz-shimmer-mode`、`skz-cv`）有补全、取值提示和文档链接：

- **WebStorm / JetBrains 系**：不用配。包里声明了 `"web-types": "./web-types.json"`，`node_modules` 里有 `skeletonizer` 就自动识别。
- **VS Code**：在 `.vscode/settings.json` 加一行：

  ```json
  { "html.customData": ["./node_modules/skeletonizer/html-custom-data.json"] }
  ```

- **JSX / 模板里的 TypeScript**：导入任一适配层（`skeletonizer/react`、`/solid`、`/svelte`、`/vue`）就生效，零配置。适配层把共享类型 `SkzHtmlAttributes`（从 `skeletonizer/lite` 导出）并进框架的 `HTMLAttributes`，所以 `skz-effect="nope"` 会报类型错。裸属性在 React / Vue 里类型是 `""`（React 对未知属性传 `true` 会丢掉属性），在 Solid / Svelte 里是 `""` 或 `true`（它们的裸写法传的是 `true`）；不收 `false`，因为 Vue / Solid 会把它渲染成 `="false"`，照样命中 `[skz-bone]`。TSX 对没声明的带连字符属性不做检查，所以只导入 lite 时 `skz-cv` / `skz-shimmer-mode` 只是没有补全，不会报错。

数据都来自同一份清单 `src/attributes.ts`；`web-types.json` 与 `html-custom-data.json` 由 `pnpm build`（或 `pnpm gen:editor`）生成并提交入库，测试保证清单、生成物、TS 类型与 README 属性表四处一致。

### SSR 与 Node

0.3.0 起每个 JS 入口开头都带 CSS 导入（`import "./full.css"` / `import "./lite.css"`），所以 **`skeletonizer` 和 `skeletonizer/lite` 在没有打包器的纯 Node 里不能直接 import**（Node 不认识 `.css`）。SSR 框架的服务端代码都经过打包器，CSS 导入由它处理，但很多框架默认把 `node_modules` 里的包外置、直接交给 Node：要让它们把本包打进去（Vite / Nuxt / SvelteKit：`ssr.noExternal: ["skeletonizer"]`；Next.js：`transpilePackages: ["skeletonizer"]`）。全局 `skz` 在服务端同样会挂。完全没有打包器时，给 Node 配一个把 `.css` 当空模块的加载钩子，或者不要把骨架代码带进服务端包。框架适配层（`skeletonizer/vue` / `/react` / `/svelte` / `/solid`）没有 CSS 导入，Node 里 import 没问题，只是没导入过实现时开发模式会警告。

### 全局变量 skz

导入 `skeletonizer` 或 `skeletonizer/lite`，就会把 `skz` 挂到 `globalThis` 上，免 import 直接用。同一个 API 对象还**总是**会挂在私有键 `globalThis[Symbol.for("skeletonizer")]` 上（适配层读的就是它；公开名字 `skz` 被别人占用时它照样可用）：

| 成员                         | 版本 | 是什么                                                  |
| ---------------------------- | ---- | ------------------------------------------------------- |
| `skz.enable` / `skz.disable` | 两者 | 同 `enable` / `disable`                                 |
| `skz.bone`                   | 两者 | 就是 `Bone` 类，`skz.bone.text(8)`、`skz.bone.lines(2)` |

- **SSR 里也会挂**：Node 里 import 同样往 `globalThis` 上写；不用它的话没副作用。
- **已经存在的 `skz` 不覆盖**：别人已经占用了全局名 `skz`（不是我们挂的）时，保持原样，开发模式下 `console.warn` 一次，提示改用 import；我们自己挂的会直接刷新（多份拷贝、热更新都不报警）。生产构建里警告连同文案会被你的打包器折叠掉（见[开发模式警告](#开发模式警告)）。
- 不冻结对象，完整版要往上补属性；**适配层（`/vue` `/react` `/svelte`）不挂**。
- 类型：导入任一入口后，全局 `skz` 带类型（`SkzGlobal`），不需要自己声明。

### 无打包器：浏览器直接用（import map）

不用打包器时，JS 入口不能直接 import（开头是 CSS 导入）：CSS 另用 `<link>` 引，模块用一份去掉那一行的拷贝，或者让你自己的构建脚本去掉它。最稳的做法是加一个很小的构建步骤；临时页面也可以把文件取下来、删掉第一条 `import "./full.css";` 语句再自己托管。`exports` 指向的文件：

| 模块名              | 文件            | 说明                                                  |
| ------------------- | --------------- | ----------------------------------------------------- |
| `skeletonizer`      | `dist/full.mjs` | 完整版；开头是 `import "./full.css"`；`full.css` 另引 |
| `skeletonizer/lite` | `dist/lite.mjs` | lite；开头是 `import "./lite.css"`；`lite.css` 另引   |

CSS 文件：`dist/full.css`、`dist/lite.css`。每个 `.mjs` 都自包含（没有共享块），要托管的就这一个文件。

```html
<link rel="stylesheet" href="/vendor/skeletonizer/full.css" />

<script type="importmap">
  { "imports": { "skeletonizer": "/vendor/skeletonizer/full.mjs" } }
</script>

<script type="module">
  import { enable, Bone } from "skeletonizer"; // 去掉第一行（CSS 导入）的 full.mjs；导入时也会挂全局 skz

  const off = enable(document.querySelector("#card"), { effect: "shimmer" });
  // 数据到了：off();
</script>
```

- import map 要放在第一个 module 脚本之前；`full.mjs` 和 `lite.mjs` 千万不要同时引。
- 浏览器会因为第一行去把 `./full.css` 当模块加载而报错，所以这种用法必须去掉那一行（打包器则会把它变成样式表链接）。

## 选择入口

整个包就是下面这些文件（`dist/`）。体积是 `pnpm build` 产物的 `gzip -9 -n`（1 KB = 1024 字节）；每个 JS 文件都自包含，没有共享块，也没有带哈希的文件。

| 导入                                              | 文件                                                 | 内容                                                                                                                                                                              | 体积（gzip）                                        |
| ------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `skeletonizer`（**完整版**，默认）                | `full.mjs` + `full.css`                              | core + 完整版扩展（文字模式、方案调度、懒渲染）+ global / svg 两个方案 + `registerEngine` + 全局 `skz`；开头是 `import "./full.css"`                                              | 3.91 + 2.32 = **6.23 KB**                           |
| `skeletonizer/lite`                               | `lite.mjs` + `lite.css`                              | core 运行时（`enable` / `disable` / `Bone` / `registerExtension`）+ 全局 `skz`；开头是 `import "./lite.css"`                                                                      | 2.27 + 1.98 = **4.26 KB**                           |
| `skeletonizer/full.css`                           | `full.css`                                           | 只要完整版样式（SSR 首屏 / 无打包器 / CDN）：主题、交互锁、标记、忽略区、第 0 / 1 / 2 档、fade / solid / 减少动态效果、根驱动、`fit`、懒渲染暂停、`skz-cv`、防火墙与 svg 降级规则 | 2.32 KB                                             |
| `skeletonizer/lite.css`                           | `lite.css`                                           | 只要 lite 样式：主题、交互锁、标记、第 0 档 + 现代档、fade / solid / 减少动态效果、根驱动、`fit`                                                                                  | 1.98 KB                                             |
| `skeletonizer/vue`、`/react`、`/svelte`、`/solid` | `vue.mjs` / `react.mjs` / `svelte.mjs` / `solid.mjs` | 框架适配层：只有胶水，不含 core 代码、不带样式；从 `globalThis[Symbol.for("skeletonizer")]` 取 API                                                                                | vue 0.83 / react 0.59 / svelte 0.42 / solid 0.64 KB |
| `skeletonizer/element`                            | `element.mjs`                                        | `<skz-box>` 自定义元素（`defineSkzBox` / `SkzBox`）：只有胶水，不含 core 代码、不带样式（CSS 随 lite / full）；导入没有副作用，调用 `defineSkzBox()` 才注册                       | 0.82 KB                                             |

每个 `.mjs` 旁边有对应的 `.d.mts`（`full.d.mts`、`lite.d.mts` ……）。`lite.d.mts` 是类型底座；`full.d.mts` 从它再导出并用 `declare module "skeletonizer/lite"` 把它变宽；适配层的类型从 `skeletonizer/lite` 引。

```ts
// 完整版（默认）：全部功能，一行
import "skeletonizer";

// lite：更小的构建，两者同一页面只能引一个
import "skeletonizer/lite";

// 配适配层：先导入一个实现（一次），再用适配层
import "skeletonizer";
import { SkzBox } from "skeletonizer/vue";
```

- 完整版里，方案（`global` 防火墙 / `svg`）在运行时用 `enable(el, { engine })` 选，不再有分方案的入口。
- `explicit` 没有了：`lite.css` 已经包含它的全部内容（见[升级到 0.3.0](#升级到-030)）。

## 升级到 0.3.0

0.3.0 把 `dist/` 里的 37 个文件合并成**两个自包含的构建加适配层**。破坏性改动如下（完整的变更记录在 [CHANGELOG](./CHANGELOG.md)）：

| 0.2.x                                                                                                            | 0.3.0                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `import "skeletonizer"`（core，`core.css`）                                                                      | `import "skeletonizer/lite"`（`lite.css`）             |
| `skeletonizer/full`、`/all`、`/global`、`/svg`（及 `/all/js`、`/global/js`、`/svg/js`）                          | `import "skeletonizer"`（新的默认，= 原来的 `all`）    |
| `skeletonizer/explicit`、`explicit.css`                                                                          | 删除；用 `skeletonizer/lite`（"只认标记"本来就是默认） |
| `skeletonizer/core.css`                                                                                          | `skeletonizer/lite.css`                                |
| `base.css`、`global.css`、`svg.css`、`all.css`、`style.css`                                                      | `skeletonizer/full.css`（= 基底 + 全部变体）           |
| `import "skeletonizer/base.css"` + `import "skeletonizer/global"` + `import { enable } from "skeletonizer/full"` | `import { enable } from "skeletonizer"`                |

1. **默认入口现在是完整版。** `import "skeletonizer"` 带来完整版运行时和 `full.css`；原来的 core 是 `skeletonizer/lite`。
2. **所有旧子路径删除**：`./full`、`./explicit`、`./global`、`./svg`、`./all`（及各自的 `/js`）和 CSS 子路径 `./core.css`、`./base.css`、`./explicit.css`、`./global.css`、`./svg.css`、`./sweep.css`、`./all.css`、`./style.css`。CSS 子路径只剩 `./full.css` 和 `./lite.css`。
3. **每个 JS 文件自包含，开头带自己的 CSS 导入**；`node` 条件和纯 JS 的 `*-js` 构建都没有了。没有打包器的纯 Node 不能再直接 import `skeletonizer` / `skeletonizer/lite`（见 [SSR 与 Node](#ssr-与-node)）。
4. **`skeletonizer` 和 `skeletonizer/lite` 不要在同一页面同时引**，各自带一份 core。
5. **适配层不再打包 core。** 它们从 `globalThis[Symbol.for("skeletonizer")]` 取 API；应用入口要导入一次 `skeletonizer` 或 `skeletonizer/lite`，否则开发模式警告、适配层什么也不做。适配层的选项类型以 `skeletonizer/lite` 为底，项目里导入 `skeletonizer` 后变宽。
6. **`explicit` 删除。** 只认标记本来就是默认行为（推导要 `skz-auto`），`explicit.css` 是 `lite.css` 的子集；它带的懒渲染规则只对完整版 JS 有意义，完整版里本来就有。
7. **类型**：增强目标从 `declare module "skeletonizer"` 改成 `declare module "skeletonizer/lite"`；自己对 `"skeletonizer"` 做过类型增强的代码，改成增强 `"skeletonizer/lite"`。

## 升级到 0.2.0

> 本节里的入口和文件名是 0.2.x 的旧名字，与今天名字的对应关系见[升级到 0.3.0](#升级到-030)。

0.2.0 把默认从"按标签推导骨头"改成"你自己标"。破坏性改动如下（完整的变更记录在 [CHANGELOG](./CHANGELOG.md)）：

1. **默认改为显式标记。** 没有任何标记、也不在 `skz-auto` 区域里的内容原样显示。文字用 `skz-text`（块元素里包一层 `<span>` 再打），图片 / 头像 / 按钮 / 色块用 `skz-bone`，要合并的容器用 `skz-leaf`。无法改标记的第三方组件，在根或根内任意元素上写裸属性 `skz-auto`：原来的推导规则（第 0 档、图标、控件、leaf 模式）现在只作用于该子树。见[标记骨头](#5-标记骨头)。
2. **根上的 `skz-text` 属性改名为 `skz-text-mode`**（取值 `round` / `clip` / `underline` / `leaf`）。`text` 选项不变，只是写到新属性；手写根属性的要同步改名。`skz-text` 现在是元素级标记。
3. **新的默认文字模式 `round`。** 文字条变成带圆角的背景盒（见[文字骨头模式](#文字骨头模式)）。要回到原来的外观，根上写 `skz-text-mode="clip"`（完整版 `text: "clip"`）。lite 与 `explicit.css` 手写 `round` / `clip` 也认。
4. **移除 `skz-has-ignore`**，忽略区只靠 `skz-ignore`、纯 CSS 生效，`enable()` 不再为它写任何属性。「含忽略区的祖先关下划线」的修正规则也一并去掉：忽略区放在 `skz-text` 元素或 `skz-auto` 区域内时，它的文字显示在骨头条之上；想要干净的忽略区，写成兄弟元素：`<span skz-text>价格</span> <span skz-ignore>实时</span>`。
5. **`explicit.css` / `skeletonizer/explicit` 的含义变成「不含 `skz-auto` 推导规则」**，同样支持 `skz-text`（round / clip）、`skz-bone`、`skz-leaf`、`skz-ignore`。`lite.css` 与 `base.css` = 标记 + 门控在 `skz-auto` 上的推导。
6. **浏览器门槛**：推导和标记规则用了 `:is()` / `:where()`（Chrome 88+ / Safari 14+ / Firefox 84+；标记规则里的 `:not()` 用了选择器列表）。CSS 按这条线降级（chrome88 / firefox84 / safari14），JS 产物是 ES2015，不带 polyfill。

CSS 不再依赖 JS：手写根属性 `skz` 就能得到正确渲染（交互锁、懒渲染暂停、防火墙、运行时 SVG 属于性能 / 降级路径，不影响正确性）。

## 从 0.1.0 之前的布局迁移

0.1.0 之前的预览布局（一个入口包含全部）早已不存在，迁移说明保留在 [CHANGELOG](./CHANGELOG.md)（0.1.0）里。那里提到的入口名（`skeletonizer/full` 等）后来又改过，当前名称以[升级到 0.3.0](#升级到-030)为准。

## 功能总表

所有选项、属性、变量、入口和 API 的作用 / 最短用法 / 限制都在这张表里，「版本」列标明每项属于 lite 还是完整版（两者 = 都有；仅完整版 = lite 里没有；仅 lite = 只有 lite 才有的东西）；总表放不下的细节见[各方案详解](#各方案详解)和[已知限制与使用约束](#已知限制与使用约束)；标记和属性的完整枚举（含各模式 / 入口 / 档位下的表现）见[标记与属性参考](#标记与属性参考)。表里的性能数字（帧率 / 每帧样式重算 / 开启耗时，"4000 / 16000 元素"）统一取文字模式 **clip**（0.2.0 之前的默认）下的数据（出自[方案对比](#方案对比)的 clip 补测与落地复测），新默认 `round` 没有逐表重测（原型实测 GPU 约为 clip 的一半）；只有原矩阵测过、没为 clip 重测的，数字旁标了"underline 时测得"。桌面 Chrome、单次正向测量，差距在 2 倍以内的别当真。

| 项                                                | 版本     | 作用                                                                                                                                                                                                                                                                                                                                                                                                                          | 用法                                                                                                                | 受限                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **效果**                                          |          |                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `fade`（默认）                                    | 两者     | 根整体 opacity 脉冲（1 → `--skz-fade-min`，默认 0.55），跑在合成器线程，几乎零成本；不写 `skz-effect` 就是它                                                                                                                                                                                                                                                                                                                  | `enable(el)`<br>`enable(el, { effect: "fade" })`<br>`<div skz>`                                                     | 根里有 `skz-ignore` 时隐式默认不开，要显式写 `effect: "fade"`；会把根里的一切（含忽略区）一起淡出；不支持 `@property` 的老浏览器里 pulse / shimmer 也退回它（完整版的 global 会由 JS 改挂 SVG 动画）<br>4000 / 16000 元素都是 60 帧、样式重算 0.14 / 0.33 ms，开启 24 / 106 ms<br>lite 实测（clip 默认，Chrome 154，每格新鲜加载）：2000 / 4000 元素 fade 都是 60.4 帧、样式重算 0.12 / 0.14 ms，solid 60.4 帧、样式重算 0；lite 的 fade 在 4× CPU 降速下没单独测，见 [lite 的规模上限](#lite-的规模上限)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `solid`                                           | 两者     | 静止的骨头色，没有动画                                                                                                                                                                                                                                                                                                                                                                                                        | `enable(el, { effect: "solid" })`<br>`skz-effect="solid"`                                                           | 基底自带，无额外限制<br>60 帧、样式重算 0.00 ms，开启 22 / 109 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pulse`                                           | 两者     | 骨头颜色在 `--skz-color` 与 `--skz-highlight` 之间来回脉冲（根驱动：根上一个动画驱动，lite 和完整版都有；完整版另可选 svg：共享 SVG 动画图）                                                                                                                                                                                                                                                                                  | `enable(el, { effect: "pulse" })`（lite 不用另引；完整版想要防火墙再 `import "skeletonizer/global"`）               | 根驱动需 `@property`（Chrome 119+ / Safari 16.4+ / Firefox 128+）：低于门槛 lite 退回 fade，完整版的 global 由 JS 改挂 SVG 动画；纯 CSS 大骨架很慢，lite 没有继承防火墙（规模上限见 [lite 的规模上限](#lite-的规模上限)）<br>lite（无防火墙，正常速度）：1000 / 2000 / 4000 元素 60.4 / 60.4 / 59.2 帧，样式重算 3.05 / 6.18 / 11.56 ms；6000 元素 46.4 帧、16000 元素 18.4 帧；4× CPU 降速下 504 元素 40.8 帧、2000 元素 21.2 帧（均为 clip，数据与口径见 [lite 的规模上限](#lite-的规模上限)）<br>完整版 2000 卡（16000 元素）`global` pulse（落地后复测）：clip 60.4 帧 / 样式重算 6.95 ms，underline 60.4 / 9.66；落地前 clip 因防火墙漏钉 `--skz-tbg` 曾掉到 22.8 帧 / 33.7 ms（已修复；现在 clip 根上不再转发逐帧变化的 `--skz-tbg`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `shimmer`                                         | 两者     | 高光光带在每个骨头自己的盒子里扫（光带固定 300px，进度由根统一驱动，各骨头同时起步、同时走完），所有平台一样                                                                                                                                                                                                                                                                                                                  | `enable(el, { effect: "shimmer" })`（lite 不用另引；完整版想要防火墙再 `import "skeletonizer/global"`）             | 同 pulse；round / clip 文字条里也有光带，显式 `text: "underline"` 的文字没法渐变（global 改为颜色脉冲、svg 保持静止）<br>光带按骨头自身盒子扫之后的性能数据尚未重测，下面是改前的实测（原理上滚动时不再因 fixed 背景走主线程重绘，应不差于原来）<br>lite（无防火墙，正常速度，默认光带降频）：1000 / 2000 / 4000 元素都是 60.4 帧，样式重算 1.27 / 2.61 / 5.05 ms；6000 元素 58 帧、16000 元素 16.8 帧；4× CPU 降速下 504 元素 52 帧、2000 元素 17.2 帧（clip，见 [lite 的规模上限](#lite-的规模上限)）<br>完整版 `global` + `enable()`（2000 卡 = 16000 元素，落地后复测）：60.4 帧 / 样式重算 3.19 ms，开启 85 ms（clip 补测批）；`svg`：58.8 帧 / 0.05 ms，开启 140 ms（clip 补测；落地后复测批同场景 50.4 帧，批间漂移，见[方案对比](#方案对比)）；纯 CSS 无 JS：20.8 帧 / 41.3 ms（underline 时测得，clip 未重测）；`explicit.css` + `global`：2.60 ms、开启 50 ms（underline 时测得）<br>无列表结构页（双栏表单，clip 补测）：`global` 11.2 帧 / 75.0 ms，`svg` 52.8 帧 / 0.04 ms<br>默认降频到 24 次/秒（`--skz-shimmer-timing`，只对根驱动：lite 与 `global`）：2000 卡 clip 的 GPU 10.44 → 3.05 ms、underline 5.35 → 1.63 ms（落地后复测）；4× CPU 降速下默认档没收益（clip 18.4 帧，与落地前持平），`steps(18)` 下 clip 到 40 帧，underline 仍 14~15 帧 |
| **入口 / 变体**                                   |          |                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `full.css`                                        | 仅完整版 | 完整版样式：主题变量、交互锁、显式标记、忽略区、`skz-auto` 区域里的三档推导、fade / solid、根驱动（纯 CSS pulse / shimmer）、懒渲染暂停、减少动态效果、`skz-cv` 与 `fit` 的 CSS、防火墙与 svg 降级规则                                                                                                                                                                                                                        | `import "skeletonizer/full.css"`（入口 `skeletonizer` 已经带上它）                                                  | 2.32 KB；pulse / shimmer 开箱即用（根驱动，防火墙由 `enable()` 在运行时启动）；推导选择器（只在 `skz-auto` 区域里匹配）让每帧样式重算比 lite 贵                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `skeletonizer`（完整版，默认入口）                | 仅完整版 | 完整版：core 运行时 + 完整版扩展（文字模式、方案调度、懒渲染）+ global / svg 两个方案 + `registerEngine` + 全局 `skz`；文件开头是 `import "./full.css"`                                                                                                                                                                                                                                                                       | `import "skeletonizer"`                                                                                             | JS 3.91 KB + CSS 2.32 KB；要打包器（见 [SSR 与 Node](#ssr-与-node)）；不要和 `skeletonizer/lite` 一起引                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `lite.css`                                        | 仅 lite  | lite 样式：主题与交互锁 + 显式标记 + 第 0 档（`skz-auto` 区域）+ 现代档（一个 `@supports` 同时要 `text-decoration-thickness` 与 `:has()`：`skz-text` 文字条，以及 `skz-auto` 区域的推导）+ fade / solid / 减少动态效果 + `fit` + 根驱动（pulse / shimmer）                                                                                                                                                                    | `import "skeletonizer/lite.css"`                                                                                    | 1.98 KB；低于门槛只有第 0 档静态色块（仅 `skz-auto` 区域）、`skz-bone` / `skz-leaf` 标记和 fade；文字条规则只匹配没写 `skz-text-mode` 或写了 `round` / `clip` 的根；没有 underline / leaf、防火墙、SVG 降级、懒渲染、`skz-cv`；SSR 首屏 / 无打包器 / CDN 时手动引；**不要和 `full.css` 同时引**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `skeletonizer/lite`                               | 仅 lite  | lite：core 运行时（`enable` / `disable` / `Bone` / `registerExtension`）+ 全局 `skz`；文件开头是 `import "./lite.css"`                                                                                                                                                                                                                                                                                                        | `import "skeletonizer/lite"`                                                                                        | JS 2.27 KB + CSS 1.98 KB；要打包器；不要和 `skeletonizer` 一起引                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `global` 方案                                     | 仅完整版 | 继承防火墙 + 老浏览器 JS 挂 SVG 降级（pulse / shimmer 的根驱动在基底里）                                                                                                                                                                                                                                                                                                                                                      | 内置在 `skeletonizer` 里；`engine: "global"`（默认）选用                                                            | 不再有单独入口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `svg` 方案                                        | 仅完整版 | pulse / shimmer 用一张共享 SVG 动画背景，按主题运行时生成精确颜色，不依赖 `@property`                                                                                                                                                                                                                                                                                                                                         | 内置在 `skeletonizer` 里；`enable(el, { engine: "svg" })`                                                           | 不再有单独入口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 框架适配层                                        | 两者     | `skeletonizer/vue` / `/react` / `/svelte` / `/solid`：只有胶水，不含 core 代码、不带样式；从 `globalThis[Symbol.for("skeletonizer")]` 取 API                                                                                                                                                                                                                                                                                  | 先导入一次 `skeletonizer` 或 `skeletonizer/lite`，再用适配层                                                        | 每个 0.5–0.9 KB；没导入实现时开发模式警告一次，适配层什么也不做                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `skeletonizer/element`（`<skz-box>`）             | 两者     | `defineSkzBox` / `SkzBox`：独立入口里的自定义元素，只有胶水，不含 core 代码、不带样式；从 `globalThis[Symbol.for(\"skeletonizer\")]` 取 API                                                                                                                                                                                                                                                                                   | 先导入一次 `skeletonizer` 或 `skeletonizer/lite`，再 `defineSkzBox()`                                               | 0.82 KB gzip；导入没有副作用；没导入实现时开发模式警告一次，元素什么也不做                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 纯 CSS 子路径                                     | 两者     | `skeletonizer/full.css` 和 `skeletonizer/lite.css`（只有这两个）                                                                                                                                                                                                                                                                                                                                                              | `<link>` 引                                                                                                         | 见“无打包器”和“SSR 首屏”                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| JS 里的 CSS 导入                                  | 两者     | `full.mjs` 和 `lite.mjs` 开头是 `import "./full.css"` / `import "./lite.css"`，打包器一并打进样式                                                                                                                                                                                                                                                                                                                             | 自动                                                                                                                | 没有打包器的纯 Node 不能直接 import，见 [SSR 与 Node](#ssr-与-node)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **`enable()` 选项**                               |          |                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `effect`                                          | 两者     | 动画效果，写到根的 `skz-effect`                                                                                                                                                                                                                                                                                                                                                                                               | `enable(el, { effect: "shimmer" })`                                                                                 | 取值 `fade`（默认）/ `solid` / `pulse` / `shimmer`；pulse / shimmer 开箱即用（根驱动在基底里），低于 `@property` 门槛时 lite 退回 fade、完整版的 global 由 JS 改挂 SVG 动画                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `text`                                            | 仅完整版 | 文字骨头画法，写到根的 `skz-text-mode`                                                                                                                                                                                                                                                                                                                                                                                        | `enable(el, { text: "clip" })`                                                                                      | 仅完整版，lite 里传了会被忽略（lite 只有 round / clip，手写 `skz-text-mode="round"` / `"clip"` 也认）。`round`（默认，不写即是；需 `box-decoration-break`，不认的浏览器退回 clip）：文字透明 + 带圆角的背景盒，行内元素折行后每行一条圆角条，块元素整块一个圆角矩形，所以 `skz-text` 要打在内层 `<span>` 上；光带、svg 引擎下与 clip 一样，GPU 约为 clip 的一半（原型实测），局限见[文字骨头模式](#文字骨头模式)。`clip`（显式写；需 `background-clip: text`，不认这个属性的浏览器由 `@supports not` 撤回、退回 underline；规范要求装饰线参与裁剪，**仅 Chrome 实测过，Firefox / Safari 未验证，是已知风险**）：下划线当形状、`background-clip: text` 当填充，文字条跟字形走，svg 引擎下也能动；比 underline 贵（见[方案对比](#方案对比)的 clip / underline 对照）；`skz-auto` 区域里不在文字标签清单里的裸文字（如 div 里直接写的文本）会不可见；`underline`（显式写 `text: "underline"`，需 `text-decoration-thickness`）：**最便宜**，不能渐变、没有圆角，shimmer 时文字只是颜色脉冲、svg 下静止，低端机 / 追求最省时选它；`leaf`（需 `:has()`）：`skz-text` 元素整块变一块骨头，`skz-auto` 区域里多行块级文字变成一整块矩形，混合文字里的裸文字节点不出骨头，详见[文字骨头模式](#文字骨头模式)；`explicit.css` 只认 round / clip                              |
| `engine`                                          | 仅完整版 | pulse / shimmer 的实现：`global` / `svg`                                                                                                                                                                                                                                                                                                                                                                                      | `enable(el, { effect: "shimmer", engine: "svg" })`                                                                  | 只对 pulse / shimmer 有效；不传时按已引入的变体决定：有 global 用 global，只有 svg 用 svg，都没引入按 global（纯 CSS 根驱动）<br>指定了没引入的方案（Chrome 154 实测）：只引 `global`、传 `engine: "svg"`，**不会退回 fade**，照常是 global 的根驱动 shimmer（CSS 不看 `engine`），只是没有继承防火墙（120 项的列表里 `skz-fw` 为 0，对照默认 110）和老浏览器 SVG 降级；只引 `svg`、传 `engine: "global"`，**退回基底 fade**（根动画是 `skz-fade`、没有光带）<br>显式传了没注册的方案时，开发模式（`process.env.NODE_ENV` 不是 production）会 `console.warn` 一次，生产构建里摘掉                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `fallback`                                        | 仅完整版 | global 在不支持 `@property` 的浏览器里的降级：`svg`（默认，JS 挂 blob SVG 动画）/ `fade`（保持基底 fade）                                                                                                                                                                                                                                                                                                                     | `enable(el, { effect: "shimmer", fallback: "fade" })`                                                               | 只在 global 方案且浏览器不支持 `@property` 时生效；`svg` 降级需 `global` 变体的 JS，且 CSP 要放行 `img-src blob:`；JS 执行前（含 SSR 首屏）和 blob 生成失败时一律是 fade；降级分支在本机 Chrome 里只能模拟，`fallback: "fade"` 没测                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `fit`                                             | 两者     | 骨架自身绝不撑出滚动条：根高度限制在滚动祖先（没有则视口）的剩余空间内，完全落在外面的列表项 `display: none`                                                                                                                                                                                                                                                                                                                  | `enable(el, { fit: true })`<br>`<skz-box loading fit>`                                                              | 开启耗时贵：2000 张卡（16000 元素）约 767 ms（对照不开 fit 的 shimmer 85 ms，clip 补测；underline 时测得 519 ms 对 61 ms），500 张约 48 ms（underline 时测得）；每帧 60 帧 / 样式重算 5.07 ms，2000 项里 1994 项被隐藏；会写根的内联 `max-height` 和项的 `skz-fit-hide`；只在边界 / 窗口尺寸变化时重算，内容变了再调一次 `enable()`；SSR 里什么都不做；没有 `ResizeObserver` 时有滚动祖先只测一次                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 重复调用 `enable()`                               | 两者     | 幂等：按本次选项重新同步属性，重新扫描列表项、忽略区、主题变量                                                                                                                                                                                                                                                                                                                                                                | `enable(el, opts)` 多次                                                                                             | 没传的选项会被清掉（不是合并）；开启后才插入的列表项、变化后的忽略区，要靠再调一次 `enable()` 纳入                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **自动机制**                                      |          |                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 继承防火墙                                        | 仅完整版 | 视口外的列表项打 `skz-fw`，CSS 在这些项上把动画源变量 `--skz-pulse-c` / `--skz-shimmer-p` 钉成静态值，并重声明由它们派生的 `--skz-fill`（pulse）、`--skz-bg-pos`（shimmer）、`--skz-ul-fill`（underline 根），它们的后代不再参与逐帧重算；16000 元素回到 60 帧                                                                                                                                                                | 自动：`enable()` / 适配层 + `global` 变体，无需手写                                                                 | 仅完整版（lite 没有）；只作用于 global 的 pulse / shimmer；需要 JS 与 `IntersectionObserver`（没有则跳过）；需要列表结构：从根往下跳过单子元素的包裹层，取第一个有多个子元素的层，不足 2 项不启用；双栏表单这类页面上等于没开，改用 `svg`；视口外的项里骨头静止，滚进前 200px 恢复；开启后新插入的项要再调 `enable()`；只引 `svg` 时不含防火墙<br>详见 [global](#根驱动-pulse--shimmer-与-global-变体)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 老浏览器 SVG 降级                                 | 仅完整版 | 不支持 `@property` 时，JS 给根挂 blob 生成的 SVG 动画，颜色精确                                                                                                                                                                                                                                                                                                                                                               | 自动：引入 `global` + `enable()`；`fallback: "fade"` 可关掉                                                         | 按 `CSS.supports("color", "rgb(from red r g b)")` 判断（Chrome 119+ / Safari 16.4+ / Firefox 128+），Chrome 85~118 被保守判为不支持；JS 执行前和 blob 失败时是 fade；严格 CSP 需 `img-src blob:`；降级路径没在真机验证                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 懒渲染（`skz-paused`）                            | 仅完整版 | `enable()` 开启的根滚出视口（含 100px 缓冲）时，CSS 移除它的动画，滚回来恢复；全库一个共享 `IntersectionObserver`                                                                                                                                                                                                                                                                                                             | 自动，无需配置（扩展在完整版 JS 里，样式在 `base.css` / `explicit.css`；lite 没有）                                 | 只观察根：大根露一角就整体在动（`skz-cv` 补这个盲区）；没有 `IntersectionObserver` 时跳过；纯 HTML 手写的根没有这个机制                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 交互锁（`inert`）                                 | 两者     | `enable()` 给根加 `aria-busy="true"` 并设原生 `inert`；根里有 `skz-ignore` 时只锁不含忽略区的分支，忽略区保持可点、可聚焦                                                                                                                                                                                                                                                                                                     | 自动                                                                                                                | 忽略区有变化要再调一次 `enable()` 重新上锁；不支持 `inert` 的浏览器退回 CSS `pointer-events: none` + `focusin` 拦截（同样放过忽略区），该分支未在真机验证；纯 HTML 手写的根只有 CSS 层的 `pointer-events` / `user-select` 锁，没有 `inert`<br>详见 [`inert` 属性支持](#inert-属性支持)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 减少动态效果                                      | 两者     | `prefers-reduced-motion: reduce` 时所有动画停止，骨头静止显示                                                                                                                                                                                                                                                                                                                                                                 | 自动                                                                                                                | 没有关闭开关，也不能只对某个根关掉                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 自动推导骨头（`skz-auto`）                        | 两者     | 只在 `skz-auto` 区域里：文字类标签（`p` `span` `h1`~`h6` `a` `li` `label` `td` `th` `strong` `b` `em` `small` `dt` `dd` `blockquote` `figcaption`）、媒体与控件（`img` `video` `canvas` `picture` `iframe` `svg` `input` `textarea` `select` `button`）、空的 `<i>` 和类名带 `icon` 的空元素，自动变成骨头                                                                                                                    | lite：`import "skeletonizer"`；完整版：引入 `base.css`；在根或根内任意元素上加 `skz-auto`                           | `explicit.css` 里没有这一层；不写 `skz-auto` 就不推导（靠标记）。规则基于标签白名单，CSS 选不到文本节点，所以直接写在 div / 自定义元素 / `code` 里的文本在 round / clip 下**不出骨头（不可见）**：包进 `p` / `span`、自己标 `skz-text`，或用 `text: "underline"`；块级文字标签在 round 下是整块圆角矩形；用 div 做的图片 / 头像 / 色块（空元素）不在范围内，要加 `skz-bone`；控件（`button` / `input` / `textarea` / `select`）整块当一块骨头、不画下划线，详见[按钮与表单控件](#按钮与表单控件)；lite 只有第 0 档 + 现代档（一个 `@supports` 同时要 `text-decoration-thickness` 与 `:has()`），低于门槛只有第 0 档静态色块；完整版保留四档渐进（见[浏览器支持与降级](#浏览器支持与降级)），图标识别、叶子模式需要 `:has()`；需要 `:is()` / `:where()`（Chrome 88+ / Safari 14+ / Firefox 84+）                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 开发模式警告                                      | 两者     | 开发模式（`process.env.NODE_ENV` 不是 production）下 `console.warn` 一次（同一条只提示一次）：① 全局 `skz` 已被别人占用，未覆盖；② 完整版里显式传了没注册的 `engine`（只引了 `global` 却写 `engine: "svg"`，或反过来）                                                                                                                                                                                                        | 自动                                                                                                                | 生产构建里不会留下：每个调用点都包在守卫 `try { if (process.env.NODE_ENV !== "production") … } catch {}` 里，产物里保留 `process.env.NODE_ENV` 原样，使用方的打包器替换并压缩后，调用和文案一起折叠掉（测试里用生产模式 vite 构建验证）；浏览器直引（没有 `process`）时守卫为假，不提示                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **标记属性**                                      |          |                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `skz`                                             | 两者     | 根：骨架开启                                                                                                                                                                                                                                                                                                                                                                                                                  | `enable()` / 适配层自动加；纯 HTML：`<div skz>`                                                                     | 是属性不是 class；`<skz-box>` 里写在宿主的第一个元素子节点上，宿主自己不带；纯 HTML 手写拿不到防火墙、运行时 SVG 和 `inert`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `skz-effect`                                      | 两者     | 根：效果，值同 `effect` 选项                                                                                                                                                                                                                                                                                                                                                                                                  | `<div skz skz-effect="shimmer">`                                                                                    | 由 `enable()` 写入并在重复调用时按选项覆盖 / 清除；纯 HTML 手写 pulse / shimmer 没有防火墙，svg 方案没有运行时图（退回 fade）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `skz-text-mode`                                   | 仅完整版 | 根：文字骨头画法，值同 `text` 选项（`round` / `clip` / `underline` / `leaf`；不写 = round）                                                                                                                                                                                                                                                                                                                                   | `<div skz skz-text-mode="clip">`                                                                                    | 同 `text` 选项的限制；`lite.css` / `explicit.css` 也认手写的 `round` / `clip`；这是改名后的根属性（以前叫 `skz-text`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `skz-text`                                        | 两者     | 元素：整个子树的文字按真实文字行出条（最后一行较短）；标在容器上也覆盖混合内容（`<div skz-text>价格：<b>¥5</b></div>`）                                                                                                                                                                                                                                                                                                       | `<h3><span skz-text>标题</span></h3>`                                                                               | 在 `skz-auto` 区域内外都生效，写在根自身上不读取；`skz-ignore` / `skz-bone` / `skz-leaf` 元素及其内部不当目标；外观跟随根上的 `skz-text-mode`；**推荐打在内层 `<span>` 上**：块元素上 round 画整块圆角矩形；需要 `text-decoration-thickness`（lite / `explicit.css` 另需 `:has()`），低于门槛时显示真实文字                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `skz-auto`                                        | 两者     | 根或根内任意元素：只对该子树开启按标签的推导（第 0 档、图标、控件，另有 leaf 模式），给无法改标记的第三方组件用                                                                                                                                                                                                                                                                                                               | `<div skz-auto>…</div>`                                                                                             | `explicit.css` 里没有；根级变量仍挂在 `skz` 根上，不经过 `skz-auto`；局限同「自动推导骨头」一行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `skz-engine`                                      | 仅完整版 | 根：`svg`，SVG 方案的 blob 图挂上后由 JS 写入                                                                                                                                                                                                                                                                                                                                                                                 | 不要手写                                                                                                            | 没有这个属性就是基底 fade（svg 方案没有内置 SVG 兜底图）；读不到主题变量或不支持 blob 时 JS 不写                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `skz-cv`                                          | 仅完整版 | 根：直接子元素加 `content-visibility: auto`，滚出视口的子元素连样式、布局、绘制都跳过；`--skz-cv-size`（默认 `200px`）是未渲染子元素的估高                                                                                                                                                                                                                                                                                    | `<div skz skz-cv>`<br>`<div skz skz-cv style="--skz-cv-size: 120px">`                                               | 在 `base.css` / `explicit.css` 里，`lite.css` 没有；子元素溢出的部分被裁掉；估高不准时滚动会跳；开启慢约 3.5 倍（16000 元素 207 ms，对照 58 ms）；需浏览器支持 `content-visibility`<br>以下 underline 时测得、clip 未重测：纯 CSS 无 JS，16000 元素 60 帧 / 6.76 ms（不加是 25 帧 / 35.3 ms）；叠加 `enable()` 反而更差（样式 6.63 ms + PrePaint 1.38 ms，对照 4.67 + 0.15）；有列表结构时优先用防火墙<br>详见 [懒渲染与 `skz-cv`](#懒渲染与-skz-cv)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `skz-bone`                                        | 两者     | 元素：强制本元素当骨头（div 做的图片、头像、色块）                                                                                                                                                                                                                                                                                                                                                                            | `<div class="avatar" skz-bone></div>`                                                                               | 骨头内部的后代被藏起来；`img` / `video` / `canvas` 骨头把真实内容推出盒子；圆角默认 `var(--skz-radius)`，元素自己写了 `border-radius` 则保留（依赖 `:where()`）；`skz-auto` 区域之外它与 `skz-text` / `skz-leaf` 一起是骨头的来源                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `skz-leaf`                                        | 两者     | 元素：本元素整块当一个骨头，子树全藏                                                                                                                                                                                                                                                                                                                                                                                          | `<div skz-leaf>…</div>`                                                                                             | 子树的文字、下划线全部隐藏；圆角规则同 `skz-bone`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `skz-host`                                        | 两者     | 元素：Web Component 宿主（Shadow DOM）整块当一个骨头；内部藏起来，由 `::before` 铺骨头                                                                                                                                                                                                                                                                                                                                        | `<my-card skz-host></my-card>`                                                                                      | lite.css 与 full.css 里的静态 CSS（取代 0.2.x 的 `registerCustomElements()`）；只在 `skz` 根内生效；宿主 `visibility: hidden`，骨头是它的 `::before`，读与 `skz-bone` 同一套 `--skz-fill` / `--skz-bg-img` / `--skz-bg-pos`，所以 pulse / shimmer、`svg` 引擎、防火墙都对它生效；写了 `skz-ignore` 的宿主不处理；shadow root 里面的样式要你自己引入                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `skz-ignore`                                      | 两者     | 元素：保持原样、可点击、可聚焦（如"取消加载"按钮）                                                                                                                                                                                                                                                                                                                                                                            | `<button skz-ignore>取消加载</button>`                                                                              | 放在 `skz-text` 元素或 `skz-auto` 区域内时，它的文字显示在骨头条之上（想要干净的忽略区写成兄弟元素：`<span skz-text>价格</span> <span skz-ignore>实时</span>`）；忽略区后代自带的背景在 Tier 0、1 仍会被清掉；依赖 `currentColor` 的边框 / outline / box-shadow 会露出来；绝对定位的悬浮角标不标它会被涂成一块灰；sweep 光带会扫到它<br>详见 [`skz-ignore` 区的颜色与背景](#skz-ignore-区的颜色与背景)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `skz-paused` / `skz-fw`                           | 仅完整版 | 运行时内部状态：懒渲染 / 继承防火墙                                                                                                                                                                                                                                                                                                                                                                                           | 不要手写                                                                                                            | 由 `enable()` 的共享观察器读写，手写会被覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `skz-x`                                           | 两者     | 内部占位：样式里 `:not([skz-x])` 用来给忽略区的几条重置规则多抬一级优先级                                                                                                                                                                                                                                                                                                                                                     | 不要手写                                                                                                            | 库里没有任何代码会写它；手写在忽略区内的元素上，它会跳过那几条重置（清背景、还原文字色、去下划线），不属于公开契约，随时可能变                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `skz-fit` / `skz-fit-hide`                        | 两者     | 运行时内部状态：`fit` 的根标记（CSS 兜底 `max-height: 100dvh` + `overflow: clip`）/ 被隐藏的列表项                                                                                                                                                                                                                                                                                                                            | 不要手写（用 `fit: true`）                                                                                          | 由 `enable()` 写入、关闭时清除                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **主题变量**                                      |          |                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--skz-color`                                     | 两者     | 骨头底色，默认 `#d9dde3`（深色 `#374151`）                                                                                                                                                                                                                                                                                                                                                                                    | `[skz] { --skz-color: #e0e0e0 }`                                                                                    | 变量声明在根自身上，要写在根元素上（内联 `style` 或命中根的选择器），写在 `:root` 上不生效                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--skz-highlight`                                 | 两者     | 高光色：shimmer 光带 / pulse 亮端，默认 `#eceff3`（深色 `#4b5563`）                                                                                                                                                                                                                                                                                                                                                           | `[skz] { --skz-highlight: #f0f0f0 }`                                                                                | 同上；svg 方案的图由 JS 按它生成，改了之后要再调一次 `enable()` 才会重新生成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--skz-radius`                                    | 两者     | 骨头圆角，默认 `4px`                                                                                                                                                                                                                                                                                                                                                                                                          | `[skz] { --skz-radius: 6px }`                                                                                       | 元素自己写了 `border-radius` 则以它为准；round 文字条也读它（固定值，不随字号缩放），clip / underline 文字条没有圆角                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--skz-duration`                                  | 两者     | 动画时长；不写时 pulse / fade 是 `2s`，shimmer 按视口分三档：< 640px `2s`、≥ 640px `2.8s`、≥ 1280px `3.6s`（`fit` 模式固定 `2s`），每轮末尾停在骨头外 0.4s；写了它则 pulse / shimmer / fade 都用它（扫过占比仍按当前档，停顿不再恰好 0.4s）                                                                                                                                                                                   | `[skz] { --skz-duration: 1.2s }`                                                                                    | svg 方案按它生成图（没写则 pulse / shimmer 都用 2000 ms）；写在根上，不是 `:root`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--skz-shimmer-timing`                            | 两者     | shimmer 光带的时间函数，默认按视口档位：2s / 2.8s / 3.6s 三档分别是 `steps(38)` / `steps(58)` / `steps(77)`（`fit` 模式 `steps(38)`），扫过段 **24 次/秒**，值没变的帧不重绘；`steps(18)` = 12 次/秒更省；`linear` 恢复逐帧平滑。underline 的 pulse 动画也读它                                                                                                                                                                | `[skz] { --skz-shimmer-timing: linear }`<br>`[skz] { --skz-duration: 3s; --skz-shimmer-timing: steps(58) }`         | 档数与时长绑定：时间函数按关键帧分段生效，光带只在扫过段移动，所以 24 次/秒 = 扫过秒数 × 24，扫过秒数 = 总时长 × 当前档占比（2s / 2.8s / 3.6s 三档分别是 80% / 85.714% / 88.889%）；默认值已配好，自己写了 `--skz-duration` 才要同步改档数（上面 3s 的例子按小档算：3s × 80% = 2.4s 扫过，× 24 ≈ `steps(58)`）；**只对根驱动生效（lite 与 `global`）**，svg 引擎的光带速度由 SMIL 决定、没做降频；单独的 `effect: "pulse"` 不读它（固定 ease-in-out）；写在根或任一祖先上都行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `container-type: inline-size`（写在根或外层区域） | 两者     | 不是变量，是让 shimmer 光带按区域宽度走的开关。even 模式下光带一轮走 `max(骨头宽, 100cqw) + 300px`：`100cqw` 是最近的 query container 的宽，没有容器时等于视口宽（大屏上的小骨头会空等较久）；在根或外层写 `container-type: inline-size`，就按那块区域的宽度走（根是普通块元素时没有副作用；宽度由内容撑开的根——浮动、`inline-block`、`flex: none` 等——不要写）。不认识容器查询单位的浏览器自动改用 `100vw`。fit 模式不受影响 | `.card { container-type: inline-size }`                                                                             |
| `--skz-ul-thickness` / `--skz-ul-offset`          | 两者     | 下划线粗度（`underline` 模式默认 `1em`，clip 家族由库设为 `1.22em` 以盖住 g / p / y 的下探字形）/ 偏移（默认 `-0.85em`，clip 为 `-0.92em`）                                                                                                                                                                                                                                                                                   | `[skz] { --skz-ul-thickness: 1.1em }`                                                                               | 只对 underline / clip 文字模式有效（round 不画装饰线）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--skz-fade-min`                                  | 两者     | fade 的最低不透明度，默认 `0.55`                                                                                                                                                                                                                                                                                                                                                                                              | `[skz] { --skz-fade-min: 0.4 }`                                                                                     | 只影响 fade（含 pulse / shimmer 退回 fade 的情形）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 深色模式切换                                      | 两者     | 默认跟随 `prefers-color-scheme: dark`；也可在 `<html>` 上强制，影响 `--skz-color` / `--skz-highlight`                                                                                                                                                                                                                                                                                                                         | `<html data-skz-theme="dark">`<br>`<html data-skz-theme="light">`                                                   | 属性要写在 `<html>` 上；svg 方案的图只在系统深浅色切换时自动重新生成，手动切 `data-skz-theme` 后要再调一次 `enable()`（按代码推断，未实测）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--skz-svg-shimmer` / `--skz-svg-pulse`           | 仅完整版 | svg 方案的动画背景图（`url(…)`）                                                                                                                                                                                                                                                                                                                                                                                              | 一般不用写                                                                                                          | 通过 `enable()` 时由 JS 写入根的内联样式，会盖掉你写的值；纯 HTML 手写 `skz-engine="svg"` 时可自己提供（未验证）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 其余 `--skz-*`                                    | 两者     | `--skz-fill` / `--skz-bg-img` / `--skz-bg-pos` / `--skz-bg-size` / `--skz-pulse-c` / `--skz-shimmer-p` / 等是样式内部变量                                                                                                                                                                                                                                                                                                     | 不要手写                                                                                                            | 随版本可能变动，不属于公开契约                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **API**                                           |          |                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `enable(el, opts?)`                               | 两者     | 开启骨架：给根加 `skz`、`aria-busy="true"`、锁交互，返回关闭函数                                                                                                                                                                                                                                                                                                                                                              | `const off = enable(el, { effect: "shimmer" })`                                                                     | 前提：入口处已引入基底样式和需要的变体；需要 DOM，不能在服务端调用；根里空元素没有尺寸、不出骨头；选项见上面「`enable()` 选项」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `disable(el)`                                     | 两者     | 关闭骨架，恢复真实内容；没开启过什么都不做                                                                                                                                                                                                                                                                                                                                                                                    | `disable(el)`（或调用 `enable()` 返回的 `off()`）                                                                   | 会清掉 `skz`、`aria-busy`、`skz-effect`、`skz-text-mode` 以及 fit / 防火墙 / svg 留下的标记和内联样式                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `toggle(el, loading, opts?)`                      |          | 按布尔值开 / 关，各适配层共用                                                                                                                                                                                                                                                                                                                                                                                                 | 自己写：`loading ? enable(el) : disable(el)`                                                                        | 没有从包入口导出（`skeletonizer` 的导出里没有它），只在适配层内部使用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `<skz-box>`                                       | 两者     | 自定义元素（来自 `skeletonizer/element`）：`loading` 是开关，另有 `effect` / `text` / `fallback` / `engine` / `fit` 属性；骨架状态作用在它的第一个元素子节点上                                                                                                                                                                                                                                                                | `<skz-box loading effect="shimmer"><div class="card">…</div></skz-box>`<br>`el.loading = true`                      | 从 `skeletonizer/element` 导入并调一次 `defineSkzBox()`（应用入口另需导入一次 `skeletonizer` 或 `skeletonizer/lite` 提供 `enable` / `disable`）；light DOM、不用 shadow；`loading="false"` 视为关闭；不带 `MutationObserver`，框架把第一个子节点替换掉后要自己把 `loading` 关一下再开；宿主被移动到别的父节点后加载态自然保持；在 Vue 里要把它配成自定义元素；没加载完整版扩展时 `text` / `engine` / `fallback` 被忽略                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `defineSkzBox(tag?)`                              | 两者     | 注册 `<skz-box>`（`skeletonizer/element` 导出），可改标签名                                                                                                                                                                                                                                                                                                                                                                   | `defineSkzBox()`                                                                                                    | 重复调用安全；没有 `customElements` 的环境（SSR）什么都不做                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `registerExtension(ext)` / `ROOT_ATTR`            | 两者     | 注册通用扩展 `{ name, sync, release }`（完整版的文字模式、方案调度、懒渲染都挂在它上面）/ 根标记属性名常量（`"skz"`）                                                                                                                                                                                                                                                                                                         | 一般不需要手动调用                                                                                                  | lite 导出；写自己的扩展用；同名重复注册以后者为准                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `registerEngine(impl)`                            | 仅完整版 | 注册 pulse / shimmer 的方案实现 `{ engine, sync, release }`（内置的 `global` / `svg` 方案自动调用）                                                                                                                                                                                                                                                                                                                           | 一般不需要手动调用                                                                                                  | 从 `skeletonizer/full` 导出（旧版的 `registerExtension({ engine, … })` 改名而来）；同名重复注册以后者为准                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 全局 `skz`                                        | 两者     | 导入任一入口就挂到 `globalThis`：`skz.enable` / `skz.disable` / `skz.bone`                                                                                                                                                                                                                                                                                                                                                    | `skz.enable(el)`<br>`skz.bone.text(8)`                                                                              | SSR 里也挂；已被别人占用的 `skz` 不覆盖，开发模式警告一次；适配层不挂；详见[全局变量 skz](#全局变量-skz)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Vue：`vSkeleton` / `SkzPlugin`                    | 两者     | 指令 / 插件（全局注册 `v-skeleton` 与 `<SkzBox>`）                                                                                                                                                                                                                                                                                                                                                                            | `<div v-skeleton="{ loading, effect: 'shimmer' }">`<br>`app.use(SkzPlugin)`                                         | `import … from "skeletonizer/vue"`；Vue ≥ 3（可选 peer 依赖）；值可以是布尔，也可以是带 `loading` 的对象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Vue：`SkzBox` / `useSkeleton`                     | 两者     | 组件 / 组合式                                                                                                                                                                                                                                                                                                                                                                                                                 | `<SkzBox :loading="loading" effect="shimmer">…</SkzBox>`<br>`useSkeleton(elRef, loadingRef, opts)`                  | 模板里写 `<SkzBox>`，写成 `<skz>` 会解析成原生自定义元素；`SkzBox` 有 `as` 属性（默认 `div`）；`useSkeleton` 的 `opts` 不是响应式的，只在 `loading` 变化时同步                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| React：`SkzBox`                                   | 两者     | 组件：渲染一个包裹元素并按 `loading` 开关骨架                                                                                                                                                                                                                                                                                                                                                                                 | `<SkzBox loading={loading} effect="shimmer">…</SkzBox>`                                                             | `import … from "skeletonizer/react"`；React ≥ 16.8（可选 peer 依赖）；只透传 `className`，`as` 默认 `div`，其余 props 都当骨架选项                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| React：`useSkeleton`                              | 两者     | Hook：`loading` 为真时开启，变假或卸载时关闭                                                                                                                                                                                                                                                                                                                                                                                  | `useSkeleton(ref, loading, { effect: "pulse" })`                                                                    | `opts` 里的字段请传原始值（字段变化时重新同步）；ref 指向的元素要已挂载                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Svelte：`skeleton`                                | 两者     | action                                                                                                                                                                                                                                                                                                                                                                                                                        | `<div use:skeleton={{ loading, effect: "shimmer" }}>…</div>`                                                        | `import { skeleton } from "skeletonizer/svelte"`；只有 action，没有组件，包里没声明 svelte 依赖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Solid：`skeleton` / `SkzBox`                      | 两者     | 指令 / 组件                                                                                                                                                                                                                                                                                                                                                                                                                   | `<div use:skeleton={{ loading: loading(), effect: "shimmer" }}>…</div>` 或 `<SkzBox loading={loading()}>…</SkzBox>` | `import { skeleton, SkzBox } from "skeletonizer/solid"`；指令需在文件里引用（`void skeleton;`）；solid-js 为可选 peer（`>=1.6.0`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Bone.text(n, opts?)`                             | 两者     | 生成 n 个字符的方块词占位文本，词间空格，可自然换行                                                                                                                                                                                                                                                                                                                                                                           | `Bone.text(8)`<br>`Bone.text(30, { seed: 1 })`                                                                      | 确定性（不用 `Math.random`，SSR / 水合安全）；`seed` 改变词长分布；`n <= 0` 返回空串                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Bone.lines(k, opts?)`                            | 两者     | 约 k 行的占位段落                                                                                                                                                                                                                                                                                                                                                                                                             | `Bone.lines(3, { perLine: 30 })`                                                                                    | `perLine`（默认 40）只是每行预估字符数，实际行数取决于容器宽度                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Bone.cjk(n, opts?)`                              | 两者     | 中日韩文本占位：纯方块，每隔 3~6 个字符放一个零宽空格用于断行                                                                                                                                                                                                                                                                                                                                                                 | `Bone.cjk(20)`                                                                                                      | `n` 不含零宽空格                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Bone.number(digits?)`                            | 两者     | 固定位数的数字占位（全宽方块）                                                                                                                                                                                                                                                                                                                                                                                                | `Bone.number(4)`                                                                                                    | 默认 3 位                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Bone.image(w?, h?)`                              | 两者     | 透明占位图：不传 = 1×1 GIF data URI；传 `w` = 方形透明 SVG；传 `w`、`h` = 带固有宽高比的透明 SVG                                                                                                                                                                                                                                                                                                                              | `Bone.image(48)`<br>`Bone.image(160, 100)`                                                                          | 不传参的 GIF 没有固有宽高，要用 `width` / `height` 或 CSS 给尺寸；参数非法（0、负数）退回 1px GIF；严格 CSP 不放行 `img-src data:` 时请改用自托管的透明图                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Bone.GIF_1PX`                                    | 两者     | 1×1 透明 GIF 的 data URI 常量                                                                                                                                                                                                                                                                                                                                                                                                 | `img.src = Bone.GIF_1PX`                                                                                            | 同上；`Bone` 只有静态成员，不能 `new`（会抛 `TypeError`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 标记与属性参考

库涉及的 HTML 属性分三类：**元素标记**（你写在根的后代上）、**根属性**（写在根上，多数由 `enable()` 代写）、**运行时属性**（库自己写，不要手写）。先是三张属性表，后面几张矩阵看它们在不同文字模式、入口、动画效果和浏览器档位下的表现。表里的 lite 指 `lite.css`（`skeletonizer` 默认入口），完整版指 `base.css` + 完整版 JS；`explicit.css`（lite 与完整版共用的显式基底）和它们不同的地方单独写明。所有结论出自 `src/styles/` 与 `src/lite/`、`src/full/` 的代码。

### 元素标记

写在根的**后代**元素上，都是裸属性（不用写值）。选择器是 `[skz] [skz-…]` 这种后代选择，所以写在根自身上不命中（`skz-auto` 例外，根自身也行）。

| 属性         | 写在哪                                | 取值   | 用途                                                                                                                                                                                        | lite / 完整版                                                  |
| ------------ | ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `skz-text`   | 文字元素（推荐块元素内层的 `<span>`） | 裸属性 | 整个子树的文字按真实文字行出条，标在容器上也覆盖混合内容；画法跟随根上的 `skz-text-mode`；标在 `skz-bone` / `skz-leaf` / `skz-ignore` 自己身上、或在 `skz-leaf` / `skz-ignore` 里面的不生效 | 两者；lite 只有 round / clip，完整版五种模式                   |
| `skz-bone`   | 任意元素（图片、头像、按钮、色块）    | 裸属性 | 本元素整块当一块骨头，后代 `visibility: hidden`；`img` / `video` / `canvas` 的真实内容被推出盒子；圆角默认 `--skz-radius`，元素自己写了 `border-radius` 则保留                              | 两者                                                           |
| `skz-leaf`   | 容器                                  | 裸属性 | 把整棵子树合成一块骨头：后代隐藏、子树里的下划线撤掉；画法同 `skz-bone`，只是不处理媒体内容（`img` 等用 `skz-bone`）                                                                        | 两者                                                           |
| `skz-host`   | Web Component 宿主（Shadow DOM）      | 裸属性 | 宿主 `visibility: hidden`，`::before` 铺一块骨头（变量与动画同 `skz-bone`）；见 [Web Component 宿主](#web-component-宿主)                                                                   | 两者                                                           |
| `skz-ignore` | 任意元素                              | 裸属性 | 保持原样、可点击、可聚焦；`enable()` 的交互锁只锁不含它的分支；根里有它时，隐式默认的 fade 不开（要 `:has()`，显式写 `effect: "fade"` 则照开）                                              | 两者                                                           |
| `skz-auto`   | 根自身，或根内任意元素                | 裸属性 | 划出一个推导区域：区域里按标签白名单推导骨头（文字标签、媒体与控件、空 `<i>` 和类名带 `icon` 的空元素），leaf 文字模式的推导也只在区域里                                                    | lite 有；`explicit.css` 没有推导规则，写了不起作用；完整版全有 |

### 根属性

写在根上，其中 `skz`、`skz-effect`、`skz-text-mode`、`skz-fit`、`skz-engine` 平时由 `enable()` / 适配层按选项代写，手写只用于无 JS 的纯 HTML。

| 属性               | 写在哪              | 取值                                                 | 用途                                                                                                                                                       | lite / 完整版                                                         |
| ------------------ | ------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `skz`              | 根                  | 裸属性                                               | 骨架开启：样式、主题变量、交互锁都挂在它上面。`<skz-box>` 写在宿主的第一个元素子节点上                                                                     | 两者                                                                  |
| `skz-effect`       | 根                  | `fade`（不写即默认）/ `solid` / `pulse` / `shimmer`  | 动画效果，对应 `effect` 选项；重复调用 `enable()` 时按本次选项覆盖 / 清除                                                                                  | 两者                                                                  |
| `skz-text-mode`    | 根                  | `round`（不写即默认）/ `clip` / `underline` / `leaf` | 文字骨头画法，对应 `text` 选项（只有完整版 JS 会写它）；拼错的取值落到 underline 外观                                                                      | `lite.css` / `explicit.css` 只认手写的 `round` / `clip`；其余仅完整版 |
| `skz-shimmer-mode` | 根                  | `even`（不写即默认）/ `fit`                          | shimmer 光带怎么扫，对应 `shimmerMode` 选项（由完整版 JS 写）：`even` 各骨头同速、按视口分三档，`fit` 每个骨头在自己的盒子里扫、固定 2s；未知取值按 `even` | 仅完整版                                                              |
| `skz-engine`       | 根                  | `svg`（仅此一值）                                    | SVG 方案的运行时图已挂上；由库写，见[运行时属性](#运行时属性库写入不要手写)                                                                                | 仅完整版                                                              |
| `skz-fit`          | 根                  | 裸属性                                               | fit 的根标记，CSS 兜底把根限制在一屏高内；由 `fit` 选项写，见[运行时属性](#运行时属性库写入不要手写)                                                       | 两者                                                                  |
| `skz-cv`           | 根                  | 裸属性（`--skz-cv-size` 估高，默认 `200px`）         | 根的直接子元素加 `content-visibility: auto`，滚出视口的子元素跳过样式、布局、绘制；见[懒渲染与 `skz-cv`](#懒渲染与-skz-cv)                                 | 仅完整版（`base.css` / `explicit.css` 里有，`lite.css` 没有）         |
| `skz-auto`         | 根，或根内任意元素  | 裸属性                                               | 同元素标记表                                                                                                                                               | 同元素标记表                                                          |
| `data-skz-theme`   | `<html>`（`:root`） | `dark` / `light`                                     | 强制深浅色；不写则跟随 `prefers-color-scheme`。影响 `--skz-color` / `--skz-highlight`                                                                      | 两者                                                                  |

`<skz-box>` 宿主自己的属性不属于根属性：`loading`（开关）、`effect` / `text` / `fallback` / `engine` / `fit` 原样转成 `enable()` 的选项，状态作用在它的第一个元素子节点上。

### 运行时属性（库写入，不要手写）

这些属性由库在运行时写，手写会被覆盖（或根本没有效果）。其中 `skz-x`、`skz-fallback` 目前没有任何代码会写，列在这里是免得误用。

| 属性                  | 写在哪                                       | 谁、何时写                                                                                                                                                                           | 用途                                                                                              | lite / 完整版                                                                |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `skz-fw`              | 列表项（根下第一个有多个子元素那层的子元素） | 完整版的 global 方案，pulse / shimmer 时：`enable()` 先给所有项打上，`IntersectionObserver` 在项进入视口（含 200px 缓冲）时撤、离开时再打；停用 / 换效果 / 换方案 / `disable()` 清掉 | CSS 在这些项上把动画变量钉成静态值，项里的骨头静止，后代不再随根逐帧重算                          | 仅完整版（要 `global.css` + 完整版 JS）                                      |
| `skz-paused`          | 根                                           | 完整版的懒渲染扩展：`enable()` 开始观察，根离开视口（100px 缓冲）时打、回来撤；`disable()` 清掉                                                                                      | 停掉根的动画，并把 `--skz-bg-img` 置 `none`（svg 的背景图也撤）                                   | 仅完整版（JS 在完整版；样式在 `base.css` / `explicit.css`，`lite.css` 没有） |
| `skz-fit`             | 根                                           | `enable(el, { fit: true })` 写，不传 `fit` 或 `disable()` 时清                                                                                                                       | CSS 兜底：`max-height: 100dvh` + `overflow: clip`，JS 量好之前首帧就不撑出滚动条                  | 两者                                                                         |
| `skz-fit-hide`        | 列表项                                       | fit 每次测量先清旧的，再给完全落在可用高度之外的项打上；`disable()` 清掉                                                                                                             | `display: none`                                                                                   | 两者                                                                         |
| `skz-engine`          | 根                                           | svg 方案的 blob 动画图成功挂上后写 `svg`；读不到主题变量 / 不支持 blob / 换方案 / `disable()` 时删（global 在老浏览器降级到 SVG 时也是它写）                                         | 让 `svg.css` 的规则生效；没有它就是基底的 fade                                                    | 仅完整版                                                                     |
| `aria-busy` / `inert` | 根 / 不含忽略区的分支                        | `enable()` 写（`aria-busy="true"`、原生 `inert`），`disable()` 清；不支持 `inert` 时改用 `focusin` 拦截                                                                              | 交互锁（不带 `skz-` 前缀，一并列在这里）                                                          | 两者                                                                         |
| `skz-x`               | 忽略区内的元素                               | 没有任何代码会写                                                                                                                                                                     | 样式里的 `:not([skz-x])` 只用来抬高几条重置规则的优先级；手写它会让该元素跳过重置，不属于公开契约 | 两者                                                                         |
| `skz-fallback`        | —                                            | 目前没有代码写，也没有样式打包                                                                                                                                                       | `fallback` 选项现在只有 `svg` / `fade`，不写属性                                                  | 都没有                                                                       |

另外有几个库写的内联变量（不是属性）：`--skz-svg-shimmer` / `--skz-svg-pulse`（svg 方案的背景图，写在根的内联样式）、fit 写的内联 `max-height`；关闭时一并清掉。

### 文字模式下的表现

`skz-text` 和 `skz-auto` 区域里的文字，画法由根的 `skz-text-mode` 决定；`skz-bone` / `skz-leaf` / `skz-ignore` 基本不随模式变。

| 对象                                              | round（默认）                                                                | clip                               | underline                        | leaf                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| `skz-text` 在行内元素（`<span>`）上               | 每行一条圆角条，折行后各自带圆角                                             | 沿文字行的条，最后一行较短，无圆角 | 沿文字行的粗下划线，真实文字透明 | 整个元素一块骨头，折行后按行片段分段                            |
| `skz-text` 在块元素上                             | 整块一个圆角矩形（短标题被拉成整行宽）                                       | 同行内：沿文字行的条               | 同行内：沿文字行的下划线         | 整块一个圆角矩形                                                |
| `skz-auto` 区域里的文字标签                       | 同 `skz-text`：行内标签逐行条，块级标签（`p` `h1`~`h6` `li` 等）整块圆角矩形 | 沿文字行的条                       | 沿文字行的粗下划线               | 没有子元素、有文字的元素整块一块骨头                            |
| 区域里不在标签清单的裸文字（如 `div` 直接写的字） | 不可见                                                                       | 不可见                             | 有下划线（后代文字一律画）       | 无子元素的 `div` 整块出骨头；与元素混排的裸文字不出骨头（透明） |
| `skz-bone`                                        | 整块色块，后代藏起来；与模式无关                                             | 同左                               | 同左                             | 同左                                                            |
| `skz-leaf`                                        | 整块色块，子树全藏；与模式无关                                               | 同左                               | 同左                             | 同左                                                            |
| `skz-ignore`                                      | 原样可见、可点；在 `skz-text` / 区域里时文字压在骨头条之上                   | 同左                               | 同左                             | 同左                                                            |

- 模式只对 `skz-text` 和 `skz-auto` 区域里的文字生效。
- 嵌在 round / clip 根里的 underline 根不会继承外层的 round / clip 变量，各画各的。
- 浏览器不认 `box-decoration-break`（含 `-webkit-` 写法）时 round 退回 clip；完整版里不认 `background-clip: text` 时再退回 underline（lite 的门槛都具备，没有这一支）。
- 圆角：round 文字条固定读 `--skz-radius`，clip / underline 没有圆角；`skz-bone` / `skz-leaf` 读 `--skz-radius`，自己写了 `border-radius` 则保留。
- 细节和局限见[文字骨头模式](#文字骨头模式)。

### 入口里哪些可用

| 属性 / 能力                | `lite.css`（`skeletonizer/lite`） | `full.css`（`skeletonizer`）  |
| -------------------------- | --------------------------------- | ----------------------------- |
| `skz-text`                 | 只有 round / clip                 | 四种模式                      |
| `skz-bone` / `skz-leaf`    | 有                                | 有                            |
| `skz-host`                 | 有                                | 有                            |
| `skz-ignore`               | 有                                | 有                            |
| `skz-auto`                 | 有（第 0 档 + 现代档）            | 有（第 0 / 1 / 2 档）         |
| `skz-text-mode`            | 只读 `round` / `clip`             | 四个值                        |
| `skz-effect`               | fade / solid / pulse / shimmer    | 同左                          |
| `skz-engine`               | 没有                              | 有（svg 方案写入）            |
| `skz-fit` / `skz-fit-hide` | 有                                | 有                            |
| `skz-cv`                   | 没有                              | 有                            |
| `skz-fw`（继承防火墙）     | 没有                              | 有（global 方案，运行时写入） |
| `skz-paused`（懒渲染）     | 没有                              | 有（完整版 JS 写入）          |
| `data-skz-theme`           | 有                                | 有                            |

- lite 里的 core JS 只处理 `skz` / `skz-effect` / `skz-fit`、交互锁和忽略区；`skz-text-mode`、`skz-engine`、`skz-paused`、`skz-fw` 的写入都在完整版 JS 里。
- lite 没有防火墙、svg、`skz-paused`、`skz-cv`，见[lite 的限制](#lite-的限制)。

### 动画效果下的表现

| 对象                                                              | fade                                                 | solid        | pulse                                                 | shimmer                                                                                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------- | ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| round / clip / leaf 的文字条，`skz-bone`、`skz-leaf`、第 0 档色块 | 整个根的 opacity 脉冲，骨头本身静止                  | 静止的骨头色 | 骨头色在 `--skz-color` 与 `--skz-highlight` 间脉冲    | 高光光带在每个骨头自己的盒子里扫（固定 300px），各骨头同时起步；一轮 2s / 2.8s / 3.6s（按视口宽度分档，`fit` 模式 2s），每轮最后 0.4s 停顿，降频到 24 次/秒 |
| underline 的文字                                                  | 同上                                                 | 静止         | 下划线 / 方块字的颜色脉冲                             | 颜色脉冲（没有光带，同样降频）                                                                                                                              |
| `skz-ignore`                                                      | 根里有忽略区时隐式默认不开（显式写才开，会一起淡出） | 原样         | 原样                                                  | 原样                                                                                                                                                        |
| 带 `skz-fw` 的列表项（global）                                    | 不适用                                               | 不适用       | 项里骨头静止（颜色钉成 `--skz-color`）                | 项里骨头静止（光带停在屏外）                                                                                                                                |
| svg 引擎                                                          | 不适用（引擎只管 pulse / shimmer）                   | 不适用       | 共享 SVG 背景图脉冲；文字条、骨头会动，underline 静止 | 共享 SVG 光带；文字条、骨头会动，underline 静止                                                                                                             |
| 根在视口外（`skz-paused`）                                        | 停                                                   | 本来就静止   | 停                                                    | 停，光带背景图撤掉                                                                                                                                          |

- `prefers-color-scheme` 之外，`prefers-reduced-motion: reduce` 时所有动画停止、骨头静止，没有关闭开关。
- `skz-bone` / `skz-leaf` 读的是渐变驱动的变量，所以即使根是 underline 模式，它们在 shimmer 下照样有光带，只有文字是颜色脉冲。
- pulse / shimmer 的根驱动要 `@property`（借相对颜色语法判断）：缺了 lite 退回 fade，完整版的 global 由 JS 改挂 SVG 动画（`fallback: "fade"` 可关）。
- 光带降频只对根驱动（lite 与 global）生效，svg 引擎的光带速度由 SMIL 决定。

### 档位与降级

档位按能力自动取，不嗅探 UA；列名对应演示页的档位选择（档位 0 = 只有主题 / 标记 / fit（无推导），1 = + 第 0 档和全部效果，2 = + 第 1 档，3 = + 第 2 档）。

| 对象                    | 第 0 档（CSS 变量 + `:is()`）                          | 第 1 档（+ `text-decoration-thickness`）               | 第 2 档（+ `:has()`）                                 | lite 低于门槛                           |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------- |
| `skz-text`              | 没有规则，显示真实文字                                 | 文字条 / 下划线 / 方块字出现                           | 同第 1 档                                             | 显示真实文字                            |
| `skz-bone` / `skz-leaf` | 有                                                     | 有                                                     | 有                                                    | 有                                      |
| `skz-ignore`            | 有（后代自带的背景仍会被清掉）                         | 有（同左）                                             | 有（叶子背景模式下精确保留）                          | 有                                      |
| `skz-auto` 区域里的推导 | 标签白名单色块，文字标签整块、嵌套命中连成大块         | 文字行出条（round / clip / underline），控件整块不画线 | 再加叶子背景模式、图标识别（空 `<i>`、类名带 `icon`） | 第 0 档色块（静态）                     |
| 动画                    | fade / solid；pulse / shimmer 缺 `@property` 退回 fade | 同第 0 档                                              | 同第 0 档；根里有忽略区时关掉隐式 fade                | fade / solid；pulse / shimmer 退回 fade |

- lite 的现代档是一个 `@supports`，同时要 `text-decoration-thickness` 与 `:has()`，所以 lite 在 `skz-text` 上只有「有 / 没有」两种状态；完整版的 `skz-text` 只要第 1 档（`text-decoration-thickness`）就有。
- leaf 文字模式下的 `skz-text` 规则没有 `@supports` 门槛。
- 低于门槛时 `skz-text` 显示真实文字，不会变成骨头条，这点要心里有数：显式标记在老浏览器里等于没标。
- 低于第 0 档（没有 CSS 变量或 `:is()`；本库底线是 Chrome 88）时，`skz-auto` 区域什么都不显示：已经没有兜底层。它原先是整块涂灰的一层，但选择器同样带 `:is()`，实际上没有任何浏览器能看到它，详见 CHANGELOG 0.3.0。

## 类型

类型以 `dist/*.d.mts` 为准。`skeletonizer/lite` 是类型底座（core 的类型）；`skeletonizer`（完整版）把它的全部再导出一遍，并多出完整版的 API；适配层的类型从各自的子路径导出，选项类型从 `skeletonizer/lite` 引。

```ts
// lite：core 的类型（也是完整版的底座）
import { enable, disable, Bone, registerExtension, ROOT_ATTR } from "skeletonizer/lite";
import type { EnableOptions, SkzEffect, SkzEffectMap, SkzExtension, SkzGlobal } from "skeletonizer/lite";

// 完整版：上面这些（再导出）加上它多出来的
import { registerEngine } from "skeletonizer";
import type { SkzTextMode, SkzShimmerMode, SkzFallback, SkzEngine, SkzEngineImpl } from "skeletonizer";

// element：<skz-box> 自定义元素（独立入口，不属于 lite / full）
import { defineSkzBox, SkzBox } from "skeletonizer/element";
```

### 类型怎么随版本变宽

`skeletonizer/lite` 的类型只描述 lite 自己有的东西；`skeletonizer`（完整版）的类型声明里带一段 `declare module "skeletonizer/lite"` 增强，**只要它的类型被你的项目引到（也就是你导入了 `skeletonizer`），下面这些类型就会自动变宽**（适配层的也一并变宽，因为它们的类型来自 lite），现有代码不用改：

| 类型                             | 只有 lite                                   | 导入完整版之后                                     |
| -------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| `EnableOptions`                  | `effect`、`fit`                             | 另多出 `text`、`shimmerMode`、`engine`、`fallback` |
| `SkzEffect`                      | `"fade" \| "solid" \| "pulse" \| "shimmer"` | 同左                                               |
| `SkzGlobal`（全局 `skz` 的类型） | `enable` / `disable` / `bone`               | 相同                                               |
| 适配层 props（`SkzBox` 等）      | 随 `EnableOptions` 变化                     | 同步变宽                                           |

机制：`SkzEffect` 是 `keyof SkzEffectMap`，`EnableOptions` 和 `SkzGlobal` 都是接口，完整版通过接口合并往里加成员（自己写扩展的人也可以用同样的办法，增强 `"skeletonizer/lite"` 来加效果名）。所以：

- 只导入 lite 时，`enable(el, { text: "leaf" })`、`{ engine: "svg" }` 都是**类型错误**（运行时 lite 也不认），这是有意的：编译期就能发现"写了 lite 没有的选项"；
- 增强是**全项目级**的：只要有一个文件导入了 `skeletonizer`，整个项目里的 `EnableOptions` 就都变宽了（TypeScript 的接口合并是全局的），所以"同一个项目里两者混用"时，类型不会替你拦住对 lite 传完整版选项（同一页面本来也不该混用）；
- `test/types` 里基于构建产物验证过（只 lite、完整版，以及两者同处一个工程）。

### `EnableOptions`

`enable()`、`<skz-box>` 的属性和三个适配层共用的选项，字段全部可选（"版本"列：两者 = lite 与完整版都有）：

| 字段       | 版本     | 类型          | 默认值                                                                | 说明                                                             |
| ---------- | -------- | ------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `effect`   | 两者     | `SkzEffect`   | `"fade"`                                                              | 动画效果，写到根的 `skz-effect`                                  |
| `fit`      | 两者     | `boolean`     | `false`                                                               | 骨架自身绝不撑出滚动条（根限高、视口外的列表项 `display: none`） |
| `text`     | 仅完整版 | `SkzTextMode` | `"round"`                                                             | 文字骨头画法，写到根的 `skz-text-mode`                           |
| `engine`   | 仅完整版 | `SkzEngine`   | 按已引入的变体：有 global 用 global，只有 svg 用 svg，都没有按 global | `pulse` / `shimmer` 的实现，只对这两个效果有效                   |
| `fallback` | 仅完整版 | `SkzFallback` | `"svg"`                                                               | global 方案在不支持 `@property` 的浏览器里的降级                 |

各取值的含义见[快速开始](#4-开启骨架)的选项表。

### 联合类型

```ts
// lite
type SkzEffect = "fade" | "solid" | "pulse" | "shimmer"; // 键取自 SkzEffectMap；

// 完整版
type SkzTextMode = "round" | "clip" | "underline" | "leaf";
type SkzFallback = "svg" | "fade";
type SkzEngine = "global" | "svg";
```

### 函数与常量

```ts
// lite（skeletonizer/lite）
function enable(el: HTMLElement, opts?: EnableOptions): () => void; // 返回关闭函数
function disable(el: HTMLElement): void;
function registerExtension(ext: SkzExtension): void; // 通用扩展点，写自己的扩展才用
const ROOT_ATTR: "skz";

// 完整版（skeletonizer）另有
function registerEngine(impl: SkzEngineImpl): void; // 方案实现的注册点，内置的 global / svg 方案加载时自己调用，一般不用管

// element（skeletonizer/element）
function defineSkzBox(tag?: string): void; // 默认标签名 "skz-box"；重复调用安全
```

- `SkzExtension`：`{ name: string; sync(el, opts): void; release(el): void }`，通用扩展点。`enable()` 每次调用按注册顺序逐个 `sync`，关闭时逐个 `release`，同名后注册的覆盖先注册的。完整版的文字模式、方案调度、懒渲染都是挂在它上面的三个扩展。
- `SkzEngineImpl`：`{ engine: SkzEngine; sync(el, opts): void; release(el): void }`，`global` / `svg` 方案接入完整版方案调度的注册项（0.1.0 起改名，原来叫 `registerExtension({ engine, … })`，见 [CHANGELOG](./CHANGELOG.md)）。
- `SkzGlobal`：全局 `skz` 的形状，成员见[全局变量 skz](#全局变量-skz)。

### `SkzBox` 类

```ts
class SkzBox extends HTMLElement {
  static get observedAttributes(): string[]; // ["loading", "effect", "text", "fallback", "engine", "fit"]
  get loading(): boolean; // loading 属性存在且值不是 "false"
  set loading(v: boolean); // 读写的就是 loading 属性
}
```

`<skz-box>` 对应的类，由 `skeletonizer/element` 导出，用 `defineSkzBox()` 注册；light DOM，不用 shadow。用法与限制见功能总表的 `<skz-box>` 一行。

### 适配层类型

| 子路径                | 导出                                                                                                                                                 | 说明                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skeletonizer/vue`    | `type SkzBinding = boolean \| (EnableOptions & { loading: boolean })`；`vSkeleton`、`SkzBox`、`useSkeleton`、`SkzPlugin`                             | `v-skeleton` 的绑定值是布尔，或带 `loading` 的 `EnableOptions`；`SkzBox` 组件的 props：`loading`（默认 `false`）、`effect`、`text`、`fallback`、`engine`、`fit`、`as`（默认 `"div"`） |
| `skeletonizer/react`  | `interface SkzProps extends EnableOptions { loading: boolean; as?: ElementType; children?: ReactNode; className?: string }`；`SkzBox`、`useSkeleton` | `SkzBox` 只透传 `className`，其余 props 都当骨架选项；`useSkeleton(ref, loading, opts?)`                                                                                              |
| `skeletonizer/svelte` | `interface SkzParams extends EnableOptions { loading: boolean }`；`skeleton`                                                                         | `skeleton(node, params)` 返回 `{ update(next), destroy() }`，用法 `use:skeleton={{ loading }}`                                                                                        |
| `skeletonizer/solid`  | `interface SkzParams extends EnableOptions { loading: boolean }`；`interface SkzBoxProps`；`skeleton`、`SkzBox`；并声明 `JSX.Directives.skeleton`    | `skeleton(el, accessor)` 用 `createEffect` 跟踪 accessor，卸载时 disable；`SkzBox` 的 `as` 缺省 `div`，`class` / `children` 透传，其余 props 当选项                                   |

## 方案怎么选

| 场景                                                             | 推荐组合                                                                                                                                                                               | 理由（数据见[方案对比](#方案对比)）                                                                                                                                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 现代浏览器里的中小骨架（单个根约 2000 元素以内），想最小最省事   | lite：`import "skeletonizer/lite"`                                                                                                                                                     | 桌面 Chrome 正常速度下，单个根 4000 元素以内 pulse / shimmer 实测 58.4~60.4 帧（主批次与重复批次；留 2× 余量，按约 2000 规划），数据见 [lite 的规模上限](#lite-的规模上限)；4.26 KB                                         |
| lite 要跑在 CPU 慢的设备（移动端 / 低端机）上                    | 控制单个根的元素数，或换完整版                                                                                                                                                         | 4× CPU 降速（粗略替身）下 lite 的 pulse / shimmer 504 元素只有 41~52 帧、2000 元素 16~21 帧（主批与复跑），完整版（继承防火墙）同条件 2000 元素是 55~60 帧；lite 的 fade / solid 在 4× 降速下没测                           |
| 低端机 / 追求最省时，尤其是 svg 下的 shimmer 或 pulse 大列表     | 完整版：根上写 `text: "underline"`                                                                                                                                                     | svg 引擎的光带没降频，clip 文字的 GPU 约 3 倍（2000 卡 8.63 对 2.87 ms），4× 降速下 svg shimmer 12.8 帧对 underline 的 34.8 帧；`global` 下 clip 已降频，GPU 约 1.9 倍（3.05 对 1.63 ms）。fade / solid 不受影响，不用改    |
| 一般页面，骨架不大（几百个元素以内）                             | lite：`import "skeletonizer/lite"`，默认 fade（不在乎体积也可以直接用完整版）                                                                                                          | fade 在 4000 / 16000 元素下都是 60 帧、样式重算 0.14 / 0.33 ms；小规模下各方案都是 60 帧；lite 的 pulse / shimmer 约 2000 元素内同样 60 帧（[lite 的规模上限](#lite-的规模上限)）                                           |
| 长列表、信息流、表格要 shimmer / pulse                           | 完整版：`import "skeletonizer"`（`enable()` 自动带继承防火墙）                                                                                                                         | lite 超过约 2000 元素会掉帧（[lite 的规模上限](#lite-的规模上限)），这类页面用完整版；16000 元素下 60 帧、样式重算约 3.2 ms（落地后复测，2000 卡 shimmer）；同样的骨架用纯 CSS（不引 JS）约 21 帧 / 41 ms（underline 测得） |
| 同上，骨头位置逐个标记（默认就是）                               | 完整版，且不用 `skz-auto`                                                                                                                                                              | 原 `explicit.css`（现已并入 lite）的实测：**帧率没差**（都 60），只是更省：16000 元素下样式重算 4.89 → 2.60 ms，开启 62 → 50 ms（underline 测得）；不用 `skz-auto` 时推导选择器根本不匹配，剩下的开销同一量级               |
| 没有列表结构的大骨架（大表单、长详情页）要 shimmer / pulse       | 完整版：`engine: "svg"`                                                                                                                                                                | 防火墙找不到列表项就帮不上忙：双栏表单 16003 元素 global 只有 11.2 帧 / 75 ms，svg 是 52.8 帧 / 0.04 ms（clip 补测）                                                                                                        |
| 纯 CSS、不想引 JS 的大骨架                                       | 完整版：根上写 `skz-cv`                                                                                                                                                                | 16000 元素 60 帧 / 6.8 ms（同条件不加是 25 帧 / 35 ms，underline 时测得）；叠加 `enable()` 反而更差，开启慢约 3.5 倍，还会裁掉溢出内容                                                                                      |
| 老浏览器（Chrome < 119 / Safari < 16.4 / Firefox < 128）也要动画 | 完整版：`global`（自动降级为 SVG 动画）或直接用 `svg`                                                                                                                                  | SVG 动画不依赖 `@property`                                                                                                                                                                                                  |
| 产品指定老浏览器里的效果                                         | 完整版：`global` + `fallback`（`svg` / `fade`）                                                                                                                                        | 只在不支持 `@property` 时生效                                                                                                                                                                                               |
| 放量占位列表，不想让骨架撑出滚动条                               | `enable(el, { fit: true })`                                                                                                                                                            | 16000 元素 60 帧、样式重算 5.07 ms；代价是开启耗时约 767 ms（2000 张卡）                                                                                                                                                    |
| 只要标记、完全不要推导规则                                       | lite（`skeletonizer/lite`）                                                                                                                                                            | 规则最少、最省；`skz-auto` 是打开推导的唯一开关，没标的一律原样显示                                                                                                                                                         |
| 无法改标记的第三方组件                                           | 在根或组件外层写 `skz-auto`                                                                                                                                                            | 只对该子树按标签推导；直接写在 div 里的文本不在范围内，见[标记骨头](#5-标记骨头)                                                                                                                                            |
| 包体敏感                                                         | lite（4.26 KB，含 fade / solid / pulse / shimmer）；完整版 6.23 KB                                                                                                                     | lite 最小                                                                                                                                                                                                                   |
| SSR / Node / 无打包器                                            | 经打包器引 `skeletonizer` 或 `skeletonizer/lite`（SSR 框架要把本包打进服务端包）；无打包器：`full.css` / `lite.css` 子路径 + import map，见[无打包器](#无打包器浏览器直接用import-map) | JS 开头带 CSS 导入，纯 Node 不能直接 import                                                                                                                                                                                 |
| 严格 CSP                                                         | 放行 `img-src blob:`（svg 方案与老浏览器 SVG 降级）；`data:` 只有 `Bone.image` 需要                                                                                                    | 运行时 SVG 走 blob URL，CSS 里不再内置任何 SVG data URI                                                                                                                                                                     |
| 快速原型、不在乎体积                                             | `import "skeletonizer"`                                                                                                                                                                | 一次拿全                                                                                                                                                                                                                    |

> 「要合成器动画、主线程长任务期间动画也不停」这条是按 `transform` 动画走合成器线程的机制推出来的，没有单独测过主线程长任务期间的表现。

## 方案对比

> **测量里的叫法**：本章的基准脚本和数字都是 0.3.0 之前测的，**没有重测**；其中的“core”就是今天的 `skeletonizer/lite`，“完整版” / `global` / `all` 就是今天的 `skeletonizer`，`base.css` 是 `full.css` 里的基底，“`explicit.css`”的几行测的是后来并入 `lite.css` 的那份基底（只认标记、没有推导）。`bench/` 目录下的文件保留旧名字。

> 本章所有数据都是 0.2.0 之前测的，**没有重跑**：文字模式 **clip**（当时的默认，下文写作「默认 clip」，现在对应 `skz-text-mode="clip"` / `text: "clip"`），推导规则对整个根生效。0.2.0 起默认文字模式是 `round`（原型实测 GPU 约为 clip 的一半），推导只在 `skz-auto` 区域里生效。

### lite 的规模上限

core 没有继承防火墙，pulse / shimmer 每帧要重算根下所有元素的样式，所以单个根的元素数有上限。这一节回答两个问题：core 在约 2000 元素内 pulse / shimmer 能不能稳定 60 帧；超过多少元素建议换完整版。

**测试条件**（脚本、场景、原始数据都在 `bench/2026-10-10-core/`）：Chrome 154.0.8037.98，Windows 10，Intel i5-13500 + UHD 770 集显，视口 1200×800、DPR 1；`pnpm build` 的 `dist/` 冻结快照，由独立静态服务（不是 vite 开发服务）提供，基准页用 import map 引 `core-js.mjs` + `core.css`（完整版对照：`base.css` + `global.css` + `full.mjs` + `global-js.mjs`，等价 `skeletonizer/global`，带继承防火墙）；默认文字模式 clip；卡片列表每张 8 个元素（125 / 250 / 500 卡 ≈ 1000 / 2000 / 4000 元素）；**每格新鲜加载页面**、3 次 trace 取中位数。每格是 帧率 / 样式重算 ms / PrePaint ms / Paint ms / GPU ms / 开启 ms（样式重算等为每帧耗时；"开启"是真实 `enable()` 的耗时，5 次中位数，波动大，只当量级看）。

**口径与局限**：测试机是日常工作机，**不是安静状态**：测前整机 CPU 约 22%~24%（等不到 <15%），批内整机 CPU 均值主批 31.2%、上限批 33.7%（三次尝试 33.7%~35.8%，取最低的一次；批均值里含被测 Chrome 自己的占用，没有拆开）；**只在 Chrome 实测**，Firefox / Safari 没测；"4× 降速"是 CDP 的 `Emulation.setCPUThrottlingRate`，只是慢设备的粗略替身，不是真机。

**正常速度，core，125 / 250 / 500 卡**：

| 效果    | 125 卡（1000 元素）                  | 250 卡（2000 元素）                   | 500 卡（4000 元素）                   |
| ------- | ------------------------------------ | ------------------------------------- | ------------------------------------- |
| fade    | 60.4 / 0.13 / 0.02 / — / 1.96 / 8    | 60.4 / 0.12 / 0.02 / — / 1.67 / 15    | 60.4 / 0.14 / 0.01 / — / 1.69 / 25    |
| solid   | 60.8 / — / 0.01 / — / 0.01 / 6       | 60.4 / — / 0.01 / — / 0.01 / 10       | 60.4 / — / 0.01 / — / 0.01 / 18       |
| pulse   | 60.4 / 3.05 / 0.33 / 1.18 / 3.41 / 6 | 60.4 / 6.18 / 0.52 / 1.06 / 3.47 / 14 | 59.2 / 11.56 / 0.82 / 1.14 / 4 / 22   |
| shimmer | 60.4 / 1.27 / 0.24 / 1.14 / 3.29 / 7 | 60.4 / 2.61 / 0.38 / 1.07 / 3.4 / 9   | 60.4 / 5.05 / 0.78 / 1.27 / 4.25 / 22 |

**同规模的完整版对照**（`global` 方案，继承防火墙已启用）：

| 效果              | 125 卡（1000 元素）                  | 250 卡（2000 元素）                   | 500 卡（4000 元素）                   |
| ----------------- | ------------------------------------ | ------------------------------------- | ------------------------------------- |
| pulse（core）     | 60.4 / 3.05 / 0.33 / 1.18 / 3.41 / 6 | 60.4 / 6.18 / 0.52 / 1.06 / 3.47 / 14 | 59.2 / 11.56 / 0.82 / 1.14 / 4 / 22   |
| pulse（完整版）   | 60.4 / 0.94 / 0.04 / 0.79 / 4.15 / 7 | 60.4 / 1.35 / 0.04 / 0.69 / 3.54 / 14 | 60.4 / 2.39 / 0.08 / 1.13 / 4.29 / 26 |
| shimmer（core）   | 60.4 / 1.27 / 0.24 / 1.14 / 3.29 / 7 | 60.4 / 2.61 / 0.38 / 1.07 / 3.4 / 9   | 60.4 / 5.05 / 0.78 / 1.27 / 4.25 / 22 |
| shimmer（完整版） | 60.4 / 0.41 / 0.03 / 0.6 / 3.97 / 5  | 60.4 / 0.52 / 0.03 / 0.7 / 3.68 / 17  | 60.4 / 0.76 / 0.05 / 0.87 / 3.68 / 25 |

- fade / solid 不吃样式重算，三个规模都是 60 帧。
- core 的样式重算随元素数近似线性：pulse 约每 1000 元素 2.9 ms（3.05 / 6.18 / 11.56 ms），shimmer 约每 1000 元素 1.3 ms（1.27 / 2.61 / 5.05 ms），所以同样规模下 shimmer 比 pulse 撑得更远。
- 完整版的防火墙把样式重算压到 0.4~2.4 ms；core 4000 元素的 pulse 已经 11.56 ms，逼近一帧 16.7 ms 的预算（那一格 59.2 帧）。

**更大的规模，正常速度**（上限批）：

| 效果              | 750 卡（6000 元素）                    | 1000 卡（8000 元素）                   | 1500 卡（12000 元素）                  | 2000 卡（16000 元素）                  |
| ----------------- | -------------------------------------- | -------------------------------------- | -------------------------------------- | -------------------------------------- |
| pulse（core）     | 46.4 / 17.45 / 1.67 / 1.49 / 4.66 / 31 | 39.6 / 21.42 / 1.99 / 1.67 / 5.03 / 42 | 25.6 / 32.74 / 3.99 / 2.36 / 6.52 / 70 | 18.4 / 45.13 / 5.67 / 2.81 / 7.45 / 74 |
| pulse（完整版）   | 60.4 / 2.65 / 0.07 / 1.01 / 3.74 / 32  | 60.4 / 3.34 / 0.1 / 1.18 / 3.73 / 44   | 60.4 / 4.66 / 0.14 / 1.18 / 4.16 / 62  | 60.4 / 6.59 / 0.12 / 1.23 / 3.5 / 83   |
| shimmer（core）   | 58 / 7.75 / 1.29 / 1.46 / 4.12 / 32    | 52 / 11.39 / 1.8 / 1.67 / 4.57 / 42    | 24.4 / 33.41 / 4.9 / 3.37 / 9.11 / 60  | 16.8 / 47.34 / 8.7 / 4.71 / 9.68 / 91  |
| shimmer（完整版） | 60.4 / 1.18 / 0.07 / 1 / 3.63 / 35     | 60.4 / 1.52 / 0.09 / 1.16 / 3.4 / 54   | 60.4 / 1.98 / 0.1 / 1 / 3.35 / 68      | 60.4 / 2.89 / 0.12 / 1.52 / 4.09 / 93  |

**4× CPU 降速**（250 卡；core 另测了 63 / 125 / 188 / 500 卡，完整版另测 500 卡）：

| 效果            | 63 卡（504 元素）                      | 125 卡（1000 元素）                    | 188 卡（1504 元素）                     | 250 卡（2000 元素）                   | 500 卡（4000 元素）                     |
| --------------- | -------------------------------------- | -------------------------------------- | --------------------------------------- | ------------------------------------- | --------------------------------------- |
| pulse（core）   | 40.8 / 14.64 / 0.72 / 9.82 / 4.36 / 18 | 32.4 / 21.89 / 1.48 / 9.66 / 4.48 / 39 | 23.2 / 31.94 / 2.14 / 12.31 / 4.88 / 52 | 21.2 / 37.8 / 2.26 / 8.92 / 4.92 / 73 | 10.4 / 82.4 / 6.77 / 16.67 / 7.26 / 142 |
| shimmer（core） | 52 / 7.23 / 0.58 / 10.63 / 4.15 / 26   | 18.4 / 35.74 / 3.4 / 24.41 / 9.43 / 54 | 18.8 / 36.5 / 3.07 / 22.51 / 8.14 / 56  | 17.2 / 41.18 / 4 / 19.55 / 8.26 / 79  | 8.4 / 99.31 / 8.14 / 24 / 9.28 / 199    |

| 效果              | 250 卡（2000 元素）                   | 500 卡（4000 元素）                     |
| ----------------- | ------------------------------------- | --------------------------------------- |
| pulse（core）     | 21.2 / 37.8 / 2.26 / 8.92 / 4.92 / 73 | 10.4 / 82.4 / 6.77 / 16.67 / 7.26 / 142 |
| pulse（完整版）   | 58.8 / 8.75 / 0.2 / 3.59 / 3.41 / 51  | 47.6 / 12.71 / 0.28 / 5.12 / 3.49 / 134 |
| shimmer（core）   | 17.2 / 41.18 / 4 / 19.55 / 8.26 / 79  | 8.4 / 99.31 / 8.14 / 24 / 9.28 / 199    |
| shimmer（完整版） | 58.4 / 4.03 / 0.2 / 4.18 / 3.57 / 168 | 57.6 / 5.62 / 0.23 / 4.59 / 3.56 / 166  |

**结论**：

1. **core 在约 2000 元素内 pulse / shimmer 能不能稳定 60 帧？桌面级 CPU、正常速度：能。** 1000 / 2000 元素都是 60.4 帧，4000 元素 pulse 59.2 / shimmer 60.4（复跑 58.4 / 60），约 2000 元素还有一倍余量。**慢设备（4× 降速）：不能**：2000 元素 pulse 21.2 / shimmer 17.2 帧，504 元素也只有 40.8 / 52 帧（完整版同条件 2000 元素是 58.8 / 58.4 帧）。
2. **超过多少元素建议换完整版？** 桌面级 CPU 上 pulse 超过约 4000 元素、shimmer 超过约 6000 元素开始掉帧（6000 元素 pulse 46.4、shimmer 58 帧；8000 元素 39.6 / 52；12000 元素 25.6 / 24.4；16000 元素 18.4 / 16.8），**建议超过约 4000 元素就换完整版**。要照顾慢设备（移动端 / 低端机）时门槛低得多：4× 降速下 504 元素的 pulse / shimmer 就上不了 60 帧（更小的规模没测），这种场景要么把单个根控制得很小，要么换完整版，要么在 core 里只用 fade / solid（core 的 fade / solid 没在 4× 降速下测过）。
3. 边界取决于主线程算力：样式重算的毫秒数随元素数线性增长，CPU 更慢整条线按比例左移，所以上面的"约 4000 元素"只对本机这类桌面 CPU 成立。
4. 完整版也不是无限的：正常速度下 16000 元素仍是 60.4 帧，但 4× 降速下 4000 元素掉到 47.6（pulse）/ 57.6（shimmer）帧（表里"完整版"行）。
5. 主批整批复跑了一遍（`after2`，整机 CPU 均值 30.8%）：core 1000 / 2000 元素仍是 60.4 帧，4000 元素 pulse 58.4 / shimmer 60 帧；4× 降速 2000 元素 pulse 18 / shimmer 16 帧（主批 21.2 / 17.2）；完整版 4× 降速 2000 元素 55.2 / 59.6 帧（主批 58.8 / 58.4）。三次独立尝试（上限批）互相吻合（例如 core 6000 元素 pulse 46.4~49.2 帧、shimmer 58~60.4 帧），4× 降速的格子波动大（如 core shimmer 125 卡 18.4~26.8 帧），上表取均值最低的那次；`bench/2026-10-10-core/NOTES.md` 里有全部尝试和主批的重复运行。

### 性能

> 光带已改为每个骨头在自己盒子里扫（不再是贴视口的 fixed 背景），shimmer 的性能数据**尚未重测**，本章数字都是改动之前的实测（原理上滚动时不再因 fixed 背景走主线程重绘，应不差于原来）。

以下为**完整版**（继承防火墙路径）的数据，core 的数据见上一节。数据来自[全量性能矩阵（控制变量版）](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/reports/2026-10-09-benchmark-matrix.md)及其中「默认文字模式改为 clip 后的补测」。每格是"帧率 / 每帧样式重算 ms"，16.6 ms 是一帧预算；卡片列表每张 8 个元素（4000 元素 = 500 张，16000 = 2000 张）。**先看下面「落地后复测」（当前默认配置）；再下面的主表和 clip / underline 对照是落地前的数据**（主表里 shimmer / pulse 的 `global` 行已在 16000 元素列并排给出落地后的数字；svg、表单、fit 等行落地前后没有成对复测）。**默认文字模式当时是 clip（0.1.x）**：主表前面各行（fade ~ fit）是 clip 默认下的补测数据，标注"underline 时测得"的三行来自改默认之前的原矩阵（文字为 underline，没为 clip 重测）；下面另有 clip 与 `text: "underline"` 成对对照。

**落地后复测**（2000 卡 = 16000 元素，Chrome 154，视口 1200×800、DPR 1，`pnpm build` 的 `dist/` 快照，每格 3 次 trace 中位数，批内整机 CPU 均值 25.8%，测前 CPU 约 14%；每格：帧率 / 样式重算 ms / PrePaint ms / GPU ms / 有绘制帧占比。「落地前」= 同一份基底叠落地前的 `global.css`：光带 linear、shimmer 一律挂 pulse、防火墙没钉 `--skz-tbg`）：

| 场景                                                             | clip（0.2.0 前的默认）               | `underline`                       |
| ---------------------------------------------------------------- | ------------------------------------ | --------------------------------- |
| shimmer，`global`                                                | 60.4 / 3.19 / 0.10 / 3.05 / 40%      | 60.4 / 3.81 / 0.09 / 1.63 / 40%   |
| shimmer，`global`（落地前）                                      | 60.4 / 7.30 / 0.26 / 10.44 / 101%    | 60.4 / 10.26 / 0.27 / 5.35 / 101% |
| pulse，`global`                                                  | 60.4 / 6.95 / 0.14 / 3.63 / 44%      | 60.4 / 9.66 / 0.10 / 1.63 / 45%   |
| pulse，`global`（落地前）                                        | **22.8 / 33.72** / 3.99 / 4.22 / 56% | 60.4 / 9.24 / 0.15 / 1.76 / 44%   |
| shimmer，`svg`（没降频）                                         | 50.4 / 0.06 / 16.95 / 8.63 / 101%    | 60.4 / 0.07 / 10.45 / 2.87 / 73%  |
| **4× 降速** shimmer，`global`，默认 `steps(36)`                  | 18.4 / 38.62 / 0.99 / 8.78 / 100%    | 14.0 / 55.84 / 0.90 / 4.56 / 103% |
| **4× 降速** 同上（落地前）                                       | 18.0 / 39.09 / 1.09 / 9.08 / 102%    | 14.0 / 55.92 / 1.65 / 4.47 / 103% |
| **4× 降速** shimmer，`global`，`--skz-shimmer-timing: steps(18)` | **40.0 / 12.83** / 0.33 / 2.69 / 31% | 14.8 / 55.14 / 1.26 / 5.15 / 100% |

- **降频生效**：`global` shimmer 的有绘制帧从 101% 降到 40%（24 / 60），clip 的 GPU 10.44 → 3.05 ms、underline 5.35 → 1.63 ms；clip 不再挂 pulse 后样式重算 7.30 → 3.19 ms。
- **防火墙修复生效**：2000 卡 pulse + clip 从 22.8 帧 / 33.72 ms 回到 60.4 帧 / 6.95 ms，和 underline（9.66 ms）同量级；200 卡页面里读不可见卡片的 `--skz-tbg`，修复前随 pulse 逐帧变化，修复后钉在静态值（`bench/2026-10-10-landing/verify.mjs`）。当时的做法是让防火墙补钉 `--skz-tbg`；之后 simplify 把 clip 根上逐帧变化的 `--skz-tbg` 转发整个去掉了：现在 clip 根只有静态的 `--skz-tbg: initial`，文字条在文字元素自己身上读 `--skz-fill` / `--skz-bg-img`，防火墙只需钉 `--skz-fill` / `--skz-bg-pos`（underline 根另有 `--skz-ul-fill`）。
- **4× CPU 降速下默认档（24 次/秒）没有收益**：主线程一帧约 54 ms，已经比一步的 41.7 ms 长，每帧都赶上一次变化（clip 18.4 对 18.0 帧）；`steps(18)`（一步 83 ms）才能跳过帧，clip 到 40 帧。**underline 在 4× 降速下换 `steps(18)` 也没有改善**（14~15 帧），样式重算 55~60 ms 的主因没查。
- **svg 引擎没降频**（SMIL，实验显示 clip + svg 的 PrePaint 降不动），本批 clip + svg 只有 50.4 帧（PrePaint 16.95 ms），之前几批同场景是 56.8~58.8 帧；这批整机 CPU 均值 25.8%、存在批间漂移，没有落地前的 svg 对照，只说"没降频、仍是三种模式里最贵的"，不说变差。
- **simplify 后复测**（`bench/2026-10-10-landing/NOTES.md`「simplify 后复测」：去掉 clip 根上的 `--skz-tbg` 别名等"不改变行为"的改动）：机器负载高（整机 CPU 均值约 29~40%），噪声大于前后差值，**无法分辨性能有没有变化**，但帧率全部 ≥57.6，没有回退；上表仍用落地复测批的数字（那批里同场景 pulse + clip 样式重算在 8~10 ms，机器当天更忙，不能和 6.95 ms 直接比）。
- 批次说明：A 批前两次尝试整机 CPU 均值 41.6% 作废，采用第 3 次（25.8%）；B 批三次 23.8%~26.0%，采用均值最低的第 2 次；C 批只跑一次（26.2%）。金丝雀（500 卡 shimmer global clip、2000 卡 fade）批间漂移：GPU 3.4~4.0 ms / 1.4~1.8 ms，帧率始终 60.4。

| 方案（引入）                                                           | 4000 元素：帧率 / 样式重算 | 16000 元素：帧率 / 样式重算                    | 开启耗时（4000 / 16000） |
| ---------------------------------------------------------------------- | -------------------------- | ---------------------------------------------- | ------------------------ |
| fade（`full.css`，默认）                                               | 60.4 / 0.14                | 60.4 / 0.33                                    | 24 / 106 ms              |
| solid（`full.css`）                                                    | 60.8 / 0.00                | 60.8 / 0.00                                    | 22 / 109 ms              |
| shimmer，`global` + `enable()`（防火墙）                               | 60.4 / 2.67（落地前）      | **60.4 / 3.19**（落地后；落地前 7.01）         | 24 / 85 ms（落地前批）   |
| shimmer，`svg`                                                         | 60.4 / 0.08                | 58.8 / 0.05                                    | 36 / 140 ms              |
| pulse，`global` + `enable()`（防火墙）                                 | 59.6 / 7.14（落地前）      | **60.4 / 6.95**（落地后；落地前 24.4 / 32.74） | 20 / 78 ms（落地前批）   |
| 无列表结构页（双栏表单）：shimmer，`global` + 防火墙                   | 36.0 / 19.71               | 11.2 / 75.02                                   | 31 / 121 ms              |
| 无列表结构页（双栏表单）：shimmer，`svg`                               | 60.4 / 0.08                | 52.8 / 0.04                                    | 46 / 178 ms              |
| `fit: true`（shimmer，`global` + `enable()`）                          | —                          | 60.4 / 5.07                                    | — / 767 ms               |
| shimmer，`global` **纯 CSS 无 JS**（underline 时测得）                 | 60.0 / 9.90                | 20.8 / 41.3                                    | 15 / 80 ms               |
| shimmer，旧 `explicit.css` + `global` + `enable()`（underline 时测得） | 60.4 / 1.14                | 60.4 / 2.60                                    | 16 / 50 ms               |
| `skz-cv`（shimmer，`global` 纯 CSS，underline 时测得）                 | 60.4 / 2.12                | 60.4 / 6.76                                    | 13 / 207 ms              |

**默认 clip 与 `text: "underline"` 对照**（16000 元素，每格：帧率 / 样式重算 ms / PrePaint ms / GPU ms / 开启 ms；同一批、成对测）：

| 场景                                         | clip（0.2.0 前的默认）               |
| -------------------------------------------- | ------------------------------------ |
| fade                                         | 60.4 / 0.33 / 0.02 / 1.98 / 106      |
| solid                                        | 60.8 / 0.00 / 0.01 / 0.01 / 109      |
| shimmer，`global` + `enable()`（落地前）     | 60.4 / 7.01 / 0.22 / 11.05 / 85      |
| shimmer，`svg`                               | 58.8 / 0.05 / 12.98 / 5.88 / 140     |
| pulse，`global` + `enable()`（落地前）       | **24.4 / 32.74** / 3.82 / 4.89 / 78  |
| 双栏表单 shimmer，`global`（落地前）         | 11.2 / 75.02 / 9.58 / 15.09 / 121    |
| 双栏表单 shimmer，`svg`                      | 52.8 / 0.04 / 13.74 / 8.22 / 178     |
| `fit: true`（shimmer，`global`）             | 60.4 / 5.07 / 0.09 / 9.43 / 767      |
| **4× CPU 降速**：shimmer，`global`（落地前） | 26.8 / 27.22 / 0.68 / 5.25 / 443     |
| **4× CPU 降速**：shimmer，`svg`              | **12.8** / 0.38 / 66.43 / 6.17 / 878 |
| **4× CPU 降速**：fade                        | 60.0 / 1.43 / 0.12 / 1.71 / 548      |
| **4× CPU 降速**：solid                       | 60.8 / — / 0.03 / 0.01 / 473         |

**测试条件**：Windows 10 桌面，Intel Core i5-13500（14 核 20 线程）+ Intel UHD 770 集显，31.7 GB 内存；Chrome 154.0.8037.98，独立用户目录、前台窗口，视口 1200×800、DPR 1；`pnpm build` 的正式构建（`dist/` 原样加载，基线 f735d65），同一份卡片列表模板；每格 3 次 trace 取中位数。测试机是日常工作机，**CPU 不是空闲状态**：批内 CPU 均值 17%~27%（含 Chrome 自己的占用）；只有一遍正向、没做反向复测，差距在 2 倍以内的结论别当真。

- **clip 补测（主表 fade ~ fit 各行与对照表）**：同一份 `dist/` 构建（含当时未提交的 clip 改动），批内 CPU 均值 21.5%~24.5%（含 Chrome 自己，G 批重跑过一次，用了较安静的第一次），只有一遍；clip 与 underline 在同一批内相邻成对测，GPU 这类 3 倍的差别两次尝试一致，2 倍以内的差别别当真。
- 下面是原矩阵（underline 默认时）的取数说明：fade / solid 取自 A 组；shimmer 前四行取自 B 组（同一批）；双栏表单两行取自 D 组；`fit`（E1）、`skz-cv`（E3）取自 E 组，同组对照是 `global` + `enable()` 的 16000 元素 4.67 ms、纯 CSS 的 25.2 帧 / 35.3 ms。不同组不在同一批里测，跨组比较留有余量。
- 纯 CSS 16000 元素的帧率在不同批里相差较大（13~25 帧，负载越高越低）；表中取 B 组的 20.8 帧。
- 开启耗时是真实 `enable()`（含防火墙、inert、blob），纯 CSS 行量的是切 `skz` 属性。svg 开启耗时在 A 组里有一次 287 ms 的单次异常，没重测。

**没测**：低端机真机（只有本机 Chrome 的 4× CPU 降速，且只测了 2000 卡的 fade / solid / shimmer global / shimmer svg，clip 对 underline）；Safari、Firefox、移动端（clip 的装饰线裁剪也只在 Chrome 实测过）；DPR > 1；删除 `fps` 计时器后没有重跑全量矩阵（只重跑了 sweep；被删的代码不在上表任何一行的路径上，但没有逐行复测）。

要点：

- **默认 fade 无论多大都是 60 帧**，开启成本只有一次样式计算；改成 clip 默认后 fade / solid 没有变贵（GPU、开启耗时与 underline 相同，4× 降速下也是 60 帧）。
- **clip 的代价集中在 pulse / shimmer 的文字上**（落地前数据；落地后 `global` 的绝对值都降了：clip 3.05 / underline 1.63 ms，比值仍约 1.9 倍，clip 比 underline 贵，见「落地后复测」）：shimmer 的 GPU 约 3 倍（global 3.6 → 11 ms，svg 1.9 → 5.9 ms，16000 元素），svg 下 PrePaint 约 1.5 倍；本机正常速度下帧率基本不掉（svg 16000 元素 58.8、表单 svg 52.8 帧），**4× CPU 降速下 svg shimmer 从 34.8 帧掉到 12.8 帧**。低端机、追求最省时请显式 `text: "underline"`。
- **pulse + `global` + `enable()` 在 clip 默认下曾明显变差（已修复）**：16000 元素 24.4 帧 / 样式重算 32.7 ms（underline 60.4 帧 / 6.2 ms），原因是 clip 根上的 `--skz-tbg`（随 pulse 逐帧变化的已展开值）绕过了继承防火墙；落地时让防火墙补钉它，之后又把这个转发整个去掉（clip 根现在只有静态的 `--skz-tbg: initial`，防火墙只钉 `--skz-fill` / `--skz-bg-pos`）；修复后复测 60.4 帧 / 6.95 ms，见「落地后复测」。
- **pulse / shimmer 的成本在样式重算**：根上的动画变量每帧变化，继承它的每个元素都要重算。纯 CSS 下 16000 元素只有约 21 帧（underline 时测得）。
- **继承防火墙**是最大的一项优化：视口外的列表项不参与重算，16000 元素回到 60 帧，开启耗时和纯 CSS 基本一致。它需要 JS（`enable()` / 适配层 + `global` 变体）和列表结构；双栏表单这类"根下只有几个大块、且都在视口里"的页面上防火墙等于没开。
- **旧 `explicit.css`（现已并入 lite）** 去掉推导选择器，每个元素的重算更便宜：防火墙路径样式重算降 35%~47%，纯 CSS 路径帧率 20.8 → 34.4；但防火墙路径两者都是 60 帧（以上 underline 时测得）。
- **svg 方案**每帧样式重算接近 0，所有结构下都是 60 帧，代价是 PrePaint（默认 clip 下 16000 元素约 13 ms，underline 时 8.3 ms）和更贵的开启耗时（140 ms 对 global 的 85 ms）。

### 颜色、兼容性与代价

| 方案                                   | 颜色                                          | 浏览器要求                                                                                       | 需要 JS           | 主要代价                                                                   |
| -------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------- |
| fade / solid                           | 精确（主题变量）                              | 支持 CSS 变量                                                                                    | 否                | fade 会把根里的一切一起淡入淡出                                            |
| 根驱动（core / 基底；global 加防火墙） | 精确                                          | `@property`（按相对颜色语法判断：Chrome 119+ / Safari 16.4+ / Firefox 128+），否则自动降级为 SVG | 否；防火墙要 JS   | 纯 CSS 时大骨架慢                                                          |
| svg                                    | 通过 JS：精确（运行时生成）；无 JS：退回 fade | SMIL（所有现代浏览器及多数老浏览器）                                                             | 否；精确颜色要 JS | 显式 `underline` 的文字静止（round / clip 下会动）；CSP 需 `img-src blob:` |
| 显式标记                               | —                                             | 同基底                                                                                           | 否                | 每个骨头都要手动标 `skz-bone`                                              |

### 实验过但没有采用的方案

| 方案                                     | 结论                               | 原因                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SVG 滤镜把内容剪影成骨头                 | 不采用                             | 16000 元素 60 帧，但文字只是字形剪影、卡片结构和浅色内容丢失、深色主题更差、`skz-ignore` 原理上无法生效                                                                                                                                                                                                                                                                                                                                                                              |
| canvas 静态遮罩 + 合成器光带             | 不采用                             | 每帧主线程为 0、颜色精确，但生成遮罩一次要 4~7 秒（16000 元素）                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CSS Paint API（Houdini）                 | 不采用                             | 能在主线程外运行，但 worklet 和 GPU 更重，且只有 Chromium                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 每个骨头各挂一个动画（旧方案）           | 已移除                             | 被 `!important` 颜色压住，pulse 看不出效果却照样耗时；备份在 `archive/2026-10-08-element-anim/`                                                                                                                                                                                                                                                                                                                                                                                      |
| `content-visibility`（`skz-cv`）         | 保留为可选                         | 长列表每帧开销低，但子元素多时开启慢约 3 倍、会裁掉溢出内容；有列表结构时防火墙更优                                                                                                                                                                                                                                                                                                                                                                                                  |
| fps JS 计时器（`fps` 选项）              | 已删除                             | 真实页面里防火墙总是先启用，计时器几乎走不到；强制走到时 16000 元素 45 帧 / 10.8 ms，仍不如 svg 的 60 帧 / 0.04 ms（均为 underline 默认时测得）                                                                                                                                                                                                                                                                                                                                      |
| `steps()` 降帧（`--skz-shimmer-timing`） | 已重新引入并默认开启（对绘制有效） | 此前只测了样式重算（16000 元素 25.2 帧 / 35.6 ms 对 25.2 帧 / 35.3 ms，underline 时测得，确实没有差别）；后来测绘制：计算值不变的帧不重绘，2000 卡 clip 的 GPU 11.4 → 2.8 ms、有绘制帧 100% → 40%（`bench/2026-10-09-clip-steps/`，落地后复测 `bench/2026-10-10-landing/`）。默认扫过段 24 次/秒，现在按视口档位是 `steps(38)` / `steps(58)` / `steps(77)`（加停顿前是 `steps(36)`，之后曾是扫过 62.5% 的 `steps(30)`）；只对 global 生效，4× CPU 降速下默认档没收益，需 `steps(18)` |
| 只给可见项挂动画（方案 A）               | 未采用                             | 原型可行：2000 张卡样式重算降到 0.7~1.2 ms；但这台机器上防火墙已经 60 帧，只有 CPU 4×/6× 降速时才拉开，还带来"漏项就静止"等新风险，Safari / Firefox 没验证；原型与数据见 `bench/agents/a6-visible-anim`                                                                                                                                                                                                                                                                              |
| 派生变量只在骨头上计算                   | 未采用                             | 2000 卡 × {pulse, shimmer} × {clip, underline}：样式重算 pulse + clip 5.75 / 5.84 对 5.94 / 6.14 ms，其余没有下降，在批间漂移之内；underline + shimmer 时骨头底色会跟着脉冲、宿主样式与 svg 引擎也受影响，要回到按模式派生（`bench/2026-10-10-layering/NOTES.md` 第 4 项 A/B）                                                                                                                                                                                                       |

详细数据与过程见 [`bench/`](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/bench/README.md) 下各子代理目录的 `NOTES.md`。

## 各方案详解

### fade / solid（基底自带）

- **fade**（默认，不写 `skz-effect` 就是它）：根整体做 opacity 脉冲，跑在合成器线程，几乎零成本，元素再多也不卡。根里有 `skz-ignore` 时，隐式默认不开 fade（否则会把忽略区一起淡掉）；想强制开就显式写 `effect: "fade"`。
- **solid**：静止，没有动画。

### 根驱动 pulse / shimmer 与 global 方案

```ts
import "skeletonizer"; // 完整版：根驱动在 full.css 里，防火墙 / 老浏览器降级由 enable() 启动；lite（"skeletonizer/lite"）也有根驱动，只是没有防火墙
enable(el, { effect: "shimmer" }); // 或 "pulse"
```

- **原理**（`lite.css` 和 `full.css` 都带这套根驱动）：根上一个 CSS 动画驱动用 `@property` 注册的变量（流光位置、脉冲颜色），骨头只读继承下来的值，自己不挂动画。颜色取自 `--skz-color` / `--skz-highlight`，精确跟主题走。
- **shimmer**：流光是每个骨头自己盒子里的渐变平移（`background-size: 300px 100%`，位置 `calc(进度 * (100% + 600px) - 300px)`，光带从骨头左边界外进场、右边界外离场，骨头越宽走得越快、大家同时走完；光带宽固定而不按骨头比例，小元素上是整段渐变的明暗变化而不是一条细线；不用 `fixed` 背景，iOS 与桌面一样）；根上只有一个进度变量在动，所以各骨头时间上同步；round / clip 模式下文字条里也有光带，显式 `underline` 模式的文字没法渐变，改为颜色脉冲（这两种模式下根上才额外挂 pulse 动画；clip / leaf 不挂，省掉每帧白做的样式重算）。
- **降频**：光带默认 24 次/秒（`--skz-shimmer-timing` 缺省值按视口档位：2s 档在 1.6s 的扫过段上是 `steps(38)`，2.8s 档 2.4s 上是 `steps(58)`，3.6s 档 3.2s 上是 `steps(77)`）：计算值没变的帧 Chrome 不重绘，2000 卡 clip 的 GPU 从 11 ms 降到约 3 ms。`steps(18)` 更省，`linear` 恢复平滑；档数与时长绑定（见功能总表），只对根驱动生效（lite 与完整版的 global 方案，svg 引擎不受影响）。
- **lite 没有继承防火墙**：根下所有元素每帧都参与样式重算，所以 lite 面向单个根约 2000 元素以内，数据见 [lite 的规模上限](#lite-的规模上限)；更大的骨架换完整版。
- **继承防火墙（自动，仅完整版的 `global` 变体）**：通过 `enable()` / 适配层开启时，库从根往下找列表项（自动跳过只有一个子元素的包裹层，"根 > 列表容器 > 卡片"会命中卡片），用一个共享的 `IntersectionObserver` 给视口外的项打 `skz-fw`，CSS 在这些项上把动画变量钉成静态值，它们的后代就不再参与逐帧重算。视口外项里的骨头是静止的，滚进视口前 200px 恢复；开启后才插入的新项要等下次调用 `enable()` 才纳入（期间照常动画，只是没省下开销）。**列表项不要用 `display: contents`**：它会一直静止，见[继承防火墙与 `display: contents`](#继承防火墙与-display-contents)。
- **老浏览器降级（仅完整版的 `global` 方案，lite 没有，低于门槛的浏览器只有 fade）**：不支持 `@property` 时，JS 默认改挂 SVG 动画（blob 生成，颜色精确），`fallback: "fade"` 可改为保持基底 fade；JS 执行前（含 SSR 首屏）和 blob 生成失败时，老浏览器显示 fade。

### svg：共享 SVG 动画背景

```ts
import { enable } from "skeletonizer"; // 完整版内置 svg 方案，enable(el, { engine: "svg" }) 选用
enable(el, { effect: "shimmer" }); // 同时引入了 global 时写 engine: "svg"
```

- **原理**（仅完整版的 `svg` 变体）：骨头背景叠一张带 SMIL 动画的 SVG，所有骨头共用这一张图，CSS 每帧不变，没有样式重算；不依赖 `@property`。
- **颜色**：通过 `enable()` 开启时，按根上的 `--skz-highlight` 和 `--skz-duration`现生成 SVG（blob URL），颜色和时长与主题一致；光带宽 = 骨头宽的 60%（图拉伸到骨头自身盒子，SMIL 动画在图里写不了固定 px；根驱动是固定 300px，小元素上两者观感不同）；同参数共用一份，没人用时释放；系统深浅色切换时自动重新生成。没有 JS 或读不到主题变量时，根上不会有 `skz-engine` 属性，显示基底的 fade（CSS 里不再内置 SVG 兜底图）。通过 `enable()` 开启时，这两张图以内联变量 `--skz-svg-shimmer` / `--skz-svg-pulse` 写在根上；纯 HTML 手写 `skz-engine="svg"` 时可以自己提供这两个变量（未验证）。
- **代价**：显式 `underline` 的文字靠颜色而不是背景图，svg 引擎下保持静止（round、clip 和 `leaf` 没有这个问题）；光带降频变量 `--skz-shimmer-timing` 对它不生效；严格 CSP 需放行 `img-src blob:`（运行时图）。

### 标记与 `skz-auto`

所有基底都以标记为默认。没标的内容原样显示，标了才是骨头：

```html
<div skz>
  <img skz-bone src="..." />
  <h3><span skz-text>标题</span></h3>
  <p>这段没标，原样显示</p>
  <div skz-leaf>……合并成一块骨头……</div>
</div>
```

`skz-text` 出文字条（见[文字骨头模式](#文字骨头模式)），`skz-bone` 本元素整块当骨头，`skz-leaf` 把子树合成一块，`skz-ignore` 保持原样；骨头内部的后代藏起来，媒体骨头把真实内容推出盒子。骨头圆角默认 `var(--skz-radius)`，但元素自己写了 `border-radius`（如圆形头像）会保留它的形状。

无法改标记的第三方组件，在根或根内任意元素上写 `skz-auto`：按标签的推导（第 0 档、图标、控件、leaf 模式）只作用于该子树。局限见[标记骨头](#5-标记骨头)。

原来的 `explicit.css`（只有标记、没有任何 `skz-auto` 规则）在 0.3.0 删除了：它是 `lite.css` 的子集，而默认本来就只认标记（推导要 `skz-auto`），所以想要“只认标记、规则最少”就用 `skeletonizer/lite`；lite 里的 `skz-text` 只认 `round` / `clip`。

### 懒渲染与 `skz-cv`

懒渲染（仅完整版）只观察根：根很大、只露一角在视口里时，整个根的动画都在跑。`skz-cv`（`full.css` 带，`lite.css` 没有）补这个盲区，让根的直接子元素在视口外时整个跳过渲染；但它和 `enable()`（继承防火墙）叠加反而更差，有列表结构时优先用防火墙。两者的触发条件、代价和数据见[功能总表](#功能总表)的「懒渲染」和「`skz-cv`」两行。

## Bone 工具

`Bone` 是一个工具对象（普通对象，不是类），提供一组方法来生成占位数据，所有结果都是确定性的（不用 `Math.random`），SSR 时同样的输入永远得到同样的输出，天然支持水合。

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

写在根上：`enable(el, { text })`（完整版）或手写 `skz-text-mode="…"`。lite 只认 **round** 和 **clip**（手写 `skz-text-mode="round"` / `"clip"` 也行）；另外三种模式和 `text` 选项**仅完整版**有。模式作用于 `skz-text` 元素和 `skz-auto` 区域里的文字。

- **`round`**（默认：不写 `text` / `skz-text-mode` 就是它；需 `box-decoration-break`）：文字透明，元素带一个圆角背景盒。行内元素折行后**每一行一条圆角条**；块元素（`p` / `h3` / `div` / flex 子项）不管长短，都是**整块一个圆角矩形**。所以块元素里**推荐把 `skz-text` 打在内层 `<span>` 上**。条里同样有 shimmer 光带（`clone`：折行后每个行片段各自按自己的盒子扫，同步）、防火墙、深浅主题和 `--skz-radius`。GPU 约为 clip 的一半（原型实测），也不依赖「装饰线参与 `background-clip: text` 裁剪」这件只在 Chrome 验证过的事。浏览器不支持 `box-decoration-break`（`-webkit-` 写法也会查）时自动降级为 clip；想明确用 clip 就写 `skz-text-mode="clip"`。已知局限：① 雅黑 / Segoe UI / system-ui 下条比 clip 高约 0.1~0.16em（条高 = 字体内容区；Arial / Georgia / Consolas / SimSun / Times 与 clip 像素一致）；② line-height 为 1.2 时多行条可能互相叠出凹口（雅黑条高 1.32em，叠 0.12em）；③ 块元素整块：长段落是一整块大矩形，短标题被拉成整行宽，没有纯 CSS 补救（里面包一层行内 `<span skz-text>`，或选 `clip`）；④ 圆角固定读 `--skz-radius`（默认 4px），不随字号缩放；⑤ 只在 Chrome 154 上实测，Firefox / Safari 未验证。
- **`clip`**（显式写 `text: "clip"` / `skz-text-mode="clip"`；需 `background-clip: text`）：形状是沿真实文字行延伸的粗下划线（最后一行较短，混合文字 `价格：<b>¥5</b>` 也覆盖），填充是背景渐变，所以文字条里也有 shimmer 光带，svg 引擎下文字也会动。做法是文字透明、装饰线透明但参与裁剪、`background-clip: text` 把背景裁进 1.22em 粗的下划线里。外观与 0.1.x 的默认逐像素一致。代价：比 `underline` 和 `round` 贵，数字见[方案对比](#方案对比)；规范要求装饰线参与裁剪，但**只在 Chrome 实测过，Firefox / Safari 未验证（已知风险）**；完整版里不认 `background-clip: text` 的浏览器由 `@supports not` 撤回 clip 规则，退回 `underline`；`skz-auto` 区域里不在文字标签清单的裸文字（如 div 里直接写的文本）不出骨头。
- **`underline`**（仅完整版；显式写 `text: "underline"` / `skz-text-mode="underline"`；需 `text-decoration-thickness`）：在真实文字下面画一条粗下划线，沿真实文字行延伸，最后一行自然变短，混合文字也覆盖。**最便宜**；代价是不能渐变，shimmer 时文字改为颜色脉冲（svg 下静止）。低端机、追求最省时用它。
- **`leaf`**（仅完整版；需 `:has()`）：`skz-text` 元素整块变成一块骨头，同 `skz-bone`；`skz-auto` 区域里没有子元素、但有文字的元素整块变成骨头，可以 shimmer、有圆角。代价是多行块级文字会变成一整块矩形，混合文字里的裸文字节点不出骨头。

```html
<div skz skz-text-mode="leaf">...</div>
```

### 自定义颜色、圆角、时长

主题变量声明在根元素自身上，所以要**写在根元素上**（内联 `style` 或命中根的选择器），写在 `:root` 上不生效：

```css
[skz] {
  --skz-color: #e0e0e0; /* 骨头色（默认 #d9dde3，深色 #374151） */
  --skz-highlight: #f0f0f0; /* 高光色：shimmer 光带、pulse 亮端（默认 #eceff3，深色 #4b5563） */
  --skz-radius: 6px; /* 骨头圆角（默认 4px） */
  --skz-duration: 1.2s; /* 动画时长（不写：pulse / shimmer 都是 2s；写了就用它） */
  --skz-ul-thickness: 1em; /* 下划线粗度 */
  --skz-ul-offset: -0.85em; /* 下划线偏移 */
}
```

深色模式切换（`prefers-color-scheme` / `data-skz-theme`）、fit 的变量、减少动态效果等见[功能总表](#功能总表)的「主题变量」和「自动机制」。

## 浏览器支持与降级

样式分档渐进增强，浏览器自动取其所能，不嗅探 UA：

| 浏览器能力                                   | 得到什么                                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS 变量                                     | 第 0 档：标签白名单骨头（`skz-auto` 区域）、`skz-bone` / `skz-leaf` / `skz-ignore` 标记、fade / solid、svg 方案；lite 低于门槛时也停在这一档（静态色块 + 标记 + fade） |
| `text-decoration-thickness`                  | 第 1 档：`skz-text` 文字条与下划线法文字骨头（完整版；lite 要它和 `:has()` 同时具备才开现代档）                                                                        |
| `background-clip: text`                      | clip 文字模式的填充（也是 round 的降级目标）；完整版里不支持时由 `@supports not` 撤回，退回 underline（装饰线是否参与裁剪仅 Chrome 实测，Firefox / Safari 未验证）     |
| `:has()`                                     | 第 2 档：叶子模式、图标识别（完整版；lite 同上），以及根里有忽略区时关掉隐式 fade                                                                                      |
| `@property`（借相对颜色语法判断）            | 根驱动 pulse / shimmer（lite 与完整版都有）；没有时 lite 退回 fade，完整版的 global 默认降级为 SVG 动画                                                                |
| `box-decoration-break`（含 `-webkit-` 写法） | round 文字条（默认）；不支持时文字条退回 clip                                                                                                                          |
| `:is()` / `:where()`                         | `skz-auto` 推导和标记规则用了它们（Chrome 88+ / Safari 14+ / Firefox 84+）；缺 `:where()` 时骨头还会失去默认圆角（它让位于元素自己的 `border-radius`）                 |
| `IntersectionObserver`                       | 懒渲染、继承防火墙（仅完整版，lite 不用它）；不支持时跳过（仍有动画，只是没有优化）                                                                                    |

**lite 的门槛**：目标线是 Chrome 119+ / Safari 16.4+ / Firefox 128+（上表这几项能力在这条线上都已具备）。低于这条线的浏览器按缺哪项退到哪档：缺 `text-decoration-thickness` 或 `:has()`，lite 有第 0 档静态色块（`skz-auto` 区域）、`skz-bone` / `skz-leaf` 标记和 fade，没有 `skz-text` 文字条；缺 `@property` / 相对颜色，pulse / shimmer 退回 fade（lite 没有 SVG 降级）。要给这些浏览器动画或更细的推导，用完整版。

**验证状态**：lite 与完整版都只在 Chrome 实测，Firefox / Safari 按规范默认兼容、未实测。桌面 Chrome 全部实测；Safari、Firefox、iOS、Android WebView、旧浏览器**未实测**，降级路径只在 Chrome 里用"把检测条件改成必然不成立"的方式模拟验证过。

## 已知限制与使用约束

### lite 的限制

- **规模**：lite 没有继承防火墙，pulse / shimmer 每帧要重算根下所有元素的样式；单个根约 2000 元素以内、正常速度的桌面 Chrome 上是 60 帧，超过之后或 CPU 慢（4× 降速）时会掉帧，具体数据和建议见 [lite 的规模上限](#lite-的规模上限)。
- **浏览器门槛**：目标线 Chrome 119+ / Safari 16.4+ / Firefox 128+；低于它们，缺 `text-decoration-thickness` 或 `:has()` 时有第 0 档静态色块（`skz-auto` 区域）、`skz-bone` / `skz-leaf` 标记和 fade（没有 `skz-text` 文字条），缺 `@property` / 相对颜色时 pulse / shimmer 退回 fade，**没有 SVG 降级**。**只在 Chrome 实测**，Firefox / Safari 按规范默认兼容，未实测（clip 的装饰线裁剪尤其如此）。
- **文字**：只有 round（默认）和 clip。`skz-auto` 区域里 div 直接写的裸文字不出骨头（不可见），把文字放进 `p` / `span`、自己标 `skz-text`，或改用完整版的 `text: "underline"`。lite 的规则只认没写 `skz-text-mode`、或写 `round` / `clip` 的根，手写 `underline` / `leaf` 在 lite 里没有对应规则。
- **没有的东西**：继承防火墙、svg 方案、underline / leaf 模式、懒渲染（`skz-paused`）、`skz-cv`——需要就用完整版，见[完整版还是 lite](#完整版还是-lite)。
- **类型**：只导入 lite 时，`text` / `engine` / `fallback` 是类型错误，见[类型怎么随版本变宽](#类型怎么随版本变宽)。

### 开发模式警告

开发模式（`process.env.NODE_ENV` 不是 `production`）下，下面两种误用会 `console.warn` 一次（同一条只提示一次）；生产构建里它们都不会留下：每个调用点都包在守卫 `try { if (process.env.NODE_ENV !== "production") … } catch {}` 里，产物里 `process.env.NODE_ENV` 原样保留，由你的打包器按它自己的模式替换，替换加压缩之后调用和文案都被折叠掉（测试里用生产模式的 vite 构建验证过）。浏览器里直接引（没有 `process`）时守卫为假，不提示。

- **全局 `skz` 被占用**：别人已经占用了全局名 `skz`，我们不覆盖，提示改用 import 方式。
- **`engine` 误配**（仅自行拼装源码模块时）：显式传了没注册的方案——只注册了 `global` 却写 `engine: "svg"`，或反过来——提示用 `registerEngine` 注册或改用完整版（完整版两种方案都已注册）。

### 继承防火墙与 `display: contents`

这是已知缺陷，暂不修复。只影响完整版的 `global` 方案（lite 没有防火墙）。

防火墙把根下找到的列表项先全部打上 `skz-fw`，再由 `IntersectionObserver` 在项进入视口时撤掉。`display: contents` 的元素没有盒子，观察器永远判它「不在视口内」，所以它身上的 `skz-fw` 一直撤不掉：**即使在视口里，它和后代的 pulse / shimmer 也是静止的**。fit 用的是同一份列表项，也量不到这种项的位置，不会按预期隐藏。

```html
<!-- ❌ 列表项本身是 display: contents：这一项一直不动 -->
<div skz>
  <div style="display:contents"><p skz-text>…</p></div>
  <div style="display:contents"><p skz-text>…</p></div>
</div>

<!-- ✅ 列表项用有盒子的元素（display: contents 放到项里面不受影响） -->
<div skz>
  <div><p skz-text>…</p></div>
  <div><p skz-text>…</p></div>
</div>
```

框架里常见的无盒子包装（如给每项包一层 `display: contents` 的组件根）要留意：要么让它出盒子，要么这个根不走 `global` 方案：传 `engine: "svg"`，或接受 lite 无防火墙的规模上限。

### `skz-ignore` 区的颜色与背景

骨架藏文字用的是 `-webkit-text-fill-color`，不动 `color`，所以 `skz-ignore` 区及其后代的文字色在各档都保持原样。剩下几点要注意：

- 忽略区后代自带的**背景**在 Tier 0、1 仍会被清掉，Tier 2 的叶子背景模式才精确保留。
- 骨架里容器上依赖 `currentColor` 的边框 / outline / box-shadow 会露出来；不想要就给它们写明确的颜色，或在骨架态下单独处理。
- 放在 `skz-text` 元素或 `skz-auto` 区域内时，忽略区的文字会显示在骨头条之上（真实文字色压在灰条上）；原来「含忽略区的祖先关下划线」的修正随 `skz-has-ignore` 一起去掉了。想要干净的忽略区，写成兄弟元素：`<span skz-text>价格</span> <span skz-ignore>实时</span>`。

### Web Component 宿主

给宿主元素（Shadow DOM）写 `skz-host` 标记即可。规则是写死在 `lite.css` 与 `full.css` 里的静态 CSS：宿主 `visibility: hidden`（会继承进 shadow 树，里面的内容一并藏住），再由它的 `::before` 铺一块骨头。画法与普通骨头一致（读继承下来的 `--skz-fill` / `--skz-bg-img` / `--skz-bg-pos`），所以 pulse / shimmer（`global` 含降频、`svg` 引擎、防火墙）对宿主同样生效：

```html
<div skz>
  <my-card skz-host></my-card>
</div>
```

宿主自己的背景色也会被 `visibility` 藏掉。写了 `skz-ignore` 的宿主不处理。shadow root 里的样式（页面样式表进不去）要你自己引入；宿主规则在外面，照常生效。

### `inert` 属性支持

`enable()` 默认用原生 `inert` 锁定交互。根里有 `skz-ignore` 时不锁整个根，只锁不含忽略区的分支，忽略区保持可点击、可聚焦（开启后忽略区有变化，再调一次 `enable()` 即可重新上锁）。不支持 `inert` 的浏览器会降级到 CSS `pointer-events:none` + `focusin` 事件拦截（同样放过忽略区），但该降级分支未在真机验证过。

### 文字模式与光带降频的限制

只列约束；机制和数据见各链接。

- **round（默认）**：
  - 块元素上直接写 `skz-text` 是整块圆角矩形（短标题会被拉成整行宽）：把 `skz-text` 打在内层 `<span>` 上；
  - 雅黑 / Segoe UI / system-ui 下条比 clip 高约 0.1~0.16em，line-height 为 1.2 时多行条可能叠出凹口；圆角固定读 `--skz-radius`；
  - 不支持 `box-decoration-break` 的浏览器退回 clip；只在 Chrome 154 实测；
  - 详见[文字骨头模式](#文字骨头模式)。
- **clip**（`skz-text-mode="clip"`）：
  - `skz-auto` 区域里，div 直接写的裸文字不出骨头（不可见），包进 `p` / `span`、自己标 `skz-text`，或用 `text: "underline"`；
  - 装饰线参与 `background-clip: text` 的裁剪，**只在 Chrome 实测过，Firefox / Safari 未验证**（已知风险，`@supports` 判断不了）；
  - 多行 clip：行内的 `skz-text` 折行时按 `box-decoration-break: slice` 把各行接成一条，光带会先扫第一行再扫第二行。所以 clip 模式下 `skz-text` 的直接父级会接管背景（父级铺背景并 `background-clip: text`），各行光带同步。代价：这个父级原有的底色会被盖掉；父级里没标记的文字不受影响（仍是不透明原样）。标记直接挂在根下（根不会被接管）、或父级是行内元素（同样会折行接成一条）时，多行仍是一行接一行；round（`clone`）不受影响；
  - 不认 `background-clip: text` 的浏览器由 `@supports not` 撤回 clip，退回 underline 外观（静态灰、没有光带）；
  - 详见[文字骨头模式](#文字骨头模式)。
- **光带降频**（`--skz-shimmer-timing`）：
  - 4× CPU 降速下默认档没有收益（测时是 `steps(36)`，现在小档默认 `steps(38)`）（clip 18.4 帧，与落地前的 18.0 帧持平），可设 `steps(18)`（clip 到 40 帧；underline 仍是 14~15 帧）；
  - 只对根驱动生效（lite 与完整版的 global），svg 引擎的光带不受这个变量影响；
  - 默认扫过段 24 次/秒（三档视口分别是 `steps(38)` / `steps(58)` / `steps(77)`；24 次/秒 = 扫过秒数 × 24，每轮末尾停顿 0.4s，扫过秒数 = 总时长 × 当前档占比）；自己写了 `--skz-duration` 要同步改档数；
  - 详见[功能总表](#功能总表)的 `--skz-shimmer-timing` 一行和[方案对比](#方案对比)的落地后复测。

### 按钮与表单控件

- `skz-auto` 区域里，`button` 是控件，**整块当一块骨头**（区域之外要自己给按钮写 `skz-bone`）：背景铺成骨头色，内部的 `span` / 图标 / 文字全部隐藏，不会在按钮块上再叠小骨头。
- 圆角：按钮自己写了 `border-radius` 就保留，没写则用 `--skz-radius`。
- `input` / `textarea` / `select` 同样是控件：整块一块骨头，不画下划线。
- `skz-ignore` 区里的按钮不当骨头，内部内容恢复可见，但按钮自带的背景会被清成透明（忽略区后代的背景仍会被清掉，见[`skz-ignore` 区的颜色与背景](#skz-ignore-区的颜色与背景)）；想让某个按钮完全保持原样、可点（如"取消加载"），直接给按钮自己写 `skz-ignore`（Chrome 154 实测）。
- 不写 `skz-auto` 就没有这些推导规则，按钮要写 `skz-bone` 才是骨头。

## 在框架里怎么用

skeletonizer 是标准 Web Component / ESM。Vue / React / Svelte / Solid 另有开箱即用的适配层（见上文「框架适配」，子路径 `skeletonizer/vue` 等）；下面是不用适配层、直接接入的写法。

示例里的文字都用 `<span skz-text>` 标记（JSX 里写成 `skz-text=""`：裸写是 `true`，React 不会把它渲染到自定义属性上）。无论哪种写法，都要在应用入口导入一次 `skeletonizer`（完整版）或 `skeletonizer/lite`：它带上样式，也挂出适配层读取的实现（见[框架适配](#框架适配)）；适配层和直接调 `enable()` 共用这一份 core。

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
      <h3>
        <span skz-text>{{ user.name }}</span>
      </h3>
      <p>
        <span skz-text>{{ user.bio }}</span>
      </p>
    </div>
  </skz-box>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { Bone } from "skeletonizer";
import { defineSkzBox } from "skeletonizer/element";

defineSkzBox();

const isLoading = ref(true);
// 加载中用 Bone 造的 mock 数据：空文字没有尺寸，不会出骨头
const user = ref({ name: Bone.text(8), bio: Bone.lines(2) });

onMounted(async () => {
  const data = await fetchUser(); // fetchUser 换成你自己的请求函数
  user.value = data;
  isLoading.value = false;
});
</script>
```

### React 18+

React 18 原生支持自定义元素属性为字符串，直接用：

```jsx
import "skeletonizer";
import { defineSkzBox } from "skeletonizer/element";

defineSkzBox();

// isLoading 为真时，user 请传 Bone 造的 mock 数据（如 { name: Bone.text(8), bio: Bone.lines(2) }）
export function CardSkeleton({ isLoading, user }) {
  return (
    <skz-box loading={isLoading} effect="pulse">
      <div className="card">
        <h3>
          <span skz-text="">{user.name}</span>
        </h3>
        <p>
          <span skz-text="">{user.bio}</span>
        </p>
      </div>
    </skz-box>
  );
}
```

如果在 React 17 或需要更细的控制，用 `enable()` / `disable()`：

```jsx
import { useEffect, useRef } from "react";
import { enable, disable } from "skeletonizer";

// isLoading 为真时，user 请传 Bone 造的 mock 数据
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
        <h3>
          <span skz-text="">{user.name}</span>
        </h3>
        <p>
          <span skz-text="">{user.bio}</span>
        </p>
      </div>
    </div>
  );
}
```

### Svelte

Svelte 直接支持自定义元素：

```svelte
<script>
  import { Bone } from 'skeletonizer';
 import { defineSkzBox } from 'skeletonizer/element';
  import { onMount } from 'svelte';

  defineSkzBox();

  let isLoading = true;
  // 加载中用 Bone 造的 mock 数据：空文字没有尺寸，不会出骨头
  let user = { name: Bone.text(8), bio: Bone.lines(2) };

  onMount(async () => {
    user = await fetchUser(); // fetchUser 换成你自己的请求函数
    isLoading = false;
  });
</script>

<skz-box loading={isLoading} effect="pulse">
  <div class="card">
    <h3><span skz-text>{user.name}</span></h3>
    <p><span skz-text>{user.bio}</span></p>
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
  <div class="card"><!-- 内容：文字用 <span skz-text>，图片用 skz-bone --></div>
</div>
```

### Solid

指令（适配层本身不用 JSX；你的应用照常用 `babel-preset-solid` / `vite-plugin-solid` 编译 `use:`）：

```tsx
import { createSignal } from "solid-js";
import "skeletonizer";
import { skeleton } from "skeletonizer/solid";

// 只被 `use:` 引用的 import 会被 TypeScript 当成未使用删掉：保留一处真实引用
void skeleton;

function UserCard() {
  const [loading, setLoading] = createSignal(true);
  return (
    <div use:skeleton={{ loading: loading(), effect: "pulse" }}>
      <div class="card">{/* 内容：文字用 <span skz-text>，图片用 skz-bone */}</div>
    </div>
  );
}
```

或用组件：`<SkzBox loading={loading()} effect="pulse" as="section" class="box">…</SkzBox>`。`solid-js` 是可选 peer 依赖（`>=1.6.0`）。

### Angular

没有单独的适配层：Angular 库要经 Angular 编译器（ng-packagr）产出 partial Ivy 格式才能在 AOT 构建里用，为一个十来行的指令引入整套构建链不划算。下面两种写法任选其一。

**写一个指令**（复制进你的项目，直接调用 `enable` / `disable`）：

```ts
import { Directive, ElementRef, Input, OnChanges, OnDestroy, inject } from "@angular/core";
import { enable, disable, type EnableOptions } from "skeletonizer"; // 或 "skeletonizer/lite"

/** 按 loading 开关骨架：<div [skzSkeleton]="loading" [skzOptions]="{ effect: 'shimmer' }"> */
@Directive({ selector: "[skzSkeleton]", standalone: true })
export class SkzSkeletonDirective implements OnChanges, OnDestroy {
  /** 是否加载中 */
  @Input("skzSkeleton") loading = false;
  /** 骨架选项，同 enable() */
  @Input() skzOptions: EnableOptions = {};
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  ngOnChanges(): void {
    // enable() 幂等，重复调用按本次选项覆盖
    if (this.loading) enable(this.el, this.skzOptions);
    else disable(this.el);
  }

  ngOnDestroy(): void {
    disable(this.el);
  }
}
```

**或用 `<skz-box>`**：在应用入口 `defineSkzBox()`（见[`<skz-box>` 自定义元素](#skz-box-自定义元素--纯-html)），组件里声明 `schemas: [CUSTOM_ELEMENTS_SCHEMA]`，然后 `<skz-box [loading]="loading" effect="shimmer"><div class="card">…</div></skz-box>`（`[loading]` 绑的是元素的 `loading` 属性）。

## 给 AI 编码助手

编码助手不会自动读取 `node_modules` 里的文档。把下面这段贴进你项目的 `AGENTS.md` / `CLAUDE.md`，它写骨架屏时就一定会先看用法：

```md
## 骨架屏

加载态统一用 skeletonizer。写之前先读 `node_modules/skeletonizer/llms.md` 并照做。
```

## 开发与实验存档

```sh
pnpm dev     # demo（http://localhost:5188/demo/index.html），可切效果、方案、档位、深色
pnpm build   # vp pack：自包含的 JS（full / lite：*.mjs + .d.mts）、适配层（vue / react / svelte / solid）和两份 CSS（full.css / lite.css，来自 src/styles/entries/*.scss）
pnpm test    # vitest：运行时、防火墙、SVG 生成、方案选择、全局 skz、样式入口组成，以及基于构建产物的类型 / 条件导出 / 打包器夹具
pnpm check   # oxfmt + oxlint（含类型检查）
```

- 源码结构见 [ARCHITECTURE.md](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/ARCHITECTURE.md)。
- 性能实验的工具包、各轮脚本 / 场景 / 原始数据、子代理实验与结论都在 [`bench/`](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/bench/README.md)；结论汇总在[性能报告](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/reports/2026-10-08-performance.md)。

## 文档与参考

- [设计总结](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/design/overview.md)
- [性能报告](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/reports/2026-10-08-performance.md)
- [当前状态与待办](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/status.md)
- [文档索引](https://github.com/icodejoo/codejoo/blob/main/apps/skeletonizer/docs/README.md)

## License

[MIT](./LICENSE)

## 致谢

设计灵感来自 Flutter 的 [skeletonizer](https://pub.dev/packages/skeletonizer)、[vue-skeletor](https://www.npmjs.com/package/vue-skeletor) 的占位思路，以及实战中对"改个 UI 就得重画骨架"这一痛点的反思。
