---
title: tofu 与 underline 成对压测，tofu 移除
status: active
updated: 2026-10-13
summary: 完整版文字模式 tofu 与 underline 的成对压力对比：tofu 没有任何场景更快，用户据此决定移除 tofu、保留 underline；附带发现 pulse global underline 在 2000 卡疑似回退。
---

## TL;DR

- tofu（方块字体文字模式）在所有动画场景下都不比 underline 快：shimmer global 样式重算多 16%~33%（帧率没差），pulse global 多 46%~102%，开启耗时约翻倍，关闭多 44%~93%。Paint / GPU 持平。shimmer svg、solid 没有可测差异。
- **决定（用户 2026-10-13 拍板）**：移除 tofu，保留 underline。`tofu.css`、`text: "tofu"` 一并删除，旧写法 `skz-text-mode="tofu"` 退回 underline 外观。
- 附带发现：本次 2000 卡 underline + pulse global 只有 23 帧，落地复测同场景是 60.4 帧，疑似回退，未定位（见文末）。

## 条件与方法

原始数据、脚本、场景都在 [`bench/2026-10-12-tofu-vs-underline/`](../../bench/2026-10-12-tofu-vs-underline/NOTES.md)，完整汇总表见该目录 `results/summary.md`。要点：

- 2026-10-13 凌晨用当时工作区（含未提交改动）`pnpm build` 的 `dist/`，Chrome 实机，视口 1200×800、DPR 1，真实 `enable(root, { effect, text, engine })`。
- tofu 页加载前先 `await document.fonts.load("16px skz-tofu")`，字体已就绪，只测暖。
- 每格 3 次 trace 取中位数，underline / tofu 同批相邻、交替先后；开启 / 关闭耗时每格 9 次取中位数（先丢 2 次预热）。
- 批内整机 CPU 均值 12%~15%。本机帧率上限这次是 57.6（以往 60.4），成对比较不受影响，但绝对 fps 不能和旧数据直接比。
- 只做了一批，没有整批重复。样式重算差 <10% 的格视为噪声。

## 数据

格内为 underline / tofu / 差值；时间单位 ms/帧，开启 / 关闭为 ms。

### 帧率与样式重算（skz-auto）

| 场景                          | fps          | 样式重算             | Paint                   | GPU                 |
| ----------------------------- | ------------ | -------------------- | ----------------------- | ------------------- |
| pulse global 500              | 57.6 / 50.8  | 7.33 / 12.84 / +75%  | 0.37 / 0.36             | 1.11 / 1.50         |
| pulse global 2000             | 23.2 / 16.4  | 39.5 / 57.8 / +46%   | 0.93 / 0.72             | 1.64 / 1.85         |
| pulse global 4000             | 11.6 / 6.4   | 88.9 / 179.9 / +102% | 1.80 / 1.36             | 2.14 / 2.49         |
| shimmer global 500            | 57.2 / 57.6  | 1.04 / 1.19 / +14%   | 0.38 / 0.40             | 1.43 / 1.63         |
| shimmer global 2000           | 57.6 / 57.2  | 3.28 / 3.82 / +16%   | 0.66 / 0.57             | 1.44 / 1.54         |
| shimmer global 4000           | 57.6 / 57.6  | 6.22 / 8.27 / +33%   | 0.77 / 0.85             | 1.46 / 1.75         |
| shimmer svg 500 / 2000 / 4000 | 都 57.2~57.6 | ≈0.04，无差别        | PrePaint 正负混杂，噪声 | 1.6~2.2，无稳定差别 |
| solid 500 / 2000 / 4000       | 都 57.2~57.6 | 0                    | 0                       | ≈0                  |

### 显式 skz-text，2000 卡

| 场景           | fps         | 样式重算           | Paint                | GPU         |
| -------------- | ----------- | ------------------ | -------------------- | ----------- |
| pulse global   | 19.6 / 13.6 | 48.6 / 73.3 / +51% | 0.72 / 0.66          | 1.40 / 1.47 |
| shimmer global | 57.2 / 57.2 | 3.24 / 4.00 / +23% | 0.47 / 0.67          | 1.11 / 1.10 |
| shimmer svg    | 57.2 / 57.2 | 0.04 / 0.04        | PrePaint 2.65 / 2.58 | 1.34 / 1.31 |

### 4× CPU 降速，2000 卡

| 场景                | fps         | 样式重算                               |
| ------------------- | ----------- | -------------------------------------- |
| shimmer global auto | 32.8 / 28.8 | 22.1 / 27.7 / +25%                     |
| shimmer global 显式 | 39.2 / 30.0 | 18.0 / 26.9 / +49%                     |
| pulse global auto   | 3.6 / 3.6   | 319 / 378 / +18%（掉帧严重，仅供参考） |
| pulse global 显式   | 3.2 / 2.0   | 391 / 709 / +81%（同上）               |

### 开启 / 关闭耗时（暖，shimmer global）

| 卡数 / 标记 | 开启 ul / tofu | 差    | 关闭 ul / tofu | 差   |
| ----------- | -------------- | ----- | -------------- | ---- |
| 500 auto    | 19.6 / 31.0    | +58%  | 18.8 / 29.1    | +55% |
| 2000 auto   | 79.2 / 151.8   | +92%  | 75.0 / 112.9   | +51% |
| 4000 auto   | 159.2 / 356.6  | +124% | 151.0 / 217.3  | +44% |
| 2000 显式   | 75.2 / 172.1   | +129% | 55.6 / 107.1   | +93% |

### 含行内 skz-ignore（2000 卡 pulse global，auto）

样式重算 39.3 / 73.3（+87%），无 ignore 的同格是 +46%。差距从 46% 放大到 87%，underline 基本没变。只有这一格、单次对比，倾向成立但没单独验证。

## 原因分析

1. **绘制两者同样便宜（有数据）。** underline 是透明文字加一条装饰线，和文字走同一条绘制路径；tofu 也是画文字。tofu 想省的"原生字体渲染那一步"本来就不贵，Paint / GPU 两边持平，差异在 ±0.5 ms 内且正负都有。
2. **每帧成本在样式重算，tofu 这里更重。** pulse / shimmer 每帧改根上的颜色变量，几万个元素逐个重算样式。
   - tofu 的目标选择器带一串 `:not()` 和 `:has()` 守卫。含 `skz-ignore` 时差距 46% → 87%，和这一点吻合（有数据，仅一格）。
   - tofu 给每个文字元素强制 13 条声明，其中 `font-family` / `letter-spacing` / `font-kerning` / `font-feature-settings` 等是字体属性，**推断**是每个元素重算时都要重新解析字体描述。**这一条是按 Chrome 机制做的推断，没有单独隔离验证**（比如拿掉字体属性只留颜色再测），不要当结论引用。
3. **开启耗时翻倍（有数据，规模越大差越多）。** underline 只影响绘制，开启时不改尺寸、不重排；tofu 换了字体，全部文字要重新塑形、断行，关闭时再来一遍。

## tofu 的固有缺点

来自 `bench/agents/a8-tofu-font/NOTES.md`，与本次性能无关：

- 按方块宽度排版，约 1/4 的情况行数与真实文字差一行，内容到达时布局位移。
- 字体加载失败或 CSP 挡 `data:` 字体时，真实文字以骨头色露出，没有 JS 回退。
- cmap format 13 只在 Chrome 验过，Firefox / Safari 未验证。
- 行内 `skz-ignore` 的父元素要退回 underline。

唯一的卖点是方块外观整齐。

## 决定与影响

- 移除 tofu：删 `tofu.css` 入口（`package.json` exports 的 `./tofu.css`）、`_tofu*.scss`、`scripts/gen-tofu-font.py`；`SkzTextMode` 类型去掉 `"tofu"`（`text: "tofu"` 现在是类型错误）；demo、README、设计文档同步。
- 行为：`skz-text-mode="tofu"` 成为未知取值，按 underline 外观处理（未知取值本来就落到 underline）。CSS 里直接写这个属性的不会报错，但外观变了。
- `all.css` 体积减少约 4 KB（minified）。
- 旧文档里的 tofu 数据（矩阵报告、a8 实验、落地复测）保留，各处已标注"已移除"。

## 附带发现：pulse global underline 在 2000 卡回退？

本次 2000 卡 underline + pulse global 是 23 帧 / 样式重算 39.5 ms；2026-10-10 落地复测同场景是 60.4 帧 / 9.66 ms。可能是 0.2.0 之后（或当时工作区未提交改动）引入的回退，也可能是测试页写法不同（本次用 `skz-auto` 路径）。没有定位，已记进 [status.md](../status.md) 待办。

## 没覆盖

冷启动（字体首次加载）；round / clip / leaf 模式；Firefox / Safari；4000 卡 4× 降速；显式标记下 500 / 4000 卡；`skz-ignore` 只测了 pulse 一格；整批重复；视觉保真对比；原因分析第 2 条的隔离验证。
