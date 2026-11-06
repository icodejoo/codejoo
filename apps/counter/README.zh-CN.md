# @codejoo/counter

浏览器端的轻量高性能计数引擎。单个共享的 `requestAnimationFrame` 心跳驱动所有 **count-up**
（数字滚动）与 **count-down**（倒计时），渲染方式可插拔——默认纯文本，也可用富 SVG/DOM 渲染插件
（翻牌、里程表、圆环）。

- **count-up** —— 数字从 `from → to` 动画，支持缓动、fps 节流、自定义格式/渲染、懒加载、分组、暂停/恢复。
- **count-down** —— 倒计时到截止点（ms / 单位 / `Date` / 日期串），支持格式化、懒加载、分组、生命周期钩子；
  渲染/钩子共用的 `ctx` 除当前 `value`（复用元组 `[d,h,m,s,ms]`）外还有 `ctx.oldValue`——上一次值真正变化前的独立快照，方便对比哪些位刚发生了进位。
- **单心跳** —— 一个 rAF 循环跑所有任务，首个任务自动启动、空闲自动停止；热路径零分配。
- **渲染插件** —— 按需引入、可独立 import（tree-shaking 友好）、运行时不依赖核心：
  - **card** —— 翻牌 / 滑动 / 日历翻页 数字卡片。
  - **odometer** —— 滚轮里程表（`minimal` / `full`）。
  - **ring** —— 圆形七段倒计时：刻度环 + 双向装饰弧 + 逐秒排空进度环。

## 安装

```sh
pnpm add @codejoo/counter
```

## 快速上手

```ts
import { countup, countdown } from "@codejoo/counter";

countup(1234, "#total"); // 0 → 1234
countup(0, 99.9, { duration: 2000, fmt: (n) => n.toFixed(1) });
countdown(60_000, "#timer", { fmt: "mm:ss" });
countdown("2026-12-31 23:59:59", "#newyear", { fmt: "DD HH:mm:ss" });
```

## 渲染插件（独立入口，按需引入）

```ts
import { countdown } from "@codejoo/counter/count-down";
import { createRingRender } from "@codejoo/counter/ring";
import "@codejoo/counter/ring.css";
countdown(300_000, "#ring", { fmt: "mm:ss", render: createRingRender() });
```

各插件选项与 API：[card](./docs/card.md) · [odometer](./docs/odometer.md) · [ring](./docs/ring.md)。

## 省电与可见性

- **共享定时器会休眠。** 插件的 `install(now, dt)` 可返回 `true`（下一帧）、`false`（空闲）或正数毫秒（"至少这么久之后再叫我"）。
  所有忙碌插件都返回数字时，核心不再逐帧空转，只挂一个定时器休眠；新增 / 恢复 / 移除任务会唤醒它。同一时刻批量创建的整秒倒计时，开销约每秒 1 次唤醒，而不是 60 帧。
- **后台标签页。** 页面隐藏时 `requestAnimationFrame` 会停摆，核心改用定时器驱动，倒计时的 `onDone` 仍会准时触发（受浏览器对隐藏页定时器节流的限制），不必等用户切回来。
- **`muteHidden`（默认 `true`）。** 页面隐藏或元素离开视口时，任务跳过 `render` / `onUpdate`；进度与完成仍按真实时间推进，重新可见时立即刷新为当前值。
  没有 `el` 的 count-up 任务不会被静音。需要始终更新时传 `muteHidden: false`。
- **时钟。** 相对时长倒计时（如 `countdown(60000, …)`）走单调钟，修改系统时间不会让它跳变；绝对 `Date` / 时间戳 / 日期字符串跟随墙钟。
  `pause()` → `resume()` 之后任务统一按单调钟继续。
- **`fps`（count-down）。** 仅限制 `showMilliseconds` 任务的显示频率，完成不受影响。

详见 [CHANGELOG](CHANGELOG.md)。

## 入口

| import                                            | 内容                                        |
| ------------------------------------------------- | ------------------------------------------- |
| `@codejoo/counter`                                | 全部（核心 + count-up + count-down + 插件） |
| `@codejoo/counter/count-down`                     | `countdown`                                 |
| `@codejoo/counter/count-up`                       | `countup`                                   |
| `@codejoo/counter/card` `.../odometer` `.../ring` | 对应渲染插件                                |

各渲染插件运行时独立（仅以 type 依赖 count-down），import `/ring` 只会打包 ring 本身。

## 开发

```sh
pnpm dev      # 监听构建
pnpm build    # 多入口 ESM 构建 + 拷贝 css
pnpm test     # vitest (jsdom)
pnpm check    # 格式化 + lint
```

全量 API 手动测试台：用 Vite dev server 打开根路径 `/`（index.html）。
