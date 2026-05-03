# `notification`

**响应级**统一通知插件 —— 把"成功 / 失败"变成可配置的 toast / message / log，业务代码不再到处 `if (res.code === '0000') { ... } else { toast(...) }`。

- 依赖 `normalize`：注册时 `requirePlugin('normalize')`，response 拦截器读 `response.data: ApiResponse`
- 触发条件：`apiResp.success` 决定走成功 / 失败分支
- 跨 retry 幂等：用 Symbol 在 settle 值上打标，防止 retry 完整重入链路时重复弹通知
- 请求级关闭：`config.notification = false` 禁用本次的通知
- 自定义 `notify` 函数：业务侧实现实际的 UI 交互（toast、控制台、modal 等）

## 快速开始

```ts
import notificationPlugin from 'http-plugins/plugins/notification';

api.use([
  normalizePlugin(),
  notificationPlugin({
    notify: (msg, ctx) => {
      // 业务自定义的 UI 调用
      if (ctx.success) toast.success(msg);
      else toast.error(msg);
    },
    messages: {
      onSuccess: false,           // 默认不弹成功
      onBizError: '操作失败',     // 业务错（success=false）
      onHttpError: '服务异常',    // HTTP 4xx/5xx
      onNetworkError: '网络异常',
      onTimeout: '请求超时',
    },
  }),
]);

// 业务代码不再写通知，全交给插件
const res = await ax.post('/order', { ... });

// 单次禁用通知
await ax.post('/silent-action', undefined, { notification: false });
```

## 配置项

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | 总开关 |
| `notify` | `(msg, ctx) => void` | 无 | 通知执行函数；`msg` 是要展示的文本，`ctx` 携带 ApiResponse / response / config / 决策类型 |
| `messages` | 对象 | `{}` | 各场景的默认消息文案，见下表 |
| `shouldNotify` | `(ctx) => boolean \| undefined` | 无 | 自定义"是否通知"裁决；返回 `true` / `false` 强制；返回 `undefined` 走默认规则 |

### `messages` 字段

| 字段 | 触发条件 | 类型 |
| --- | --- | --- |
| `onSuccess` | `success === true` | `string \| TNotifyMessage \| false` |
| `onBizError` | `success === false`，业务码 | 同上 |
| `onHttpError` | HTTP 4xx/5xx（normalize 分类）| 同上 |
| `onNetworkError` | 断网 / DNS / 拒连 | 同上 |
| `onTimeout` | axios 超时 | 同上 |
| `onCancel` | 用户主动 abort | 同上 |

每个字段可以是：
- `string` —— 固定文案
- `false` —— 不通知
- `TNotifyMessage`（函数）—— `(ctx) => string \| false`，动态决定文案

## 请求级 `config.notification`

```ts
config.notification === false                 // 禁用本次通知
config.notification === true / 未指定           // 走插件级默认
config.notification === { onSuccess?: '...' }  // 字段级覆盖
config.notification === (ctx) => ...           // MaybeFunc，动态返回上述任一形式
```

## 推荐 use() 顺序

`notification` 在 response 拦截器工作，**必须在 `normalize` 之后** —— 它读 `response.data: ApiResponse`。`retry` 也在 response 拦截，建议把 `notification` 放 `retry` 之后，让重试期间不弹通知，最终结果才弹一次。

```ts
api.use([
  // ... 请求拦截 / adapter 层
  normalizePlugin(),
  retryPlugin(),
  notificationPlugin({ ... }),    // ← 重试结束后才看到最终结果
  rethrowPlugin(),                // 最后做 reject 决策
]);
```

## 跨 retry 防重弹

retry 重入完整插件链路意味着每次都会重新进 notification 的 response 拦截器。插件用一个 module-level `Symbol('http-plugins:notification:notified')` 在 settle 值上打标 —— 第一次通知后打标，后续看到打标的就跳过。**这意味着 retry 失败的中间过程不会弹，只有最终的 settle 值会触发一次通知**。
