# `normalize`

**全链路归一化** —— 把 axios 的所有 settle 形态（成功 / HTTP 错误 / 网络 / 超时 / cancel / 业务错误）统一塌缩成 `response.data: ApiResponse` 然后 **resolve**。下游所有插件 / 业务都看到同一种形态。

- **必须最先 use 装载 adapter**（虽然不再有全局强校验，但 `requirePlugin('normalize')` 由 retry / rethrow / notification / auth 各自调用）
- **永远 resolve**：业务 `try/catch` 不再需要分支处理 `AxiosError` / `CanceledError` / `AxiosResponse`
- 配套 `rethrow` 在链尾按需把 `ApiResponse` reject 给业务

## 快速开始

```ts
import normalizePlugin, { NETWORK_ERR_CODE } from 'http-plugins/plugins/normalize';

api.use([
  // success 是函数 + 必传 —— 没有默认值
  normalizePlugin({ success: (apiResp) => apiResp.code === '0000' }),
  // ... retry / share / loading / notification / rethrow
]);

const r = await api.get('/api/foo')();
if (r instanceof ApiResponse && !r.success) {
  if (r.code === NETWORK_ERR_CODE) { /* 网络问题 */ }
}
```

## 配置项

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `success` | `(apiResp: ApiResponse) => boolean` | **无（必传）** | 成功裁决函数；接收已组装好的 `ApiResponse`（`.success=false` 起步），返回 boolean 决定最终成功状态 |
| `codeKeyPath` | `string \| (resp, err) => unknown` | `'code'` | 业务码字段定位（字符串路径相对 `response.data`） |
| `messageKeyPath` | `string \| function` | `'message'` | 业务消息字段定位 |
| `dataKeyPath` | `string \| function` | `'data'` | 业务数据字段定位 |
| `httpErrorCode` | `string` | `'HTTP_ERR'` | HTTP 4xx/5xx 但服务端无 envelope 时的占位 code |
| `networkErrorCode` | `string` | `'NETWORK_ERR'` | 网络错误占位 code |
| `timeoutErrorCode` | `string` | `'TIMEOUT_ERR'` | 超时占位 code |
| `cancelCode` | `string` | `'CANCEL'` | 用户取消占位 code |

> ⚠️ 旧版本支持的标量 / 数组形态 `success` 已删除；旧版本插件级 `nullable` / `emptyable` 也已**删除** —— 这些语义现在由用户自己实现进 `success` 函数，或通过请求级 `config.nullable` / `config.emptyable` 二次覆盖。

## 成功裁决流程

```text
1. 抽 envelope 三元组（code / message / data），构造 ApiResponse(success=false) —— 先假定失败
2. error 路径（network / 4xx 5xx 无 envelope / timeout / cancel）→ 保持 success=false
3. 否则调 success 函数（请求级覆盖后的）：apiResp.success = success(apiResp)
4. 如果**请求级未提供** success，但提供了 `nullable` 或 `emptyable`：
     - data 是 null/undefined ⇒ 用请求级 `nullable` 强制覆盖 apiResp.success
     - data 是空容器（{} / [] / ''）⇒ 用请求级 `emptyable` 强制覆盖
   （请求级提供了 success ⇒ 完全裁决，nullable/emptyable 不参与）
```

## 归一化矩阵

| 场景 | 归一化结果 |
| --- | --- |
| HTTP 2xx + envelope | `ApiResponse` 后调 `success(apiResp)`，由用户决定 |
| HTTP 4xx/5xx 带 envelope | `ApiResponse` 走 success 函数（一般会判 code 命中失败） |
| HTTP 4xx/5xx 无 envelope | `ApiResponse(success=false, code='HTTP_ERR')` |
| 网络错误（断网 / DNS） | `ApiResponse(status=0, code='NETWORK_ERR', success=false)` |
| 超时 | `ApiResponse(status=0, code='TIMEOUT_ERR', success=false)` |
| 用户 abort | `ApiResponse(status=0, code='CANCEL', success=false)` |

`ERR_CODES` 常量从 `http-plugins/objects/ApiResponse` 导出，用 `===` 精确比对。

## 请求级覆盖

```ts
// 1. 请求级 success 函数 ⇒ 完全裁决，nullable/emptyable 不参与
ax.get('/x', {
  normalize: { success: (a) => a.status === 200 },
});

// 2. 请求级 nullable / emptyable ⇒ 与插件级 success 共同决策
//    顶层简写
ax.get('/heartbeat',  { nullable: true });   // null data 强制视为成功
ax.get('/list-empty', { emptyable: true });  // 空容器强制视为成功
//    嵌套写法（顶层优先级更高）
ax.get('/x', { normalize: { nullable: true, emptyable: false } });

// 3. 跳过归一化（特殊场景，如下载流 / SSE）
ax.get('/download', { normalize: false });
```

**优先级**：请求级 `success` > 顶层 `nullable`/`emptyable` > `normalize.{nullable,emptyable}` > 插件级 `success`。

## 常见模式

### 严格模式：null/empty data 视为失败

```ts
normalizePlugin({
  success: (a) =>
    a.code === '0000' &&
    a.data != null &&
    !(typeof a.data === 'object' && Object.keys(a.data).length === 0),
});
```

### 宽松模式：仅看业务码

```ts
normalizePlugin({ success: (a) => a.code === '0000' });
// → null/empty data 也视为成功
```

### 默认严格 + 单次放行

```ts
normalizePlugin({
  success: (a) => a.code === '0000' && a.data != null,
});

// 探活接口默认就允许 null data：
ax.get('/heartbeat', { nullable: true });
```

## 与 `rethrow` 的分工

- `normalize` 决定 `apiResp.success`（先假定 false → 调 success 函数 → 请求级 nullable/emptyable 二次覆盖）
- `rethrow` 装在链尾，根据 `apiResp.success` 决定**是否** reject 给业务
- 业务调用方拿到的永远是 `ApiResponse`：成功在 `try` 分支，失败在 `catch` 分支
