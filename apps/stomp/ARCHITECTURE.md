# Stomp 架构文档

## 项目概述

**@codejoo/stomp** 是一个框架无关的 STOMP-over-WebSocket 客户端封装，基于 @stomp/stompjs，提供共享解析队列、Ref-counted 管理、自动重连、离线缓存、自动应答等功能。

## 核心架构

```
应用代码 (subscribe/send)
    ↓
[Stompsocket 核心封装]
    ├─ 连接管理器 (Connection Manager)
    ├─ 协议处理器 (STOMP Frame Handler)
    ├─ 状态管理器 (State Manager)
    └─ 事件系统 (Event Emitter)
    ↓
[WebSocket 连接]
    ├─ 建立 WebSocket 连接
    ├─ STOMP 握手 (CONNECT 帧)
    └─ 心跳管理
    ↓
[消息处理]
    ├─ 共享解析队列
    │  └─ 多个订阅者共享一个解析器（性能优化）
    ├─ Ref-counted 订阅管理
    │  ├─ 追踪每个订阅者数量
    │  └─ 订阅者为 0 时自动取消订阅
    ├─ 消息确认 (ACK/NACK)
    │  ├─ 自动 ACK
    │  └─ 手动 ACK/NACK
    └─ 消息过滤
    ↓
[离线支持]
    ├─ 离线缓冲队列 (Offline Buffer)
    └─ 重连时自动重新发送
    ↓
[重连管理]
    ├─ 自动重连逻辑
    ├─ 指数退避策略
    ├─ 重新订阅恢复
    └─ 前台恢复检测
    ↓
[应用层回调]
    └─ 用户消息处理函数
```

## 主要特性

### 1. **STOMP 协议支持**
- STOMP 1.0/1.1/1.2 支持
- 完整的 Frame 类型支持
- 自动心跳管理
- 连接超时检测

### 2. **连接管理**
- 自动重连机制
- 指数退避重试策略
- 连接状态观察
- 前台恢复触发重连

### 3. **订阅管理**
- **Ref-counted**: 追踪订阅者数量，自动管理
- **多订阅者支持**: 同一主题多个订阅者
- **动态订阅/取消**: 运行时操作
- **通配符支持**: 支持主题通配符

### 4. **消息处理**
- **共享解析队列**: 多订阅者共享一个解析器，性能优化
- **消息确认**: ACK/NACK 支持
- **自动确认**: 可配置自动应答
- **消息过滤**: 支持条件过滤

### 5. **离线支持**
- **离线缓冲**: 连接断开时缓存待发送消息
- **自动重发**: 重连后自动重新发送
- **顺序保证**: 保证消息发送顺序

### 6. **Token 刷新**
- **BeforeConnect Hook**: 连接前自动刷新 Token
- **无缝续期**: 用户无感知的 Token 更新

## 文件结构

```
src/
├── index.ts                 # 主入口，导出 Stompsocket
├── core/
│   ├── stompsocket.ts      # Stompsocket 核心类
│   ├── connection.ts       # 连接管理
│   ├── frame-handler.ts    # STOMP 帧处理
│   └─ types.ts             # 类型定义
├── queue/
│   ├── shared-parser.ts    # 共享解析队列
│   ├── message-queue.ts    # 消息队列
│   └─ offline-buffer.ts    # 离线缓冲
├── subscription/
│   ├── manager.ts          # 订阅管理器
│   ├─ ref-counter.ts       # Ref-counted 计数
│   └─ subscription.ts      # 订阅对象
├── state/
│   ├── state-manager.ts    # 状态管理
│   ├── reconnect.ts        # 重连策略
│   └─ event-emitter.ts     # 事件发射器
├── hooks/
│   ├── before-connect.ts   # 连接前 Hook
│   └─ interceptors.ts      # 请求/响应拦截
└── utils/
    ├─ logger.ts            # 日志工具
    └─ ...                  # 其他工具
```

## 核心流程

### 1. 创建和连接
```typescript
import { Stompsocket } from '@codejoo/stomp'

const stomp = new Stompsocket({
  brokerURL: 'ws://localhost:15674/ws',
  login: 'user',
  passcode: 'password',
  onConnect: () => console.log('Connected'),
  onDisconnect: () => console.log('Disconnected'),
  beforeConnect: async () => {
    // 刷新 Token
    const token = await refreshToken()
    return {
      login: 'user',
      passcode: token
    }
  }
})

await stomp.connect()
```

### 2. 订阅消息
```typescript
const subscription = await stomp.subscribe('/topic/chat', {
  onMessage: (message) => {
    console.log('Received:', message.body)
    message.ack()  // 手动应答
  }
})

// 取消订阅
await subscription.unsubscribe()
```

### 3. 发送消息
```typescript
// 连接状态下
await stomp.send('/queue/notifications', {}, JSON.stringify({
  type: 'notification',
  content: 'Hello'
}))

// 离线状态下自动缓存，重连后自动发送
```

### 4. 连接流程

```
创建 Stompsocket 实例
    ↓
[连接初始化]
    ├─ 建立 WebSocket 连接
    └─ 状态变为 CONNECTING
    ↓
[BeforeConnect Hook]
    ├─ 执行自定义逻辑（如刷新 Token）
    └─ 返回认证信息
    ↓
[CONNECT 帧]
    ├─ 发送 STOMP CONNECT 帧
    ├─ 包含 login, passcode, accept-version 等
    └─ 等待服务器响应
    ↓
[CONNECTED 帧]
    ├─ 接收 CONNECTED 帧
    ├─ 解析协议版本、服务器信息
    ├─ 状态变为 CONNECTED
    └─ 触发 onConnect 回调
    ↓
[恢复订阅]
    ├─ 遍历之前的订阅列表
    ├─ 重新订阅所有主题
    └─ 恢复之前的状态
    ↓
[离线消息发送]
    ├─ 发送离线缓冲队列中的消息
    └─ 清空缓冲区
    ↓
连接完成，可以订阅和发送消息
```

### 5. 重连流程

```
WebSocket 连接断开
    ↓
[重连管理器]
    ├─ 计算重连延迟（指数退避）
    ├─ delay = min(initialDelay * 2^attempt, maxDelay)
    └─ 启动定时器
    ↓
[等待延迟时间]
    └─ 前台恢复会立即触发重连
    ↓
[尝试重连]
    ├─ 重复连接流程
    └─ 失败后重试
    ↓
[重连成功]
    ├─ 恢复订阅和离线消息
    └─ 用户无感知
```

### 6. 订阅管理 (Ref-counted)

```typescript
// 订阅主题 1
const sub1 = await stomp.subscribe('/topic/news', handler1)
// 此时 ref-count = 1, SUBSCRIBE 帧发送

// 第二个订阅者订阅同一主题
const sub2 = await stomp.subscribe('/topic/news', handler2)
// 此时 ref-count = 2, 不再发送 SUBSCRIBE 帧

// 第一个订阅者取消
await sub1.unsubscribe()
// 此时 ref-count = 1, 不发送 UNSUBSCRIBE 帧

// 最后一个订阅者取消
await sub2.unsubscribe()
// 此时 ref-count = 0, 发送 UNSUBSCRIBE 帧
```

## 消息确认

```typescript
// 自动应答
const sub = await stomp.subscribe('/topic/important', {
  ack: 'auto',  // 自动应答
  onMessage: (msg) => {
    // 消息自动应答
  }
})

// 手动应答
const sub2 = await stomp.subscribe('/queue/tasks', {
  ack: 'client',  // 需要手动应答
  onMessage: (msg) => {
    try {
      // 处理消息
      msg.ack()
    } catch (error) {
      msg.nack()  // 拒绝消息
    }
  }
})
```

## 离线缓冲

```typescript
// 连接断开时
if (!stomp.isConnected()) {
  // 消息自动进入缓冲队列
  await stomp.send('/queue/email', {}, JSON.stringify({
    to: 'user@example.com',
    subject: 'Hello'
  }))
  // 缓冲中，等待重连
}

// 重连成功后
// 缓冲的消息自动发送
```

## 与其他项目的关系

- **@codejoo/storage**: 可用于存储订阅状态和离线消息
- **@codejoo/axp**: 在 beforeConnect 中可以调用 AXP 刷新 Token
- **应用层**: 作为 WebSocket 实时通信的统一入口

## 参考

- [README.md](./README.md)
- [源代码](./src)
- [STOMP 协议](https://stomp.github.io/)
- [@stomp/stompjs 文档](https://stomp-js.github.io/)
