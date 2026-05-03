# `filter`

请求发出前，剥离 `params` / `data` 中的空字段（`null` / `undefined` / `NaN` / 空白字符串）—— 保持服务端日志、签名、缓存 key 干净。

```ts
import filterPlugin from 'http-plugins/plugins/filter';

api.use(filterPlugin());                                       // 默认
api.use(filterPlugin({ ignoreKeys: ['ts'] }));                 // 即使为空也保留 `ts`
api.use(filterPlugin({ predicate: ([k, v]) => v === 0 }));     // 自定义丢弃规则

api.get('/api', undefined, { filter: true });                          // 走插件级默认
api.get('/api', undefined, { filter: false });                         // 跳过过滤
api.get('/api', undefined, { filter: { ignoreValues: [0] } });         // 请求级覆盖
```

## 配置项

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | 总开关；`false` 时拦截器装但 runWhen 永远 false |
| `predicate` | `(kv) => boolean` | `defaultPredicate` | "丢弃"判定（返回 true ⇒ 丢） |
| `ignoreKeys` | `string[]` | — | 指定 key 命中即保留，无视 predicate |
| `ignoreValues` | `any[]` | — | 指定 value 命中即保留（含 NaN 特例） |
| `deep` | `boolean` | `false` | 是否递归过滤嵌套对象 / 数组 |

## 请求级 `config.filter`

```ts
config.filter === false / null / 0 / ''   // 跳过该请求
config.filter === true / undefined         // 走插件级默认
config.filter === { ignoreKeys?, ... }     // 字段级覆盖
config.filter === (config) => ...          // MaybeFun
```

## 默认行为

- 默认只过滤顶层一层。嵌套对象由 `key` 在哈希时再做深度遍历；双重遍历是浪费 CPU。如需对嵌套结构也递归过滤，传 `deep: true`（或请求级 `filter: { deep: true }`）—— 递归过滤后的空对象 / 空数组保持为空容器，不会被当成"空"丢弃。
- **重试请求短路**：`isRetry(config) === true` 时拦截器提前 return —— 首发已过滤，重试时 params/data 已稳定。
- `defaultPredicate` 与 `key` 的默认空值过滤语义对齐，两个插件对"什么算空"的判断保持一致。

## opt-in 默认

`runWhen: (config) => enable && isEnabled(config.filter)` —— 只有显式 `config.filter` 为 truthy 时拦截器才跑。要让所有请求默认走过滤，可以在外层包装拦截器或全局 `axios.defaults.filter = true`。
