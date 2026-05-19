# @codejoo/ticker

> 基于 `requestAnimationFrame` 的高性能定时与动画引擎。「全局 RAF 一次驱动 + 桶模式 O(1) 任务调度」核心,外围用插件机制叠出 `tween / animate / countDown / countUp` 四种能力。

**English**: [README.md](./README.md)

---

## 特性

- **单 RAF 循环 + O(1) 调度** —— 同 interval 的任务共享一个桶,add / remove / 每帧分发均 O(1)。
- **pause / resume 时间补偿** —— 暂停时长不计入 `dt`,resume 后任务不会"跳帧"。
- **GSAP 风格 Tween** —— `to / from / fromTo`、`pause / play / reverse / seek / restart / kill`、`repeat`、`yoyo`、`delay`、`onComplete` 链式串联。
- **jQuery 风格 animate** —— 底层委托 Tween,支持 4 种重载签名。
- **高精度倒计时** —— `new Function` 元编程生成零开销 formatter,3 种 parser 模式(shared / typed / callback)。
- **金额数字滚动** —— 同样元编程生成千分位/小数格式化器,支持动画中途 `update(newTo)` 平滑重定向。
- **轻量** —— 零依赖,minify 后约 10 KB。

## 安装

```bash
pnpm add @codejoo/ticker
```

## 快速上手

```ts
import { Ticker, tween, animate, countDown, countUp, ease } from '@codejoo/ticker'

// 按需 extends —— 未 install 的插件,bundler 会 tree-shake 掉
Ticker.extends(tween())
Ticker.extends(animate())     // animate 运行时依赖 tween,需先装 tween
Ticker.extends(countDown())
Ticker.extends(countUp())

const ticker = new Ticker()

// 基于 RAF 的 timeout / interval(核心,不需要装任何插件)
ticker.setTimeout(task => console.log('1秒后'), 1000)
const id = ticker.setInterval(task => console.log(task.updateAt), 1000)
ticker.remove(id)

// Tween + chain
ticker.to('#box', {
  left: 200, duration: 800, ease: ease.easeOutCubic,
  onComplete: chain => chain.to({ top: 100, duration: 400 })
})

// jQuery 风格 animate
ticker.animate('#box', { left: '+=100' }, 400)

// 倒计时
ticker.countDown(60_000, txt => el.textContent = txt)

// 金额滚动
ticker.countUp(99999, { prefix: '¥' }, txt => console.log(txt))
```

> **注**:包发布为单个 `dist/index.mjs`,并声明了 `"sideEffects": false`。
> 仅 `import { Ticker, countDown }` 时,你的 bundler 会 tree-shake 掉
> tween / animate / countUp 的代码,最终产物不会包含未使用的部分。

## API

### `new Ticker(options?)`

| 选项       | 类型     | 默认 | 说明                                       |
|------------|----------|------|--------------------------------------------|
| `interval` | `number` | `0`  | 全局帧间隔(ms)。`33` ≈ 30fps,`0` = 不限制。 |

| 方法                                  | 说明                                |
|---------------------------------------|-------------------------------------|
| `setTimeout(cb, interval?, ...args)`  | 一次性延时(默认 1000ms)             |
| `setInterval(cb, opts?, ...args)`     | 周期任务                            |
| `setImmediate(cb, ...args)`           | 下一帧立即执行                      |
| `remove(id)`                          | 取消任务                            |
| `pause() / resume()`                  | 暂停/恢复 RAF 循环,时间补偿无跳帧    |
| `start() / stop()`                    | 重置/停止 RAF 循环                  |
| `size`                                | 当前活跃任务数                      |

回调签名 `callback(task, ...args)` —— `task` 始终是首参。

### Tween 插件

```ts
import { tween, ease } from '@codejoo/ticker'
Ticker.extend(tween())

const tw = ticker.to(target, {
  // CSS 属性或对象任意 key
  left: 200, opacity: 0.5, x: 100, rotate: 45,
  // 配置项
  duration: 800, ease: ease.easeOutCubic, delay: 100,
  repeat: 2, yoyo: true,
  onStart, onUpdate, onComplete, onRepeat
})

tw.pause(); tw.play(); tw.reverse()
tw.seek(0.5); tw.restart(); tw.kill()
```

- **Transform 简写**:`x / y / z / rotate / rotateX / rotateY / scale / scaleX / scaleY / skewX / skewY`
- **相对值**:`'+=20'`、`'-=10px'`
- **目标**:CSS 选择器 / Element / 普通对象
- **链式**:`onComplete: chain => chain.to({ ... })`

### animate 插件(jQuery 风格)

```ts
import { animate } from '@codejoo/ticker'
Ticker.extend(animate())

ticker.animate('#box', { left: 200 })
ticker.animate('#box', { left: 200 }, 400)
ticker.animate('#box', { left: 200 }, 400, () => console.log('done'))
ticker.animate('#box', { left: 200 }, 400, ease.easeOutCubic, done)
ticker.animate('#box', { left: 200 }, {
  duration: 400, easing: ease.easeOutCubic,
  progress: (p, remaining) => {}, complete: chain => {}
})
```

### countDown 插件

```ts
import {
  countDown,
  buildHighPerfFormatter,
  createCountDownParser,
  buildCountDownFormatter
} from '@codejoo/ticker'
Ticker.extend(countDown())

// 默认 formatter:'HH:mm:ss'
ticker.countDown(60_000, txt => el.textContent = txt)

// 自定义 formatter
const fmt = buildHighPerfFormatter('DD天 HH:mm:ss.sss')
ticker.countDown(86_500_000, txt => {}, { interval: 100, formatter: fmt })

// 三种 parser 模式
const sharedParser = createCountDownParser('shared', true)    // { d, h, m, s, sss }(复用对象,零 GC)
const typedParser  = createCountDownParser('typed', true)     // Int32Array(5)(可跨线程转移)
const cbParser     = createCountDownParser('callback', true)  // (ms, cb) 异步消费内存安全

// parser → formatter
const f = buildCountDownFormatter(sharedParser, (d, h, m, s) => `${d}天 ${h}时 ${m}分 ${s}秒`)
```

### countUp 插件

```ts
import { countUp, buildCountUpFormatter } from '@codejoo/ticker'
Ticker.extend(countUp())

const ctrl = ticker.countUp(99999, {
  prefix: '¥', suffix: '',
  thousands: ',', decimal: '.', precision: 2,
  duration: 1500, easing: ease.easeCountUp,
  fps: 30,
  el: '#total'   // 可选:每帧自动写入 textContent
}, txt => console.log(txt))

ctrl.update(199999)   // 平滑重定向到新目标
ctrl.remove()
```

### 缓动函数

```ts
import { ease, easeAsymmetricS } from '@codejoo/ticker'

ease.linear
ease.easeInQuad / easeOutQuad / easeInOutQuad
ease.easeOutCubic / easeInOutCubic
ease.easeCountUp           // 非对称 S 曲线(countUp 默认)
easeAsymmetricS(0.3)       // 自定义拐点
```

## 架构

| 文件                | 职责                                                       |
|---------------------|------------------------------------------------------------|
| `Ticker.ts`         | RAF 循环、pause/resume、插件注册入口                       |
| `TickerManager.ts`  | 桶模式 O(1) 调度器(并行数组 + epoch 防重入)                |
| `TickerTask.ts`     | 单任务状态载体                                             |
| `TickerHelper.ts`   | CSS/Transform 工具、缓动函数                               |
| `TickerTween.ts`    | GSAP 风格 tween 引擎                                       |
| `TickerAnimate.ts`  | jQuery 风格 animate 封装层(底层是 Tween)                   |
| `TickerCountDown.ts`| 倒计时 + 元编程 formatter / parser                         |
| `TickerCountUp.ts`  | 金额/数字滚动 + 元编程 formatter                           |

## 构建与测试

```bash
pnpm install
pnpm dev          # vite 开发服务器,加载 index.html
pnpm build        # tsc + vite 库构建 → dist/index.es.js
pnpm test         # vitest run (jsdom 环境)
```

## License

MIT
