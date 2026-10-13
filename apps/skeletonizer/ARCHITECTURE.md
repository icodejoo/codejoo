# Skeletonizer 架构文档

## 项目概述

**skeletonizer** 用真实 DOM + mock 数据 + 纯 CSS 生成骨架屏：运行时只负责开关加载态，哪些元素是骨头由开发者用标记（`skz-text` / `skz-bone` / `skz-leaf` / `skz-ignore`）指定，形状由 CSS 按元素结构画出来；无法改标记的第三方组件放进 `skz-auto` 区域，区域内才按标签白名单推导。CSS 不依赖 JS，只靠根上的 `skz` 属性开关，JS 只负责切开关、写根属性。

包提供两个**二选一**的自包含构建：**完整版**（默认，`import "skeletonizer"`，不设规模上限，带防火墙 / svg / 老浏览器降级等）与 **lite**（`skeletonizer/lite`，面向现代浏览器里的中小骨架，体积和规则都最简），外加框架适配层（vue / react / svelte / solid）。选哪个见 [README](./README.md) 的对比表。同一页面不要同时引两个构建（各带一份 core，注册表会分家）。

## 目录

```
scripts/
├─ gen-editor-data.mjs      读 src/attributes.ts 写 web-types.json 与 html-custom-data.json（pnpm build 先跑；也可 pnpm gen:editor）
src/
├─ core/                    core 运行时（lite 与完整版都内联它，各一份）
│  ├─ index.ts              core 入口模块：导出全部 API，执行时把 skz 挂到全局；只有 lite 与完整版两个入口引用它
│  ├─ enable.ts             enable / disable：加根标记、aria-busy、交互锁（inert），按注册顺序回调扩展
│  ├─ extension.ts          通用扩展点 registerExtension({ name, sync, release })：core 不认识任何具体扩展
│  ├─ types.ts              SkzEffectMap（core 只有 fade / solid / pulse / shimmer）、SkzEffect、EnableOptions（effect / fit）：接口形式，完整版靠 declare module 补成员
│  ├─ api-key.ts            私有全局键 SKZ_API_KEY = Symbol.for("skeletonizer")（零依赖，适配层也引它）
│  ├─ global.ts             全局 skz：SkzGlobal 形状、mountGlobal（SSR 也挂；被别人占用不覆盖，开发模式警告一次）
│  ├─ dev.ts                开发模式警告 warnOnce：process.env.NODE_ENV 原样保留，由使用方打包器决定去留
│  ├─ bone.ts               Bone：确定性 mock 数据（文字 / 段落 / CJK / 数字 / 占位图）
│  ├─ fit.ts                fit：骨架自身不撑出滚动条
│  └─ dom.ts                小工具：清空 style 属性、列表项查找
├─ full/                    完整版扩展（导入 full/index.ts 即通过 registerExtension 注册）
│  ├─ index.ts              完整版入口模块：注册 text / engine / lazy 三个扩展，导出 registerEngine
│  ├─ text.ts               文字模式扩展：按 text 选项写根上的 skz-text-mode（注意不是元素级标记 skz-text，那个是开发者写在 HTML 里的）
│  ├─ engine.ts             方案调度扩展：registerEngine 注册表，pulse / shimmer 时只让选中的方案处理根（engine 误配时开发模式警告）
│  ├─ lazy.ts               懒渲染扩展：根滚出视口打 skz-paused，全库共享一个 IntersectionObserver
│  ├─ types.ts              SkzTextMode / SkzShimmerMode / SkzFallback / SkzEngine，以及 declare module "skeletonizer/lite" 对 lite 类型的增强（text / shimmerMode / engine / fallback）
│  ├─ firewall.ts           继承防火墙：给视口外的列表项打 skz-fw，阻断根变量逐帧变化引起的子树重算
│  ├─ svg.ts                SVG 方案的运行时图：按主题高光色和时长生成 blob SVG，引用计数释放
│  └─ variants/             方案实现：global.ts（防火墙 + 老浏览器 SVG 降级）、svg.ts（运行时 SVG），导入即 registerEngine
├─ attributes.ts            skz-* 属性清单（编辑器提示的单一数据源）：scripts/gen-editor-data.mjs 据此生成包根的 web-types.json（WebStorm）与 html-custom-data.json（VS Code），生成物提交入库；SkzHtmlAttributes 类型（core/types.ts + full/types.ts）的键与它由测试核对；不进 JS 产物
├─ adapter-api.ts           适配层共用的胶水：从私有全局键 globalThis[Symbol.for("skeletonizer")] 取 enable / disable（没有实现时开发模式警告一次）；不含 core 代码
├─ element.ts                    <skz-box loading> 自定义元素（light DOM，SSR 安全，独立入口 skeletonizer/element）：宿主只管 loading，skz 落在第一个元素子节点上，不带 MutationObserver；只引 adapter-api，不含 core，导入无副作用，需手动 defineSkzBox()
├─ vue.ts / react.ts / svelte.ts / solid.ts   框架适配层（子路径导出）：只引 adapter-api，各自用模块增强把 SkzHtmlAttributes 并进框架的 HTMLAttributes（skz-* 属性的补全与取值检查），不带样式、不含 core、不挂全局；类型从 skeletonizer/lite 引，随导入完整版变宽
├─ entries/                 入口外壳
│  ├─ lite                  lite 入口 = core（构建时产物开头加 import "./lite.css"）
│  ├─ full                  完整版入口 = 完整版扩展 + global / svg 方案（构建时产物开头加 import "./full.css"）
│  └─ full.types            只给 d.mts 构建用：从 skeletonizer/lite 再导出 + 完整版独有导出，不另生成第二份核心类型
└─ styles/
   ├─ entries/              CSS 入口：full（= parts 里 base + global + svg 的拼装）、lite
   ├─ parts/                拼装件（base / global / svg），不单独产出 CSS；full.scss 引用它们，测试里按块编译断言
   ├─ _theme / _marks / _effects-core / _fit   两份样式共用：主题与交互锁、显式标记与忽略区、fade / solid / 减少动态效果、fit
   ├─ _driver                              两份样式共用：pulse / shimmer 的根驱动（@property、关键帧、降频；光带按骨头自身盒子扫）
   ├─ _modern                              lite 的现代档：tier1 + tier2 里 lite 需要的部分合并，一个 @supports 同时要求 text-decoration-thickness 和 :has()（skz-text 文字条 + skz-auto 区域的推导）
   ├─ tier0 / tier1 / tier2   完整版三档（第 0 / 1 / 2 档；tier0 lite 也用；已没有兜底层和退出兜底层，见设计总结 Q40）：推导部分只作用于 skz-auto 区域，skz-text 标记在 tier1 / 2
   ├─ _text / _lists / _mixins / _drivers  不输出 CSS：文字规则积木（_text：完整版 tier1 / tier2、lite 的 _modern 共用，含 round / clip 的 sk-clip-root / sk-round-root / sk-mark-text-*）、选择器清单与根限定后缀（_lists：sk-auto()、$clip-mod / $round-mod / $core-mod / $color-modes、$mark-text）、骨头与文字骨头的背景声明（_mixins：sk-bone / sk-text-bone）、根驱动的三条派生变量 mixin
   ├─ _driver-color                        只在完整版：underline 的纯色驱动
   ├─ _lazy                                懒渲染 skz-paused 与 skz-cv：full.css 带，lite.css 不带
   └─ _firewall / _svg   变体样式：global 拼装件 = 继承防火墙 + 老浏览器 SVG 降级（@use _svg）
```

## 渲染分层（CSS 渐进增强）

**默认显式，推导靠 `skz-auto`**：没有任何标记、也不在 `skz-auto` 区域里的内容原样显示。下表里第 0 / 1 / 2 档的推导规则都以 `sk-auto()` 作前缀，只作用于根自身或根内某个后代写了裸属性 `skz-auto` 的子树；显式标记（`skz-bone` / `skz-leaf` / `skz-ignore` 在 `_marks.scss`，`skz-text` 在 `tier1` / `tier2` / `_modern`）在区域内外都生效。根级变量（`--skz-dc` / `--skz-tbg` / 驱动变量等）挂在 `[skz]` 根上，不经过 `skz-auto`。

lite.css 的目标线是 Chrome 119+ / Safari 16.4+ / Firefox 128+（同时具备 `@property`、相对颜色、`:has()`、`text-decoration-thickness`、`background-clip:text`），体积优先、规则从简：低于门槛只剩第 0 档静态色块加 fade，门槛以上走"现代档"（`@supports` 同时要求 `text-decoration-thickness` 和 `:has()`，clip 文字 / 控件整块 / 图标 / 忽略区修正合并在一起，没有 underline / leaf，也没有 `background-clip` 的撤回分支）。完整版 base.css 保留下面三档的全部渐进行为，给介于两者之间的浏览器用。两者**只在 Chrome 实测**，Firefox / Safari 按规范默认兼容。

| 档位    | 能力要求                                   | 效果                                                                                                                                                                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tier0   | CSS 变量（默认支持）+ `:is()` / `:where()` | `skz-auto` 区域里的标签白名单 + 背景色骨头 + 主题变量（core 与完整版共用）                                                                                                                                                                                                                                                                                                                     |
| tier1   | `text-decoration-thickness`                | 文字骨头：下划线法；文字条家族（round 默认 / clip）在其上叠背景填充：clip 用 `background-clip:text`，round 撤掉装饰线改用圆角背景盒（门控在 `box-decoration-break` 上，见下一节），`@supports not (background-clip: text)` 撤回；`$clip-mod` 是正向选择（没写 `skz-text-mode` / `round` / `clip`），其他取值（含已移除的 `tofu` 和任何未知值）都是 underline 外观；`skz-text` 元素标记也在这里 |
| tier2   | `:has()`                                   | 叶子背景法（`skz-text-mode="leaf"`）、图标启发式（均只在 `skz-auto` 区域）                                                                                                                                                                                                                                                                                                                     |
| effects | CSS 变量 / `@property`                     | fade（默认）/ solid；pulse / shimmer 根驱动（lite / full 都带，防火墙与 SVG 降级规则只在 full）或 SVG 方案                                                                                                                                                                                                                                                                                     |

## 文字条家族：round 与 clip 的规则结构

`skz-text-mode` 取值里，没写、`round`、`clip` 三种属于同一个**文字条家族**（读背景骨头的同一套变量，gradient 驱动），其余（`underline` / 未知取值）走 underline 外观，`leaf` 走叶子背景法。round 是默认，不另写一套目标规则：它与 clip **共用同一批形状 / 填充 / 圆角规则**（`_text.scss` 里的 `sk-underline-decl` / `sk-clip-fill` / `sk-mark-text-clip` / `sk-text-bone`），只在 round 根上切四个内部变量，目标规则读这些变量、缺省值就是 clip 原来的写法：

| 变量            | clip（缺省）                                                                                  | round 根上                                                                        | 谁读它                                           |
| --------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `--skz-ul-line` | `underline`（`var(--skz-ul-line, underline)`）                                                | `none`：撤掉透明的装饰线，形状改由背景盒承担，也清掉 `<a>` 自带的下划线           | `sk-underline-decl`                              |
| `--skz-bgclip`  | `text`                                                                                        | `border-box`：撤掉 `background-clip:text`，背景铺满盒子                           | `sk-clip-fill`、`sk-mark-text-clip`              |
| `--skz-bdb`     | `slice`                                                                                       | `clone`：折行后每个行片段各自带圆角（`box-decoration-break`，含 `-webkit-` 写法） | `sk-text-bone`                                   |
| `--skz-tradius` | `0px`（`sk-clip-root` 和 tier1 的 `$color-modes` 规则为文字标签和纯色根设的，下划线不要圆角） | `initial`：清掉 0px，圆角回落到 `--skz-radius`，不新增圆角变量                    | 圆角规则 `var(--skz-tradius, var(--skz-radius))` |

四个变量都是内部开关，不属于公开 API。相关的选择器后缀在 `_lists.scss`：`$clip-mod` = `:is(:not([skz-text-mode]), [skz-text-mode="round"], [skz-text-mode="clip"])`（文字条家族），`$round-mod` = `:is(:not([skz-text-mode]), [skz-text-mode="round"])`，`$color-modes` = 有 `skz-text-mode` 且不是 round / clip / leaf（underline / 未知取值的纯色驱动挂载点）。

**门控**：`sk-round-root` 把这四个变量包在 `@supports ((box-decoration-break: clone) or (-webkit-box-decoration-break: clone))` 里写到 `[skz]$round-mod` 根上（Chrome 130 前与 Safari 只认 `-webkit-` 前缀，两种写法都查）。不支持的浏览器根本不设变量，所有规则按缺省值走，也就是原来的 clip（clip 自己还有 `@supports not (background-clip: text)` 退回 underline 的降级链）。

**隔离**：文字条家族的根（`sk-clip-root`）同时把 `--skz-ul-line` / `--skz-bgclip` / `--skz-bdb` 复位成 `initial`（完整版再复位 `--skz-tbg` / `--skz-timg`，lite 没有 underline 根，省掉），所以写成 `clip` 的根嵌套在 round 根里不会继承外层的 round。

**规则顺序**（同优先级，靠写入顺序覆盖，调整时不要打乱）：`sk-round-root` 必须排在 `sk-clip-root`（把三个开关复位成 clip 的值，并写 `--skz-tradius: 0px`）**之后**、tier1 里的 `@supports not (background-clip: text)` 撤回分支**之前**；撤回分支把 `--skz-ul-line` 清回缺省，让不认 `background-clip:text` 的浏览器里的 round 也退回 underline（否则文字透明、背景撤掉、装饰线又是 none，什么都看不见）。`_modern.scss`（core）与 `explicit.scss` 的顺序相同，只是没有撤回分支（门槛已保证支持）。

round 的外观与限制见 README「文字骨头模式」（块元素整块圆角矩形、推荐把 `skz-text` 打在内层 `<span>`、条高与行高、圆角固定读 `--skz-radius`）。

## 构建与产物

`pnpm build` 先跑 `scripts/gen-editor-data.mjs`（重写包根的 `web-types.json` 与 `html-custom-data.json`，二者提交入库、列在 `files` 里，`package.json` 的 `web-types` 字段指向前者），再由 `vp pack` 一次产出 16 个文件（`dist/`），没有带哈希的 chunk：`full.mjs` + `full.css`、`lite.mjs` + `lite.css`、适配层 `vue.mjs` / `react.mjs` / `svelte.mjs` / `solid.mjs`、`<skz-box>` 入口 `element.mjs`，以及对应的 `.d.mts`（JS 为 ES2015、压缩；CSS 按 chrome88 / firefox84 / safari14 降级；SCSS 经 `@tsdown/css` 编译压缩，按最低支持线降级语法）。`vite.config.ts` 里每个 JS 入口各一份 pack 配置（单入口单文件，所以 full 与 lite 各自内联一份 core；适配层与 element 各自成配置以免出共享 chunk），full 的 d.mts 单独用 `emitDtsOnly` 配置从 `entries/full.types.ts` 构建。`package.json` 的 `exports` 只有 `.`（full）、`./lite`、`./vue`、`./react`、`./svelte`、`./solid`、`./element`、`./full.css`、`./lite.css`、`./package.json`；没有 `node` 条件，JS 开头带 CSS 导入（所以没有打包器的纯 Node 不能直接 import）。

更详细的设计决策见 [docs/design/overview.md](./docs/design/overview.md)。

## lite 与完整版

- **运行时**：core 的 `enable()` 只管开关、交互锁、`fit`；其余能力都是通过通用扩展点 `registerExtension({ name, sync, release })` 挂进来的。`enable()` 每次调用按注册顺序逐个 `sync`，关闭时逐个 `release`。导入 `src/full/index.ts` 注册三个扩展（文字模式 → 方案调度 → 懒渲染）；方案调度扩展有自己的注册表 `registerEngine({ engine, sync, release })`，`global` / `svg` 方案模块导入时往里注册（完整版入口两个都导入），调度扩展按 `engine` 选项（不传则按已注册的方案，默认 global）只让选中的方案处理根，其余方案 `release`。full 与 lite 各内联一份 core、各有一份注册表，所以两者不能同页并存。
- **Web Component 宿主**：`skz-host` 标记的规则在 `src/styles/_marks.scss`（lite.css 与 full.css 共用），选择器 `[skz] [skz-host]:not([skz-ignore])`：宿主 `visibility: hidden`（继承进 Shadow DOM），`::before` 用 `sk-bone` mixin 铺骨头，变量与动画跟普通骨头一致。取代 0.2.x 的 `registerCustomElements`（JS 扫描标签名再生成样式表）：CSS 无法按"标签名含 -"选择，所以改成显式标记。
- **样式**：`full.css` = 完整版基底 + global 防火墙 / svg 降级规则；`lite.css` 是 core 的精简样式。lite.css 的文字条规则只认文字条家族的根（没写 `skz-text-mode`、`round`、`clip`，即 `$core-mod`）；两份样式同页并存不推荐（重复规则对默认根不改变层叠结果，但 lite 排在 full 之后时它的 shimmer 根规则会盖掉 underline / 未知取值根的 pulse 动画，见 `bench/2026-10-10-layering/NOTES.md`）。基底里 pulse / shimmer 退回 fade 的规则包在 `:where()` 里（优先级 0），保证不管样式表先后，svg 降级都能盖住它。原来的 `explicit.css`（只认标记、无推导）是 lite.css 的子集，0.3.0 已删除。
- **全局 skz 与私有键**：导入 lite 或完整版入口（`src/core/index.ts` 执行）时 `mountGlobal()` 先把 `skz = { enable, disable, bone }` 总是挂到私有键 `globalThis[Symbol.for("skeletonizer")]`（键常量在零依赖的 `src/core/api-key.ts`），再挂公开的 `globalThis.skz`（SSR 里同样挂；已被别人占用的 `skz` 不覆盖，开发模式警告一次）；完整版与 lite 共用同一个 `skz` 对象（扩展经 `registerExtension` 挂入，不往对象上加成员）。适配层与 element（`<skz-box>`）只通过私有键取 `enable` / `disable`（`src/adapter-api.ts`），没导入实现时开发模式警告一次、调用无操作；适配层与 element 自己不挂全局、不含 core。
- **类型扩展**：`lite.d.mts` 是类型底座（`EnableOptions` / `SkzGlobal` 是接口、`SkzEffect` 取自 `SkzEffectMap` 的键）；`full.d.mts` 从 `skeletonizer/lite` 再导出并带 `declare module "skeletonizer/lite"`（源码在 `src/full/types.ts`），往这几个接口补 `text` / `shimmerMode` / `engine` / `fallback`，导入完整版（类型随 `.d.mts` 一起被引到）后全项目自动变宽；适配层的 d.mts 也从 `skeletonizer/lite` 引选项类型，所以同步变宽。源码里 `tsconfig` 的 `paths` 把 `skeletonizer/lite` 指到 `src/core/index.ts`。`test/types` 基于构建产物验证（只 lite / 完整版 / 两者混在一个工程）。
- **开发警告**：`warnOnce` 只在开发模式输出，每条一次：全局 `skz` 被占用、显式传了没注册的 `engine`（拼装源码模块时）、适配层或 `<skz-box>` 在没有导入实现时被调用。`warnOnce` 自己不判断环境：每个调用点都包在 `try { if (process.env.NODE_ENV !== "production") … } catch {}` 守卫里，产物里 `process.env.NODE_ENV` 原样保留，使用方的打包器替换并压缩后，调用连同中文文案一起折叠掉（`test/dist.test.ts` 用生产 / 开发两种 vite 构建验证）。
- **构建**：见上节。`package.json` 的 `sideEffects` 包含 `src/core/index.ts`、`src/full/index.ts`、`src/full/variants/*` 与 `dist/*.mjs`，防止注册 / 挂全局的代码被 tree-shaking 掉。其中 `./src/...` 几条是给本包自己的构建用的（路径对应源码），不能删：删掉后 rolldown 会把 `mountGlobal()`、`registerExtension()` 这类只有副作用的顶层调用当成无副作用摇掉（第 1 批实测）；`./dist/*.mjs` 才是给使用方打包器看的。package.json 不能写注释，原因同时记在 `vite.config.ts` 的 `pack` 配置处。
