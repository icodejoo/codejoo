# @codejoo/timer

> 基于 `requestAnimationFrame` 的高性能定时引擎。「全局 RAF 一次驱动 + 桶模式 O(1) 任务调度」核心，内置 `setTimeout / setInterval / setImmediate / countDown / countUp` 五种能力，零插件机制、零依赖。

**English**: [README.md](./README.md)

---

## 特性

- **单 RAF 循环 + O(1) 调度** —— 同 interval 的任务共享一个桶，add / remove / 每帧分发均 O(1)。
- **pause / resume 时间补偿** —— 暂停时长不计入 `dt`，resume 后任务不会"跳帧"。
- **高精度倒计时** —— `new Function` 元编程生成零开销 formatter，3 种 parser 模式（shared / typed / callback）。
- **金额数字滚动** —— 同样元编程生成千分位/小数格式化器，支持动画中途 `update(newTo)` 平滑重定向。
- **轻量** —— 零依赖，无插件系统，全部 API 内置。

## 安装

```bash
pnpm add @codejoo/timer
```

## 快速上手

```ts
import { Timer, ease, buildHighPerfFormatter } from "@codejoo/timer";

const timer = new Timer();

// 基于 RAF 的 timeout / interval / immediate
timer.setTimeout((task) => console.log("1秒后"), 1000);
const id = timer.setInterval((task) => console.log(task.updateAt), 1000);
timer.remove(id);

// 倒计时
timer.countDown(60_000, (txt) => (el.textContent = txt));

// 金额滚动
timer.countUp(99999, { prefix: "¥" }, (txt) => console.log(txt));
```

## API

### `new Timer(options?)`

| 选项       | 类型     | 默认 | 说明                                         |
| ---------- | -------- | ---- | -------------------------------------------- |
| `interval` | `number` | `0`  | 全局帧间隔(ms)。`33` ≈ 30fps，`0` = 不限制。 |

| 方法                                 | 说明                               |
| ------------------------------------ | ---------------------------------- |
| `setTimeout(cb, interval?, ...args)` | 一次性延时（默认 1000ms）          |
| `setInterval(cb, opts?, ...args)`    | 周期任务                           |
| `setImmediate(cb, ...args)`          | 下一帧立即执行                     |
| `countDown(duration, cb, opts?)`     | 倒计时                             |
| `countUp(to, opts?, cb?)`            | 数字/金额滚动                      |
| `remove(id)`                         | 取消任务                           |
| `pause() / resume()`                 | 暂停/恢复 RAF 循环，时间补偿无跳帧 |
| `start() / stop()`                   | 重置/停止 RAF 循环                 |
| `size`                               | 当前活跃任务数                     |

回调签名 `callback(task, ...args)` —— `task` 始终是首参。

### countDown

```ts
import { buildHighPerfFormatter, createCountDownParser, buildCountDownFormatter } from "@codejoo/timer";

// 默认 formatter: 'HH:mm:ss'
timer.countDown(60_000, (txt) => (el.textContent = txt));

// 自定义 formatter
const fmt = buildHighPerfFormatter("DD天 HH:mm:ss.sss");
timer.countDown(86_500_000, (txt) => {}, { interval: 100, formatter: fmt });

// Parser 三种模式
const sharedParser = createCountDownParser("shared", true); // { d, h, m, s, sss }
const typedParser = createCountDownParser("typed", true); // Int32Array(5)
const cbParser = createCountDownParser("callback", true); // (ms, cb)

// Parser → formatter 链式
const f = buildCountDownFormatter(sharedParser, (d, h, m, s) => `${d}d ${h}h ${m}m ${s}s`);
```

### countUp

```ts
import { buildCountUpFormatter, ease } from "@codejoo/timer";

const ctrl = timer.countUp(
  99999,
  {
    prefix: "$",
    suffix: "",
    thousands: ",",
    decimal: ".",
    precision: 2,
    duration: 1500,
    easing: ease.easeCountUp,
    fps: 30,
    el: "#total", // 可选：直接写入 textContent
  },
  (txt) => console.log(txt),
);

ctrl.update(199999); // 平滑重定向
ctrl.remove();
```

### 缓动函数

```ts
import { ease, easeAsymmetricS } from "@codejoo/timer";

ease.linear;
ease.easeInQuad / easeOutQuad / easeInOutQuad;
ease.easeOutCubic / easeInOutCubic;
ease.easeCountUp; // 非对称 S 曲线（countUp 默认）
easeAsymmetricS(0.3); // 自定义 skew
```

## 架构

| 文件              | 职责                                                      |
| ----------------- | --------------------------------------------------------- |
| `Timer.ts`        | RAF 循环、pause/resume，以及 countDown/countUp 等全部 API |
| `TimerManager.ts` | 桶模式 O(1) 调度（并行数组 + epoch 防重入）               |
| `TimerTask.ts`    | 单任务状态载体                                            |
| `TimerHelper.ts`  | 缓动函数与 `resolveEl` 工具                               |

## 构建与测试

```bash
pnpm install
pnpm dev          # vite dev server at index.html
pnpm build        # 产出 dist/index.mjs + dist/index.min.js
pnpm test         # vitest run (jsdom)
```

## License

MIT
