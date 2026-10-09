# 2026-10-09 全量性能矩阵（控制变量版）

报告：`docs/reports/2026-10-09-benchmark-matrix.md`。本目录是脚本、场景、原始数据和截图。

**状态：只跑完了一遍正向（A~E、S）；F（CPU 降速 4×）和反向第二遍没跑（用户中途叫停）。**

## 文件

| 路径 | 用途 |
| ---- | ---- |
| `perf.html` | 基准页。CSS / JS 全部取自 `../../dist/`（正式构建），URL 参数 `css=` 用令牌选组合，见页面顶部注释 |
| `serve.mjs` | 静态服务（默认 5190），原样吐出 dist，不经 Vite 转换；dev 服务 5188 没动 |
| `gen-scenarios.mjs` | 生成 `scenarios/sc-*.json`（`-rev` 是反向顺序版，没用上） |
| `run-batches.mjs` | 批量跑：等 CPU 安静 → 后台采样 CPU → `bench/kit/run-locked.mjs` → 批均值过高就整批重跑，不混用 |
| `wait-idle.ps1` / `cpu-log.ps1` | 等安静 / 逐秒采样 CPU |
| `summarize.mjs` | 汇总 `results/*.jsonl`；`node summarize.mjs pivot` 出报告用的并排表 |
| `verify-matrix.mjs` / `verify-anim.mjs` | 正确性抽查（截图 + 计算样式 / 连拍 12 张） |
| `probe-sweep.mjs` / `probe-fw.mjs` | 探针：sweep 光带随根高消失、防火墙滚动后仍在动 |
| `results/` | 原始数据（见下） |
| `results-discarded-minimized/` | 作废数据：测试 Chrome 窗口被最小化，rAF 停摆，帧数全错；之后给 `kit/trace.mjs` 加了守卫 |
| `shots/` | 截图 |

## 对kit的改动（都向后兼容，默认行为不变）

- `bench/kit/trace.mjs`：`PERF_VIEWPORT=1200x800` 固定视口 + DPR 1；场景可写 `"cpu": 4`（CPU 降速）；`"snap": true` 在输出里带页面状态；每次测量前还原最小化窗口，页面不可见或耗时拖长则作废重测（输出 `stalls`）。
- `bench/kit/run-locked.mjs`：环境变量 `PERF_SCRIPT` 可换掉被跑的脚本（正确性抽查、探针用）。

## 场景 ↔ 结果

| 批 | 场景文件 | 结果 | 内容 |
| -- | -------- | ---- | ---- |
| A | `sc-A.json` | `results/A.jsonl` | A1 fade、A2 solid、A3 sweep、A4 纯 CSS（p=pulse，s=shimmer）、A5 global+enable、A6 svg |
| B | `sc-B.json` | `results/B.jsonl` | base vs explicit（enable / 纯 CSS / svg） |
| C | `sc-C.json` | `results/C.jsonl` | 文字模式 underline vs leaf |
| D | `sc-D.json` | `results/D.jsonl` | 无列表结构（双栏表单）：默认 / fps:auto / fps:24 / svg；D5、D6 加了 `noio`（强制走计时器） |
| E | `sc-E.json` | `results/E.jsonl` | E1 fit、E2/E3 skz-cv、E4 steps(36)、E6/E7 sweep 两种模式、E8 sweep+fit、E9 sweep 小根 |
| S | `sc-S.json` | `results/S.jsonl` | 连续滚动（1200px/s 往返）下的帧数 |
| F | `sc-F.json` | **无** | 4× 降速，没跑 |

- 每批首尾各有金丝雀（`CAN-*`：同一场景测两次，看批内漂移）。
- `results/<批>.try<N>.jsonl` 是该批每次尝试的原始输出，`<批>.jsonl` 是采用的那次（批内 CPU 均值最低的）；`results/cpu.jsonl` 记每次尝试的 CPU（均值 / P90 / 最大，含 Chrome 自己的占用）。
- 每行：`fps`、`UpdateLayoutTree`（样式重算 ms/帧）、`PrePaint`、`Paint`（缺字段 = 0）、`toggleMs`（开启耗时中位数）、`snap`（防火墙标记数、fit 隐藏数、根属性等）。
- `verify.jsonl`、`verify-anim.jsonl`、`probe-*.jsonl`：正确性抽查原始输出。

## 与旧口径的差别

- 页面用 `dist/` 里的 JS：`global` = `global-js.mjs`，`svg` = `svg-js.mjs`（单独引入，不叠 global）；纯 CSS 行只引 CSS，不加载变体 JS。
- 开启耗时：enable 路径量的是真实的 `off(); enable(root, opts); 强制样式 + 布局`；纯 CSS 路径量切 `skz` 属性。和旧报告（只切属性）不可直接比。
- 固定视口 1200×800、DPR 1。

## 怎么重跑

```
pnpm build
node bench/2026-10-09-matrix/serve.mjs 5190 &            # 静态服务（或把 URL 换成 5188 的 dev 服务，但那会经 Vite 转换）
node bench/2026-10-09-matrix/gen-scenarios.mjs
MAX_MEAN=22 TRIES=2 node bench/2026-10-09-matrix/run-batches.mjs A B C D E S F
node bench/2026-10-09-matrix/summarize.mjs pivot
# 正确性抽查
PERF_SCRIPT=$PWD/bench/2026-10-09-matrix/verify-matrix.mjs PERF_VIEWPORT=1200x800 node bench/kit/run-locked.mjs 9351 <配置目录> bench/2026-10-09-matrix/scenarios/smoke.json http://localhost:5190/bench/2026-10-09-matrix/perf.html 1
```
