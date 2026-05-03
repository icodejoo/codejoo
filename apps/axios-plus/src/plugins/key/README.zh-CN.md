# `key`

为每个请求生成稳定、确定性的指纹。`cache`、`share`、`retry` 的日志都把这个字符串作为请求维度。

- **FNV-1a** 流式哈希，单遍递归处理 `method` + `url`（deep 模式还包括 `params` + `data`）
- **两种模式**：`fastMode: true`（仅 `method+url`，亚微秒级）vs `fastMode: false`（完整请求，即使大 payload 也 sub-ms）
- **长字符串采样**：> 64 字符的字符串采头/中/尾 + 长度，避免对大 token 做 O(N) 哈希，碰撞概率仍然极低
- **幂等短路**：重试请求（`isRetry(config) === true`）下拦截器提前 return —— 首发已经算过 key，`method+url(+params/data)` 是稳定输入

## 快速开始

```ts
import keyPlugin from 'http-plugins/plugins/key';

api.use(keyPlugin({ fastMode: true }));   // 全局默认

// 请求级
api.get('/api', { key: true });           // 走插件级默认
api.get('/api', { key: 'deep' });         // 该次强制 deep 哈希
api.get('/api', { key: 'manual-key-v1' }); // 写死字符串
api.get('/api', { key: { fastMode: false, ignoreKeys: ['ts'] } });
```

## 配置项

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `enable` | `boolean` | `true` | 插件总开关 |
| `fastMode` | `boolean` | `false` | `true` 仅 `method+url`，`false` 完整 deep |
| `ignoreKeys` | `any[]` | — | 这些 key 的 value 不被当作"空值"过滤 |
| `ignoreValues` | `any[]` | — | 这些 value 不被过滤（`===` 比较，`NaN` 特例） |
| `before(config)` | hook（已废弃） | — | key 计算前调用。**已废弃** —— 请改写自己的 request 拦截器 |
| `after(config)` | hook（已废弃） | — | `config.key` 设置后调用。**已废弃** —— 请改写自己的 request 拦截器 |

## 请求级 `config.key`

```ts
config.key === false / undefined   // → 不生成 key（拦截器短路）
config.key === true                // → 走插件级默认
config.key === 'deep'              // → 强制 deep 模式（仍用插件级 ignore 列表）
config.key === 0                   // → '0'（数字字符串化）
config.key === 42                  // → '42'
config.key === 'fixed-string'      // → 直接当 key 使用（trim 后非空）
config.key === { fastMode, ignoreKeys, ignoreValues } // → 字段级覆盖
config.key === (config) => string  // → 函数形式，取返回值
```

## 为什么需要稳定 key

如果没有统一的请求指纹，`cache`、`share` 这些需要请求等价性判断的插件会各自实现一套 keying 逻辑。集中到本插件后：

- 一处配置（`fastMode` / `ignore*`）
- 统一表示：base-36 字符串，写到 `config.key`
- 其他插件直接读 `config.key`，不重复计算

## 内部细节

- **非加密**哈希——理论上有碰撞，但对典型 HTTP 流量概率极低
- **长字符串采样**（首/中/尾/长度）是哈希经济性的主要 tradeoff。UUID / 短 ID 完全无损；长不透明 token 会损失但长度也参与哈希，结构相似的 token 仍能区分
