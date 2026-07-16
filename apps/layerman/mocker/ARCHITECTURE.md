# Mocker 架构文档

## 项目概述

**@codejoo/mocker** 是一个轻量级的前端 Mock 服务器，集成为 Vite 插件，基于装饰器的路由定义，支持热重载、代理回源、认证、场景分支等功能。

## 核心架构

```
前端代码 (API 请求)
    ↓
Vite 开发服务器
    ↓
[Mocker 插件]
    ├─ HTTP 拦截器
    ├─ 路由匹配 (装饰器定义)
    │  ├─ GET /api/users
    │  ├─ POST /api/users
    │  └─ 动态路由 /api/users/:id
    ├─ 场景分支
    │  ├─ 成功场景
    │  ├─ 失败场景
    │  └─ 自定义场景
    ├─ 认证检查
    │  └─ 权限验证
    ├─ 文件监听 (Hot Reload)
    │  └─ 重新加载处理器
    └─ 代理策略
        ├─ Mock 匹配 → 返回 Mock 数据
        └─ 无匹配 → 代理到真实服务器
        ↓
    HTTP 响应
        ↓
    前端代码处理
```

## 主要特性

### 1. **Vite 插件集成**
- 无缝集成到 Vite 开发流程
- 只在开发环境激活
- 自动拦截 API 请求

### 2. **装饰器路由**
```typescript
@GET('/api/users')
@POST('/api/users')
@PUT('/api/users/:id')
@DELETE('/api/users/:id')
```
- 直观的装饰器语法
- 自动类型推导
- 支持动态路由参数

### 3. **场景管理**
- 支持多个响应场景
- 通过查询参数切换场景
- 支持条件响应
- 可模拟各种状态（成功/错误/超时）

### 4. **热重载**
- 修改 Mock 处理器后自动重载
- 无需重启开发服务器
- 实时生效

### 5. **代理回源**
- 未匹配的请求自动代理到真实服务器
- 支持环境变量配置
- 支持自定义代理规则

### 6. **认证支持**
- 支持 Bearer Token 验证
- 支持自定义认证策略
- 支持跨域请求（CORS）

## 文件结构

```
src/
├── index.ts                 # Vite 插件导出
├── core/
│   ├── interceptor.ts      # HTTP 拦截器
│   ├── router.ts           # 路由匹配引擎
│   ├── handler.ts          # 请求处理器
│   └── types.ts            # 类型定义
├── decorators/
│   ├── http-methods.ts     # GET/POST/PUT/DELETE
│   ├── middleware.ts       # 中间件装饰器
│   └── validators.ts       # 验证装饰器
├── scenarios/
│   ├── manager.ts          # 场景管理器
│   └── conditions.ts       # 条件判断
├── auth/
│   ├── strategies.ts       # 认证策略
│   └── validators.ts       # 认证验证
├── proxy/
│   ├── forward.ts          # 代理转发
│   └── rules.ts            # 代理规则
├── plugins/
│   └── vite.ts             # Vite 插件实现
└── utils/
    ├── matcher.ts          # 路由匹配工具
    └── ...                 # 其他工具
```

## 核心流程

### 1. 插件配置
```typescript
// vite.config.ts
import { mocker } from '@codejoo/mocker/vite'

export default {
  plugins: [
    mocker({
      mocks: './src/mocks',
      proxy: {
        '/api': 'http://localhost:3001'
      },
      auth: {
        enabled: true,
        tokenKey: 'Authorization'
      }
    })
  ]
}
```

### 2. 定义 Mock 处理器
```typescript
// src/mocks/users.ts
import { GET, POST, PUT, DELETE } from '@codejoo/mocker/helpers'

@GET('/api/users')
export const getUsers = (req, scenario) => {
  if (scenario === 'error') {
    return { status: 500, body: { message: 'Server error' } }
  }
  return { 
    status: 200, 
    body: [{ id: 1, name: 'John' }] 
  }
}

@POST('/api/users')
export const createUser = (req) => {
  return { 
    status: 201, 
    body: { id: 2, ...req.body } 
  }
}

@PUT('/api/users/:id')
export const updateUser = (req) => {
  const { id } = req.params
  return { 
    status: 200, 
    body: { id, ...req.body } 
  }
}

@DELETE('/api/users/:id')
export const deleteUser = (req) => {
  return { status: 204 }
}
```

### 3. 请求处理流程

```
HTTP 请求来临
    ↓
[路由匹配]
    ├─ 按 URL 和方法匹配
    ├─ 支持动态参数解析
    └─ 返回匹配的处理器
    ↓
[认证检查]
    ├─ 验证 Token（如需要）
    └─ 无效则返回 401
    ↓
[场景分支]
    ├─ 读取查询参数中的 scenario
    ├─ 传递给处理器
    └─ 处理器根据场景返回不同数据
    ↓
[执行处理器]
    ├─ 调用对应的处理器函数
    └─ 返回响应数据
    ↓
[响应返回]
    ├─ 设置状态码和响应头
    └─ 返回给前端
    ↓
[如果无匹配]
    └─ 代理到真实服务器
```

## 场景管理

```typescript
// 使用场景参数
fetch('/api/users?scenario=error')  // 触发错误场景
fetch('/api/users?scenario=empty')  // 触发空数据场景
fetch('/api/users')                 // 默认成功场景
```

## 热重载流程

```
文件变化事件
    ↓
[文件监听器检测]
    ├─ chokidar 监听 mocks 目录
    └─ 文件变化时触发
    ↓
[重新加载处理器]
    ├─ 清除之前的路由注册
    ├─ 重新导入模块
    └─ 重新扫描装饰器
    ↓
[下一个请求应用新处理器]
    └─ 无需重启服务器
```

## 代理配置

```typescript
mocker({
  proxy: {
    '/api': 'http://localhost:3001',
    '/ws': {
      target: 'http://localhost:3002',
      pathRewrite: { '^/ws': '/socket' }
    }
  }
})
```

## 与其他项目的关系

- **@codejoo/axp**: Mocker 可为 AXP 提供 Mock 数据
- **Vite**: 作为 Vite 插件集成
- **Hono**: 底层使用 Hono 框架处理 HTTP

## 参考

- [README.md](./README.md)
- [源代码](./src)
- [示例](./example)
