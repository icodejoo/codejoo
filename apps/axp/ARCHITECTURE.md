# AXP 架构文档

## 项目概述

**@codejoo/axp** 是一个基于 axios 的类型安全、插件化 HTTP 客户端库，提供缓存、重试、请求去重、认证刷新、取消、加载状态、Mock、OpenAPI 类型推导等功能。

## 核心架构

```
用户代码 (API 调用)
    ↓
[AXP 核心]
    ├─ 插件系统
    │  ├─ Cache 插件 (缓存管理)
    │  ├─ Retry 插件 (失败重试)
    │  ├─ Share 插件 (请求去重)
    │  ├─ Auth 插件 (Token 刷新)
    │  ├─ Cancel 插件 (请求取消)
    │  ├─ Loading 插件 (加载状态)
    │  ├─ Mock 插件 (模拟数据)
    │  └─ 其他插件
    └─ Axios 实例
        ↓
    [请求拦截器]
        ↓
    [网络请求]
        ↓
    [响应拦截器]
        ↓
    类型安全响应
```

## 主要特性

### 1. **模块化插件系统**
- 每个功能都是独立的插件，可选择性加载
- 支持自定义插件扩展
- 插件之间通过 Hook 机制协作

### 2. **请求管理**
- **缓存插件**: 自动缓存 GET 请求，支持自定义过期时间
- **重试插件**: 失败自动重试，支持指数退避
- **去重插件**: 相同请求只发送一次，其他请求共享结果
- **取消插件**: 支持请求超时和手动取消

### 3. **认证与安全**
- **Auth 插件**: 自动注入 Token，过期自动刷新
- 环境变量管理

### 4. **加载与 UI 反馈**
- **Loading 插件**: 管理全局加载状态
- **通知插件**: 错误提示、成功提示

### 5. **开发辅助**
- **Mock 插件**: 开发阶段使用模拟数据
- **Logger 插件**: 请求/响应日志记录
- **OpenAPI 集成**: 端到端类型推导

## 文件结构

```
src/
├── index.ts                 # 核心导出
├── core/
│   ├── manager.ts          # 核心管理器
│   └── types.ts            # 类型定义
├── plugins/
│   ├── cache.ts            # 缓存插件
│   ├── retry.ts            # 重试插件
│   ├── share.ts            # 去重插件
│   ├── auth.ts             # 认证插件
│   ├── cancel.ts           # 取消插件
│   ├── loading.ts          # 加载插件
│   ├── logger.ts           # 日志插件
│   └── ...
└── utils/
    └── ...                 # 工具函数
```

## 核心流程

### 创建客户端
```typescript
import { createAxp } from '@codejoo/axp'

const axp = createAxp({
  baseURL: 'https://api.example.com',
  plugins: [
    cachePlugin(),
    retryPlugin(),
    sharePlugin(),
    authPlugin({ tokenKey: 'token' })
  ]
})
```

### 发起请求
```typescript
const response = await axp.get('/users')
// 1. 检查缓存
// 2. 检查去重队列
// 3. 执行请求拦截器
// 4. 发送网络请求
// 5. 处理响应拦截器
// 6. 缓存结果
// 7. 返回数据
```

## 数据流

1. **请求阶段**
   - 插件预处理请求配置
   - 执行请求拦截器
   - 发送 HTTP 请求

2. **缓存策略**
   - 检查缓存是否存在且未过期
   - 命中则直接返回
   - Miss 则继续网络请求

3. **去重机制**
   - 相同 URL 和方法的请求进行标准化
   - 相同请求放入队列等待首个完成
   - 后续请求共享首个请求的结果

4. **认证处理**
   - 请求前自动注入 Token
   - 收到 401 触发 Token 刷新
   - 刷新后重试原请求

5. **响应处理**
   - 执行响应拦截器
   - 数据转换与验证
   - 通知加载状态完成

## 扩展性

### 添加自定义插件
```typescript
function myPlugin() {
  return {
    name: 'my-plugin',
    hooks: {
      'request:before': (config) => {
        // 修改请求配置
        return config
      },
      'response:success': (response) => {
        // 处理成功响应
        return response
      }
    }
  }
}
```

## 与其他项目的关系

- **@codejoo/openapi2lang**: 为 AXP 提供类型推导支持
- **@codejoo/storage**: 可用于缓存持久化
- **应用层**: 作为统一的 HTTP 客户端接入点

## 性能考量

- 缓存策略减少网络请求
- 请求去重避免重复计算
- 插件按需加载，减少初始化开销
- 支持请求批处理和并发控制

## 参考

- [README.md](./README.md)
- [源代码](./src)
- [测试用例](./test)
