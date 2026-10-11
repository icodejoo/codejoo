# Skeletonizer 架构文档

## 项目概述

**skeletonizer** 用真实 DOM + mock 数据 + 纯 CSS 生成骨架屏：运行时只负责开关加载态，哪些元素是骨头由开发者用标记（`skz-text` / `skz-bone` / `skz-leaf` / `skz-ignore`）指定，形状由 CSS 按元素结构画出来；无法改标记的第三方组件放进 `skz-auto` 区域，区域内才按标签白名单推导。CSS 不依赖 JS，只靠根上的 `skz` 属性开关，JS 只负责切开关、写根属性。

包有两种并列的用法：**core**（默认，`import "skeletonizer"`，面向现代浏览器里的中小骨架，体积和规则都最简）与**完整版**（`skeletonizer/full` + 按需的样式与变体，不设规模上限，带防火墙 / svg / sweep / 老浏览器降级等）。选哪个见 [README](./README.md) 的对比表。

## 目录

```
src/
├─ core/                    core 运行时（完整版也建立在它之上）
│  ├─ index.ts              core 入口模块：导出全部 API，执行时把 skz 挂到全局；只有 skeletonizer / explicit / full 三类入口引用它，适配层直接引具体模块
│  ├─ enable.ts             enable / disable：加根标记、aria-busy、交互锁（inert），按注册顺序回调扩展
│  ├─ extension.ts          通用扩展点 registerExtension({ name, sync, release })：core 不认识任何具体扩展
│  ├─ types.ts              SkzEffectMap（core 只有 fade / solid / pulse / shimmer）、SkzEffect、EnableOptions（effect / fit）：接口形式，完整版靠 declare module 补成员
│  ├─ global.ts             全局 skz：SkzGlobal 形状、mountGlobal（SSR 也挂；被别人占用不覆盖，开发模式警告一次；完整版再往上补 registerCustomElements）
│  ├─ dev.ts                开发模式警告 warnOnce：process.env.NODE_ENV 原样保留，由使用方打包器决定去留
│  ├─ element.ts            <skz-box loading> 自定义元素（light DOM，SSR 安全）：宿主只管 loading，skz 落在第一个元素子节点上，不带 MutationObserver
│  ├─ bone.ts               Bone：确定性 mock 数据（文字 / 段落 / CJK / 数字 / 占位图）
│  ├─ fit.ts                fit：骨架自身不撑出滚动条
│  └─ dom.ts                小工具：清空 style 属性、列表项查找
├─ full/                    完整版扩展（导入 full/index.ts 即通过 registerExtension 注册）
│  ├─ index.ts              完整版入口模块：注册 text / engine / lazy 三个扩展，补 skz.registerCustomElements，导出 registerEngine / registerCustomElements
│  ├─ text.ts               文字模式扩展：按 text 选项写根上的 skz-text-mode（注意不是元素级标记 skz-text，那个是开发者写在 HTML 里的）
│  ├─ engine.ts             方案调度扩展：registerEngine 注册表，pulse / shimmer 时只让选中的方案处理根（engine 误配时开发模式警告）
│  ├─ lazy.ts               懒渲染扩展：根滚出视口打 skz-paused，全库共享一个 IntersectionObserver
│  ├─ hosts.ts              registerCustomElements：Web Component 宿主（Shadow DOM）的骨架样式表
│  ├─ types.ts              SkzTextMode / SkzFallback / SkzEngine，以及 declare module "skeletonizer" 对 core 类型的增强（text / engine / fallback、sweep、registerCustomElements）
│  ├─ firewall.ts           继承防火墙：给视口外的列表项打 skz-fw，阻断根变量逐帧变化引起的子树重算
│  ├─ svg.ts                SVG 方案的运行时图：按主题高光色和时长生成 blob SVG，引用计数释放
│  └─ variants/             方案实现：global.ts（防火墙 + 老浏览器 SVG 降级）、svg.ts（运行时 SVG），导入即 registerEngine
├─ vue.ts / react.ts / svelte.ts   框架适配层（子路径导出）：直接引 core 模块，不带样式、不挂全局，类型随导入的版本变宽
├─ entries/                 入口外壳
│  ├─ core / explicit       core 与显式模式（构建时产物开头加 import "./core.css" / "./explicit.css"）；core-js / explicit-js 是纯 JS 版（node 条件、无打包器）
│  ├─ full                  完整版运行时，不带 CSS
│  └─ global / svg / all    变体入口（完整版扩展 + 方案 + 样式），*-js 是纯 JS 版
└─ styles/
   ├─ entries/              CSS 入口：core / explicit / base（基底三选一）、global / svg / sweep / tofu（变体）、all
   ├─ _theme / _marks / _effects-core / _fit   所有基底共用：主题与交互锁、显式标记与忽略区、fade / solid / 减少动态效果、fit
   ├─ _driver                              所有基底共用：pulse / shimmer 的根驱动（@property、关键帧、降频、iOS 分支）
   ├─ _modern                              core 的现代档：tier1 + tier2 里 core 需要的部分合并，一个 @supports 同时要求 text-decoration-thickness 和 :has()（skz-text 文字条 + skz-auto 区域的推导）
   ├─ base / _tier0-exit / tier0 / tier1 / tier2   完整版四档（兜底层、退出兜底层、第 0 / 1 / 2 档；core / explicit 不含兜底层；tier0 core 也用）：推导部分只作用于 skz-auto 区域，skz-text 标记在 tier1 / 2
   ├─ _text / _lists / _mixins / _drivers  不输出 CSS：文字规则积木（_text：完整版 tier1 / tier2、core 的 _modern、explicit 共用，含 round / clip 的 sk-clip-root / sk-round-root / sk-mark-text-*）、选择器清单与根限定后缀（_lists：sk-auto()、$clip-mod / $round-mod / $core-mod / $color-modes、$mark-text）、骨头与文字骨头的背景声明（_mixins：sk-bone / sk-text-bone）、根驱动的三条派生变量 mixin
   ├─ _driver-color                        只在完整版 base.css：underline / tofu 的纯色驱动
   ├─ _lazy                                懒渲染 skz-paused 与 skz-cv：base.css 与 explicit.css 带，core.css 不带
   ├─ _tofu / _tofu-font                   tofu 文字模式（方块字体）；_tofu-font.scss 是 scripts/gen-tofu-font.py 的生成物（woff2 base64）
   └─ _firewall / _svg / _sweep 与 *-mixin   变体样式：global.css = 继承防火墙 + 老浏览器 SVG 降级（@use _svg）；svg / sweep 的 mixin 也可复用
```

## 渲染分层（CSS 渐进增强）

**默认显式，推导靠 `skz-auto`**：没有任何标记、也不在 `skz-auto` 区域里的内容原样显示。下表里的兜底层、第 0 / 1 / 2 档的推导规则都以 `sk-auto()` 作前缀，只作用于根自身或根内某个后代写了裸属性 `skz-auto` 的子树；显式标记（`skz-bone` / `skz-leaf` / `skz-ignore` 在 `_marks.scss`，`skz-text` 在 `tier1` / `tier2` / `_modern` / `explicit`）在区域内外都生效。根级变量（`--skz-dc` / `--skz-tbg` / 驱动变量等）挂在 `[skz]` 根上，不经过 `skz-auto`。

core.css 的目标线是 Chrome 119+ / Safari 16.4+ / Firefox 128+（同时具备 `@property`、相对颜色、`:has()`、`text-decoration-thickness`、`background-clip:text`），体积优先、规则从简：低于门槛只剩第 0 档静态色块加 fade，门槛以上走"现代档"（`@supports` 同时要求 `text-decoration-thickness` 和 `:has()`，clip 文字 / 控件整块 / 图标 / 忽略区修正合并在一起，没有 underline / leaf / tofu，也没有 `background-clip` 的撤回分支）。完整版 base.css 保留下面四档的全部渐进行为，给介于两者之间的浏览器用。两者**只在 Chrome 实测**，Firefox / Safari 按规范默认兼容。

| 档位    | 能力要求                                   | 效果                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base    | 无                                         | `skz-auto` 区域的直接子元素整块灰（仅完整版）                                                                                                                                                                                                                                                                                                                                                            |
| tier0   | CSS 变量（默认支持）+ `:is()` / `:where()` | `skz-auto` 区域里的标签白名单 + 背景色骨头 + 主题变量（core 与完整版共用）                                                                                                                                                                                                                                                                                                                               |
| tier1   | `text-decoration-thickness`                | 文字骨头：下划线法；文字条家族（round 默认 / clip）在其上叠背景填充：clip 用 `background-clip:text`，round 撤掉装饰线改用圆角背景盒（门控在 `box-decoration-break` 上，见下一节），`@supports not (background-clip: text)` 撤回；`$clip-mod` 是正向选择（没写 `skz-text-mode` / `round` / `clip`），其他取值（含没引 `tofu.css` 的 `tofu` 和任何未知值）都是 underline 外观；`skz-text` 元素标记也在这里 |
| tier2   | `:has()`                                   | 叶子背景法（`skz-text-mode="leaf"`）、图标启发式（均只在 `skz-auto` 区域）                                                                                                                                                                                                                                                                                                                               |
| effects | CSS 变量 / `@property`                     | fade（默认）/ solid / sweep；pulse / shimmer 根驱动（core / explicit / base 都带，global.css 只补防火墙和 SVG 降级）或 SVG 方案                                                                                                                                                                                                                                                                          |

## 文字条家族：round 与 clip 的规则结构

`skz-text-mode` 取值里，没写、`round`、`clip` 三种属于同一个**文字条家族**（读背景骨头的同一套变量，gradient 驱动），其余（`underline` / `tofu` / 未知取值）走 underline 外观，`leaf` 走叶子背景法。round 是默认，不另写一套目标规则：它与 clip **共用同一批形状 / 填充 / 圆角规则**（`_text.scss` 里的 `sk-underline-decl` / `sk-clip-fill` / `sk-mark-text-clip` / `sk-text-bone`），只在 round 根上切四个内部变量，目标规则读这些变量、缺省值就是 clip 原来的写法：

| 变量            | clip（缺省）                                                                                  | round 根上                                                                        | 谁读它                                           |
| --------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `--skz-ul-line` | `underline`（`var(--skz-ul-line, underline)`）                                                | `none`：撤掉透明的装饰线，形状改由背景盒承担，也清掉 `<a>` 自带的下划线           | `sk-underline-decl`                              |
| `--skz-bgclip`  | `text`                                                                                        | `border-box`：撤掉 `background-clip:text`，背景铺满盒子                           | `sk-clip-fill`、`sk-mark-text-clip`              |
| `--skz-bdb`     | `slice`                                                                                       | `clone`：折行后每个行片段各自带圆角（`box-decoration-break`，含 `-webkit-` 写法） | `sk-text-bone`                                   |
| `--skz-tradius` | `0px`（`sk-clip-root` 和 tier1 的 `$color-modes` 规则为文字标签和纯色根设的，下划线不要圆角） | `initial`：清掉 0px，圆角回落到 `--skz-radius`，不新增圆角变量                    | 圆角规则 `var(--skz-tradius, var(--skz-radius))` |

四个变量都是内部开关，不属于公开 API。相关的选择器后缀在 `_lists.scss`：`$clip-mod` = `:is(:not([skz-text-mode]), [skz-text-mode="round"], [skz-text-mode="clip"])`（文字条家族），`$round-mod` = `:is(:not([skz-text-mode]), [skz-text-mode="round"])`，`$color-modes` = 有 `skz-text-mode` 且不是 round / clip / leaf（underline / tofu / 未知取值的纯色驱动挂载点）。

**门控**：`sk-round-root` 把这四个变量包在 `@supports ((box-decoration-break: clone) or (-webkit-box-decoration-break: clone))` 里写到 `[skz]$round-mod` 根上（Chrome 130 前与 Safari 只认 `-webkit-` 前缀，两种写法都查）。不支持的浏览器根本不设变量，所有规则按缺省值走，也就是原来的 clip（clip 自己还有 `@supports not (background-clip: text)` 退回 underline 的降级链）。

**隔离**：文字条家族的根（`sk-clip-root`）同时把 `--skz-ul-line` / `--skz-bgclip` / `--skz-bdb` 复位成 `initial`（完整版再复位 `--skz-tbg` / `--skz-timg`，core 没有 underline / tofu 根，省掉），所以写成 `clip` 的根嵌套在 round 根里不会继承外层的 round。

**规则顺序**（同优先级，靠写入顺序覆盖，调整时不要打乱）：`sk-round-root` 必须排在 `sk-clip-root`（把三个开关复位成 clip 的值，并写 `--skz-tradius: 0px`）**之后**、tier1 里的 `@supports not (background-clip: text)` 撤回分支**之前**；撤回分支把 `--skz-ul-line` 清回缺省，让不认 `background-clip:text` 的浏览器里的 round 也退回 underline（否则文字透明、背景撤掉、装饰线又是 none，什么都看不见）。`_modern.scss`（core）与 `explicit.scss` 的顺序相同，只是没有撤回分支（门槛已保证支持）。

round 的外观与限制见 README「文字骨头模式」（块元素整块圆角矩形、推荐把 `skz-text` 打在内层 `<span>`、条高与行高、圆角固定读 `--skz-radius`）。

## 构建与产物

`vp pack` 一次产出：`dist/*.mjs`（ES2015、压缩，多入口 + 公共 chunk）、`dist/*.d.mts`、8 个 CSS（`core` / `base` / `explicit` / `global` / `svg` / `sweep` / `tofu` / `all`，SCSS 经 `@tsdown/css` 编译压缩，按最低支持线降级语法）。JS 入口：`core` / `explicit`（带 CSS）、`core-js` / `explicit-js`（纯 JS）、`full`、`vue` / `react` / `svelte`、`global` / `svg` / `all`（带 CSS）及其 `-js` 版。`package.json` 的 `exports`：根入口按 `node` 条件给纯 JS、其余给带 CSS 的版本；`./full` 不带 CSS。

更详细的设计决策见 [docs/design/overview.md](./docs/design/overview.md)。

## core 与完整版

- **运行时**：core 的 `enable()` 只管开关、交互锁、`fit`；其余能力都是通过通用扩展点 `registerExtension({ name, sync, release })` 挂进来的。`enable()` 每次调用按注册顺序逐个 `sync`，关闭时逐个 `release`。导入 `src/full/index.ts` 注册三个扩展（文字模式 → 方案调度 → 懒渲染）；方案调度扩展有自己的注册表 `registerEngine({ engine, sync, release })`，`global` / `svg` 变体模块导入时往里注册，调度扩展按 `engine` 选项（不传则按已注册的变体）只让选中的方案处理根，其余方案 `release`。所有入口共享同一批公共 chunk，所以 core、适配层、完整版和变体可以分开导入，注册表只有一份。
- **样式**：基底三选一（`core.css` / `base.css` 完整版自动推导 / `explicit.css` 只认显式标记），变体按需叠加；`all.css` = `base` + 全部变体。core.css 的文字条规则只认文字条家族的根（没写 `skz-text-mode`、`round`、`clip`，即 `$core-mod`），同时引了 core.css 和完整版样式时（不推荐）重复规则对默认根不改变层叠结果；但 core 排在完整版样式之后时，它的 shimmer 根规则会盖掉 underline / tofu / 未知取值根的 pulse 动画（见 `bench/2026-10-10-layering/NOTES.md`）。基底里 pulse / shimmer 退回 fade 的规则包在 `:where()` 里（优先级 0），保证不管样式表先后，变体都能盖住它。
- **全局 skz**：导入 core / explicit / full 任一入口（`src/core/index.ts` 执行）时 `mountGlobal()` 把 `skz = { enable, disable, bone, defineSkzBox }` 挂到 `globalThis`，SSR 里同样挂；已被别人占用的 `skz` 不覆盖，开发模式警告一次；完整版入口再补 `registerCustomElements`。适配层不挂。
- **类型扩展**：core 的 `EnableOptions` / `SkzGlobal` 是接口、`SkzEffect` 取自 `SkzEffectMap` 的键；`src/full/types.ts` 里的 `declare module "skeletonizer"` 往这几个接口补 `text` / `engine` / `fallback`、`sweep`、`registerCustomElements`，导入任一完整版入口（类型随 `.d.mts` 一起被引到）后全项目自动变宽。`test/types` 基于构建产物按入口验证。
- **开发警告**：`warnOnce` 只在开发模式输出，每条一次：全局 `skz` 被占用、完整版里显式传了没注册的 `engine`。生产里随 `process.env.NODE_ENV` 摘掉。
- **构建**：`vite.config.ts` 的 `pack` 一份 JS 多入口配置（rolldown 按 chunk 的 banner 给带 CSS 的入口加 `import "./xxx.css"`）+ 每个 CSS 入口一份配置。`package.json` 的 `sideEffects` 包含 `src/core/index.ts`、`src/full/index.ts`、`src/full/variants/*` 与 `dist/*.mjs`，防止注册 / 挂全局的代码被 tree-shaking 掉。其中 `./src/...` 几条是给本包自己的构建用的（路径对应源码），不能删：删掉后 rolldown 会把 `mountGlobal()`、`registerExtension()` 这类只有副作用的顶层调用当成无副作用摇掉（第 1 批实测）；`./dist/*.mjs` 才是给使用方打包器看的。package.json 不能写注释，原因同时记在 `vite.config.ts` 的 `pack` 配置处。
