# `cancel`

**全局共享**的请求登记表（跨所有 axios 实例），按 `aborter` 字段分组，配合 `cancelAll()` 一键中止活跃请求。

- `cancelAll()` —— 清所有分组（一次性清场）
- `cancelAll('group')` —— 仅清命名组（如登出时清 `auth` 组）
- 模块级 `Map<string, Set<AbortController>>`，settle 后自动从分组移除

## 快速开始

```ts
import cancelPlugin, { cancelAll } from 'http-plugins/plugins/cancel';

api.use(cancelPlugin());

// 默认组：cancelAll() 一次清场
ax.get('/list');
cancelAll();

// 命名组：登出时清鉴权相关请求
ax.get('/me', undefined, { aborter: 'auth' });
cancelAll('auth', 'logout');

// 自管 controller：手动中止 + 仍可被 cancelAll 命中
const ctrl = new AbortController();
ax.get('/big', undefined, { aborter: ctrl });
ctrl.abort();

// 完全不参与
ax.get('/realtime', undefined, { aborter: false });
```

## 配置项

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | 总开关；`false` 不安装拦截器 |

## 请求级 `aborter` 四态语义

| 值 | 行为 |
| --- | --- |
| `false` | 跳过插件，不接管也不登记 |
| `true` / 未指定 | 默认组；用户已有 `signal` / `cancelToken` 时尊重不接管 |
| `string` | 命名组（强制接管 signal） |
| `AbortController` | 用 user 提供的 ctrl + 登记默认组 |

## API

```ts
cancelAll(group?: string, reason?: string): number
```

- 不传 `group` ⇒ 清空所有分组（默认 + 命名）
- 传 `group` ⇒ 仅清该命名组（默认组传 `'__default__'`）
- 不影响 `aborter:false` / 用户自带 signal / cancelToken 的请求 —— 它们没登记

## 推荐 use() 顺序

`cancel` 只在 request 拦截器附加 signal、response 阶段释放 controller。一般可以放在 request 链中靠前位置：

```ts
api.use([
  filterPlugin(),
  keyPlugin(),
  cachePlugin(),
  cancelPlugin(),     // ← 早装，确保所有出网的请求都登记
  normalizePlugin(),
  retryPlugin(),
]);
```

## 与其他插件互动

- **retry**：取消产生的归一化错误 `code: 'CANCEL'` 在 retry 默认行为中**永不重试**（即使 shouldRetry 返回 true 也不会）
- **share**：被 cancel 的请求若是共享 promise 的首发，所有 caller 都收到相同的归一化 CANCEL
- **normalize**：把 `CanceledError` / abort 错误统一成 `ApiResponse(code='CANCEL', success=false, status=0)`，`try/catch` 不会拿到原始 axios 错误

## 重发场景（`retry` / `auth`-refresh / `auth`-replay）保留分组

请求拦截器首次跑就会消费 `config.aborter` 并把 controller 注册到对应分组。当**同一**配置被 `retry` / `auth.Refresh` / `auth.Replay` 重发时，原 `aborter` 字段已经不在 —— 没保护的话重发就会被悄悄落到默认组。

本插件用一个隐藏字段 `_cancel_intent` 持久化"可重建的意图"，让重发能恢复到原分组：

| 首发的 `aborter` | 持久化的 `_cancel_intent` | 重发时的行为 |
|---|---|---|
| `'payment'`（命名组） | `'payment'` | 重发时新建 `AbortController` 仍注册到 `'payment'` |
| `false`（明确不参与） | `false` | 重发同样跳过 |
| `true` / `null` / `undefined` | （不持久化） | 重发按默认组规则走 —— 结果一致 |
| `AbortController` 实例 | （不持久化） | 用户提供的 ctrl 一旦 abort 就废了不能复用；重发回到默认组。需要跨重发分组请改用命名组字符串 |

实际语义：`cancelAll('payment')` 能可靠中止 `'payment'` 组里**所有**活跃请求，**包括**这些请求的 retry / auth refresh 重发。
