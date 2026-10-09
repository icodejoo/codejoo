# Skeletonizer 架构文档

## 项目概述

**skeletonizer** 用真实 DOM + mock 数据 + 纯 CSS 生成骨架屏：运行时只负责开关加载态，骨头的形状由 CSS 按元素结构自动推断。

## 目录

```
src/
├─ bone.ts       Bone：确定性 mock 数据（文字 / 段落 / CJK / 数字 / 占位图）
├─ enable.ts     enable/disable 开关加载态；registerCustomElements 处理第三方自定义元素宿主
├─ element.ts    <skz-box loading> 自定义元素（light DOM，SSR 安全）：宿主只管 loading，skz 落在第一个元素子节点上，不带 MutationObserver
├─ firewall.ts   继承防火墙：给视口外的列表项打 skz-fw，阻断根变量逐帧变化引起的子树重算
├─ svg.ts        SVG 方案的运行时图：按主题高光色和时长生成 blob SVG，引用计数释放
├─ dom.ts        小工具：清空 style 属性、CSS 时长换算
├─ vue.ts / react.ts / svelte.ts   框架适配层（子路径导出）
├─ index.ts      核心入口（skeletonizer），不带 CSS
├─ variants/     方案扩展：global.ts（防火墙）、svg.ts（运行时 SVG），导入即通过 registerExtension 注册到核心
├─ entries/      变体入口外壳：global / svg / all（构建时产物开头加 import "./xxx.css"）与 *-js（纯 JS）
└─ styles/
   ├─ entries/   CSS 入口：base / explicit（基底二选一）、global / svg / sweep（变体）、all
   ├─ _theme / _marks / _effects-core      基底共用：主题与交互锁、显式标记与忽略区、fade / solid / 暂停 / 减少动态效果
   ├─ base / tier0 / tier1 / tier2         自动推导四档（显式基底不含）
   └─ _global / _svg / _sweep 与 *-mixin   变体样式；svg / sweep 的 mixin 也供 global 的老浏览器降级复用
```

## 渲染分层（CSS 渐进增强）

| 档位    | 能力要求                    | 效果                                                           |
| ------- | --------------------------- | -------------------------------------------------------------- |
| base    | 无                          | 根的直接子元素整块灰                                           |
| tier0   | CSS 变量（默认支持）        | 标签白名单 + 背景色骨头 + 主题变量                             |
| tier1   | `text-decoration-thickness` | 下划线法文字骨头                                               |
| tier2   | `:has()`                    | 叶子背景法、`skz-ignore` 祖先修正                              |
| effects | CSS 变量 / `@property`      | fade（默认）/ solid / sweep；pulse / shimmer 根驱动或 SVG 方案 |

## 构建与产物

`vp pack` 一次产出：`dist/*.mjs`（ES2015、压缩，多入口 + 公共 chunk）、`dist/*.d.mts`、6 个 CSS（`base` / `explicit` / `global` / `svg` / `sweep` / `all`，SCSS 经 `@tsdown/css` 编译压缩，按最低支持线降级语法）。

更详细的设计决策见 [docs/design/overview.md](./docs/design/overview.md)。

## 基底 + 变体

- **运行时**：核心 `enable()` 只管开关、交互锁、懒渲染、忽略区；pulse / shimmer 的增强处理由变体扩展提供。变体模块导入时调用 `registerExtension`，核心按 `engine` 选项（不传则按已注册的变体）只让选中的方案处理根，其余方案 `release`。所有入口共享同一个注册表 chunk，所以核心、适配层和变体可以分开导入。
- **样式**：基底二选一（`base.css` 自动推导 / `explicit.css` 只认显式标记），变体按需叠加；`all.css` = `base` + 全部变体。基底里 pulse / shimmer 退回 fade 的规则包在 `:where()` 里（优先级 0），保证不管样式表先后，变体都能盖住它。
- **构建**：`vite.config.ts` 的 `pack` 一份 JS 多入口配置（rolldown 按 chunk 的 banner 给带 CSS 的变体入口加 `import "./xxx.css"`）+ 每个 CSS 入口一份配置。`package.json` 的 `sideEffects` 包含 `src/variants/*` 与 `dist/*.mjs`，防止注册代码被 tree-shaking 掉。
