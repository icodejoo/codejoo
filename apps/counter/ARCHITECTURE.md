# Counter 架构文档

## 项目概述

**@codejoo/counter** 是一个计数动画引擎，基于共享的 RAF (requestAnimationFrame) 定时器，支持 countUp/countDown 功能，提供可树摇的渲染插件（Card、Odometer、Ring）。

## 核心架构

```
应用代码
    ↓
[Counter 引擎]
    ├─ 共享 RAF 定时器 (全局单例)
    ├─ Counter 实例管理
    │  ├─ countUp(target, duration, options)
    │  └─ countDown(target, duration, options)
    └─ 缓动函数 (easing functions)
        ↓
    [状态更新]
        ├─ 当前值
        ├─ 目标值
        └─ 动画进度
        ↓
    [渲染插件]
        ├─ Card 插件 (卡片样式)
        ├─ Odometer 插件 (里程表样式)
        ├─ Ring 插件 (环形进度条)
        └─ Vue 插件 (Vue 组件集成)
        ↓
    DOM 更新
        ↓
    用户看到的动画
```

## 主要特性

### 1. **共享 RAF 定时器**
- 所有 Counter 实例共享一个全局 RAF 循环
- 减少浏览器重排/重绘次数
- 优化性能

### 2. **计数功能**
- `countUp`: 从当前值数到目标值
- `countDown`: 从当前值倒数到目标值
- 支持自定义持续时间、缓动函数、回调

### 3. **缓动动画**
- 内置多种缓动函数（linear、easeIn、easeOut 等）
- 支持自定义缓动函数
- 平滑的动画过渡

### 4. **渲染插件系统**
- **Card 插件**: 数字卡片样式，支持自定义样式
- **Odometer 插件**: 里程表翻盘效果
- **Ring 插件**: 环形进度条样式
- 插件可独立加载，支持树摇

### 5. **Vue 集成**
- 提供 Vue 3 组件
- 响应式数据绑定
- 简化在 Vue 项目中的使用

## 文件结构

```
src/
├── index.ts                 # 核心导出
├── core/
│   ├── ticker.ts           # 共享 RAF 定时器
│   ├── counter.ts          # Counter 核心类
│   ├── easing.ts           # 缓动函数
│   └── types.ts            # 类型定义
├── plugins/
│   ├── card.ts             # Card 渲染插件
│   ├── odometer.ts         # Odometer 渲染插件
│   ├── ring.ts             # Ring 渲染插件
│   └── vue.ts              # Vue 组件插件
├── css/
│   ├── card.css            # Card 样式
│   └── ring.css            # Ring 样式
└── utils/
    └── ...                 # 工具函数
```

## 核心流程

### 初始化
```typescript
import { createCounter } from '@codejoo/counter'

const counter = createCounter({
  initial: 0,
  duration: 1000,      // 1秒
  easing: 'easeOut'
})
```

### 执行计数
```typescript
// 数到 999
await counter.countUp(999)

// 从 999 倒数到 0
await counter.countDown(0)
```

### 数据流

1. **初始化阶段**
   - 创建 Counter 实例
   - 初始化状态（当前值、目标值）
   - 启动共享 RAF 定时器

2. **动画阶段**
   - RAF 每帧调用回调函数
   - 计算缓动进度 (0 → 1)
   - 根据进度和缓动函数计算当前值
   - 调用 onUpdate 回调

3. **渲染阶段**
   - 渲染插件接收当前值
   - 插件更新 DOM（或其他 UI 层）
   - 浏览器绘制最终结果

4. **完成阶段**
   - 动画达到目标值
   - 触发 onComplete 回调
   - 保留最终值

## 性能优化

### 1. **共享 RAF**
```typescript
// 而不是每个 Counter 都创建一个 RAF
const ticker = new Ticker()
counter1.setTicker(ticker)
counter2.setTicker(ticker)
counter3.setTicker(ticker)
// 三个 Counter 共用一个 RAF，性能更优
```

### 2. **树摇优化**
- 只导入需要的插件
- 未使用的插件代码会被树摇删除
```typescript
import { createCounter } from '@codejoo/counter'
import { CardPlugin } from '@codejoo/counter/card'  // 只导入 Card 插件

const counter = createCounter()
counter.use(new CardPlugin())
```

### 3. **批量更新**
- 共享 RAF 确保所有计数器在同一帧内更新
- 减少浏览器重排次数

## 扩展性

### 添加自定义渲染插件
```typescript
class MyPlugin {
  bind(counter) {
    this.counter = counter
    this.counter.on('update', (value) => {
      // 自定义渲染逻辑
      console.log('Current value:', value)
    })
  }

  unbind() {
    this.counter.off('update')
  }
}
```

### 自定义缓动函数
```typescript
counter.countUp(999, {
  easing: (t) => {
    // 自定义缓动逻辑
    // t: 0 → 1 (动画进度)
    return t * t  // 二次方缓动
  }
})
```

## 与其他项目的关系

- **@codejoo/ticker**: 可能共享 RAF 定时器逻辑
- **应用层**: 提供数字动画能力

## 参考

- [README.md](./README.md)
- [源代码](./src)
- [测试用例](./test)
