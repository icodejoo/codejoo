---
title: skeletonizer Web 版设计总结
status: active
updated: 2026-10-08
summary: 运行时 + mock + 覆盖标记的 Web 骨架屏方案：已定决策、四档层叠、标记、API 与路线。
---

## TL;DR

- 照 Flutter skeletonizer 的路子：**真实 DOM 渲染 + mock 数据 + 例外标记**，不手画占位形状。
- 核心是**纯 CSS**，靠 `@supports` 分四档渐进覆盖（兜底整块 → 标签白名单 → 下划线文字 → `:has` 叶子），不用 UA 嗅探，也不用 JS 闸门。
- 产物只有 `core`（CSS + `enable()` + `Bone`）和一个 light DOM 的 `<x-ske>`；各框架只给文档示例，不发适配包。
- 原型已跑通，实测结论见 [原型验证报告](../reports/2026-10-08-prototype-verification.md)。

## 1. 为什么做，和三个参考物的关系

| 参考                                                                       | 做法                                                                                                    | 我们取什么 / 不取什么                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [skeletonizer（Flutter）](https://pub.dev/packages/skeletonizer)           | 照常写真实组件喂 mock，运行时把叶子换成按真实布局画的骨头，用 `ignore/keep/leaf/unite/replace` 局部覆盖 | **全盘照搬思路**：真实布局、叶子替换、覆盖标记 |
| [vue-skeletor](https://www.npmjs.com/package/vue-skeletor)                 | 手写占位组件，靠不可见字符撑高度                                                                        | 只借一点：mock 文字撑出真实宽度                |
| [react-content-loader](https://www.npmjs.com/package/react-content-loader) | 手画 SVG 形状                                                                                           | 不取：和真实 UI 脱节，改版就得重画             |

## 2. 已定决策

| #        | 议题             | 结论                                                                                                                                                                                                                   |
| -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1       | 渲染机制         | CSS 优先；运行时测量（覆盖层）暂不做，留作将来的逃生口                                                                                                                                                                 |
| Q2 / Q19 | 产物形态         | `core` + `<x-ske>`（light DOM，不用 shadow）；**不发框架适配包**                                                                                                                                                       |
| Q3 / Q14 | mock             | `Bone` 静态工具类，**只造数据不渲染**；图片用透明占位图，文字用 `█` 词                                                                                                                                                 |
| Q4       | SSR / 无 JS 首屏 | 要。状态全在 class/属性里，CSS 即可出骨架                                                                                                                                                                              |
| Q5 / Q24 | 浏览器基线       | 纯 CSS 层叠渐进增强，不声明版本号，不用 JS 闸门；认识 `@supports` 的进第 0 档及以上，其余落到兜底整块                                                                                                                  |
| Q6 / Q23 | 本次产出         | 设计文档 + 最小原型（零依赖）                                                                                                                                                                                          |
| Q7 / Q12 | 命中方式         | **默认自动**（整树按规则命中），标记只做例外；`x-ske-auto` 作用域标记不要了                                                                                                                                            |
| Q8 / Q13 | 标记载体         | 裸属性：`sk` / `x-ske-leaf` / `x-ske-ignore`，不用 `data-sk`；根状态用 class `x-ske`                                                                                                                                   |
| Q9       | 多行文字形状     | 被 Q16 的下划线法取代（`lh` 渐变分行没做）                                                                                                                                                                             |
| Q10      | 交互锁           | 根上 `inert` + `aria-busy`；要保持可点的内容放到骨架根外面                                                                                                                                                             |
| Q11      | 动效             | 默认 `fade`（根级 opacity，合成器线程，几乎零成本）；`solid`；`pulse` / `shimmer` 是元素级动画、很贵，`enable()` 在元素数超过 300 时自动降 fade；下划线文字不能 shimmer。**2026-10-08 由性能实测改了默认**，见性能报告 |
| Q15      | 文字占位         | 按词切分、词长确定性（不用 `Math.random`）、`lines`、CJK 简单版                                                                                                                                                        |
| Q16      | 文字骨头         | **两套都做**：下划线法（默认）+ 叶子背景法（根上写 `x-ske-text="leaf"`，需 `:has`）                                                                                                                                    |
| Q17      | Web Component    | 支持：宿主 `visibility:hidden` + `::before` 铺骨头，运行时生成标签名样式表                                                                                                                                             |
| Q18      | 图标             | 默认命中（空 `i`、类名含 `icon` 的空元素），白名单可扩展                                                                                                                                                               |
| Q20      | 包名             | `skeletonizer`（npm 上目前未被占用，发布前再确认）                                                                                                                                                                     |
| Q21      | 测试             | Vitest + Playwright 三引擎视觉快照（**待做**，原型只有 `node:test`）                                                                                                                                                   |
| Q22      | 框架使用         | 只在文档里放可复制的最小示例，不发包                                                                                                                                                                                   |
| Q25      | 支持口径         | 第 0、1 档标 best effort；CI 只做逻辑层验证                                                                                                                                                                            |
| Q26      | 构建             | JS 目标 ES2015、不带 polyfill；PostCSS + autoprefixer 作开发依赖（**待做**，原型未接）                                                                                                                                 |
| Q27      | iOS 流光         | 识别 iOS 后显式选了的 shimmer 降级 pulse（**iOS 上是否真的需要，未验证**）                                                                                                                                             |
| Q28      | 兜底粒度         | 根的**直接子元素各一块**，后代 `visibility:hidden`                                                                                                                                                                     |
| Q29      | 兜底层约束       | 见 §7                                                                                                                                                                                                                  |

## 3. 四档层叠

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
- 未升级的 `<x-ske loading>`（没有 `customElements` 的环境）按 `[loading]` 命中兜底层，所以在这类环境里始终是整块。

## 4. 标记词汇

| 标记           | 含义                                               | 对应 skeletonizer          |
| -------------- | -------------------------------------------------- | -------------------------- |
| `sk`           | 本元素强制当骨头（装饰 div、背景图元素），不动子树 | `Skeleton.replace`         |
| `x-ske-leaf`   | 本元素整块，子树全藏                               | `Skeleton.leaf` / `unite`  |
| `x-ske-ignore` | 保持原样                                           | `Skeleton.keep` / `ignore` |

根元素上的属性：`x-ske-effect="fade|solid|sweep|pulse|shimmer"`（sweep 为原型）、`x-ske-text="underline|leaf"`。

已知限制：`x-ske-ignore` 区里后代自带的颜色/背景，在第 0、1 档会丢（被 `color: inherit` 覆盖）；第 2 档的叶子背景模式才精确保留。

## 5. 根状态与 API

```js
import { enable, disable, registerCustomElements, defineXSke, Bone } from "skeletonizer";

const off = enable(el, { effect: "pulse", text: "underline" }); // 返回关闭函数
off(); // 或 disable(el)

defineXSke(); // <x-ske loading effect="pulse">
registerCustomElements(document, { watch: true }); // 扫描自定义元素，生成宿主样式表
```

- `enable()` 加 class、`aria-busy`、`inert`；对根上的 `class` 属性挂 `MutationObserver`，**框架重绘把 class 抹掉时会自动补回**。
- 没有原生 `inert` 时退到 CSS `pointer-events:none` + 根上 `focusin` 捕获后 `blur()`（**该分支未在真机验证**）。
- `registerCustomElements` 优先 `adoptedStyleSheets`，不支持时往 `<head>` 插 `<style data-x-ske-hosts>`（**降级分支未验证**）。

### Bone（只造数据）

| 方法                             | 说明                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Bone.text(n, {seed})`           | n 个字符的 `█` 词文本，词间有空格，可换行，词长确定性                                                                                                                       |
| `Bone.lines(k, {perLine, seed})` | 约 k 行的占位段落                                                                                                                                                           |
| `Bone.cjk(n, {seed})`            | 方块 + 零宽空格断点                                                                                                                                                         |
| `Bone.number(digits)`            | 固定位数方块                                                                                                                                                                |
| `Bone.image(w?, h?)`             | 重载：无参返回 1px 透明 GIF 的 base64 data URI（尺寸由 img 属性或 CSS 给）；只传 w 则 h=w，得到方形透明 SVG；传 w、h 返回带固有宽高的透明 SVG，保留宽高比；非法参数退回 GIF |

注意：严格 CSP 若不放行 `img-src data:`，请自托管透明图。

## 6. 文字骨头：两种做法

- **下划线法（默认，第 1 档）**：给所有文字画 `text-decoration: underline`，粗 `1em`、偏移 `-0.85em`（变量 `--x-ske-ul-thickness` / `--x-ske-ul-offset` 可调）。沿真实文字行延伸，最后一行自然变短，混合文字（`价格：<b>¥5</b>`）也覆盖。代价：不能渐变（只有 pulse），没有圆角，下划线会沿祖先传给后代文字。
- **叶子背景法（第 2 档，`x-ske-text="leaf"`）**：`:not(:has(*)):not(:empty)` 的元素上背景色，可 shimmer、有圆角。代价：多行块级文字成一整块矩形，混合文字里的裸文字节点既不出骨头也被藏起来。

## 7. 兜底层的使用约束（Q29）

实测结果见验证报告，准确表述如下：

1. 根的直接子元素若是 `video`/`canvas`/`iframe`，真实内容仍会盖在灰块上，请自己包一层 `div`。
2. 不要对根的直接子元素用 `display: contents`：它没有盒子，涂不上色，后代又被藏起来，那一块会变成**空白**。
3. 直接放在根下的**裸文字不会被藏起来**（实测：会露出真实文字），请用元素包住。
4. 绝对定位的悬浮角标会被涂成一块灰，需要保持原样就标 `x-ske-ignore`。
5. 第 0 档同样会露出容器里的**混合文字**（元素之间的裸文字节点），和图标字体 `<i>` 的字形（图标启发式在第 2 档才有）。

## 8. 待验证假设与实测状态

详见 [验证报告](../reports/2026-10-08-prototype-verification.md)。**Safari / Firefox / iOS / 旧浏览器均未验证**，只在桌面 Chrome 上实测。

## 9. 后续路线

1. 迁 TypeScript，`tsup` 构建（JS 目标 ES2015），CSS 接 PostCSS + autoprefixer（需先确认依赖）。
2. 测试：Vitest（`Bone`、`enable`），Playwright 三引擎视觉快照，另外在现代浏览器里**强制只加载某一档 CSS**跑快照，验证降级逻辑。
3. 框架使用示例文档：Vue 指令（`enable(el)`，`updated` 钩子补 class）、React、Svelte `use:`、Solid。
4. 补真机验证：iOS Safari（`fixed` 背景、`inert`、`::before` 宿主）、Firefox、Safari。
5. 评估运行时测量模式（`Range.getClientRects` 覆盖层）作为精确模式的逃生口。
6. 发布前确认 npm 包名 `skeletonizer` 仍未被占用。
