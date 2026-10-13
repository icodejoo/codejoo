---
title: 文档索引
status: active
updated: 2026-10-13
summary: skeletonizer 项目文档的唯一入口。
---

## 想接着做

- [当前状态与待办](status.md) — 做到哪、没做什么、怎么跑 demo。active

## 想知道方案是什么 / 为什么这样定

- [设计总结](design/overview.md) — 已定决策表、三档层叠、标记、API、路线。active

## 想看实测结果

- [tofu 与 underline 成对压测](reports/2026-10-13-tofu-vs-underline.md) — tofu 无一场景更快，已于 2026-10-13 移除；附 pulse global 回退线索。active
- [原型验证报告（桌面 Chrome）](reports/2026-10-08-prototype-verification.md) — 各假设成立与否、最终参数、未验证项。active
- [全量性能矩阵（控制变量版）](reports/2026-10-09-benchmark-matrix.md) — 各模式同条件对比、剔除依据、sweep 修复补测；README 数据来源。active
- [CSS 方案性能评估与优化复测](reports/2026-10-08-performance.md) — 历次优化过程与成本分析（数据为分轮测得，横向比较以矩阵为准）。active
- [lite 实测与规模上限](../bench/2026-10-10-core/NOTES.md) — 原 core（今 lite）在 1000~4000 元素的 fade / solid / pulse / shimmer、完整版对照、4× 降速与规模上限；README「lite 的规模上限」据此（目录与正文沿用旧名 core）。active
- [CSS 分层验证与基准](../bench/2026-10-10-layering/NOTES.md) — 分层前后逐规则对比、计算样式与截图对比、老浏览器模拟、重复加载。active
- [性能实验存档](../bench/README.md) — 测试工具包、各轮脚本/场景/原始数据、子代理实验目录、矩阵与 sweep 排查（各带 NOTES）。active

## 术语

- 骨头 = bone = 骨架里的一块灰色占位。
- 完整版 / lite = 包的两个二选一构建（0.3.0 起）：`skeletonizer`（默认，全部功能，不设规模上限）与 `skeletonizer/lite`（现代浏览器、中小骨架，原 core），见设计总结 §5.1。
- 第 0 / 1 / 2 档 = 渐进增强的三层 CSS（0.3.0 起没有兜底层），见设计总结 §3。
- `skz-auto` 区域 = 自动推导（第 0 / 1 / 2 档的推导规则）只作用于的子树；默认（不写）由开发者用 `skz-text` / `skz-bone` / `skz-leaf` 标记骨头，见设计总结 §4。
