# `share`

按 `config.key`（由 [`key`](../key/) 生成）做并发请求去重。多种策略共用一个内核：每个 `(key, 一轮)` 一个 `Promise.withResolvers`，策略决定"哪个 HTTP 有资格 settle 它"。

| 策略 | 行为 |
|---|---|
| `start`（默认） | 相同 key 的并发请求共享**首发**的 HTTP promise，只发一次 HTTP |
| `end` | 后到的请求顶替前面，所有 caller 等**最后一个**的 HTTP 结果 |
| `race` | 每个 caller 各发 HTTP，**第一个成功**的赢家广播给所有 caller（`Promise.any` 语义） |
| `none` | 关闭——等同于没装本插件 |

失败重试请使用独立的 [`retry`](../retry/) 插件，与 `share` 配合即可。

## 配置项

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `enable` | `boolean` | `true` | 插件总开关 |
| `policy` | `SharePolicy` | `'start'` | 默认共享策略；可由 `config.share` 覆盖 |
| `methods` | `string[]` | `['get', 'head']` | 允许参与共享的 method 白名单（不区分大小写）；非白名单 method 默认不去重，避免同 key 的 POST/PUT 被吞。设为 `[]` / `undefined` ⇒ 不限制 method（旧行为）。 |

```ts
import sharePlugin from 'http-plugins/plugins/share';

api.use(buildKey({ fastMode: true }));   // key 生产者
api.use(sharePlugin({ policy: 'start' }));     // share 消费者（必须在 buildKey 之后装）

api.get('/api', { share: false });             // 该请求不参与
api.get('/api', { share: 'race' });            // 策略覆盖
api.get('/api', { share: { policy: 'end' } }); // 对象形式
api.get('/api', { share: () => isCritical() ? 'race' : 'start' });
```

## 实现细节

- 工作在 **adapter 层**，不是请求拦截器层——装载顺序很重要：`key`（请求拦截器）先装，`config.key` 才会在 share 的 adapter 看到请求时已就位
- 共享 promise 在 settle 后立即从 map 移除，下一轮并发会拿到全新 entry
- 没有 `config.key` 时（例如未装 `key` 或本请求短路了）插件会**直接走原 adapter** 不去重——不会死锁，也不会丢请求
