---
title: 文档索引
status: active
updated: 2026-10-09
summary: skeletonizer 项目文档的唯一入口。
---

## 想接着做

- [当前状态与待办](status.md) — 做到哪、没做什么、怎么跑 demo。active

## 想知道方案是什么 / 为什么这样定

- [设计总结](design/overview.md) — 已定决策表、四档层叠、标记、API、路线。active

## 想看实测结果

- [原型验证报告（桌面 Chrome）](reports/2026-10-08-prototype-verification.md) — 各假设成立与否、最终参数、未验证项。active
- [全量性能矩阵（控制变量版）](reports/2026-10-09-benchmark-matrix.md) — 各模式同条件对比、剔除依据、sweep 修复补测；README 数据来源。active
- [CSS 方案性能评估与优化复测](reports/2026-10-08-performance.md) — 历次优化过程与成本分析（数据为分轮测得，横向比较以矩阵为准）。active
- [性能实验存档](../bench/README.md) — 测试工具包、各轮脚本/场景/原始数据、子代理实验目录、矩阵与 sweep 排查（各带 NOTES）。active

## 术语

- 骨头 = bone = 骨架里的一块灰色占位。
- 兜底 / 第 0 / 1 / 2 档 = 渐进增强的四层 CSS，见设计总结 §3。
