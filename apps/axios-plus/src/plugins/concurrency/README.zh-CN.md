# `concurrency`

**adapter 层**并发控制 —— 限制 axios 实例的最高在飞 HTTP 请求数，超出的进 FIFO 优先级队列等待槽位。

- 队列：`max` 上限；前一个 settle（成功 / 失败）自动唤醒队首
- `max <= 0` ⇒ 无限制（仍装 adapter 但走轻量直通）
- 请求级优先级：`config.priority` 越大越优先；同优先级 FIFO
- 请求级 bypass：`config.concurrency = false` 跳过队列直接发
- abort 友好：在队列中的请求若 `signal.aborted`，自动从队列移除并 reject
- method 白名单：只对 `methods` 内的请求计入并发

## 快速开始

```ts
import concurrencyPlugin from 'http-plugins/plugins/concurrency';

api.use(concurrencyPlugin({ max: 4 }));

// 同一 axios 实例最多 4 个 HTTP 在飞，超出的进队列
ax.get('/list1');
ax.get('/list2');
// ...

// 优先级请求 —— 跳到队列里所有 ≤10 之前
ax.get('/critical', undefined, { priority: 10 });

// 强制绕过限制（如下载大文件，独立通道）
ax.get('/big-download', undefined, { concurrency: false });
```

## 配置项

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | 插件总开关；`false` 时根本不装 adapter |
| `max` | `number` | `999` | 最大并发数；`<= 0` 表示不限制（轻量直通） |
| `methods` | `string[] \| '*'` | `'*'` | 参与并发控制的 method 白名单；`'*'` / `[]` / `['*']` 都表示不限制 |

## 请求级配置

```ts
declare module 'axios' {
  interface AxiosRequestConfig {
    concurrency?: boolean;   // false ⇒ 绕过队列直接发
    priority?: number;       // 排队优先级（数值越大越优先）；默认 0
  }
}
```

| 字段 | 行为 |
| --- | --- |
| `concurrency: false` | 完全 bypass，不计入 active，不排队 |
| `priority: 10`（满槽时） | 跳到队列里所有 priority ≤ 10 的之前 |
| `priority: 10`（空槽时） | 直接拿槽位，priority 无影响 |
| 同优先级 | FIFO（先入先出） |
| 缺省 priority | 视为 0 |

## 推荐 use() 顺序

`concurrency` 在 adapter 层包装请求，**建议放在 `cache` / `mock` 这类"可短路 adapter"之后**：让缓存命中或 mock 命中先返回，**不消耗并发槽位**。

```ts
api.use([
  filterPlugin(),
  keyPlugin(),
  cachePlugin(),                  // 缓存命中不入队 ✓
  mockPlugin(),                   // mock 命中不入队 ✓
  concurrencyPlugin({ max: 4 }),  // 真正出网的请求才占槽位
  normalizePlugin(),
  retryPlugin(),
]);
```

## 设计权衡

- **优先级队列实现**：插入时按 `priority` 降序定位（`O(n)`），出队时 `shift()`（`O(1)`）。N 通常很小（个位数），整体可忽略。
- **abort 监听**：`signal.addEventListener('abort', ..., { once: true })`，命中后自动从队列移除；如果 promise 已被 release 唤醒，重复 reject 是 no-op。
- **release 槽位接力**：前一个释放时不直接 `active--`，而是把 active 计数原封不动地"过户"给队首回调 —— 避免 `active` 抖动到 0 又立即弹回。
