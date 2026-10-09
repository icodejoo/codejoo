---
title: 当前状态与待办
status: active
updated: 2026-10-08
summary: 原型已跑通的范围、没做的事、下一步。
---

## TL;DR

设计已拍板，桌面 Chrome 验证通过，单测 18 条全绿，准备首次发布 npm（0.1.0）。其他浏览器真机验证、视觉快照测试还没开始。

## 已完成

- 性能评估与优化（默认 fade、去掉元素级动画默认、`enable()` 阈值保护（后已移除）），见 [性能报告](reports/2026-10-08-performance.md)
- 设计总结 [overview](design/overview.md)
- 核心：`Bone`、`enable/disable`、`registerCustomElements`、`<skz-box>`、Vue / React / Svelte 适配层
- 基底 + 变体拆包（`base.css` / `explicit.css`、`global` / `svg` / `sweep`、`all`、`/js`），继承防火墙、svg 运行时精确颜色、`fps: "auto"`、老浏览器默认 SVG 降级，见性能报告第 10、11 节
- 根标记改为属性 `skz`（去掉 MutationObserver）；懒渲染（共享 `IntersectionObserver`）；忽略区保持可交互；移除 `maxAnimated` 自动降级，由调用方选效果
- 空闲环境性能复测，class 与属性根标记 A/B 对比，见性能报告第 6 节
- 四档 CSS（兜底 / 0 / 1 / 2）+ 基底效果 + 三个变体，源码 `src/styles/`，CSS 入口在 `src/styles/entries/`，由 vite 多入口编译产出 `dist/`
- demo 页：八项场景、档位切换、深色、效果切换
- 验证：[原型验证报告](reports/2026-10-08-prototype-verification.md)

## 待办（按优先级）

1. 真机 / 其他引擎验证：iOS Safari、Safari、Firefox（报告里的"未验证"项）
2. PostCSS + autoprefixer（先确认依赖）
3. Vitest + Playwright 三引擎视觉快照，强制单档 CSS 的降级快照
4. 框架使用示例文档（Vue 指令 / React / Svelte / Solid）
5. 评估运行时测量模式作为精确文字骨头的逃生口
6. shimmer 降帧（`steps()`）收益在空闲环境复测；16000 元素下属性标记的开启耗时复测

## 怎么跑

```
pnpm dev            # demo 开发服务（5188），改 src/styles/*.scss 热更新
pnpm test           # vitest
pnpm check          # oxfmt + oxlint（含类型检查）
pnpm build          # vp pack 产出 dist/（发布用）
```
