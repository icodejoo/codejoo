# `retry`

失败重试，参考 [ky](https://github.com/sindresorhus/ky) 设计。

- **默认安全**：仅重试**幂等方法**（`get` / `put` / `head` / `delete` / `options` / `trace`）+ **服务端故障状态码**（`408` / `413` / `429` / `500` / `502` / `503` / `504`）
- **指数退避**开箱即用（`300 → 600 → 1200 …` ms），可选 jitter
- 自动解析 **`Retry-After`**、`RateLimit-Reset`、`X-RateLimit-Retry-After`、`X-RateLimit-Reset`、`X-Rate-Limit-Reset`
- **唯一决策钩子** `shouldRetry(response, error)`：优先级最高，可覆盖任意默认规则
- **取消请求绝不重试** —— `axios.isCancel(error)` 在所有逻辑之前短路
- **倒计时计数挂在 `config.__retry`**：`max=3` 时序列为 `3 → 2 → 1 → 0`；`-1` 维持 `-1` 不递减表示无限。字段跨 `axios.request` 调用通过 `mergeConfig` 自动复制；不依赖 `WeakMap`；其他插件用 `isRetry(config)` 在重试请求里 short-circuit

## 快速开始

```ts
import retryPlugin from 'http-plugins/plugins/retry';

api.use(retryPlugin({ max: 3 }));

api.use(retryPlugin({
  max: 5,
  methods: ['post'],         // ← 与默认列表合并，不覆盖
  status: [418],             // ← 合并
  delay: (n) => 100 * 2 ** n,
  delayMax: 5_000,
  jitter: true,
  retryAfterMax: 30_000,     // 限制服务端 Retry-After 的最大值
  retryOnTimeout: true,
  shouldRetry: (response, error) => {
    if (response?.data?.code === 'rate_limited') return true;
    if (error?.code === 'ERR_BAD_REQUEST') return false;
  },
  beforeRetry: async ({ request, retryCount }) => {
    if (retryCount === 1) await refreshToken();
  },
}));
```

## 配置项

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `enable` | `boolean` | `true` | 插件总开关，`false` 跳过整个 install |
| `max` | `number \| boolean` | `2` | `false` / `0` 关闭 · `true` / `undefined` 默认 2 · 正数显式 · `-1` 无限 |
| `methods` | `string[]` | 幂等方法集合 | **与默认合并**——传 `['post']` 只是 add，原 GET/PUT/… 保留 |
| `status` | `number[]` | `[408,413,429,500,502,503,504]` | **与默认合并** |
| `delay` | `number \| (n) => ms` | `0.3 * 2^(n-1) * 1000` | 基础退避 |
| `delayMax` | `number \| (n) => ms` | `Infinity` | 算法延迟封顶 |
| `retryAfterMax` | `number` | `Infinity` | `Retry-After` 头延迟封顶 |
| `jitter` | `boolean \| (d) => ms` | `false` | `true` → `[0, delay)` 随机；或自定义 |
| `retryOnTimeout` | `boolean` | `false` | `ETIMEDOUT` / `ECONNABORTED` 是否重试 |
| `shouldRetry` | `(response, error) => boolean \| null \| void` | — | **最高优先级决策钩子** |
| `beforeRetry` | `(ctx) => unknown` | — | 重试前钩子；返回 `false` 取消，抛异常会用 hook 异常 reject |

### `shouldRetry(response, error)` 唯一决策钩子

| 路径 | 调用 | 返回值含义 |
|---|---|---|
| `onFulfilled`（成功） | `shouldRetry(response, undefined)` | **只有 `true` 才会触发重试**；`false` / `null` / `undefined` → 原样返回 |
| `onRejected` HTTP 错误 | `shouldRetry(error.response, error)` | `true` 重试 · `false` 不重试 · `null` / `undefined` → 走默认规则 |
| `onRejected` 网络错误 | `shouldRetry(undefined, error)` | 同上 |

**决策优先级**（从高到低）：

1. `axios.isCancel(error)` —— 永远胜出，绝不重试
2. `max === 0` —— 不重试
3. **预算耗尽** —— `__retry === 0` 直接 reject，不进入重试流程
4. `shouldRetry` —— `true` / `false` 短路；`null` / `undefined` 继续向下
5. 默认规则：`methods` 白名单 → 错误分类（HTTP `status` / 超时 / 网络）
6. `Retry-After` 头（当 `response.status` 在 `status` 列表内时启用）
7. `beforeRetry` —— 最后取消机会

### 请求级 `config.retry`

```ts
api.get('/api', { retry: 5 });                             // 覆盖 max
api.get('/api', { retry: false });                         // 禁用
api.post('/api', body, { retry: { methods: ['post'] } });  // 显式启用 POST
api.get('/api', { retry: () => isOnline() ? 3 : 0 });      // MaybeFun
```

`config.retry` 是 `MaybeFun<number | boolean | IRetryOptions>`。性能：当 `config.retry` 为 `undefined` / `true` / 等价标量时，`$merge` 直接**按引用返回插件级配置**（零分配）。请求级覆盖只有真正改变字段时才分配新对象。

## `config.__retry` 倒计时计数

```ts
import { isRetry, RETRY_KEY } from 'http-plugins';

api.use({
  name: 'my-plugin',
  install(ctx) {
    ctx.request((config) => {
      if (isRetry(config)) return config;  // 重试请求里跳过本插件
      // ... 做昂贵的幂等工作（重写路径、计算 key、剥离空字段等）
      return config;
    });
  },
});
```

`max=3` 序列：首发失败时 `__retry=3`，每次重试后递减（`2 → 1 → 0`）。处理器读到 `__retry === 0` 即知预算耗尽 reject。`max=-1` 初始化为 `-1` 且永不递减。

已 opt-in 此短路的内置幂等插件：

- [`key`](../key/) —— 指纹只在首发时计算一次
- [`filter`](../filter/) —— params/data 只过滤一次
- [`reurl`](../reurl/) —— 路径变量只替换一次；baseURL/url 分隔符只规整一次

故意**不跳过**（每次重试都需运行）：

- [`cache`](../cache/) —— TTL 可能在两次尝试间过期
- [`cancel`](../cancel/) —— 每个请求需要新的 `AbortController`（命名组意图会跨重试持久化，详见 cancel/README）
- [`loading`](../loading/) —— 必须保持全局计数准确
- [`share`](../share/) —— adapter 层
- [`normalize`](../normalize/) —— 也要规整化重试回来的响应

## 在 attempt 入口的跨插件短路

两个 `bag` 标记会让 retry 在某些场景**不再叠加**重试预算 —— 避免跟其他插件的重发机制冲突：

| 标记 | 设置方 | 为什么 retry 跳过 |
|------|--------|-------------------|
| `__raceSettled` (`SHARE_SETTLED_KEY`) | [`share`](../share/)（race policy） | caller 已经从共享 promise 拿到赢家响应 —— 自己再重试是浪费带宽 |
| `_refreshed` (`AUTH_REFRESHED_KEY`) | [`auth`](../auth/)（Refresh / Replay） | 这次 dispatch 是 auth 的重发尝试。没这个短路，`retry: { max: 3 }` 会变成"3 retries × (1 + N 次 auth 刷新)"的隐性叠加 |

两个检查都在 `$attempt(...)` 最顶部：标记为 true → 直接重置 `__retry` 并原样返回响应。

## 备注

- 重试通过 `ctx.axios.request(config)` 重新进入完整链路，**所有非短路插件每次重试都会跑一遍**（让 `cache` / `share` / `normalize` 等正确处理重试结果）
- 任何终态（成功 / 最终失败 / 取消 / `beforeRetry === false`）都会 `delete config.__retry`，让同一个 config 对象之后再次发起独立请求时计数从零开始
- 无限重试（`max: -1`）必须搭配会在某些条件下返回 `false` 的 `shouldRetry`，否则会死循环
