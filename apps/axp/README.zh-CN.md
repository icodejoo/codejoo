# @codejoo/axp

中文 | [English](./README.md)

基于 `axios` 的插件式 HTTP 客户端。`Axp.install` 把插件装到任意
`AxiosInstance` 上；`Axp.create`/`Core` 是可选的类型化派发层——类型系统完全
由你自己决定要不要用，从不强制。

```bash
npm i @codejoo/axp   # peer dep: axios
```

入口：
- `@codejoo/axp`：不打包的 ESM，和各插件子路径 `@codejoo/axp/cache`、`/cancel`、`/auth` 等共用同一份模块状态，混着导入没问题。
- `@codejoo/axp/min`：单文件压缩版，**自带一份独立的模块**，不要和根入口或子路径混用。

类型推断需要 TypeScript ≥ 5.4。

## 快速开始

```ts
import axios from 'axios';
import { Axp, axpKey, axpCache, axpShare, axpRetry } from '@codejoo/axp';

const axiosInstance = axios.create({ baseURL: '/api' });

Axp.install(axiosInstance, {
  key: axpKey(),
  cache: axpCache({ expires: 30_000 }),
  share: axpShare(),
  retry: axpRetry({ max: 2 }),
});

const res = await axiosInstance.get('/pet/findByStatus', { params: { status: 'available' }, key: true, cache: true });
```

想要 path/payload/response 的类型推断而不是裸 `axios` 调用？把同一个实例
包一层 `Axp.create`（见下）——`Axp.install` 用法完全一样，反正它只需要一个
裸的 `AxiosInstance`。

## `Axp.create` —— 可选的类型化派发层

```ts
import { Axp } from '@codejoo/axp';

const api = Axp.create<MySchema>(axios.create({ baseURL: '/api' }));
const pets = await api.get('/pet/findByStatus')({ status: 'available' });  // → MySchema['get']['/pet/findByStatus'][0]
await api.post('/pet')({ name: 'lassie', photoUrls: [] });
```

`Axp.create<T = unknown>(axiosInstance = axios.create(), options?): Core<T>`。
`T` 可以是**任意**形如 `MethodSchema`（见 `src/types.ts`）的类型——手写、你
自己的 codegen、`@codejoo/openapi2lang` 生成的类型都行；axp 只按 schema 的实际键检查结构形状（没有索引签名的 `interface` 也能用），
不要求任何全局命名空间。codegen 还没覆盖到的接口，可以复制
`types/local/example.d.ts.template`：它在 `MethodRefs` 基础上扩展出 `LocalMethodRefs`，作为 `T` 传进来即可。不传 `T`（或者干脆不用 `Axp.create` 这层包装）就是
未类型化客户端——所有路径退化为 `string`。

每个 HTTP 动词（`get` `post` `put` `patch` `delete` `head` `options`）调用形式为
`api.<verb>(path, methodConfig?)(payload?, callConfig?)`。写操作动词把
`payload` 当 `data` 发，其余当 `params`。

| 调用 | 返回 |
| --- | --- |
| `verb(path)(payload)` | 已拆包的业务数据（`{ code, data, message }` 信封的 `data`；非信封响应原样返回） |
| `verb(path)(payload, { raw: true })` | 完整信封 `{ code, data, message }` |
| `verb(path)(payload, { wrap: true })` | `AxpResponse<R>` 实例（非信封响应原样放进它的 `data`） |

`api.axios` 是底层的 `AxiosInstance`——传给 `Axp.install` 用。
`api.extends(overrides?)` 派生一个子 `Core`：克隆 `axios.defaults` 后合并
`overrides`。不会带走插件：子实例拿到的是父实例未经插件包装的底层 adapter，
cache、loading、mock 的状态都不会带过去。派生实例需要插件的话，自己对 `child.axios` 再调
一次 `Axp.install`。

## `Axp.install` —— 插件编排

```ts
const handle = Axp.install(axiosInstance, { key: axpKey(), cache: axpCache() });
```

接受一个裸的 `AxiosInstance`——`axios.create()` 的返回值，或者如果你也用了
`Axp.create`，就是 `api.axios`。把传入的插件按固定顺序装上去，返回一个
`AxpHandle`：

| 成员 | 签名 | 用途 |
| --- | --- | --- |
| `axios` | `AxiosInstance` | 传入的实例 |
| `plugins` | `readonly Plugin[]` | 当前顺序的快照 |
| `plugin(name)` | `(string) => Plugin \| undefined` | 按 `.name` 查找 |
| `dispose()` | `() => void` | 卸载这个 handle 追踪的全部插件 |
| `prepend(p)` / `append(p)` | `(Plugin) => void` | 在已追踪集合前/后再装一个 |
| `insertBefore(anchor, p)` / `insertAfter(anchor, p)` | `(Plugin, Plugin) => void` | 相对某个已追踪插件插入；`anchor` 不在追踪集合里则抛错 |

```ts
import { Axp, axpKey, axpCache, axpLogger } from '@codejoo/axp';

const handle = Axp.install(axiosInstance, { key: axpKey(), cache: axpCache() });

handle.plugin('axp:cache');           // → 上面传入的 axpCache() Plugin 对象
handle.append(axpLogger({ debug: true }));       // 加到这个 handle 追踪集合的最后
handle.prepend(myOwnPlugin);                     // 加到这个 handle 追踪集合的最前

const cachePlugin = handle.plugin('axp:cache')!;
handle.insertBefore(cachePlugin, myOwnPlugin2);  // 相对某个已追踪插件插入

handle.dispose();                     // 卸载这个 handle 追踪的每一个插件
```

`AxpPlugins` 插槽：`logger` `envs` `key` `filter` `repath` `auth` `cancel`
`retry` `notify` `normalize` `cache` `share` `mock` `loading`。留空（或传假值）即跳过该插件。

adapter 层的插件（`cache` `share` `mock` `loading`）各自占 adapter 链上的一层，各层可以按任意顺序卸载：
卸载一个 handle，不会误摘别的 handle 的层，也不会把已经卸载的层装回来。

---

## 插件

每个插件都接受 `{ enable?: boolean }`（默认 `true`），下面的表省略它。"请求字段"
按次请求设置，例如 `api.get(p)(payload, { cache: true })`。

### `axpLogger(options?)`
给其它插件打开 debug 日志。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `debug` | `boolean` | `false` |
| `logger` | `PluginLogger`（`log`/`warn`/`error`） | `console` |

```ts
axpLogger({ debug: true })
```

### `axpKey(options?)`
计算去重/缓存 key，写到 `config.key`。给 `axpCache`/`axpShare` 用。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `fastMode` | `boolean` | `key:true` 时为 `true`，对象形式为 `false` |
| `ignores` | `any[]` | — （豁免空值过滤的键名或值，对齐 dioman 的 `DiomanKey.ignores`） |
| `sample` | `boolean` | `false`（超 64 字符的字符串采样而非全量） |
| `before` / `after` | `(config) => any` | — |
| `scope` | `string \| number \| (config) => string \| number \| null \| undefined` | — （并入每个 key，缓存和共享不会跨账号、跨租户串数据） |

`Date`、`URLSearchParams` 按内容参与哈希。无法可靠区分内容的值（`FormData`、`Blob`、`Map`、`Set`、
没有可枚举字段的类实例）**不生成 key**，这样的请求既不缓存也不共享。宁可没命中，也不能命中错的。

请求字段 `key`：`true` \| `'deep'` \| `number` \| `string` \| `IKeyObject` \| `(config) => …`。

```ts
axpKey({ fastMode: false })
api.get('/list')(undefined, { key: true })
```

### `axpCache(options?)`
TTL 响应缓存，adapter 层短路（命中不打 HTTP）。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `expires` | `number`（ms） | `60_000` |
| `key` | `(config) => string \| undefined` | 回退到 `config.key` |
| `clone` | `'shallow' \| 'deep' \| (data) => any` | — （共享引用） |
| `max` | `number` | `500`，超出后淘汰最久未用的条目；每次写入时顺带清理过期项（传 `Infinity` 表示不限） |
| `shouldCache` | `(response) => boolean` | 非 2xx 和业务失败的信封不缓存（判定规则和 `axpNormalize` 一致） |

请求字段 `cache`：`false` \| `true` \| `{ expires?, key?, clone?, shouldCache? }`。另导出
`removeCache(ax, key)`、`clearCache(ax)`。

- **快照**：缓存存的是 adapter 返回的原始响应，每次命中都给一个新外壳，所以 `transformResponse` 每次命中只执行一次。
- **新旧顺序**：发起较早、返回较慢的响应不会覆盖较新的结果。
- **clearCache**：会让已经在途的请求返回后不再写回缓存。登出或切换账号时调用它，或者给 `axpKey` 配上 `scope`。
- **刷新 token 时不清缓存**：用户没变，缓存仍然有效。

```ts
axpCache({ expires: 30_000 })
api.get('/list')(undefined, { key: true, cache: true })
removeCache(api.axios, 'some-key')
clearCache(api.axios)
```

### `axpShare(options?)`
对同一个 `config.key` 的并发请求去重/防抖/合并。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `policy` | `'start' \| 'end' \| 'race' \| 'none'` | `'start'` |

请求字段 `share`：`false` \| `true` \| 策略字符串 \| `{ policy? }` \| `(config) => …`。

每个调用方都各自保留自己的 `signal`、`cancelToken`、`timeout`：取消某个跟随者，只有它自己立即被拒，共享的那个请求照常进行。
请求失败时，每个调用方拿到的都是独立的 error 对象，`config` 也是自己的。

```ts
axpShare({ policy: 'start' })
api.get('/list')(undefined, { key: true, share: true })
```

### `axpRetry(options?)`
失败（或响应被判定为业务异常）后按 `delay` 等待、重发，最多 `max` 次。每次重发都是一次独立的**尝试**：
- 用 `transformRequest` 之前的原始请求体，自定义转换每次尝试只执行一次，不会层层叠加；
- 经过 `axpAuth` 的尝试钩子：注入最新 token，重试途中遇到 401 会先刷新再重放；
- 不会重新进入插件链的其余部分：notify、normalize 对一个逻辑请求只触发一次，auth 重放也不会让重试次数翻倍。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `max` | `number` | `0`（不重试） |
| `methods` | `string[]` | `['get','put','head','delete','options','trace']`——硬性否决，`shouldRetry` 说了也不算 |
| `shouldRetry` | `(response?, err?) => boolean \| undefined` | — （不设默认值；返回明确 true/false 就采用，undefined 退回 `statusCodes`） |
| `statusCodes` | `number[]` | `[408, 429, 500, 502, 503, 504]` |
| `delay` | `number \| (current, max, response?, err?) => number \| false \| void \| null` | `3000`（函数返回非 number 视为 `0`） |
| `jitter` | `true \| (delay: number) => number` | — （不抖动） |
| `delayMax` | `number` | `Infinity` |
| `respectRetryAfter` | `boolean` | `true` |
| `afterStatusCodes` | `number[]` | `[413, 429, 503]`——只有这些状态码才信 `Retry-After` 头 |
| `retryAfterMax` | `number` | `Infinity` |

请求字段 `retry`：`number`（最大重试次数） \| `false`（禁用，最高优先级否决） \| `true`（尊重插件默认） \| `IRetryOptions`（按字段覆盖上面任意默认值，也可用 `enable: false` 代替 `false`）。

判定优先级，每级都能提前否决：（1）`retry: false` / `{ enable: false }` → 永不重试；（2）`methods` 白名单 → 方法不在表里直接否决，`shouldRetry` 说了也不算；（3）`shouldRetry?.(response?, err?) ?? statusCodes.includes(status) ?? false`。

等待期间会监听 `config.signal`——请求被取消（比如通过 `axpCancel`）会立刻停止等待，不会空等到定时器触发。响应带 `Retry-After` 头（数字秒或 HTTP-date）且状态码在 `afterStatusCodes` 内时，优先听它而不算 `delay`；换算出的等待由 `retryAfterMax` 封顶，且不叠加 `jitter`/`delayMax`（这两个只管本插件自己算出来的 delay）。

```ts
axpRetry({ max: 3, statusCodes: [500, 502, 503, 504], jitter: true, delayMax: 10_000 })
api.get('/flaky')(undefined, { retry: 3 })
api.get('/flaky')(undefined, { retry: { max: 2, shouldRetry: (r) => r?.data?.code !== 0 } })
api.get('/flaky')(undefined, { retry: false }) // 本次调用永不重试
```

### `axpNotify(options)`
把响应/错误转成一句消息，回调出去（比如弹 toast）。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `notify` | `(message: string) => void` | **必填** |
| `stringify` | `(data, message, status, config) => string` | **必填**（返回 `''` 表示不通知） |

```ts
axpNotify({
  notify: (msg) => toast.error(msg),
  stringify: (data, message, status) => (status >= 400 ? message : ''),
})
```

### `axpLoading(options?)`
全局请求计数 loading 开关。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `loading` | `(visible: boolean) => any` | — |
| `delay` | `number` | `0`——0→1 后延迟显示，期间计数回落到 0 则直接取消（快请求从不显示） |
| `delayClose` | `number` | `0`——1→0 后延迟隐藏，期间新请求把计数顶回 1 则取消隐藏（连续请求不闪一下） |

按**逻辑请求**计数：同一个请求的多次重试和 auth 重放，只算一对显示、隐藏，两次尝试之间不会闪烁。
`loading` 回调抛错会被隔离，请求和计数都不受影响。卸载插件时会取消还没触发的延迟回调。

请求字段 `loading`：`false`（跳过） \| `true` \| `(visible) => any` \| `{ enable?, loading?, delay?, delayClose? }`（按字段覆盖，`enable: false` 等价于顶层 `false`）。

```ts
axpLoading({ loading: (v) => setSpinner(v), delay: 200, delayClose: 200 })
api.get('/list')(undefined, { loading: true })
api.get('/quiet')(undefined, { loading: { delay: 0 } }) // 这次调用跳过防闪烁延迟
```

### `axpAuth(options)`
令牌守卫 + 401/403 单飞刷新重放。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `tokenManager` | `ITokenManager` | **必填** |
| `onRefresh` | `(tm, resp) => any` | **必填**（`false`/抛错 = 失败） |
| `onAccessExpired` | `(tm, resp) => void` | **必填** |
| `methods` / `urlPattern` | `string \| string[]` | `'*'` |
| `isProtected` | `(config) => boolean \| void` | — |
| `onFailure` | `(tm, resp) => AuthFailureAction \| void` | `DEFAULT_ON_AUTH_FAILURE` |
| `onAccessDenied` | `(tm, resp) => void` | → `onAccessExpired` |
| `ready` | `(tm, config) => void` | 注入 `Authorization` 头 |
| `accessDeniedCode` | `string` | `'ACCESS_DENIED'` |

请求字段 `protected`：`boolean` \| `(config) => boolean \| void`。

- **取消**：刷新后重放沿用原请求的取消状态，刷新期间调用 `cancelAll()`，重放也会一并取消。
- **重放范围**：重放只重新走鉴权这一步，retry、notify、normalize 仍然只执行一次。
- **`canRefresh`**：`tokenManager.canRefresh` 为 `false` 时不刷新。会话过期时插件会把它置为 `false`，登录流程负责改回 `true`。

另导出 `AuthFailureAction`（const 对象，同时有同名类型）、`authFailureFactory(headerName?)`、
`DEFAULT_ON_AUTH_FAILURE`、`ACCESS_DENIED_CODE`、`TokenManager`。

```ts
axpAuth({
  tokenManager: new TokenManager(),
  urlPattern: ['/api/*', '!/api/public/*'],
  onRefresh: (tm) => refreshToken(tm),
  onAccessExpired: (tm) => redirectToLogin(),
})
```

### `axpMock(options?)`
路由到 mock 服务器，未命中时回落真实接口。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `mock` | `boolean` | `false`（默认全部 mock） |
| `mockUrl` | `string` | — |
| `fallbackWhen` | `(info) => boolean` | 404 / 不可达 |

请求字段 `mock`：`false` \| `true` \| `{ mock?, mockUrl?, fallbackWhen? }`。按请求设置的值，重试时会保留。

```ts
axpMock({ enable: import.meta.env.DEV, mockUrl: 'http://localhost:4000' })
api.get('/pet/1')(undefined, { mock: true })
```

### `axpFilter(options?)`
发送前剥离 `params`/`data` 里的空字段。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `predicate` | `(kv: [key, value]) => boolean` | 丢弃 `null`/`undefined`/`NaN`/空白串 |
| `ignoreKeys` / `ignoreValues` | `array` | — |

请求字段 `filter`：`false` \| `true` \| `IFilterOptions` \| `(config) => …`。

```ts
axpFilter()
api.get('/search')(undefined, { filter: true, params: { q: 'x', page: '' } })
```

### `axpNormalize(options?)`
`AxpResponse.fromResponse(res).successful === false` 时以 `ApiError` reject。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `nullable` | `boolean` | — |

请求字段 `normalize`：`false` \| `true` \| `{ enable? }` \| `(config) => …`，可以只对某一次调用关闭。

```ts
axpNormalize()
```

### `axpRepath(options?)`
从 `params`（再 `data`）替换路径占位符 `{id}` / `:id` / `[id]`。
- 只处理 pathname，查询串、hash 和 `host:port` 都不动；
- 同一个占位符出现两次，两处都会替换；
- 值按路径段做 `encodeURIComponent` 编码。

| 选项 | 类型 | 默认 |
| --- | --- | --- |
| `pattern` | `RegExp` | 匹配 `{id}` / `:id` / `[id]` |
| `removeKey` | `boolean` | `true`（替换后删除已消费的 key） |

```ts
axpRepath()
api.get('/pet/:id')(undefined, { params: { id: 5 } })  // → GET /pet/5
```

### `axpEnvs(rules)`
install 时按规则选环境配置（无拦截器）。

```ts
axpEnvs([
  { rule: () => import.meta.env.DEV, config: { baseURL: 'http://dev' } },
  { rule: () => import.meta.env.PROD, config: { baseURL: 'http://prod' } },
])
```

### `axpCancel(options?)`
给每个未自带 `signal`/`cancelToken` 的请求自动注入 `AbortController`。导出
`cancelAll(ax, reason?) => number`。

```ts
axpCancel()
cancelAll(api.axios, '页面已离开')
```

---

## 运行时模型对象

**`AxpResponse<T>`** —— `{ status, code, message, data, successful }`。
`AxpResponse.fromResponse(res)` 防御式构建（null-safe）。
`AxpResponse.isSuccessful(status, code)` 是成功判定钩子——可重新赋值自定义。

**`ApiError<T>`** —— 带 `.response: AxpResponse<T>` 的 `Error`；`axpNormalize`
业务失败时 reject 的就是它。

**`TokenManager`**（`implements ITokenManager`）—— `canRefresh`、`accessToken`
（getter 返回 `Bearer <token>`）、`refreshToken`、`set(access?, refresh?)`、
`clear()`。裸 token 持久化到 `localStorage`。

## 编写插件

```ts
import type { Plugin } from '@codejoo/axp';
import { pluginLog } from '@codejoo/axp';

const logging: Plugin = {
  name: 'logging',
  install(axios) {
    const id = axios.interceptors.request.use((cfg) => {
      pluginLog(cfg, '→', cfg.method, cfg.url);
      return cfg;
    });
    return () => { axios.interceptors.request.eject(id); };  // 没什么要还原就可以省略
  },
};
```

请求拦截器 LIFO（后注册先执行），响应拦截器 FIFO（先注册先执行）——纯
`axios` 原生语义。

## 构建与测试

- `npm test` / `npx vitest run` —— 单元 + 集成测试（`test/**`）。
- `npm run build` —— 产出 `dist/esm/**`（不打包的 ESM 及 `.d.mts`，含根入口和各插件子路径）和 `dist/index.min.js`（对应 `./min`）。
- `npm run e2e` —— Playwright 真浏览器端到端测试（`e2e/`），对接本地 mock 服务器。
- `npm run accept` —— 黑盒验收，对接 [api-ws-demo testkit](https://github.com/icodejoo/api-ws-demo/tree/main/testkit)：真实 HTTP 服务器加网络条件代理，按 场景 × 网络 × 响应风格 × adapter 组合跑。
