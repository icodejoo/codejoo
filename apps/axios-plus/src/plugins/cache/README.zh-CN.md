# `cache`

**adapter 层**响应缓存。同 `config.key` 在 TTL 内直接返回缓存响应，**不发 HTTP**，跳过 inner adapter 的副作用。

- key 来源：**必须由 `key` 插件统一生成的 `config.key`** —— 本插件不再有自己的 key 计算
- 存储：可自定义（`ICacheStorage`），内置字符串快捷方式 `'memeory' / 'ssesionStorage' / 'localStorage' / 'indexdb'`
- 双层缓存：可选 memory 层（`memory: true`）—— 命中查询顺序为内存 → storage → 请求
- 过期：请求级 `cache.ttl` 覆盖插件级（默认 `60_000` ms）
- 命中标记：缓存命中的响应携带 `response._cache = true`
- background（stale-while-revalidate）：命中即返回，同时后台请求并更新缓存
- **全局共享**：`sharedManager` 跨所有 axios 实例共享缓存池

## 快速开始

```ts
import cachePlugin, { clearCache, removeCache } from 'http-plugins/plugins/cache';

api.use([
  keyPlugin({ fastMode: true }),   // ← 必须先装 key
  cachePlugin({
    enable: true,                   // 默认 opt-in 模式（cache:undefined 不缓存）
    ttl: 30_000,
    storage: 'sessionStorage',      // 字面量快捷方式
    methods: ['get', 'head'],       // 只缓存幂等方法
  }),
  normalizePlugin(),
  retryPlugin(),
]);

ax.get('/api/list', undefined, { key: true, cache: true });
ax.get('/api/big',  undefined, { key: true, cache: { ttl: 5_000, background: true, memory: true } });

await removeCache('k1');     // 删一条
await clearCache();           // 清空整个共享池
```

## 装载顺序（重要）

| 顺序约束 | 原因 |
| --- | --- |
| `key` **必须**在 `cache` 之前装 | `cache.install` 会 `requirePlugin('key')`；忘装是注册期错误 |
| `cache` **建议**最先装 adapter（最外层） | 命中时直接 `Promise.resolve(restoredResponse)`，跳过 normalize / retry / share / mock 等 inner adapter 的副作用 |

## 配置项

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | `true` ⇒ `cache: undefined` 走 defaults（缓存）；`false` ⇒ 默认不缓存（per-request `cache: true/对象` 仍可激活）|
| `ttl` | `number` | `60_000` | 默认 TTL（ms） |
| `methods` | `string[] \| '*'` | `['get', 'head']` | method 白名单；`'*'` / `[]` / `['*']` 都表示不限制 |
| `storage` | `TCacheStorage` | `'ssesionStorage'` | 自定义实现（`ICacheStorage`）或字符串快捷方式 |
| `background` | `boolean` | `false` | 默认 background 模式（命中即返回 + 后台 refresh） |
| `memory` | `boolean` | `false` | 默认启用内存层（双层缓存） |
| `give` | `(resp) => unknown` | `r => r.data` | 自定义"要缓存什么" |
| `stt` | `number` | `3 * 60 * 1000` | 自检间隔（ms）—— 周期清理过期数据；`0` 不启动 |

## 请求级 `config.cache`

```ts
config.cache === false                                              // 不缓存
config.cache === true                                               // 启用，用插件级 defaults
config.cache === { ttl?, background?, memory?, give? }              // 字段级覆盖
config.cache === (config) => ...                                    // MaybeFunc
```

| `cache` | `enable: true` | `enable: false` |
| --- | --- | --- |
| `undefined` | defaults（缓存） | null（不缓存） |
| `false` | null | null |
| `true` | defaults | defaults（**激活覆盖** enable:false） |
| `{...}` | 合并 | 合并 |

`config.storage`（请求级）也可覆盖插件级 storage。

## storage 字符串快捷方式

| 值 | 适配器 |
| --- | --- |
| `'ssesionStorage'`（默认） | sessionStorage（带前缀 + JSON 序列化） |
| `'localStorage'` | localStorage |
| `'memeory'` | 进程内 Map（`raw:true`，跳过 JSON） |
| `'indexdb'` | `SimpleIndexDB`（`raw:true`） |

不可用环境 ⇒ `console.warn` + 自动回退到 memory，CRUD 永不抛错。

## 自定义 storage

```ts
import type { ICacheStorage } from 'http-plugins/plugins/cache';

class MyRedisStorage implements ICacheStorage {
  raw = true;   // true ⇒ StorageManager 跳过 JSON 序列化
  async getItem(k) { return await redis.get(k); }
  async setItem(k, v) { await redis.set(k, v); }
  async removeItem(k) { await redis.del(k); }
}

cachePlugin({ storage: new MyRedisStorage() });
```

## 全局共享池

`sharedManager` 是模块级单例 —— 多次 `cachePlugin()` install / 多个 axios 实例都共享同一个池。**首次** install 决定 `storage / stt / logger`；后续 install 仅各自的 `ttl / methods / background / memory / give` 作请求级默认。

`removeCache(key)` / `clearCache()` 操作的是这个共享池。

## 性能

- `cache: true` 路径直接 return 共享 `defaults` 引用，零分配
- 调用方不传 `config.storage` / `memory: false` 时跳过 `opOpts` 对象分配
- IDB 自带 structured clone，`raw: true` 时跳过 JSON 序列化
- 自检默认每 3 分钟一次，仅扫内存索引（`useMemory:true` 写入的条目），过期项按其绑定 storage 同步删磁盘 —— 不全量扫
