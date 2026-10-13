# 2026-10-12 tofu vs underline 压力对比

问题：完整版文字模式 tofu 相对 underline 差多少，值不值得拿 tofu 替换 underline。对象：2026-10-13 03:00 用当前工作区（含未提交改动）`pnpm build` 的 `dist/`。

## 方法与条件

- `dist/` 冻结到 `%TEMP%/skz-tvu-dist`，`serve.mjs`（端口 5196）静态吐出；Chrome 实机，端口 9655，新配置目录，`run-locked.mjs` 加锁串行，视口 1200×800、DPR 1。
- 基准页 `perf.html`：CSS 令牌 `base,global[,tofu]` / `base,svg[,tofu]`（underline 页不引 tofu.css，tofu 页引）；JS 来自 `full.mjs` + `global-js.mjs` / `svg-js.mjs`，真实 `enable(root, { effect, text, engine })`。
  - 标记方式：auto = 根上 `skz-auto`（`_attrs`）；ex = 文字元素（h3 / p / span / button）打 `skz-text`、img / i 打 `skz-bone`，根上不写 skz-auto。
  - tofu 页加载前 `await document.fonts.load("16px skz-tofu")`（字体已就绪，只测暖）；开启 / 关闭耗时每格先丢 2 次预热切换。
  - ign 场景：偶数卡的 p 里放 `<span skz-ignore>`（auto）。
- 每格 3 次 trace（各 2.5 秒）取中位数；underline / tofu 同批相邻、每格交替先后（抵消批内漂移）。开启 / 关闭耗时每格 9 次取中位数（所有原始值在 `results/summary.md`）。
- 批：K 金丝雀；A 规模×效果（auto）；B 显式 2000；C 4× 降速 2000；D 开启 / 关闭；E 含 skz-ignore。场景由 `gen-scenarios.mjs` 生成，`run-batches.mjs` 跑，`summarize.mjs` 汇总到 `results/summary.md`（完整表）。
- 每批首尾各一对金丝雀（500 卡 fade、2000 卡 shimmer global underline），每批判据：visibilityState=visible、rAF≥55、金丝雀 fps≥57，否则整批作废重跑（本次全部一次通过，没有作废）。

## 环境探测（锁屏 / 关屏）

全部 22 次金丝雀（K + A~E 首尾）：visibilityState=visible，hasFocus=true，rAF 3 秒帧率 56.9~57.3，金丝雀 fps 57.2~57.6，无 stall。环境可用。
注意：本机本次的帧率天花板稳定在约 57.6（以往记录 60.4），所有格同样受影响，成对比较不受影响，但绝对 fps 不能和旧数据直接比。

## CPU 情况

批内整机 CPU 均值：K 15.2%、A 13.0%、B 12.3%、C 14.8%、D 13.9%、E 13.0%（P90 约 16~19%，峰值 42~55%，来自 Chrome 自身）。起测前等安静（均值 ≤10%）。没有批次因 CPU 偏高重跑（阈值 22%）。原始 CPU 日志在 `results/cpu-*.log`、`results/cpu.jsonl`。

## 数据

格内为 underline | tofu | 差值%；时间单位 ms/帧。完整表（含 Layout、有绘制帧占比、开启各次原值）见 `results/summary.md`。

### 帧率与样式重算（auto，1 / 2 / 3 档规模）

| 场景 | fps ul / tofu | 样式重算 | Paint | GPU |
|---|---|---|---|---|
| pulse global 500 | 57.6 / 50.8 | 7.33 / 12.84 / +75% | 0.37 / 0.36 | 1.11 / 1.50 |
| pulse global 2000 | 23.2 / 16.4 | 39.5 / 57.8 / +46% | 0.93 / 0.72 | 1.64 / 1.85 |
| pulse global 4000 | 11.6 / 6.4 | 88.9 / 179.9 / +102% | 1.80 / 1.36 | 2.14 / 2.49 |
| shimmer global 500 | 57.2 / 57.6 | 1.04 / 1.19 / +14% | 0.38 / 0.40 | 1.43 / 1.63 |
| shimmer global 2000 | 57.6 / 57.2 | 3.28 / 3.82 / +16% | 0.66 / 0.57 | 1.44 / 1.54 |
| shimmer global 4000 | 57.6 / 57.6 | 6.22 / 8.27 / +33% | 0.77 / 0.85 | 1.46 / 1.75 |
| shimmer svg 500 / 2000 / 4000 | 都 57.2~57.6 | 样式重算 ≈0.04 | PrePaint 1.00/0.99、5.11/4.07、8.91/7.90 | 1.63/2.02、1.79/2.20、1.76/2.02 |
| solid 500 / 2000 / 4000 | 都 57.2~57.6 | 0 | 0 | ≈0 |

### 显式 skz-text，2000 卡

| 场景 | fps | 样式重算 | Paint | GPU |
|---|---|---|---|---|
| pulse global | 19.6 / 13.6 | 48.6 / 73.3 / +51% | 0.72 / 0.66 | 1.40 / 1.47 |
| shimmer global | 57.2 / 57.2 | 3.24 / 4.00 / +23% | 0.47 / 0.67 | 1.11 / 1.10 |
| shimmer svg | 57.2 / 57.2 | 0.04 / 0.04 | PrePaint 2.65 / 2.58 | 1.34 / 1.31 |
| solid | 57.6 / 57.6 | 0 / 0 | 0 / 0 | ≈0 |

### 4× CPU 降速，2000 卡

| 场景 | fps | 样式重算 | Paint | GPU |
|---|---|---|---|---|
| shimmer global auto | 32.8 / 28.8 | 22.1 / 27.7 / +25% | 4.79 / 4.66 | 2.06 / 2.81 |
| pulse global auto | 3.6 / 3.6 | 319 / 378 / +18% | 6.41 / 4.96 | 2.97 / 2.45 |
| shimmer global 显式 | 39.2 / 30.0 | 18.0 / 26.9 / +49% | 2.98 / 3.69 | 1.34 / 1.80 |
| pulse global 显式 | 3.2 / 2.0 | 391 / 709 / +81% | 7.52 / 7.07 | 2.72 / 2.85 |

### 开启 / 关闭耗时（暖，shimmer global，9 次中位数）

| 卡数 / 标记 | 开启 ul | 开启 tofu | 差 | 关闭 ul | 关闭 tofu | 差 |
|---|---|---|---|---|---|---|
| 500 auto | 19.6 | 31.0 | +58% | 18.8 | 29.1 | +55% |
| 2000 auto | 79.2 | 151.8 | +92% | 75.0 | 112.9 | +51% |
| 4000 auto | 159.2 | 356.6 | +124% | 151.0 | 217.3 | +44% |
| 2000 显式 | 75.2 | 172.1 | +129% | 55.6 | 107.1 | +93% |

### 含行内 skz-ignore（2000 卡 pulse global，auto）

fps 23.6 / 14.0；样式重算 39.3 / 73.3（+87%）；Paint 0.92 / 0.87；GPU 1.68 / 1.80。对比无 ignore 的同格（39.5 / 57.8，+46%）：tofu 多出的差距从 +46% 扩到 +87%，ul 基本没变，说明 `:has` 守卫在含 skz-ignore 的结构里有额外成本（单次对比，见噪声）。

## 结论

1. **tofu 在任何动画场景下都不比 underline 快；GPU / Paint 基本持平**（差异在 ±0.5ms 内，且正负都有），差距全在主线程样式重算和开启 / 关闭耗时。
2. **shimmer global（落地后的默认动画）**：2000 卡样式重算多 0.5~0.8ms/帧（+16%~23%），4000 卡多 2ms（+33%）；fps 没差别（都是帧率上限）。差距小，在 2 倍以内，且有噪声，可接受。
3. **shimmer svg / solid**：没有可测差异（样式重算 ≈0；svg 的 PrePaint 差异正负混杂，是噪声）。
4. **开启 / 关闭耗时是 tofu 最明显的代价**：暖字体下开启慢 58%~129%，规模越大越慢（2000 卡 +72ms，4000 卡 +197ms）；关闭也慢 44%~93%。用户在加载骨架的瞬间会多卡 70~200ms。比 0.2.0 之前记录的 +30~45% 更差。
5. **pulse global 下 tofu 明显更差**：样式重算 +46%~102%，500 卡 fps 就从 57.6 掉到 50.8，4× 降速显式标记 +81%。但注意**这个版本里 underline 的 pulse global 本身在 2000 卡就只有 23 fps**（旧基准 9.66ms 样式重算、60 fps，这次 39.5ms），见"需要关注"，所以 pulse 全局场景无论用哪种文字模式都不该上大规模。
6. 含 `skz-ignore` 时 tofu 的 `:has` 守卫成本放大（+87%），只有一个单次对比，倾向成立但没验证。

**能不能用 tofu 替换 underline**：不建议整体替换。视觉上 tofu 的价值是真实排版（换行、末行变短）；性能上 shimmer 下代价小可以接受，但开启耗时翻倍、pulse 全局更差、4000 卡时开启要 357ms。建议保持 underline 为默认，tofu 作为"要排版保真时再选"的可选项，且别和 pulse 全局大列表搭配。

## 噪声说明

- 每格 3 次 trace 中位数，批内金丝雀稳定（fps 57.2~57.6，rAF 56.9~57.3），整机 CPU 均值 12~15%，但这是日常工作机，不是空闲机。
- 样式重算差 <10% 的格视为噪声；shimmer 的 16%~33%、开启耗时 +50% 以上重复性较好（开启 9 次的原值很集中，如 4000 卡 tofu 345~360ms）。
- pulse global 2000/4000 卡本身掉帧严重（fps 6~24，每帧样式重算几十~几百 ms），fps 和有绘制帧占比在此处波动大，只看样式重算。4× 降速 pulse 只有 3 fps，数值不稳，仅供参考（"有绘制帧占比"出现 111% / 78% 也是掉帧导致的统计假象）。
- pulse 每格只有一次 3 trace 中位数，+18%（降速 auto）这个量级不下结论。

## 没覆盖

- 冷启动（字体首次加载）；其他文字模式（round / clip / leaf）；Firefox / Safari；4000 卡的 4× 降速；显式标记下 500 / 4000 卡；`skz-ignore` 只测了 pulse 一格（没测 shimmer、没测显式标记）；每格重复整批（只做了一批）；视觉保真对比。

## 需要关注（非本次对比对象）

pulse global 2000 卡 underline 现在是 23 fps / 样式重算 39.5ms，旧基准（`2026-10-10-landing`）同场景 60.4 fps / 9.66ms。可能是 0.2.0 之后 / 工作区未提交改动引入的回退，也可能是页面结构（skz-auto 路径）不同；本次没有定位，建议单独查。

## 文件

`perf.html` 基准页；`trace.mjs` 追踪器（增补 env 探针、开启 / 关闭耗时）；`serve.mjs`；`gen-scenarios.mjs`；`run-batches.mjs`；`summarize.mjs`；`scenarios/`；`results/*.jsonl`（采用的原始数据，`*.try1.jsonl` 同）、`results/summary.md`、CPU 日志；`batches.log`。
