# 基准测试工具包（多个子代理共用）

## 基准页
1. 在 `E:/workspaces/codejoo/apps/skeletonizer/demo/` 下建自己的临时目录（如 `demo/.tmp-<你的名字>/`）。
2. 把 `perf-template.html` 复制进去命名为 `perf.html`；它从同目录加载 `?css=<名字>` 对应的 `<名字>.css`。
3. CSS：`cp dist/all.css demo/.tmp-x/prod.css` 得到正式版（全部方案）；需要变体时用 `pnpm exec sass --no-source-map src/styles/entries/all.scss demo/.tmp-x/base.css` 编出可读版再改写。分入口见 `src/styles/entries/`。
4. 页面地址：`http://localhost:5188/demo/.tmp-x/perf.html`（开发服务已在 5188 运行，不要停它；若 curl 不通，在包目录执行 `pnpm exec vp dev --port 5188 --strictPort --open false` 后台启动）。

## 场景文件（JSON 数组）
每项：`{ "name": "...", "css": "prod", "n": 500, "attrs": <数组或对象>, "toggle": true, "toggleN": 9, "noTrace": false }`
- `n` 是卡片数：500 ≈ 4000 元素，2000 ≈ 16000 元素。
- `attrs` 为数组 `[["x-ske-effect","shimmer"],["x-ske-text","leaf"]]` 时直接写根属性（纯 CSS 路径）；为对象 `{"effect":"shimmer","text":"leaf","fps":24}` 时走真实 `enable()`。
- 输出每行一个 JSON：fps、UpdateLayoutTree（样式重算 ms/帧）、Layout、PrePaint、Paint、gpu、compositor，均为每帧中位数；toggleMs 为开启耗时。`mainBusy` 有重复计数，别用。

## 跑（必须用这个，自动排队，避免多个代理同时测互相抢 CPU）
```
node <kit>/run-locked.mjs <你的端口> <你的 Chrome 配置目录> <场景.json> <基准页 URL> 3
```
- 端口和配置目录每个代理用自己的（见各自任务说明）。
- 脚本会等锁、打印 CPU、起 Chrome、跑完关 Chrome、释放锁。别自己另起 Chrome 跑基准。
- 正确性检查（截图、读计算样式）同样要在拿锁期间做：可以仿照 trace.mjs 写自己的 CDP 脚本，用 run-locked.mjs 的方式（先 mkdir 锁目录 `<kit>/bench.lock`，结束删除）。
