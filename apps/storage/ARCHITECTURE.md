# Storage 架构文档

## 项目概述

**@codejoo/storage** 是一个统一、类型安全的浏览器存储封装，支持 localStorage、sessionStorage、IndexedDB，提供 TTL、滑动过期、命名空间、可插拔序列化、混淆编解码等功能。

## 核心架构

```
应用代码 (get/set/del)
    ↓
[Storage 统一接口]
    ├─ 方法签名一致
    ├─ 类型推导
    └─ API 包装
    ↓
[存储适配器选择]
    ├─ 快速存储: localStorage (同步)
    ├─ 会话存储: sessionStorage (同步)
    └─ 大容量: IndexedDB (异步)
    ↓
[键值格式化]
    ├─ 命名空间处理 (prefix:key)
    ├─ 版本号管理
    └─ 键编码
    ↓
[序列化器]
    ├─ 自定义序列化函数
    ├─ 内置支持: Date, Map, Set, BigInt
    └─ 扩展点
    ↓
[加密编解码]
    ├─ 可选的混淆编码
    ├─ 支持自定义 Codec
    └─ 加解密逻辑
    ↓
[TTL 管理]
    ├─ 过期时间计算
    ├─ 滑动窗口（续期）
    └─ 自动清理过期数据
    ↓
[值存储]
    ├─ localStorage/sessionStorage: 字符串
    └─ IndexedDB: 二进制/对象
    ↓
应用读取到的数据
```

## 主要特性

### 1. **多存储后端统一**
- **localStorage**: 持久存储（~5-10MB），同步操作
- **sessionStorage**: 会话存储（~5-10MB），同步操作，关闭标签页自动清除
- **IndexedDB**: 大容量存储（GB 级），异步操作，持久化

### 2. **类型安全**
```typescript
interface User {
  id: number
  name: string
}

// 完全类型推导
const storage = createStorage<User>()
const user = await storage.get('user-1')  // user: User | null
```

### 3. **命名空间**
```typescript
// 避免键冲突
const userStorage = createStorage({
  namespace: 'user:'
})
const settingStorage = createStorage({
  namespace: 'settings:'
})
```

### 4. **TTL 和过期**
```typescript
// 设置过期时间
await storage.set('token', 'abc123', {
  ttl: 3600 * 1000  // 1 小时后自动删除
})

// 滑动过期（访问时续期）
await storage.set('session', sessionData, {
  ttl: 3600 * 1000,
  sliding: true  // 每次访问时重置过期时间
})
```

### 5. **可插拔序列化**
```typescript
// 自定义序列化器
const storage = createStorage({
  serializer: {
    serialize: (value) => JSON.stringify(value),
    deserialize: (str) => JSON.parse(str)
  }
})
```

### 6. **加密和混淆**
```typescript
// 使用混淆编解码
const storage = createStorage({
  codec: {
    encode: (str) => btoa(str),  // Base64 编码
    decode: (encoded) => atob(encoded)
  }
})
```

### 7. **跨标签页同步**
```typescript
// 监听其他标签页的更新
storage.subscribe('key', (newValue, oldValue) => {
  console.log('Value updated:', newValue)
})
```

## 文件结构

```
src/
├── index.ts                 # 主入口
├── core/
│   ├── storage.ts          # Storage 核心类
│   ├── adapters/
│   │   ├─ localstorage.ts  # localStorage 适配器
│   │   ├─ sessionstorage.ts # sessionStorage 适配器
│   │   └─ indexeddb.ts     # IndexedDB 适配器
│   ├── types.ts            # 类型定义
│   └─ constants.ts         # 常量
├── expiry/
│   ├── manager.ts          # 过期管理器
│   ├─ ttl.ts               # TTL 计算
│   └─ cleaner.ts           # 自动清理
├── serialization/
│   ├── serializer.ts       # 序列化器
│   ├─ builtin-types.ts     # 内置类型支持 (Date/Map/Set/BigInt)
│   └─ codec.ts             # 编解码
├── namespace/
│   ├── manager.ts          # 命名空间管理
│   └─ prefix.ts            # 键前缀处理
├── sync/
│   ├── cross-tab.ts        # 跨标签页同步
│   ├─ event-emitter.ts     # 事件发射器
│   └─ storage-event.ts     # Storage 事件监听
└── utils/
    ├─ key-encryptor.ts     # 键加密（可选）
    └─ ...                  # 其他工具
```

## 核心流程

### 1. 初始化
```typescript
import { createStorage } from '@codejoo/storage'

// 基础使用
const storage = createStorage()

// 完整配置
const userStorage = createStorage({
  backend: 'indexeddb',      // 存储后端
  namespace: 'app:user:',    // 键前缀
  ttl: 86400 * 1000,         // 默认 TTL (24h)
  sliding: true,             // 滑动过期
  serializer: { /* ... */ }, // 自定义序列化
  codec: { /* ... */ }       // 加密编解码
})
```

### 2. 数据写入流程

```
应用调用 storage.set(key, value, options)
    ↓
[准备数据]
    ├─ 合并配置（继承默认 TTL 等）
    ├─ 生成键（namespace + key）
    └─ 计算过期时间
    ↓
[序列化]
    ├─ 调用序列化器的 serialize 方法
    ├─ 转换为可存储格式（JSON 字符串或对象）
    └─ 处理特殊类型 (Date/Map/Set/BigInt)
    ↓
[编码]
    ├─ 如果配置了 Codec
    ├─ 执行编码操作（如 Base64）
    └─ 返回编码后的值
    ↓
[构造存储数据]
    ├─ 包含：值、过期时间、版本号
    └─ 元数据（type, size 等）
    ↓
[选择存储后端]
    ├─ 小数据（<1MB）→ localStorage / sessionStorage
    ├─ 中等数据 → IndexedDB
    └─ 特大数据 → 压缩或分块
    ↓
[执行写入]
    ├─ localStorage: setItem(key, JSON.stringify(data))
    ├─ sessionStorage: setItem(key, JSON.stringify(data))
    └─ IndexedDB: db.put(storeName, data)
    ↓
[通知其他标签页]
    ├─ 发起 storage 事件（仅 localStorage/sessionStorage）
    ├─ IndexedDB 需要 BroadcastChannel 通知
    └─ 其他标签页收到更新事件
    ↓
数据写入完成
```

### 3. 数据读取流程

```
应用调用 storage.get(key, options)
    ↓
[准备键]
    ├─ 生成实际键（namespace + key）
    └─ 支持缓存查询
    ↓
[检查过期]
    ├─ 读取存储的过期时间
    ├─ 与当前时间比较
    └─ 已过期则删除并返回 null
    ↓
[读取数据]
    ├─ localStorage: getItem(key)
    ├─ sessionStorage: getItem(key)
    └─ IndexedDB: db.get(storeName, key)
    ↓
[解析元数据]
    ├─ 提取值、过期时间、版本号
    └─ 验证数据完整性
    ↓
[检查滑动过期]
    ├─ 如果启用 sliding 模式
    ├─ 更新过期时间（续期）
    └─ 重新写入存储
    ↓
[解码]
    ├─ 如果配置了 Codec
    ├─ 执行解码操作
    └─ 返回原始数据
    ↓
[反序列化]
    ├─ 调用反序列化器 deserialize 方法
    ├─ 还原特殊类型 (Date/Map/Set/BigInt)
    └─ 返回类型正确的值
    ↓
返回数据给应用
```

### 4. 删除流程

```
应用调用 storage.del(key)
    ↓
[准备键]
    └─ 生成实际键（namespace + key）
    ↓
[执行删除]
    ├─ localStorage: removeItem(key)
    ├─ sessionStorage: removeItem(key)
    └─ IndexedDB: db.delete(storeName, key)
    ↓
[通知其他标签页]
    └─ 发起 storage 事件
    ↓
删除完成
```

## TTL 和滑动过期

```typescript
// 场景：用户会话 Token 管理

// 固定过期：设置后 1 小时内必须有新 Token
await storage.set('token', 'abc123', {
  ttl: 3600 * 1000,  // 1 小时
  sliding: false     // 不滑动
})

// 滑动过期：最后一次访问后 1 小时内自动删除
await storage.set('session', sessionData, {
  ttl: 3600 * 1000,
  sliding: true      // 滑动
})
// 访问时自动续期
const session = await storage.get('session')  // 过期时间重置
```

## 与其他项目的关系

- **@codejoo/layerman**: 使用 Storage 管理冷却状态和跨标签页同步
- **@codejoo/picman**: 使用 Storage 管理缓存配置
- **@codejoo/stomp**: 可用于存储订阅状态和离线消息
- **应用层**: 提供统一的浏览器存储接口

## 参考

- [README.md](./README.md)
- [源代码](./src)
- [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
