# bench：性能实验存档

骨架屏动画与选择器的性能实验，全部草案、测试脚本、场景、原始数据和结论都在这里。**不参与构建、格式化、lint，也不随 npm 包发布。** 结论的正式版本在 [`docs/reports/2026-10-08-performance.md`](../docs/reports/2026-10-08-performance.md)。

## 目录

| 路径 | 内容 |
| ---- | ---- |
| `kit/` | 测试工具包：`trace.mjs`（CDP Tracing 拆每帧耗时）、`run-locked.mjs`（加锁串行跑，自动起停独立 Chrome）、`perf-template.html`（基准页模板）、`cpu.ps1`、`kill-chrome.ps1`、`README.md`（用法） |
| `2026-10-08/scripts/` | 主会话各轮实验与验证脚本（`trace-v1.mjs` 是工具包之前的版本） |
| `2026-10-08/scenarios/` | 场景文件 `sc-*.json` |
| `2026-10-08/results/` | 原始结果 `res-*.jsonl`（每行一个场景，每帧耗时为中位数） |
| `2026-10-08/screenshots/` | 截图 |
| `2026-10-08/css-compare/` | `/simplify` 前后编译 CSS 对比 |
| `2026-10-08/VARIANTS.md` | 各轮 CSS 变体的改法（变体文件已删，可按说明复原）和未入报告的 A/B 数据 |
| `2026-10-09-entries/` | 拆包后复测：`explicit.css` vs `base.css`（`sc-explicit.json` / `explicit.log`）、优先级问题探针 `probe.mjs`、Vite 按需打包验证用例 `bundle/`（性能报告第 11 节） |
| `2026-10-09-integration/` | 组合方案落地后的复测：场景 `sc-int-*.json`、原始输出 `int-*.log`、测试页（`perf.html` / 带 `x-ske-bone` 的 `perf-bone.html`）、验证脚本 `verify*.mjs`、截图 `shots/`（性能报告第 10 节） |
| `2026-10-09-autoscope/` | 自动作用域属性 `skz-auto` 实验：scoped / split / class 三种前缀写法的 CSS 变体，A 现状 / B 标记区 / C 全自动 / D explicit / E 混合五组对比（16000 元素），含页面 `perf-auto.html`、场景 `sc-*.json`、带看门狗的 `run-all.sh`、原始结果 `results/`、截图 `shots/`、`NOTES.md`（结论：标记区没有被加速，全自动区反而慢 7~9ms） |
| `2026-10-10-landing/` | 降频 / clip 不挂 pulse / 防火墙补钉 `--skz-tbg` / tofu 落地后的复测（2000 卡 × shimmer·pulse·svg × clip·underline·tofu，另含 4× 降速）与正确性验证（`verify.mjs`、`wcsvg.mjs`、`shots/`），见 `NOTES.md` |
| `2026-10-10-layering/` | CSS 分层（`core.css` / `explicit.css` / `base.css` / `global.css` 重新划分）的验证与基准：逐规则对比 `cssdiff.mjs`、计算样式 + 整页截图对比 `verify.mjs`、老浏览器模拟（`serve.mjs` 的 `?sim=`）、重复加载（`dup`）、demo 快照对比、完整版 2000 卡基准（每格新鲜加载）、派生变量 A/B（未采用）、"会话状态陷阱"排查；最小 core 页面 `core.html`；见 `NOTES.md` |
| `2026-10-10-core/` | core 实测（core 与完整版并列拆包之后）：125 / 250 / 500 卡 × fade·solid·pulse·shimmer，同规模完整版（`skeletonizer/global` + 防火墙）对照，250 卡 4× CPU 降速，另有规模上限批（750~2000 卡、4× 降速下 63~500 卡）；基准页 `perf.html`（import map 引 `core-js` + `core.css` / 完整版）、`serve.mjs`（冻结 dist 快照）、`gen-scenarios.mjs`、`run-batch.mjs`（端口 9711，等 CPU 安静 + 加锁串行）、`summarize.mjs`、`results/`（jsonl、CPU 日志、汇总）；结论与口径见 `NOTES.md` |
| `agents/` | 子代理实验目录，各自带 `NOTES.md`（方案、文件用途、场景↔实验、原始结果、截图、结论与失败原因），见下表 |

## 场景 / 结果 ↔ 性能报告

| 场景 → 结果 | 内容 | 报告章节 |
| ----------- | ---- | -------- |
| `sc-base` → `res-base` | 各效果每帧耗时拆分基线 | 8.2 |
| `sc-exp` → `res-exp` | steps、去掉第 1/2 档、sweep 变体、开启耗时 | 8.3 |
| `sc-rules` → `res-rules` | 第 2 档逐条规则成本与改写 | 8.3 |
| `sc-r4` → `res-r4`、`sc-r5` → `res-r5` | 改写组合、开启耗时异常、sweep 隔离 | 8.3 |
| `sc-toggle` → `res-toggle` | 开启耗时 15 次中位数 | 8.4 |
| `sc-final` → `res-final` | 优化前后同轮对比 | 8.4 |
| `sc-svg` → `res-svg` | SVG 动画背景原型 | 9.2 |
| `sc-root` / `sc-root2` → `res-root` / `res-root2` | 根驱动成本来源、JS 写变量 | 9.1 |
| `sc-svgprod` / `sc-svgprod2` → `res-svgprod` / `res-svgprod2` | SVG 方案正式构建复测 | 9.2 |
| `sc-tick` → `res-tick` | JS 计时器 `fps` 选项复测 | 9.3 |

## 怎么重跑

1. 开发服务：在包目录 `pnpm exec vp dev --port 5188 --strictPort --open false`。
2. 建测试目录（如 `demo/.tmp-x/`），复制 `kit/perf-template.html` 为 `perf.html`，放入 CSS（`cp dist/skeletonizer.css demo/.tmp-x/prod.css`）。
3. `node bench/kit/run-locked.mjs 9333 <Chrome 配置目录> <场景.json> http://localhost:5188/demo/.tmp-x/perf.html 3`。
4. 测之前确认 CPU 空闲（`run-locked.mjs` 会打印 CPU 占用）；有编译任务时数据不可信。

## 子代理实验（2026-10-08）

方案由主会话制定，子代理按方案实现原型并实测；所有基准经 `kit/run-locked.mjs` 加锁串行，避免互相抢 CPU。

| 目录 | 方向 | 一句话结论 |
| ---- | ---- | ---------- |
| `agents/a1-root-fps-firewall/` | 根驱动提帧率：继承防火墙、JS 计时器自适应写入频率 | 防火墙要连派生变量（`--x-ske-fill` / `--x-ske-bg-pos` / `--x-ske-ul-fill`）一起在卡片上重声明才成立；IntersectionObserver 给视口外卡片打防火墙，16000 元素 shimmer 19 → 60fps，开启耗时与基线相近，优于 `x-ske-cv`；自适应写入（上限每 4 帧写一次）16000 元素保持 ≥45fps |
| `agents/a2-new-schemes-mask-paint/` | 新方案：静态骨头遮罩 + 合成器光带（A）、CSS Paint API（B1 骨头自带动画 / B2 根上继承变量） | A 每帧主线程为 0、颜色跟 CSS 变量，但一次性生成遮罩 16000 元素要 4~7s（PNG 编码）；B1 主线程外运行但 worklet/GPU 更重、仅 Chromium；B2 无收益 |
| `agents/a3-svg-simplify-blob/` | SVG 简化：CSS 定色的三种做法、SVG 写法与体积、时长、精灵 + 片段、运行时 blob | 纯 CSS 定色做不到任意高光精确；运行时 blob 生成 SVG 颜色与根驱动一致、时长可配、性能持平；精灵 + 片段无性能收益；最短 SVG 写法每张省约 100~150B |
| `agents/a4-explicit-bone/` | 只认 `x-ske-bone` 的显式模式 | 16000 元素样式重算降约 1/3（pulse 34 → 23ms、shimmer 42 → 27ms），开启 71 → 52ms；只加标记不改 CSS 无影响；统一圆角会盖掉页面自己的 `border-radius` |
| `agents/a5-svg-filter/` | SVG 滤镜把内容剪影成骨头 | 静止 / 滚动 / pulse / shimmer 16000 元素都是 60fps，开启时多约 115ms 首绘；视觉硬伤：文字是字形剪影、卡片结构和浅色内容丢失、深色主题更差、`x-ske-ignore` 原理上无法生效 |

重跑子代理的实验：把目录复制回 `demo/.tmp-<名字>/`（测试页用 `../../src/index.ts` 相对引用源码），再按各自 `NOTES.md` 的命令执行。

测量口径提醒：基准页的 `frames()` 用 rAF 循环计帧，会强制每帧一次主线程帧，从而把合成器动画（sweep、SVG、遮罩方案）的 PrePaint 也算进来；页面本身没有 rAF 循环时这部分不一定发生。`a2` 目录里有 idle 模式（读合成器真实交换帧数）的对照数据。
