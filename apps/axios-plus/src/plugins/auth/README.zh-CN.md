# `auth`

**鉴权 / token 刷新插件** —— 把"401 → refresh → 重放"的并发刷新协议沉淀到框架，业务无需自己写 token 互斥逻辑。

- 依赖 `normalize`：`requirePlugin('normalize')`；响应拦截器读 `response.data: ApiResponse`
- 受保护请求由 `methods × urlPattern` 取交集判定（可叠加 `isProtected` 函数 + 请求级 `config.protected: boolean` 覆盖）
- **单一决策路由器** `onFailure: (tm, response) => AuthFailureAction` —— 5 路枚举分发（`Refresh / Replay / Deny / Expired / Others`），取代旧的 `shouldRefresh / isDeny / isExpired` 三谓词链
- **并发刷新协议**：模块内单一 `refreshing` promise —— 同一时刻最多 1 个 `onRefresh` 在跑，所有受保护请求加入同一 refreshing 窗口
- **stale-token 自动重放**：refresh 完成后才到货的、用旧 token 发出的响应会自动用新 token 重发，且**不**重复触发 `onRefresh`

## 快速开始

```ts
import { authPlugin, normalizePlugin, retryPlugin, rethrowPlugin, TokenManager } from 'http-plugins';

const tm = new TokenManager();   // 或自己实现 ITokenManager

api.use([
  normalizePlugin({ success: (a) => a.code === '0000' }),
  authPlugin({
    enable: true,
    tokenManager: tm,

    // 哪些 method × URL 组合受保护
    methods: '*',                                                // 默认 '*'
    urlPattern: ['/api/users/*', '/api/orders/*', '!/api/users/login'],

    // 请求级单次覆盖：config.protected: boolean | (config) => boolean

    // 刷新实现 —— 任何**非 false** 返回都算成功（包括 undefined）
    onRefresh: async (tm, response) => {
      const { data } = await axios.post('/auth/refresh', { rt: tm.refreshToken });
      tm.set(data.accessToken, data.refreshToken);
      // 不显式 return ⇒ undefined，视为成功
    },

    onAccessExpired: async (tm, response) => {
      router.replace('/login');
    },

    onAccessDenied: async (tm, response) => {
      toast.error('权限不足');
    },

    // 可选：每次受保护请求发出前附加 header（或其他签名）
    ready: (tm, config) => {
      config.headers!.Authorization = tm.accessToken;
    },
  }),
  retryPlugin(),
  rethrowPlugin(),
]);
```

## 配置项

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | 总开关 |
| `tokenManager` | `ITokenManager` | **必传** | 提供 `accessToken / refreshToken / set / clear / toHeaders` |
| `methods` | `string \| string[]` | `'*'` | HTTP method 白名单；`'*'` 全通配（fast-path） |
| `urlPattern` | `string \| string[]` | `'*'` | `URLPattern` pathname 语法 + gitignore 风格 `!` 否定 |
| `isProtected` | `(config) => boolean \| null` | — | 在 `methods × urlPattern` 之上再叠加一层函数判定（返回 `null/undefined` 落到下一层） |
| `accessDeniedCode` | `string` | `'ACCESS_DENIED'` | 受保护请求无 `accessToken` 时合成 ApiResponse 的业务码 |
| `onFailure` | `(tm, response) => AuthFailureAction \| null` | `DEFAULT_ON_AUTH_FAILURE` | 单一响应路由器（见下） |
| `onRefresh` | `(tm, response) => unknown` | **必传** | 刷新实现。返回 `false` / 抛错 ⇒ 失败；**其他任何值**（包括 `undefined`） ⇒ 成功 |
| `onAccessExpired` | `(tm, response) => void` | **必传** | 刷新失败 / 重发后仍 401 / 401 兜底 时调用 |
| `onAccessDenied` | `(tm, response) => void` | aliased to `onAccessExpired` | 已认证但权限不足（默认 403 路径） |
| `ready` | `(tm, config) => void` | — | 受保护请求发出前的钩子（附加 header / 签名 / 等） |

## `onFailure` & `AuthFailureAction`

```ts
import { AuthFailureAction, DEFAULT_ON_AUTH_FAILURE, authFailureFactory } from 'http-plugins';

enum AuthFailureAction {
  Refresh = 'refresh',  // → 调 onRefresh，成功后用同一 config 重发
  Replay  = 'replay',   // → 不调 onRefresh，直接用同一 config 重发
  Deny    = 'deny',     // → 调 onAccessDenied，原响应原样传播
  Expired = 'expired',  // → tm.clear() + onAccessExpired，原响应原样传播
  Others  = 'others',   // → 与本插件无关，原样传播（null/undefined/void 等同此值）
}
```

默认实现 `DEFAULT_ON_AUTH_FAILURE`（= `authFailureFactory('Authorization')`）的路由表：

| 条件 | 动作 |
|------|------|
| 状态非 401/403 | `Others` |
| `tm.accessToken` 为空 | `401: Expired` / `403: Deny` |
| 请求当时**未携带** token | `Replay`（用 tm 当前 token 重发） |
| 携带 token 与当前一致 | `Refresh` |
| 携带 token 与当前不一致（stale） | `Replay` |

### 三种自定义模式

**1. 业务码扩展（基于默认 + 早返回）**

```ts
import { AuthFailureAction, DEFAULT_ON_AUTH_FAILURE } from 'http-plugins';

onFailure: (tm, resp) => {
  if (resp.data?.code === 'TOKEN_EXPIRED') return AuthFailureAction.Refresh;
  return DEFAULT_ON_AUTH_FAILURE(tm, resp);
}
```

**2. 换 header 名**

```ts
import { authFailureFactory } from 'http-plugins';

onFailure: authFailureFactory('X-Token'),
ready: (tm, config) => { (config.headers as any)['X-Token'] = tm.accessToken; },
```

**3. 完全自实现** —— 多 header 联合签名 / JWT payload 等价 / cookie 比对 / etc.

```ts
onFailure: (tm, resp) => { /* 返回任意 AuthFailureAction */ }
```

## 并发刷新协议

```
所有受保护请求 → check refreshing
                   ├─ refreshing 进行中 → await refreshing
                   │                       ├─ 成功 → 用新 token 继续
                   │                       └─ 失败 → 抛错，中断本请求
                   └─ refreshing 空 → 用 tm.accessToken 直接发

某请求收到失败响应 → onFailure 路由：
  → Refresh → $startOrJoinRefresh
                ├─ refreshing 空 → 启动新的 onRefresh
                └─ refreshing 已有 → 等同一个
              ↓
              成功 → 用同 config 重放（标 `_refreshed = true`）
              失败 → onAccessExpired
  → Replay  → 不刷新，直接用同 config 重发（同样标 `_refreshed = true`）
  → Deny    → onAccessDenied，原响应原样传播
  → Expired → tm.clear() + onAccessExpired，原响应原样传播
  → Others  → 原样传播
```

**核心保证**：同一时刻最多一个 `onRefresh`；同窗口的所有 401 共享同一个 refresh。

## 重放路径：新 token 通过 `ready` 注入

`Refresh` / `Replay` 都通过 `ctx.axios.request(config)` 重发 —— **整个拦截器链重新跑一遍**，包括 auth 请求拦截器自己。第二轮会再调你的 `ready` 钩子，新写入的 `tm.accessToken` 会被附加到重发请求上。

默认 `ITokenManager.toHeaders()` 返回 `{ Authorization: <accessToken> }`。常见 `ready` 一行：

```ts
ready: (tm, config) => Object.assign(config.headers ??= {}, tm.toHeaders() ?? {}),
```

自定义 TM 重写 `toHeaders()` 把 token 放到任意位置（`X-Token` / `Cookie` / 多 header 签名），同一个 `ready` 自动适配。

## 跨插件重发协议（retry / replay 行为）

三个隐藏字段挂在 `config` 上保证重发行为正确（跨插件契约，全部定义在 `helper.ts`）：

| 字段 | 持有方 | 用途 |
|------|--------|------|
| `_protected` (`AUTH_PROTECTED_KEY`) | auth（每次尝试） | 标记"本请求已被识别为受保护"；每次终态响应清理 |
| `_refreshed` (`AUTH_REFRESHED_KEY`) | auth | `Refresh` / `Replay` 重发前置标记。auth 自身防回环 + **被 `retry` 读取**避免在 auth 重发上叠加新的重试预算 |
| `_auth_decision` (`AUTH_DECISION_KEY`) | auth | 缓存 `isProtected(config)` 结果。跨 retry / replay 重发存活，避免请求级 `protected: false` 在第一轮被消费后丢失 |

`retry` 插件在 attempt 入口检查 `_refreshed`：为 true → 短路放行。这样 `retry: { max: 3 }` 始终是**总共 3 次**，不会变成"3 次 retry + auth refresh + 又 3 次 retry" 的叠加（详见 [retry/README.zh-CN.md](../retry/README.zh-CN.md) "auth 联动"段落）。

`cancel` 插件类似地持久化 `aborter` 意图（`_cancel_intent`），让 `aborter: 'payment'` 标记的请求在所有 retry / refresh / replay 重发上仍属于 `'payment'` 组；`cancelAll('payment')` 能正确命中。

## 注意

- `protected` 顶层选项在新 API 中拆成 `methods × urlPattern × isProtected`，旧代码 `protected: ['/...']` 应迁移到 `urlPattern: ['/...']`。
- `shouldRefresh / isDeny / isExpired` 已被单一 `onFailure` 路由器取代。迁移：把分散判定改写成 `switch` 返回 `AuthFailureAction`。
- `onRefresh` 不再要求显式 `return true`；副作用风格的实现（调用 refresh API + `tm.set(...)` 后无显式返回）也算成功，仅 `return false` / 抛错才算失败。
