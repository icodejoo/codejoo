# `rethrow`

**链尾 reject 插件** —— `normalize` 把所有 settle 形态归一为 onFulfilled 后，业务 caller 用 `try/catch` 抓不到错误；`rethrow` 把失败响应**重新 reject**，恢复直观语义。

## 核心契约

| 响应形态 | rethrow 行为 |
| --- | --- |
| `apiResp.success === true` | **永远 resolve**，rethrow 完全不动 —— 不改变接口本身的行为 |
| `apiResp.success === false` | **默认 reject**，业务 caller 走 `.catch` 拿到 ApiResponse |

`success === true` 路径上 rethrow 是无操作 —— 任何配置（包括 `config.rethrow:true`、`shouldRethrow`）都不能让成功响应变成 reject。这是为了让"接口本身的行为"与 rethrow 是否启用无关。

- 依赖 `normalize`：`requirePlugin('normalize')`，response 拦截器读 `response.data: ApiResponse`
- 链中**只有它能产生 onRejected**，所有其他插件都在 onFulfilled 工作

## 快速开始

```ts
import rethrowPlugin from 'http-plugins/plugins/rethrow';

api.use([
  // ...
  normalizePlugin(),
  retryPlugin(),
  notificationPlugin({ ... }),
  rethrowPlugin({
    shouldRethrow: (apiResp) => apiResp.code === 'CANCEL' ? false : null,  // CANCEL 不当错处理
  }),
]);

// 业务调用方
try {
  const res = await api.get('/users')();
  console.log(res.data);   // ApiResponse —— success===true
} catch (apiResp) {
  toast(apiResp.message ?? '请求失败');   // ApiResponse —— success===false
}

// 单次让失败也 resolve（如非关键探活，业务不想 try/catch）
api.get('/heartbeat', { rethrow: false });
```

## 配置项

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | 总开关；`false` ⇒ 整个插件不安装 |
| `shouldRethrow` | `(apiResp, response, config) => boolean \| null \| undefined` | 无 | 自定义裁决；**仅在 success===false 时调用**。返回 `false` 让本次失败也 resolve；`true` / `null` / `undefined` ⇒ 走默认 reject |
| `transform` | `(apiResp, response) => any` | 无 | 自定义 reject 值；不传 ⇒ 直接 reject `apiResp` |

## 裁决规则

```text
0. apiResp.success === true        → resolve（契约不可破，下面都不执行）
1. config.rethrow === false        → resolve（请求级豁免）
2. shouldRethrow(...) === true     → reject
3. shouldRethrow(...) === false    → resolve
4. shouldRethrow(...) === null/undefined / 未配置 → 走默认
5. else                            → reject
```

## 请求级配置

```ts
declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     *   - false  → 本次失败也 resolve（豁免）
     *   - true / 未指定 → 走默认（失败 reject）
     *   - 函数 (config) => boolean —— MaybeFun
     *
     * 不支持"强制 reject success===true 响应"——契约保证不动成功响应。
     */
    rethrow?: MaybeFunc<boolean | null | undefined>;
  }
}
```

## 推荐 use() 顺序

**永远是最后一个**。原因：

```ts
api.use([
  // ... 请求侧 + adapter 层
  normalizePlugin(),       // 1. 归一化所有 settle 形态
  retryPlugin(),           // 2. 失败时重试
  notificationPlugin(),    // 3. 把成功 / 失败弹通知
  rethrowPlugin({ ... }),  // ← 最后决定 reject vs resolve
]);
```

如果 `rethrow` 不在最后，被它 reject 的 ApiResponse 进了下游 onRejected，下游没人接 —— `try/catch` 还是能拿到，但中间插件失去了对成功 / 失败响应同等处理的能力。

## `transform`：自定义 reject 值

```ts
class HttpError extends Error {
  constructor(public api: ApiResponse, public response: AxiosResponse) {
    super(api.message ?? 'request failed');
  }
}

rethrowPlugin({
  transform: (apiResp, response) => new HttpError(apiResp, response),
});

// 业务侧
try {
  await api.get('/x')();
} catch (e) {
  if (e instanceof HttpError) {
    console.error(e.api.code, e.response.status);
  }
}
```

## 升级提示（旧版本兼容）

旧版本曾有 `onError` 和 `nullable` 选项 —— 它们破坏"不改成功响应行为"契约，已删除：

| 旧用法 | 新等价 |
| --- | --- |
| `rethrowPlugin({ onError: false })` | `rethrowPlugin({ shouldRethrow: () => false })` 或对个别请求传 `rethrow: false` |
| `rethrowPlugin({ nullable: false })`（成功+null data 也 reject） | **`nullable` 已移到 normalize**：`normalizePlugin({ nullable: false })` —— 由 normalize 把 null data 标记为 `apiResp.success=false`，然后 rethrow 自然 reject |
| `config.nullable` per-request | 仍可使用 —— 但现在归 normalize 处理：见 [normalize README](../normalize/README.zh-CN.md) |
| `config.rethrow: true` 强制 reject 成功响应 | 已废除：契约保证 `success===true` 永远 resolve |
