---
title: 当前状态与待办
status: active
updated: 2026-10-10
summary: 原型已跑通的范围、没做的事、下一步。
---

## TL;DR

设计已拍板，桌面 Chrome 验证通过，单测 170 条全绿（含类型测试与产物测试），准备首次发布 npm（0.1.0）。2026-10-10 包拆成 core + 完整版并列两种用法、CSS 重新分层；core 的规模上限有实测（见 `bench/2026-10-10-core/NOTES.md`）。其他浏览器（Firefox / Safari）、真机验证、视觉快照测试还没开始。

## 已完成

- 性能评估与优化（默认 fade、去掉元素级动画默认、`enable()` 阈值保护（后已移除）），见 [性能报告](reports/2026-10-08-performance.md)
- 设计总结 [overview](design/overview.md)
- 核心：`Bone`、`enable/disable`、`registerCustomElements`、`<skz-box>`、Vue / React / Svelte 适配层
- 基底 + 变体拆包（`base.css` / `explicit.css`、`global` / `svg` / `sweep`、`all`、`/js`），继承防火墙、svg 运行时精确颜色、老浏览器默认 SVG 降级，见性能报告第 10、11 节
- 根标记改为属性 `skz`（去掉 MutationObserver）；懒渲染（共享 `IntersectionObserver`）；忽略区保持可交互；移除 `maxAnimated` 自动降级，由调用方选效果
- 空闲环境性能复测，class 与属性根标记 A/B 对比，见性能报告第 6 节
- 四档 CSS（兜底 / 0 / 1 / 2）+ 基底效果 + 三个变体，源码 `src/styles/`，CSS 入口在 `src/styles/entries/`，由 vite 多入口编译产出 `dist/`
- demo 页：八项场景、档位切换、深色、效果切换
- 验证：[原型验证报告](reports/2026-10-08-prototype-verification.md)
- 控制变量全量性能矩阵，README「方案怎么选 / 方案对比」据此重写，见 [矩阵报告](reports/2026-10-09-benchmark-matrix.md)
- 按矩阵剔除：删除 `fps` JS 计时器（实际从未生效，无列表结构改推荐 `engine: "svg"`）；`--skz-shimmer-timing` 降帧当时也删了（只测了样式重算，无收益），**2026-10-10 已重新引入并默认开启**（见下）
- sweep：修复根高超过约 16 倍根宽时光带不可见（`skewX` 所致，倾斜角改为变量 `--skz-sweep-skew`，默认仍 -12deg，长根设 0deg）；合并为一种，浅色混合、深色容器色扫光
- 新增 `fit` 选项：骨架自身不撑出滚动条
- 默认文字模式改为 `clip`（下划线 + background-clip:text，文字条有光带，svg 下也能动；`underline` 需显式写，最便宜）；补测见 [矩阵报告](reports/2026-10-09-benchmark-matrix.md)（`bench/2026-10-09-clip-default/`）：fade / solid 没变贵，shimmer GPU 约 3 倍，pulse + global 16000 元素掉到 24 帧（待查防火墙是否被绕过），4× 降速下 svg shimmer 12.8 帧；原型数据见 `bench/agents/a7-clip-underline/`，Firefox / Safari 未验证

- 2026-10-10 落地：shimmer 光带默认降频 24 次/秒（`--skz-shimmer-timing: steps(36)`，只对 global，4× CPU 降速下默认档无收益）；clip 下 shimmer 根不再挂 pulse（underline / tofu / iOS 才挂，同样降频）；clip 根去掉 `--skz-tbg` / `--skz-timg` 转发（修 pulse + clip 绕过防火墙）（pulse + clip 2000 卡 22.8 帧 / 33.7 ms → 60.4 帧 / 6.95 ms）；新增可选 `text: "tofu"` 与 `tofu.css`（方块字体，`scripts/gen-tofu-font.py` 生成，没引 `tofu.css` 时退回 underline 外观，CSP 需 `font-src data:`）；`registerCustomElements` 宿主 `::before` 读动画变量（pulse / shimmer 对 Web Component 宿主生效）。复测见 [矩阵报告](reports/2026-10-09-benchmark-matrix.md)「落地复测」与 `bench/2026-10-10-landing/`
- 2026-10-10 拆包与分层：包拆成 core（`skeletonizer`，默认，现代浏览器、单个根约 2000 元素以内）与完整版（`skeletonizer/full`，上限高得多）并列，`registerExtension` 变成通用扩展点（方案注册改名 `registerEngine`），全局 `skz`、类型随版本变宽、开发模式警告；CSS 分成 `core.css` / `explicit.css` / `base.css` / `global.css`，根驱动挪进各基底，`explicit.css` 恢复懒渲染规则。验证见 `bench/2026-10-10-layering/`（逐规则对比、计算样式 + 截图、老浏览器模拟）与 `bench/2026-10-10-core/`（core 实测：125 / 250 / 500 卡 × fade·solid·pulse·shimmer，对照完整版，4× 降速，规模上限）。README（中英）、`llms.md`、ARCHITECTURE 按新结构重写：开头并列对比表、两条快速开始、迁移说明、每项标明属于 core 还是完整版
- 2026-10-10 文档补齐：README（中英）加「类型」章节与无打包器（import map）示例，补按钮 / clip / tofu / 降频的限制，功能总表性能数字统一到默认 clip 口径（未重测的标「underline 时测得」），修正防火墙机制、`engine` 指定未引入方案的实测表现、体积表；`llms.md` 补 `enable` 选项、`<skz-box>` 属性、适配层导出与全部主题变量速查

## 待办（按优先级）

1. 真机 / 其他引擎验证：iOS Safari（降频、iOS 分支的 pulse 与防火墙目前只在 Chrome 里模拟）、Safari、Firefox（报告里的"未验证"项；含 clip 的装饰线裁剪、tofu 的 cmap format 13；core 与完整版目前都只在 Chrome 实测）
2. 4× 降速下 underline / tofu 样式重算 55~60 ms 的原因；core 在 4× 降速下的规模上限偏低（数据见 `bench/2026-10-10-core/NOTES.md`）；svg 引擎 clip 的 PrePaint 降不动的根因；24 次/秒的光带台阶感需要真人观感评审
3. PostCSS + autoprefixer（先确认依赖）
4. Vitest + Playwright 三引擎视觉快照，强制单档 CSS 的降级快照
5. 框架使用示例文档（Vue 指令 / React / Svelte / Solid）
6. 评估运行时测量模式作为精确文字骨头的逃生口

## 怎么跑

```
pnpm dev            # demo 开发服务（5188），改 src/styles/*.scss 热更新
pnpm test           # vitest
pnpm check          # oxfmt + oxlint（含类型检查）
pnpm build          # vp pack 产出 dist/（发布用）
```
