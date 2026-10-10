# Skeletonizer 架构文档

## 项目概述

**skeletonizer** 用真实 DOM + mock 数据 + 纯 CSS 生成骨架屏：运行时只负责开关加载态，骨头的形状由 CSS 按元素结构自动推断。

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
│  ├─ text.ts               文字模式扩展：按 text 选项写 skz-text
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
   ├─ _modern                              core 的现代档：tier1 + tier2 里 core 需要的部分合并，一个 @supports 同时要求 text-decoration-thickness 和 :has()
   ├─ base / _tier0-exit / tier0 / tier1 / tier2   完整版自动推导四档（兜底层、退出兜底层、第 0 / 1 / 2 档；core / explicit 不含；tier0 core 也用）
   ├─ _text / _lists / _drivers            不输出 CSS：文字规则积木（完整版 tier1 / tier2 与 core 的 _modern 共用）、选择器清单与 color 驱动挂载选择器、根驱动的三条派生变量 mixin
   ├─ _driver-color                        只在完整版 base.css：underline / tofu 的纯色驱动
   ├─ _lazy                                懒渲染 skz-paused 与 skz-cv：base.css 与 explicit.css 带，core.css 不带
   ├─ _tofu / _tofu-font                   tofu 文字模式（方块字体）；_tofu-font.scss 是 scripts/gen-tofu-font.py 的生成物（woff2 base64）
   └─ _firewall / _svg / _sweep 与 *-mixin   变体样式：global.css = 继承防火墙 + 老浏览器 SVG 降级（@use _svg）；svg / sweep 的 mixin 也可复用
```

## 渲染分层（CSS 渐进增强）

core.css 的目标线是 Chrome 119+ / Safari 16.4+ / Firefox 128+（同时具备 `@property`、相对颜色、`:has()`、`text-decoration-thickness`、`background-clip:text`），体积优先、规则从简：低于门槛只剩第 0 档静态色块加 fade，门槛以上走"现代档"（`@supports` 同时要求 `text-decoration-thickness` 和 `:has()`，clip 文字 / 控件整块 / 图标 / 忽略区修正合并在一起，没有 underline / leaf / tofu，也没有 `background-clip` 的撤回分支）。完整版 base.css 保留下面四档的全部渐进行为，给介于两者之间的浏览器用。两者**只在 Chrome 实测**，Firefox / Safari 按规范默认兼容。

| 档位    | 能力要求                    | 效果                                                                                                                                                                                                                       |
| ------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base    | 无                          | 根的直接子元素整块灰（仅完整版）                                                                                                                                                                                           |
| tier0   | CSS 变量（默认支持）        | 标签白名单 + 背景色骨头 + 主题变量（core 与完整版共用）                                                                                                                                                                    |
| tier1   | `text-decoration-thickness` | 文字骨头：下划线法；默认 clip 在其上叠 `background-clip:text`（不支持时 `@supports not` 撤回）；`$clip` 是正向选择（没写 `skz-text` 或写 `clip`），其他取值（含没引 `tofu.css` 的 `tofu` 和任何未知值）都是 underline 外观 |
| tier2   | `:has()`                    | 叶子背景法、`skz-ignore` 祖先修正                                                                                                                                                                                          |
| effects | CSS 变量 / `@property`      | fade（默认）/ solid / sweep；pulse / shimmer 根驱动（core / explicit / base 都带，global.css 只补防火墙和 SVG 降级）或 SVG 方案                                                                                            |

## 构建与产物

`vp pack` 一次产出：`dist/*.mjs`（ES2015、压缩，多入口 + 公共 chunk）、`dist/*.d.mts`、8 个 CSS（`core` / `base` / `explicit` / `global` / `svg` / `sweep` / `tofu` / `all`，SCSS 经 `@tsdown/css` 编译压缩，按最低支持线降级语法）。JS 入口：`core` / `explicit`（带 CSS）、`core-js` / `explicit-js`（纯 JS）、`full`、`vue` / `react` / `svelte`、`global` / `svg` / `all`（带 CSS）及其 `-js` 版。`package.json` 的 `exports`：根入口按 `node` 条件给纯 JS、其余给带 CSS 的版本；`./full` 不带 CSS。

更详细的设计决策见 [docs/design/overview.md](./docs/design/overview.md)。

## core 与完整版

- **运行时**：core 的 `enable()` 只管开关、交互锁、`fit`；其余能力都是通过通用扩展点 `registerExtension({ name, sync, release })` 挂进来的。`enable()` 每次调用按注册顺序逐个 `sync`，关闭时逐个 `release`。导入 `src/full/index.ts` 注册三个扩展（文字模式 → 方案调度 → 懒渲染）；方案调度扩展有自己的注册表 `registerEngine({ engine, sync, release })`，`global` / `svg` 变体模块导入时往里注册，调度扩展按 `engine` 选项（不传则按已注册的变体）只让选中的方案处理根，其余方案 `release`。所有入口共享同一批公共 chunk，所以 core、适配层、完整版和变体可以分开导入，注册表只有一份。
- **样式**：基底三选一（`core.css` / `base.css` 完整版自动推导 / `explicit.css` 只认显式标记），变体按需叠加；`all.css` = `base` + 全部变体。core.css 的规则只认没写 `skz-text` 的根，同时引了 core.css 和完整版样式时（不推荐）重复规则对 clip 默认根不改变层叠结果；但 core 排在完整版样式之后时，它的 shimmer 根规则会盖掉 underline / tofu / 未知取值根的 pulse 动画（见 `bench/2026-10-10-layering/NOTES.md`）。基底里 pulse / shimmer 退回 fade 的规则包在 `:where()` 里（优先级 0），保证不管样式表先后，变体都能盖住它。
- **全局 skz**：导入 core / explicit / full 任一入口（`src/core/index.ts` 执行）时 `mountGlobal()` 把 `skz = { enable, disable, bone, defineSkzBox }` 挂到 `globalThis`，SSR 里同样挂；已被别人占用的 `skz` 不覆盖，开发模式警告一次；完整版入口再补 `registerCustomElements`。适配层不挂。
- **类型扩展**：core 的 `EnableOptions` / `SkzGlobal` 是接口、`SkzEffect` 取自 `SkzEffectMap` 的键；`src/full/types.ts` 里的 `declare module "skeletonizer"` 往这几个接口补 `text` / `engine` / `fallback`、`sweep`、`registerCustomElements`，导入任一完整版入口（类型随 `.d.mts` 一起被引到）后全项目自动变宽。`test/types` 基于构建产物按入口验证。
- **开发警告**：`warnOnce` 只在开发模式输出，每条一次：全局 `skz` 被占用、完整版里显式传了没注册的 `engine`。生产里随 `process.env.NODE_ENV` 摘掉。
- **构建**：`vite.config.ts` 的 `pack` 一份 JS 多入口配置（rolldown 按 chunk 的 banner 给带 CSS 的入口加 `import "./xxx.css"`）+ 每个 CSS 入口一份配置。`package.json` 的 `sideEffects` 包含 `src/core/index.ts`、`src/full/index.ts`、`src/full/variants/*` 与 `dist/*.mjs`，防止注册 / 挂全局的代码被 tree-shaking 掉。其中 `./src/...` 几条是给本包自己的构建用的（路径对应源码），不能删：删掉后 rolldown 会把 `mountGlobal()`、`registerExtension()` 这类只有副作用的顶层调用当成无副作用摇掉（第 1 批实测）；`./dist/*.mjs` 才是给使用方打包器看的。package.json 不能写注释，原因同时记在 `vite.config.ts` 的 `pack` 配置处。
