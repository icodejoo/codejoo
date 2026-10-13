---
title: skeletonizer Web 版设计总结
status: active
updated: 2026-10-11
summary: 运行时 + mock + 显式标记的 Web 骨架屏方案：已定决策、四档层叠、core 与完整版、标记、API 与路线。
---

## TL;DR

- 照 Flutter skeletonizer 的路子：**真实 DOM 渲染 + mock 数据 + 显式标记**（0.2.0 起默认由开发者标 `skz-text` / `skz-bone` / `skz-leaf`，没标的原样显示），不手画占位形状；无法改标记的第三方组件放进 `skz-auto` 区域，区域内才按标签推导。
- 核心是**纯 CSS**，不依赖 JS（只靠根上的 `skz` 开关）：`skz-auto` 区域里靠 `@supports` 分四档渐进覆盖（兜底整块 → 标签白名单 → 下划线文字（默认 round 圆角条，clip 叠 `background-clip:text` 填充）→ `:has` 叶子），不用 UA 嗅探，也不用 JS 闸门。
- 包有两种并列的用法（2026-10-10 拆包）：**core**（默认，`import "skeletonizer"`，面向现代浏览器里的中小骨架，单个根约 2000 元素以内）与**完整版**（`skeletonizer/full` + 按需样式与变体，规模上限高得多（有继承防火墙））；产物还包括一个 light DOM 的 `<skz-box>` 和 Vue / React / Svelte 适配层（子路径导出）。
- 原型已跑通，实测结论见 [原型验证报告](../reports/2026-10-08-prototype-verification.md)。

## 1. 为什么做，和三个参考物的关系

| 参考                                                                       | 做法                                                                                                    | 我们取什么 / 不取什么                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [skeletonizer（Flutter）](https://pub.dev/packages/skeletonizer)           | 照常写真实组件喂 mock，运行时把叶子换成按真实布局画的骨头，用 `ignore/keep/leaf/unite/replace` 局部覆盖 | **全盘照搬思路**：真实布局、叶子替换、覆盖标记 |
| [vue-skeletor](https://www.npmjs.com/package/vue-skeletor)                 | 手写占位组件，靠不可见字符撑高度                                                                        | 只借一点：mock 文字撑出真实宽度                |
| [react-content-loader](https://www.npmjs.com/package/react-content-loader) | 手画 SVG 形状                                                                                           | 不取：和真实 UI 脱节，改版就得重画             |

## 2. 已定决策

| #        | 议题                                   | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1       | 渲染机制                               | CSS 优先；运行时测量（覆盖层）暂不做，留作将来的逃生口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Q2 / Q19 | 产物形态                               | `core` + `<skz-box>`（light DOM，不用 shadow）；**不发框架适配包**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Q3 / Q14 | mock                                   | `Bone` 静态工具类，**只造数据不渲染**；图片用透明占位图，文字用 `█` 词                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Q4       | SSR / 无 JS 首屏                       | 要。状态全在 class/属性里，CSS 即可出骨架                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Q5 / Q24 | 浏览器基线                             | 纯 CSS 层叠渐进增强，不声明版本号，不用 JS 闸门；认识 `@supports` 的进第 0 档及以上，其余落到兜底整块                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Q6 / Q23 | 本次产出                               | 设计文档 + 最小原型（零依赖）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Q7 / Q12 | 命中方式                               | **0.2.0 起默认显式**：开发者自己标 `skz-text` / `skz-bone` / `skz-leaf`（最精准），没有标记也不在 `skz-auto` 里的内容原样显示；自动推导只在 `skz-auto` 区域里生效（给无法改标记的第三方组件）。0.1.x 原为「默认自动、标记只做例外、不要 `skz-auto`」，反转原因：标签白名单外的裸文字（div / 自定义元素 / code 里直接写的字）在 clip 下不可见，只能发现一个补一个                                                                                                                                                                                                                                                          |
| Q8 / Q13 | 标记载体                               | 裸属性：`skz-text` / `skz-bone` / `skz-leaf` / `skz-ignore` / `skz-auto`，不用 `data-sk`；根状态用属性 `skz`（不是 class，框架整体改写 class 不会冲掉它），根上的文字模式属性叫 `skz-text-mode`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Q9       | 多行文字形状                           | 被 Q16 的下划线法取代（`lh` 渐变分行没做）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Q10      | 交互锁                                 | 根上 `inert` + `aria-busy`；要保持可点的内容放到骨架根外面                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Q11      | 动效                                   | 默认 `fade`（根级 opacity，合成器线程，几乎零成本）；`solid`；`pulse` / `shimmer` 改为根驱动（`@property` 变量 + 根上一个动画），不支持 `@property` 时退回 fade；不自动降级（曾有 `maxAnimated` 阈值，已移除）。元素级旧方案备份在 `archive/2026-10-08-element-anim/`；仅显式 `underline` 的文字不能 shimmer（round / clip 可以）。shimmer 光带默认降频到 24 次/秒（`--skz-shimmer-timing`，2026-10-10 重新引入时为 `steps(36)`；2026-10-12 默认时长 1.5s → 2s、光带扫过 62.5% 后停顿，档数改为 `steps(30)`；随后光带改为每个骨头在自己的盒子里扫（去掉 `fixed`，`background-size: 300px 100%`，位置 `calc(进度 * (100% + 600px) - 300px)`，光带固定 300px、不按骨头比例（小元素上不会只剩细线），`--skz-shimmer-p` 为 0 → 1 进度，根上一个变量驱动、各骨头同步，iOS 与桌面一样），时长固定 2s / `steps(30)`，用户写 `--skz-duration` 则 pulse 与 shimmer 都用它（档数自己配），svg 引擎图拉伸到骨头盒子、rect 宽 60：此前只测了样式重算没收益，后来发现值不变的帧不重绘，GPU 大降；只对 global 生效）；clip 下根上不再挂 pulse 动画，underline 才挂。**2026-10-08 由性能实测改了默认**，见性能报告 |
| Q15      | 文字占位                               | 按词切分、词长确定性（不用 `Math.random`）、`lines`、CJK 简单版                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Q16      | 文字骨头                               | **四种**：round（**0.2.0 起默认**：文字透明 + 圆角背景盒，行内元素折行后每行一条圆角条，块元素整块圆角矩形，推荐把 `skz-text` 打在内层 `<span>` 上；不支持 `box-decoration-break` 时降级为 clip）+ clip（下划线当形状、`background-clip:text` 当填充，文字条有光带，0.1.x 的默认；`skz-text-mode="clip"`）+ 下划线法（`skz-text-mode="underline"`，最便宜）+ 叶子背景法（`skz-text-mode="leaf"`，需 `:has`）。tofu（方块字体，可选）已于 2026-10-13 移除，见[2026-10-13 对比报告](../reports/2026-10-13-tofu-vs-underline.md)。core 与 `explicit.css` 只认 round / clip                                                                                                 |
| Q17      | Web Component                          | 支持：宿主 `visibility:hidden` + `::before` 铺骨头，运行时生成标签名样式表                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Q18      | 图标                                   | 默认命中（空 `i`、类名含 `icon` 的空元素），白名单可扩展                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Q20      | 包名                                   | `skeletonizer`（npm 上目前未被占用，发布前再确认）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Q21      | 测试                                   | Vitest + Playwright 三引擎视觉快照（**待做**，原型只有 `node:test`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Q22      | 框架使用                               | 只在文档里放可复制的最小示例，不发包                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Q25      | 支持口径                               | 第 0、1 档标 best effort；CI 只做逻辑层验证                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Q26      | 构建                                   | JS 目标 ES2015、不带 polyfill；PostCSS + autoprefixer 作开发依赖（**待做**，原型未接）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Q27      | iOS 流光                               | 已取消：光带按骨头自身盒子扫、不再依赖 `fixed` 背景，iOS 与桌面走同一套光带（原先的 iOS 降级分支已删；**iOS 真机上的表现未验证**）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Q28      | 兜底粒度                               | 根的**直接子元素各一块**，后代 `visibility:hidden`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Q29      | 兜底层约束                             | 见 §7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Q30      | core 与完整版                          | 包拆成两种**并列**用法：core（`skeletonizer`，体积 > 简单 > 维护，目标 Chrome 119+ / Safari 16.4+ / Firefox 128+，单个根约 2000 元素以内，文字只有 round / clip，低于门槛有第 0 档（`skz-auto` 区域）+ 标记 + fade）与完整版（`skeletonizer/full`，四档渐进、防火墙、svg、sweep、懒渲染、`registerCustomElements`、老浏览器降级，规模上限高得多（有继承防火墙））。README 用一张对比表让使用者选，两者不要同时引（见 §5.1）。**Firefox / Safari 未实测，按规范默认兼容，文档写"仅 Chrome 实测"**                                                                                                                    |
| Q31      | CSS 分层                               | `core.css` = 主题 + 第 0 档 + 标记 + 现代档（单个 `@supports` 要求 `text-decoration-thickness` 与 `:has()`）+ effects-core + fit + 根驱动；`explicit.css` = 主题 + 标记 + effects-core + fit + 根驱动 + 懒渲染规则；`base.css` = 兜底 + 完整四档 + 根驱动 + 纯色驱动 + 懒渲染；`global.css` 只剩防火墙 + svg 降级。pulse / shimmer 的根驱动挪进各基底，只引 `base.css` 也有纯 CSS 动画。逐规则对比与性能验证见 `bench/2026-10-10-layering/NOTES.md`                                                                                                                                                                       |
| Q32      | 扩展点与全局变量                       | core 只认 `effect` / `fit`，其余能力经通用扩展点 `registerExtension({ name, sync, release })` 挂入；方案实现的注册改名 `registerEngine`（`skeletonizer/full` 导出）。导入 core / explicit / full 任一入口挂全局 `skz = { enable, disable, bone, defineSkzBox }`（SSR 也挂，完整版补 `registerCustomElements`；已被别人占用不覆盖并在开发模式警告一次；适配层不挂）                                                                                                                                                                                                                                                        |
| Q33      | 类型随版本变宽                         | `EnableOptions` / `SkzGlobal` 用接口、`SkzEffect` 取自 `SkzEffectMap` 的键；完整版入口的类型里 `declare module "skeletonizer"` 补 `text` / `engine` / `fallback`、`sweep`、`registerCustomElements`，导入后全项目自动变宽；只导入 core 时传这些是类型错误                                                                                                                                                                                                                                                                                                                                                                 |
| Q34      | 开发模式警告                           | `process.env.NODE_ENV` 不是 production 时 `console.warn` 一次：全局 `skz` 被占用、完整版里显式传了没注册的 `engine`；产物里保留该表达式原样，由使用方打包器替换，浏览器直引按生产处理                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Q35      | 文字模式 round 成为默认                | 新增 round 并作为默认：与 clip 共用同一批形状 / 填充 / 圆角规则，只在根上切四个内部变量（`--skz-ul-line` / `--skz-bgclip` / `--skz-bdb` / `--skz-tradius`），门控在 `box-decoration-break` 的 `@supports` 上，不支持时整块不生效、外观就是 clip。GPU 约为 clip 的一半（a9 原型实测），也不依赖「装饰线参与 `background-clip:text` 裁剪」这件只在 Chrome 实测过的行为。显式写 `clip` 与 0.1.x 像素一致。已知局限：雅黑 / Segoe UI / system-ui 下条比 clip 高约 0.1~0.16em；line-height 1.2 时多行条可能叠出凹口；块元素整块；圆角固定读 `--skz-radius`。规则结构见 [ARCHITECTURE](../../ARCHITECTURE.md)                   |
| Q36      | `skz-text` 改名与元素级标记            | 根上的文字模式属性 `skz-text` 改名 `skz-text-mode`（JS 选项 `text` 不变，写到新属性），`skz-text` 腾出来作元素级标记：该元素整个子树按文字行出条，标在容器上也覆盖混合内容                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Q37      | 忽略区只靠 `skz-ignore`                | 移除 `skz-has-ignore`，`enable()` 不再写它；不再有「含忽略区的祖先关下划线」的修正（`:has([skz-ignore])` 逐元素检查整条删除）：忽略区在 `skz-text` / `skz-auto` 内时文字显示在骨头条之上，想干净就写成兄弟元素。根上的默认 fade 遇到忽略区改为 `:has()` 对根自己检查一次来撤销                                                                                                                                                                                                                                                                                                                                            |
| Q38      | 推导用 `:is()` / `:where()` 作区域前缀 | `skz-auto` 包在 `:where()` 里，优先级与原来的单 `[skz]` 前缀一致，层叠关系不变；门槛随之为支持 `:is()` / `:where()` 的浏览器（Chrome 88+ / Safari 14+ / Firefox 84+；标记规则里的 `:not()` 用了选择器列表）。根级变量仍挂在 `[skz]` 上，不经过 `skz-auto`                                                                                                                                                                                                                                                                                                                                                                 |

## 3. 四档层叠

> 这是完整版（`base.css`）的完整渐进。core 只取其中的第 0 档加一个"现代档"（`text-decoration-thickness` 与 `:has()` 同时具备时才开，`skz-text` 文字条 / 控件整块 / 图标合并在一起），低于门槛没有中间档；见 §5.1。
>
> **0.2.0 起这些推导规则都只作用于 `skz-auto` 区域**（根自身或根内某个后代写了裸属性 `skz-auto`），默认（没有 `skz-auto`）由开发者用标记决定骨头；`skz-text` 标记在 tier1 / tier2 里，区域内外都生效。下文"根的直接子元素""标签白名单"等都指区域内。

```
base.css      无条件        兜底：根的直接子元素整块灰，后代藏起来
tier0.css     无条件（默认支持 CSS 变量）标签白名单 + 背景色（粗糙）
tier1.css     @supports (text-decoration-thickness: 1em)  下划线法文字骨头
tier2.css     @supports selector(:has(*))                 叶子背景法、图标、含 ignore 祖先修正
effects.css   无条件（默认支持 CSS 变量）fade（默认）/ solid / pulse / shimmer
```

要点：

- 兜底层只用 CSS2.1/3 基础语法，颜色写字面量；不认识 `@supports` 的浏览器会整段跳过后面的块，自然停在兜底。
- 兜底层用 `background-image` 渐变图层上色（不是 `background-color`），这样第 0 档退出时只需 `background-image: none`，不会把业务自己的背景色一起抹掉。代价：根的直接子元素自己的 `background-image` 在第 0 档以上会丢。
- 兜底层的规则全部 `!important`，否则压不住业务样式。
- SSR / 无 JS（或 `<skz-box>` 没升级）时，在骨架根上直接写 `skz`（要兜底层再加 `skz-auto`），如 `<skz-box loading><div skz skz-auto>…</div></skz-box>`，按 `[skz]` 命中，标记照常生效，兜底层里始终是整块；JS 起来后 `enable()` 幂等，不会重复加锁。

## 4. 标记词汇

| 标记         | 含义                                                                                              | 对应 skeletonizer          |
| ------------ | ------------------------------------------------------------------------------------------------- | -------------------------- |
| `skz-text`   | 该元素整个子树的文字按文字行出条（最后一行变短），标在容器上也覆盖混合内容；推荐打在内层 `<span>` | 文字骨头                   |
| `skz-bone`   | 本元素整块当骨头（图片、头像、按钮、装饰 div），子树隐藏                                          | `Skeleton.replace`         |
| `skz-leaf`   | 本元素整块，子树全藏                                                                              | `Skeleton.leaf` / `unite`  |
| `skz-ignore` | 保持原样、可交互                                                                                  | `Skeleton.keep` / `ignore` |
| `skz-auto`   | 根自身或根内任意后代：只对该子树开启按标签的自动推导（给无法改标记的第三方组件）                  | —                          |

根元素上的属性：`skz-effect="fade|solid|sweep|pulse|shimmer"`（sweep：浅色混合提亮、深色自动用容器色扫光，无单独模式属性）、`skz-text-mode="round|clip|underline|leaf"`（不写 = round，默认；未知取值（含已移除的 tofu）退回 underline 外观；core 与 `explicit.css` 只认 round / clip）。

`skz-auto` 的局限：规则基于标签白名单，CSS 选不到文本节点，所以 `div` / 自定义元素 / `code` 里直接写的裸文字不在范围内（round / clip 下不可见，要包进 `p` / `span` 或自己标 `skz-text`）；块级文字标签在 round 下是整块圆角矩形；空 div 做的头像 / 色块不识别，要写 `skz-bone`。

已知限制：`skz-ignore` 区里后代自带的**背景**在第 0、1 档会丢，第 2 档的叶子背景模式才精确保留；文字色因为藏文字改用 `-webkit-text-fill-color`（不动 `color`），各档都保留。代价是容器上依赖 `currentColor` 的边框等会在骨架里露出来。忽略区放在 `skz-text` 元素或 `skz-auto` 区域内时，它的文字显示在骨头条之上；想要干净的忽略区，写成兄弟元素：`<span skz-text>价格</span> <span skz-ignore>实时</span>`。

## 5. 根状态与 API

```js
import { enable, disable, defineSkzBox, Bone } from "skeletonizer"; // core；完整版从 "skeletonizer/full" 导入，并多出 registerCustomElements / registerEngine
import { registerCustomElements } from "skeletonizer/full";

const off = enable(el, { effect: "pulse" }); // 返回关闭函数；text / engine / fallback 仅完整版
off(); // 或 disable(el)

defineSkzBox(); // <skz-box loading effect="pulse"><div>…</div></skz-box>，skz 落在第一个元素子节点上
registerCustomElements(document, { watch: true }); // 扫描自定义元素，生成宿主样式表
```

- `enable()` 加根标记属性 `skz`、`aria-busy`、`inert`（避开 `skz-ignore` 区）。根标记用属性而非 class：框架重绘整体改写 class 时不会冲掉它，所以不需要 MutationObserver 补回。根滚出视口时由全库共享的 `IntersectionObserver` 打上 `skz-paused` 暂停动画。
- `fit: true`（默认关）：骨架自身不撑出滚动条。根带 `skz-fit`，CSS 兜底 `max-height: 100vh/100dvh` + `overflow: clip`（首帧零 JS 生效）；JS（`src/fit.ts`）找第一个 overflow 非 visible 的祖先（没有则视口），把根的内联 `max-height` 收成「边界可视底边 − 根顶」，并给完全落在其外的列表项（同防火墙的找法）打 `skz-fit-hide`（`display:none`）；收口后边界若仍可滚动（骨架在首屏以下，或下方有别的内容，滚动条不是骨架造成的），放宽为一屏高后重新打标记，只放宽一次；`ResizeObserver` 观察边界（视口监听 `resize`），rAF 合并重算；关闭或 `disable()` 时清干净。只管骨架自身，不扣掉它下方的内容（页脚等）。`<skz-box fit>` 与 React / Vue / Svelte 的 `fit` 透传同一选项。
- `<skz-box>` 宿主只管自己的 `loading` 属性，`enable/disable/toggle` 作用在【第一个元素子节点】上，宿主自己不带 `skz`，因此没有重入保护；宿主断开时对子根 `disable`、重新连接时按 `loading` 恢复。不带 MutationObserver：子根被框架替换后由用户自己处理（如切一下 `loading`）。
- 没有原生 `inert` 时退到 CSS `pointer-events:none` + 根上 `focusin` 捕获后 `blur()`（**该分支未在真机验证**）。
- `registerCustomElements`（仅完整版）优先 `adoptedStyleSheets`，不支持时往 `<head>` 插 `<style data-skz-hosts>`（**降级分支未验证**）。

### 5.1 包的两种用法：core 与完整版

|              | core（`skeletonizer`）                                            | 完整版（`skeletonizer/full`）                                                                    |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 样式         | 自带 `core.css`                                                   | 自己挑：`base.css` / `explicit.css` + 变体，或 `all.css`                                         |
| 能力         | fade / solid / pulse / shimmer，文字只有 round / clip             | 另有 sweep、underline / leaf、防火墙、svg、懒渲染、`registerCustomElements`、老浏览器降级 |
| 门槛与规模   | Chrome 119+ / Safari 16.4+ / Firefox 128+；单个根约 2000 元素以内 | 兜底层 + 四档渐进；上限高得多                                                                    |
| 体积（gzip） | 4.76 KB                                                           | 6.54 KB（`full` + `base.css`）起                                                                 |

- core 没有继承防火墙，pulse / shimmer 每帧重算根下所有元素的样式，规模上限的数据见 [README 的"core 的规模上限"](../../README.zh-CN.md#core-的规模上限)和 `bench/2026-10-10-core/NOTES.md`。
- 完整版用户不要再引 `skeletonizer` 默认入口（它带 `core.css`，重复加载并改变层叠）；旧的 `import … from "skeletonizer"` 迁到 `skeletonizer/full`。
- 适配层直接引 core 模块，不带样式、不挂全局，类型随导入的版本变宽。

### Bone（只造数据）

| 方法                             | 说明                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Bone.text(n, {seed})`           | n 个字符的 `█` 词文本，词间有空格，可换行，词长确定性                                                                                                                       |
| `Bone.lines(k, {perLine, seed})` | 约 k 行的占位段落                                                                                                                                                           |
| `Bone.cjk(n, {seed})`            | 方块 + 零宽空格断点                                                                                                                                                         |
| `Bone.number(digits)`            | 固定位数方块                                                                                                                                                                |
| `Bone.image(w?, h?)`             | 重载：无参返回 1px 透明 GIF 的 base64 data URI（尺寸由 img 属性或 CSS 给）；只传 w 则 h=w，得到方形透明 SVG；传 w、h 返回带固有宽高的透明 SVG，保留宽高比；非法参数退回 GIF |

注意：严格 CSP 若不放行 `img-src data:`，请自托管透明图。

## 6. 文字骨头：四种做法

以下模式作用于 `skz-text` 元素和 `skz-auto` 区域里的文字，写在根的 `skz-text-mode` 上。

- **round（默认）**：文字透明，元素带圆角背景盒（`box-decoration-break: clone`）：行内元素折行后每行一条圆角条，块元素整块一个圆角矩形，所以推荐把 `skz-text` 打在内层 `<span>` 上。与 clip 共用同一批形状 / 填充规则，只在根上切 `--skz-ul-line` / `--skz-bgclip` / `--skz-bdb` / `--skz-tradius` 四个变量（见 ARCHITECTURE）。文字条里有 shimmer 光带，GPU 约为 clip 的一半，不依赖装饰线参与 `background-clip:text` 裁剪；浏览器不支持 `box-decoration-break` 时降级为 clip。局限：雅黑 / Segoe UI / system-ui 下条比 clip 高约 0.1~0.16em；line-height 1.2 时多行条可能叠出凹口；块元素整块（长段落一大块、短标题拉成整行宽）；圆角固定读 `--skz-radius`；只在 Chrome 实测。
- **clip（显式 `skz-text-mode="clip"`，0.1.x 的默认）**：形状仍是下划线（粗 `1.22em`、上移到 `-0.92em`，盖住下探字形），所有后代的装饰线颜色设透明（只参与裁剪、不显示），文字标签读背景骨头的同一套变量（`--skz-fill` / `--skz-bg-img` / `--skz-bg-pos`）并 `background-clip: text`，所以文字条里有 shimmer 光带，svg 引擎下文字也会动。多行光带同步：行内标记元素折行是 slice（各行接成一条），所以 clip 下 `skz-text` 的直接父级接管背景（父级铺背景 + `background-clip: text`，标记元素自己不铺），各行同步；代价是父级原有底色被盖掉，标记直接挂在根下或父级是行内元素时仍一行接一行；round 生效时（支持 `box-decoration-break`）不输出这批规则，用 `@supports not` 反向门控让默认 / round 根在不支持时才走它（`sk-clip-parent`）。整组规则无条件写在 `tier1.scss`，浏览器不认 `background-clip: text` 时由 `@supports not` 撤回、退回下划线。代价：比下划线贵（数据见[矩阵报告](../reports/2026-10-09-benchmark-matrix.md)的补测）；装饰线是否参与裁剪规范有要求，但只在 Chrome 实测过，Firefox / Safari 未验证；`skz-auto` 区域里不在文字标签清单却直接含文字的元素（裸 div 文本）不出骨头。
- **下划线法（显式 `skz-text-mode="underline"`，第 1 档）**：最便宜。给所有文字画 `text-decoration: underline`，粗 `1em`、偏移 `-0.85em`（变量 `--skz-ul-thickness` / `--skz-ul-offset` 可调）。沿真实文字行延伸，最后一行自然变短，混合文字（`价格：<b>¥5</b>`）也覆盖。代价：不能渐变（只有 pulse），没有圆角，下划线会沿祖先传给后代文字。
- **tofu（已于 2026-10-13 移除）**：曾是可选的方块字体文字模式（`tofu.css`）；成对压测里没有任何场景比 underline 快，且有换行差一行、字体被挡时真实文字露出等固有缺点，用户拍板去掉。依据见[2026-10-13 对比报告](../reports/2026-10-13-tofu-vs-underline.md)。旧写法 `skz-text-mode="tofu"` 现在是未知取值，退回 underline 外观。
- **叶子背景法（第 2 档，`skz-text-mode="leaf"`）**：`skz-text` 元素整块当骨头（同 `skz-bone`）；`skz-auto` 区域里 `:not(:has(*)):not(:empty)` 的元素上背景色，可 shimmer、有圆角。代价：多行块级文字成一整块矩形，混合文字里的裸文字节点既不出骨头也被藏起来。

## 7. 兜底层的使用约束（Q29）

兜底层只在 `skz-auto` 区域里生效（下面的"根"指区域；SSR / 无 JS 时写 `skz skz-auto`）。实测结果见验证报告，准确表述如下：

1. 根的直接子元素若是 `video`/`canvas`/`iframe`，真实内容仍会盖在灰块上，请自己包一层 `div`。
2. 不要对根的直接子元素用 `display: contents`：它没有盒子，涂不上色，后代又被藏起来，那一块会变成**空白**。
3. 直接放在根下的**裸文字不会被藏起来**（实测：会露出真实文字），请用元素包住。
4. 绝对定位的悬浮角标会被涂成一块灰，需要保持原样就标 `skz-ignore`。
5. 第 0 档同样会露出容器里的**混合文字**（元素之间的裸文字节点），和图标字体 `<i>` 的字形（图标启发式在第 2 档才有）。

## 8. 待验证假设与实测状态

详见 [验证报告](../reports/2026-10-08-prototype-verification.md)。**Safari / Firefox / iOS / 旧浏览器均未验证**，只在桌面 Chrome 上实测。

## 9. 后续路线

1. 迁 TypeScript，`tsup` 构建（JS 目标 ES2015），CSS 接 PostCSS + autoprefixer（需先确认依赖）。
2. 测试：Vitest（`Bone`、`enable`），Playwright 三引擎视觉快照，另外在现代浏览器里**强制只加载某一档 CSS**跑快照，验证降级逻辑。
3. 框架使用示例文档：Vue 指令（`enable(el)`，`updated` 钩子补 class）、React、Svelte `use:`、Solid。
4. 补真机验证：iOS Safari（光带、`inert`、`::before` 宿主）、Firefox、Safari。
5. 评估运行时测量模式（`Range.getClientRects` 覆盖层）作为精确模式的逃生口。
6. 发布前确认 npm 包名 `skeletonizer` 仍未被占用。
