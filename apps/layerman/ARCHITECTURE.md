# Layerman 架构文档

## 项目概述

**@codejoo/layerman** 是一个框架无关的无头 (headless) 弹层/对话框/模态框/底部抽屉/侧边栏队列管理器，支持优先级、替换、冷却、条件控制等高级功能。

## 核心架构

```
应用代码 (show/queue)
    ↓
[Layerman 核心]
    ├─ 队列管理器 (Queue Manager)
    │  ├─ 优先级算法 (FIFO/Replace/Overlap)
    │  └─ 队列调度
    ├─ 条件验证 (Conditions)
    │  ├─ 路由条件 (Route)
    │  ├─ 认证条件 (Auth)
    │  └─ 自定义谓词 (Predicate)
    ├─ 冷却管理 (Cooldown)
    │  ├─ 会话级冷却
    │  ├─ 天级冷却
    │  ├─ 时间级冷却 (小时/分钟)
    │  ├─ 总次数限制
    │  └─ 最小间隔
    └─ 存储层 (Storage)
        └─ 跨标签页同步
        ↓
    [渲染层]
        ├─ DOM 操作
        ├─ 框架整合 (React/Vue/Svelte/Solid)
        └─ 动画处理
        ↓
    用户交互
        ↓
    [两阶段关闭]
        ├─ Before Close (清理前)
        └─ After Close (清理后)
        ↓
    下一个队列项目
```

## 主要特性

### 1. **队列管理**
- **FIFO (First In First Out)**: 按顺序显示
- **Replace (替换)**: 新弹层替换旧弹层
- **Overlap (重叠)**: 新弹层覆盖旧弹层（可同时展示多个）
- **Affix (固定)**: 固定在队列中，不被后续覆盖

### 2. **条件控制**
- **路由条件**: 只在特定路由显示
- **认证条件**: 只在认证状态下显示
- **自定义谓词**: 使用自定义函数验证

### 3. **冷却系统**
- **会话级**: 同一浏览器会话内冷却
- **日级**: 每天重置一次
- **时间级**: 小时、分钟级别冷却
- **总次数**: 限制总显示次数
- **最小间隔**: 相邻两次的最小间隔时间
- **跨标签页同步**: 使用 Storage 同步状态

### 4. **无头设计**
- 不包含 UI 逻辑，只管理状态
- 可与任何框架/UI 库集成
- 支持 Vue/React/Svelte/Solid

### 5. **异步 Resolve**
- 弹层操作可异步 resolve
- 支持后端驱动动态内容
- Promise-based API

## 文件结构

```
src/
├── index.ts                 # 核心导出
├── core/
│   ├── manager.ts          # 队列管理器
│   ├── layer.ts            # 弹层对象
│   ├── types.ts            # 类型定义
│   └── constants.ts        # 常量
├── conditions/
│   ├── route.ts            # 路由条件
│   ├── auth.ts             # 认证条件
│   └── predicate.ts        # 自定义谓词
├── cooldown/
│   ├── manager.ts          # 冷却管理器
│   ├── storage.ts          # 冷却存储
│   └── strategies/         # 各种冷却策略
├── adapters/
│   ├── vue.ts              # Vue 适配器
│   ├── react.ts            # React 适配器
│   ├── svelte.ts           # Svelte 适配器
│   └── solid.ts            # Solid 适配器
└── utils/
    └── ...                 # 工具函数
```

## 核心流程

### 初始化
```typescript
import { createLayerman } from '@codejoo/layerman'

const layerman = createLayerman({
  context: {
    route: () => router.currentRoute.value.path,
    isAuth: () => user.value !== null
  }
})
```

### 显示弹层
```typescript
// 基础调用
await layerman.show('dialog-1', {
  type: 'dialog',
  content: { title: '确认', message: '确定吗？' }
})

// 带条件和冷却
await layerman.show('newsletter', {
  content: { /* ... */ },
  conditions: [
    { type: 'route', pattern: '/home' },
    { type: 'auth' }
  ],
  cooldown: {
    session: 1,           // 本会话只显示 1 次
    minGap: 3600 * 1000   // 最小间隔 1 小时
  }
})
```

### 数据流

1. **请求阶段**
   - 用户调用 `show()` 或 `queue()`
   - Layerman 接收弹层配置

2. **验证阶段**
   - 检查条件是否满足 (路由/认证/谓词)
   - 条件不满足则拒绝或推迟

3. **冷却检查**
   - 查询冷却存储
   - 检查是否在冷却期内
   - 在冷却期则启动定时器等待

4. **优先级处理**
   - 根据优先级算法排队
   - FIFO: 加入队列末尾
   - Replace: 关闭当前弹层，显示新弹层
   - Overlap: 保留当前，显示新弹层

5. **显示阶段**
   - 触发渲染（DOM/框架更新）
   - 动画播放
   - 用户交互

6. **关闭阶段**
   - 两阶段关闭流程
   - Before Close: 验证是否可关闭
   - After Close: 清理资源
   - 触发 resolve/reject

7. **下一项处理**
   - 获取队列中的下一项
   - 重复流程

## 跨标签页同步

```typescript
// 冷却状态自动在标签页间同步
// 标签页 A 显示弹层，触发冷却
// 标签页 B 同时检查冷却时，也会遵守冷却规则

// 通过 Storage 事件实现
window.addEventListener('storage', (e) => {
  if (e.key === 'layerman:cooldown') {
    // 更新本地冷却状态
  }
})
```

## 扩展性

### 自定义条件
```typescript
const myCondition = {
  type: 'custom',
  check: (ctx) => {
    // 返回 true 表示条件满足
    return ctx.someValue > 100
  }
}
```

### 自定义冷却策略
```typescript
const customCooldown = {
  name: 'my-strategy',
  checkReady: (state) => {
    // 检查是否可显示
    return Date.now() - state.lastShow > 5000
  },
  record: (state) => {
    // 记录显示状态
    state.lastShow = Date.now()
  }
}
```

## 与其他项目的关系

- **@codejoo/storage**: 用于存储冷却状态和跨标签页同步
- **框架适配层**: 支持 Vue/React/Svelte/Solid 集成
- **路由库**: 需要提供路由上下文

## 参考

- [README.md](./README.md)
- [源代码](./src)
- [测试用例](./test)
