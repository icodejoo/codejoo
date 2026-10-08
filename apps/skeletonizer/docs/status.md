---
title: 当前状态与待办
status: active
updated: 2026-10-08
summary: 原型已跑通的范围、没做的事、下一步。
---

## TL;DR

设计已拍板，零依赖原型（仓库根 + `demo/`）在桌面 Chrome 上验证通过，单测 9 条全绿。TS 化已完成（产出 dts）；其余浏览器、测试体系还没开始。

## 已完成

- 性能评估与优化（默认 fade、去掉元素级动画默认、`enable()` 阈值保护），见 [性能报告](reports/2026-10-08-performance.md)
- 设计总结 [overview](design/overview.md)
- 核心：`Bone`、`enable/disable`、`registerCustomElements`、`<x-ske>`
- 四档 CSS（兜底 / 0 / 1 / 2）+ effects，源码是 `src/styles/*.scss`（选择器清单在 `_lists.scss`），由 vite 编译产出 `dist/`
- demo 页：八项场景、档位切换、深色、效果切换
- 验证：[原型验证报告](reports/2026-10-08-prototype-verification.md)

## 待办（按优先级）

1. 真机 / 其他引擎验证：iOS Safari、Safari、Firefox（报告里的"未验证"项）
2. PostCSS + autoprefixer（先确认依赖）
3. Vitest + Playwright 三引擎视觉快照，强制单档 CSS 的降级快照
4. 框架使用示例文档（Vue 指令 / React / Svelte / Solid）
5. 评估运行时测量模式作为精确文字骨头的逃生口
6. 发布前确认 npm 包名

## 怎么跑

```
npm run demo        # vite 开发服务（5188），改 src/styles/*.scss 热更新
npm test            # node --test
npm run build       # 产出 dist/（发布用）
```
