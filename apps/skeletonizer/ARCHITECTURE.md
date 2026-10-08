# Skeletonizer 架构文档

## 项目概述

**@codejoo/skeletonizer** 用真实 DOM + mock 数据 + 纯 CSS 生成骨架屏：运行时只负责开关加载态，骨头的形状由 CSS 按元素结构自动推断。

## 目录

```
src/
├─ bone.ts       Bone：确定性 mock 数据（文字 / 段落 / CJK / 数字 / 占位图）
├─ enable.ts     enable/disable 开关加载态；registerCustomElements 处理第三方自定义元素宿主
├─ element.ts    <x-ske> 自定义元素（light DOM，SSR 安全）
├─ vue.ts / react.ts / svelte.ts   框架适配层（子路径导出）
├─ index.ts      主入口
└─ styles/       SCSS：base（兜底）→ tier0 → tier1 → tier2 → effects，合并为 skeletonizer.css
```

## 渲染分层（CSS 渐进增强）

| 档位    | 能力要求                    | 效果                                          |
| ------- | --------------------------- | --------------------------------------------- |
| base    | 无                          | 根的直接子元素整块灰                          |
| tier0   | CSS 变量（默认支持）        | 标签白名单 + 背景色骨头 + 主题变量            |
| tier1   | `text-decoration-thickness` | 下划线法文字骨头                              |
| tier2   | `:has()`                    | 叶子背景法、`x-ske-ignore` 祖先修正           |
| effects | CSS 变量                    | fade（默认）/ solid / pulse / shimmer / sweep |

## 构建与产物

`vp pack` 一次产出：`dist/*.mjs`（ES2015、压缩）、`dist/*.d.mts`、`dist/skeletonizer.css`（SCSS 经 `@tsdown/css` 编译压缩，按最低支持线降级语法）。

更详细的设计决策见 [docs/design/overview.md](./docs/design/overview.md)。
