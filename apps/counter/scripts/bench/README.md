# 性能基准（前后对比）

在真实（无头）Chrome 里，把 **git 基线**（默认 `HEAD`）与**当前工作区**各打一个包，同一页面交错测量，避免冷热、机器负载造成的偏差。结果是相对变化，
无头下的绝对 ms 含浏览器自身开销，只看 base 与 cur 的比值。

```sh
node scripts/bench/prepare.mjs [baseRef=HEAD]                 # 生成 .bench/（已 gitignore）
node scripts/bench/run.mjs '[["cd1s",100,0],["ring",100]]'    # CPU / rAF 对比，可选 [持续ms=6000] [轮数=3]
node scripts/bench/tick.mjs                                   # 纯 tick 吞吐 100 / 1k / 1w 任务
BENCH_HEADED=1 node scripts/bench/fps.mjs '[["ring",30],["odo",100]]'   # 有头真机 fps（合成器 DrawFrame / DroppedFrame，与 DevTools FPS 表同源）
node scripts/bench/hidden.mjs cur 1 390000                    # 后台标签页 onDone 准时性（>=390000 才会触发强节流）
```

- 浏览器默认 `C:/Program Files/Google/Chrome/Application/chrome.exe`，可用 `CHROME` 环境变量换成 Edge 等 Chromium 系浏览器。
- `run.mjs` 场景：`cd1s` 整秒倒计时、`cdms` 毫秒倒计时、`cu` count-up、`cdms-off` / `cu-off` 大量元素在视口外（验证 `muteHidden`）、
  `ring` / `card` / `odo` 渲染插件（40px 小格子，全部在视口内）。第三项是各任务截止时间的错开毫秒数：对齐（0）时休眠收益最大，错开 ≥3ms 会退化为逐帧。
- 单个场景一轮约 8 秒；`hidden.mjs` 等于目标时长（强节流验证约 7 分钟）。

**有头 fps（`fps.mjs`）解读**：动画类场景（`odo`、毫秒倒计时、`cu`）合成 fps 越接近屏幕刷新率越流畅；整秒类（`card`、`ring`、整秒倒计时）本就只在秒位切换时出帧，
`ring` / `card` 的 ~15–17 fps 是每秒一次的 0.25s 颜色 / 翻牌过渡产生的帧，看**掉帧 %**而不是 fps 绝对值。有头会在桌面弹出窗口，测量期间请勿遮挡。
ring 场景与 `ring-stress.html` 同配置（2–7 分钟、`mm:ss`、关发光）；`ring` = 每秒，`ringms` = 毫秒模式（每帧回调的最坏负载）。
