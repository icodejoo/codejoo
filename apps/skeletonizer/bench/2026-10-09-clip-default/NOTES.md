# 2026-10-09 默认文字模式改为 clip 后的补测

默认（不写 `text`，即 clip）与显式 `text: "underline"` 成对测。报告：`docs/reports/2026-10-09-benchmark-matrix.md` 的「默认文字模式改为 clip 后的补测」一节。

## 方法

- 沿用 `../2026-10-09-matrix/` 的页面（`perf.html` 原样复制）、`bench/kit/run-locked.mjs` 加锁串行、`trace.mjs` 采集。视口 1200×800、DPR 1，Chrome 154，端口 9577，配置目录 `C:/Users/jelon/AppData/Local/Temp/skz-clipdef-chrome`。
- 页面全部取 `pnpm build` 后的 `dist/`，由本目录 `serve.mjs`（静态服务，5190）原样吐出，没有走 5188 的 Vite dev 服务（会让 dist 的 mjs 变成不同实例，svg 引擎和防火墙不生效）。
- 每个场景 3 次 trace 取中位数，开启耗时 7 次中位数；每批首尾各一对金丝雀，同批内 clip / underline 相邻放置。
- `run-batches.mjs`：测前等 CPU 安静（整机 <15% 连续 6 秒，最长等 10 分钟；机器常驻后台负载约 12~18%，多数批是等到超时才开跑）；批均值 >22% 就整批重跑（最多 2 次），取均值较低的一次。
- 对 `bench/kit/trace.mjs` 加了环境变量 `PERF_SCHEME=dark`（CDP `Emulation.setEmulatedMedia`，模拟深色），向后兼容。深色是否真的生效只靠这条 CDP 调用，没有另外截图核对。

## 文件

| 路径 | 内容 |
| ---- | ---- |
| `gen-scenarios.mjs` | 生成 `scenarios/sc-{G,GD,F}.json`；`-clip` 行不写 `text`，`-ul` 行写 `text:"underline"` |
| `run-batches.mjs` | 批量跑（G、GD、F；GD 自动带 `PERF_SCHEME=dark`） |
| `summarize.mjs` | 把 `results/<批>.jsonl` 汇总成并排表，输出在 `results/summary.md` |
| `results/<批>.jsonl` | 采用的那次原始数据；`<批>.try<N>.jsonl` 是每次尝试；`cpu.jsonl` / `cpu-*.log` 是 CPU 记录 |
| `perf.html` `serve.mjs` `wait-idle.ps1` `cpu-log.ps1` | 从 `../2026-10-09-matrix/` 复制 |

批：G = 默认路径（fade / solid / shimmer global / shimmer svg / pulse global / 表单 global / 表单 svg / sweep 浅 / fit）；GD = sweep 深色；F = 4× CPU 降速（2000 卡）。

## CPU 记录（整机，含 Chrome 自己）

| 批 | 采用 | 均值 / P90 | 另一次 |
| -- | ---- | ---------- | ------ |
| G | try1 | 24.5 / 32.6 | try2 32.3（更吵，没采用） |
| GD | try2 | 21.5 / 34.2 | try1 27.9 |
| F | try1 | 23.8 / 34.4 | try2 23.9 |

G 批 24.5% 超过 22% 的重跑线，重跑后更差，所以用了第一次。和上一轮矩阵（17%~27%）同量级，**不是空闲机器**。各批金丝雀（fade 2000 / shimmer global 500）样式重算 2.0~2.4 ms、GPU 7~9 ms（shimmer）、fade GPU 1.3~2.0 ms，批间漂移不大。

## 结果

完整表见 `results/summary.md`；摘要和结论在报告里。要点：

- fade / solid：clip 与 underline 没有可见差别（fps、样式重算、PrePaint、Paint、GPU、开启耗时都在噪声内）。
- shimmer（global / svg / 表单）：GPU 约 3 倍（~3.5 → ~11 ms；svg 2~3 → 6~7 ms）；svg 下 PrePaint 约 1.5~2 倍；fps 在 16000 元素时 svg 略掉（58.8 / 52.8 对 60.4）。
- **pulse global + enable：clip 明显变差**（16000 元素 24.4 fps / 样式重算 32.7 ms，underline 60.4 fps / 6.15 ms；try2 复现 28 fps / 27.5 ms）。读 `_global.scss` 与 `tier1.scss` 的推测原因：clip 在根上声明 `--skz-tbg: var(--skz-fill, ...)`，每帧随 pulse 变化的已展开值会继承给所有后代，防火墙只重声明 `--skz-fill` / `--skz-ul-fill` / `--skz-bg-pos`，挡不住 `--skz-tbg`。**只是读代码的推测，没有做实验验证。**
- 4× 降速：svg shimmer 12.8 fps（underline 34.8）；global shimmer 26.8 / 27.6 fps（持平）；fade / solid 持平 60 fps。
