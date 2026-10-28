# @codejoo/axp

中文 | [English](./README.md)

基于 `axios` 的 HTTP 客户端。重试、鉴权、缓存、去重、mock、loading 这些环节都是插件，按固定阶段一层层包住一次请求。成功、失败和被抛出的，都是同一种对象：归一化响应 `IAxpResponse`。

从旧版（`Axp.install` / `Axp.create`）升级，请看 [迁移指南](docs/guides/migrating-to-pipeline.md)。

```bash
npm i @codejoo/axp   # peer dep: axios
```

入口：
- `@codejoo/axp`：不打包的 ESM。插件子路径（`@codejoo/axp/retry`、`@codejoo/axp/cache` 等）和根入口共用同一份模块，混着导入没问题。
- `@codejoo/axp/min`：单文件压缩版，**自带一份独立的模块**，不要和根入口或子路径混用。

类型推断需要 TypeScript ≥ 5.4。

## 快速开始

```ts
import axios from 'axios';
import { createAxp, axpRepath, axpRetry, axpAuth, axpCache, TokenManager } from '@codejoo/axp';
import type { Schema } from './api-schema'; // 你的接口类型，结构与旧版 MethodSchema 一致

const api = createAxp<Schema>({
  axios: axios.create({ baseURL: '/api' }),
  plugins: [
    axpRepath(),                           // 替换路径里的 {id}，装上才生效
    axpRetry({ max: 2 }),
    axpAuth({
      tokenManager: new TokenManager(),
      onRefresh: (r, tm) => refreshToken(tm), // 返回 false 或抛错即刷新失败
      onAccessExpired: () => redirectToLogin(),
    }),
    axpCache({ expires: 30_000 }),
  ],
});

// 类型化调用：成功直接拿到业务数据
const pet = await api.get('/pet/{id}')({ id: 1 });                                  // Pet
// 缓存需要按请求开启
const list = await api.get('/pet/findByStatus')({ status: 'available' }, { cache: true });
```

要用自定义响应 `R` 时，`S` 和 `R` 都要显式写出：TypeScript 不做部分推断，只写 `S` 推不出 `R`。不传 `S` 时，路径退化为 `string`。

## 返回形态与错误处理

一次调用的结果取决于两个开关：`wrap` 和 `throws`。

| 调用 | 成功 | 失败 |
| --- | --- | --- |
| 默认 | 返回 `data` | `throw r`，`r` 是 `IAxpResponse` |
| `{ wrap: true }` | 返回 `WithData<R, D>`：和响应同形，`data` 是业务类型 | 同上，抛出 |
| `{ throws: false }` | 返回 `WithData<R, D>` | 不抛出，resolve 出 `ok` 为 `false` 的 `R` |

失败抛出的不是 `Error`。默认没有 `stack`，开启 `debug` 后才会附上调用点。程序 bug（中间件、用户回调、拦截器里抛出的非 axios 异常）不会被当成请求失败：它会原样抛出，`throws: false` 也不会吞掉它。

```ts
// 默认：catch 到的失败是 IAxpResponse，程序 bug 原样抛出
try {
  await api.post('/pet')(body);
} catch (e) {
  if (api.isResponse(e)) toast(e.message);   // 可预期的失败
  else throw e;                              // 程序 bug
}

// throws: false：失败也 resolve，用 ok 判断
const res = await api.post('/pet')(body, { throws: false });
if (!res.ok) toast(res.message);

// wrap: true：需要原始响应时使用
const out = await api.get('/pet/{id}')({ id: 1 }, { wrap: true });
out.data;   // Pet
out.raw;    // 原始 AxiosResponse（逃生口）
```

`IAxpResponse` 的字段：

| 字段 | 说明 |
| --- | --- |
| `ok` | 成功判定，开放点见下一节 |
| `kind` | 类别，见下表 |
| `status` | 逻辑状态。判断 401、403、5xx 一律读它。默认实现里，HTTP 2xx 但业务码是 400–599 的数字时，等于业务码 |
| `httpStatus` | 原始 HTTP 状态，没有响应时为 `0` |
| `code` / `message` / `data` | 业务码、消息、数据。非信封响应的 `code` 是 `undefined` |
| `reason` | 细分原因，如 auth 的 `expired`、`denied`、`unauthenticated` |
| `request` | 实际发出的请求。命中 share 或 cache 时，是发出那一次的请求 |
| `stack` | 只在 `debug` 开启、且失败被抛出时存在，见下文 |
| `raw` | 原始 `AxiosResponse` |
| `error` | 原始异常，网络错误的 stack 在这里 |

`kind` 的取值：

| kind | 含义 |
| --- | --- |
| `ok` | 成功 |
| `http` | 非 2xx |
| `biz` | HTTP 2xx，但业务判定失败 |
| `network` | 网络错误 |
| `timeout` | 超时 |
| `cancel` | 被取消（`cancelAll` 或 `signal`） |
| `parse` | 响应解析失败。开启 `expectJson` 时，2xx 却拿到未解析的 JSON 文本 |
| `auth` | 鉴权失败，细分看 `reason` |
| `internal` | 程序 bug 的内部包装。落定时会抛出原始异常，正常情况下你拿不到它 |

三个配套能力：

- `api.isResponse(e)`：区分可预期的失败和程序 bug，并把类型收窄到客户端的 `R`。它和 `isAxpResponse(e)` 判断的是同一件事。
- `createAxp({ reject })`：可预期的失败抛出前经过这个函数转换，默认原样返回。接 Sentry、TanStack Query 这类要求 `Error` 的生态时，在这里包一层：

  ```ts
  createAxp({ reject: (r) => Object.assign(new Error(r.message), { response: r }) });
  ```

- `debug`：开启后，抛出的失败会附上发起请求那一刻的调用点 `stack`（`throws: false` 不抛，也就没有）。只在 debug 下记录，生产环境没有额外开销。

`throws` 只能按请求设置，默认 `true`；没有客户端级默认值，否则返回类型没法如实反映它。

## 自定义响应

默认实现是 `AxpResponse`。要加字段或改判定，继承它，覆盖 `ok` 或 `status` 这两个 getter 即可。`kind` 会跟着 `ok` 自动推导，不需要另外改。

```ts
import { AxpResponse, axpResponse, axpRetry, createAxp } from '@codejoo/axp';

class MyResponse<D = unknown> extends AxpResponse<D> {
  traceId = '';
  get ok() { return this.httpStatus < 300 && this.code === 200; }   // 我们的成功码是 200
  get status() { return this.code === 'TOKEN_EXPIRED' ? 401 : super.status; }
}

const response = axpResponse<MyResponse>({
  create: (init, raw) => Object.assign(new MyResponse(init), { traceId: raw?.headers['x-trace-id'] ?? '' }),
});

const api = createAxp<Schema, MyResponse>({
  response,
  plugins: [axpRetry({ shouldRetry: (r) => r.traceId !== '' })],
});
```

几点约定：

- `ok` 和 `status` 只在收到响应时求值。网络错误之类没有响应的失败，由工厂直接写好 `ok: false`、`kind`、`status`，所以覆盖时只需要判断响应本身。
- `R` 不是 `AxpResponse` 时，`createAxp` 的 `response` 必填。
- 也可以不继承，直接让 `create` 返回带额外字段的普通对象。内核会补上品牌，`isAxpResponse` 照常识别。

默认工厂 `axpResponse(options?)` 的选项：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `envelope` | `{ code: 'code', data: 'data', message: 'message' }` | 信封字段名。`false` 关闭信封识别 |
| `expectJson` | `false` | 声明了 JSON 却解析失败时，判为 `parse` |
| `create(init, raw?)` | `new AxpResponse(init)` | 扩展点，返回子类或带额外字段的对象 |

默认的成功判定：HTTP 2xx，并且没有业务码，或者业务码落在 `[0, '0000']` 之内。

## 插件

10 个内置插件。装上即生效，除了 `cache` 和 `share` 需要按请求开启，`mock` 默认关闭。内置插件的先后顺序由阶段决定，你不需要排序。

| 阶段 | 内置插件（外 → 内） | 说明 |
| --- | --- | --- |
| `outer` | `axpLoading` → `axpNotify` | 每个逻辑请求进出一次，看到最终结果 |
| `prepare` | `axpRepath` → `axpFilter` | 请求整形，只跑一次 |
| `attempt` | `axpRetry` | 重试边界，里面的每次尝试都会重跑 |
| `credential` | `axpAuth` | 注入凭证，401 时刷新后重放 |
| `source` | `axpMock` → `axpShare` → `axpCache` | 结果来源，可以不触网直接返回 |
| 无 | `axpEnvs` | 只在装上时执行，不进中间件链 |

### 通用约定

下面的约定适用于每个插件，只写这一次。

请求级选项有四种写法：

| 写法 | 含义 |
| --- | --- |
| `false` | 本次关闭 |
| `true` 或省略 | 用插件级配置 |
| 简写 | 各插件单独注明，如 retry 的数字、share 的策略字符串、loading 的回调函数，只覆盖主参数 |
| 对象 | 按字段覆盖，优先级：请求级 > 插件级 > 内置默认。字段写 `null` 或 `undefined` 表示继承。数组字段整体替换。`enable: false` 等同于 `false` |

补充：

- `null` 和 `undefined` 都按"省略"处理。其它未声明的值类型会报错，运行时也按省略处理。
- 每个插件工厂都接受 `enable?: boolean`，默认 `true`（`axpMock` 默认 `false`）。`enable: false` 时插件不进链、不执行 `setup`，`api.inspect()` 也不列出它。请求级无法把它重新打开。
- 请求级选项不接受函数形式。例外是本身就是回调的选项，比如 `axpLoading` 的请求级回调。
- 各层拿到的请求已经合并了 axios 实例的 `defaults`（`baseURL`、`params`、`headers` 等），和旧版拦截器看到的一样。所以 `repath`、`filter` 能处理 `defaults.params` 里的值，key 里也包含它们。某一层删掉的默认 `params`、`headers` 字段，发给 axios 时不会被它二次合并带回来。
- 插件选项在创建插件时就定下了。之后再改传进去的 options 对象不会生效；要变，用请求级选项，或者重新创建插件。
- 插件的请求选项通过 `declare module '@codejoo/axp'` 扩展 `AxpRequestOptions`，不会污染 axios 的类型。内核自带的请求选项有 `wrap`、`throws`、`silent`、`key`、`signal`。

回调抛错的处理分两类：

- 通知类（`loading`、`notify`、`stringify`、`onAccessExpired`、`onAccessDenied`）：隔离，不影响请求结果和插件状态，同步抛错和异步拒绝都一样，用 `console.error` 输出，不受 `debug` 开关控制。
- 判定类（`shouldRetry`、retry 的 `delay` 和 `jitter` 函数、`onFailure`、`isProtected`、`fallbackWhen`、`shouldCache`、`ready`）：按程序 bug 处理，原样抛出。
- 例外：`onRefresh` 抛错算刷新失败，不算 bug。

### `axpLoading(options?)`

阶段：`outer`（内置次序 1）。按逻辑请求计数，显示和隐藏成对出现。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `loading(visible)` | — | 显示和隐藏的回调 |
| `delay` | `0` | 计数从 0 变成 1 后延迟显示。期间回落到 0 就不显示 |
| `delayClose` | `0` | 计数从 1 变成 0 后延迟隐藏。期间有新请求就不隐藏 |

请求级：`false`、`true`、一个函数（本次使用的回调），或 `{ enable, loading, delay, delayClose }`。

- 显示从逻辑请求开始算，包括等待 token 刷新的时间。
- 重试和鉴权重放都在同一对显示、隐藏之内，不会闪烁。
- 每个回调各自计数，所以每个回调都看到成对的 `true` 和 `false`。
- 插件级和请求级都没给回调时，这次请求不参与计数。
- 同一个回调下，`delay` 取让计数从 0 变成 1 的那个请求的值，`delayClose` 取让计数从 1 变成 0 的那个请求的值。
- 卸载插件（`eject` 或 `dispose`）时，还没触发的延迟回调会被取消；已经显示出来的会立刻收到一次 `false`，之后在途请求结束也不再回调。

```ts
axpLoading({ loading: (v) => setSpinner(v), delay: 200, delayClose: 200 });
api.get('/list')(undefined, { loading: true });
api.get('/quiet')(undefined, { loading: { delay: 0 } });   // 本次跳过防闪烁延迟
```

### `axpNotify(options)`

阶段：`outer`（内置次序 2）。每个逻辑请求最多通知一次。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `notify(message, r)` | **必填** | 拿到非空消息时调用 |
| `stringify(r, ctx)` | 见下 | 返回空串表示不通知 |

默认的 `stringify`：`r.ok`、`r.kind === 'cancel'`，或者 `ctx.request.silent` 为真时返回 `''`；其它情况返回 `r.message || \`${r.kind} ${r.status}\``。

请求级：`notify` 只是个开关。`false` 或 `{ enable: false }` 关闭本次通知，`true`、`null` 和省略都沿用插件配置。`notify`、`stringify` 两个回调不能按请求覆盖。

内核选项 `silent: true` 会让默认的 `stringify` 返回空串。自定义 `stringify` 拿到的 `ctx.request.silent` 是原值，要不要静默由它自己决定；`notify: false` 对默认和自定义的 `stringify` 都有效。

```ts
axpNotify({
  notify: (msg) => toast.error(msg),
  stringify: (r, ctx) => (r.ok || r.kind === 'cancel' || ctx.request.silent ? '' : r.message),
});
api.post('/pet')(body, { silent: true });   // 这一次不弹提示
```

### `axpRepath(options?)`

阶段：`prepare`（内置次序 1）。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `pattern` | 匹配 `{id}`、`:id`、`[id]` | 占位符的匹配规则 |
| `removeKey` | `true` | 替换后删除已经用掉的参数 |

- 只处理 pathname，查询串和 hash 不动。
- 先从 `params` 取值，取不到再从 `data` 取。
- 值按路径段做 `encodeURIComponent`。同一个占位符出现几次，全部替换。
- 不修改调用方传入的对象，改写结果通过 `next(patch)` 交给内层。

请求级：`false` 关闭本次替换；也可以写对象 `{ enable, pattern, removeKey }`，按字段覆盖插件级配置。

```ts
axpRepath();
api.get('/pet/:id')(undefined, { params: { id: 5 } });   // → GET /pet/5
```

### `axpFilter(options?)`

阶段：`prepare`（内置次序 2）。装上即生效。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `predicate([k, v])` | 丢弃 `null`、`undefined`、`NaN`、空白串 | 严格返回 `true` 的字段会被剥掉 |
| `ignoreKeys` / `ignoreValues` | — | 豁免过滤的键名或值，`ignoreValues` 认得 `NaN` |

只看 `params` 和 `data`（纯对象）的顶层字段，不递归。剥掉空字段后生成新对象交给内层，`FormData` 这类特殊请求体保持原样。

请求级：`false` 关闭本次过滤；也可以写对象 `{ enable, predicate, ignoreKeys, ignoreValues }`，按字段覆盖插件级配置（数组字段整体替换，写空数组就是清空豁免）。

```ts
axpFilter();
api.get('/search')(undefined, { params: { q: 'x', page: '' } });   // 发出 ?q=x
```

### `axpRetry(options?)`

阶段：`attempt`。装上即生效，默认最多重试 2 次。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `max` | `2` | 最多重试次数 |
| `methods` | `get put head delete options trace` | 硬性否决：方法不在表里一律不重试，`shouldRetry` 说了也不算 |
| `statusCodes` | `[408, 429, 500, 502, 503, 504]` | 对照 `r.status`（逻辑状态） |
| `shouldRetry(r, attempt, ctx)` | — | 返回布尔值即采用，其它返回值（含 `undefined`）则继续往下判断 |
| `delay` | `attempt => 300 * 2 ** (attempt - 1)` | 数字，或函数 `(attempt, max, r) => number`，返回非数字按 0 算 |
| `jitter` | — | `true`（在 0 到 delay 之间均匀随机），或 `(delay) => number`（返回负数、`NaN`、`Infinity` 时沿用原 delay） |
| `delayMax` | `10_000` | 只封顶插件自己算出来的 delay，抖动之后再封顶 |
| `respectRetryAfter` | `true` | 是否采用响应里的 `Retry-After` |
| `afterStatusCodes` | `[413, 429, 503]` | 只有这些状态码才信 `Retry-After`，对照 `r.status` |
| `retryAfterMax` | `Infinity` | 从 `Retry-After` 换算出的等待时间的上限 |

`Retry-After` 的规则：

- 决定重试之后才会去看它。`respectRetryAfter` 为真，且 `r.status`（逻辑状态）在 `afterStatusCodes` 里，才会读响应头。头取自原始的 HTTP 响应，所以 HTTP 200 加业务码 429 的接口，只要响应头带了 `Retry-After` 也适用。
- 值可以是秒数，也可以是 HTTP 日期（按当前时钟算出还要等多久）。缺失或解析不了，就回退到本地的 `delay`。
- 能解析时它优先：直接用头给出的时间，不再调用 `delay`，也不叠加 `jitter`，`delayMax` 管不到它，只受 `retryAfterMax` 封顶。
- 头里是负数，或日期已经过了，等待时间按 0 算，立即重发，不会回退到 `delay`。
- 回退到本地时，顺序是：先算 `delay`，再套 `jitter`，最后用 `delayMax` 封顶。

请求级：数字表示 `max`；`false` 关闭；`true` 用插件级配置；对象按字段覆盖。

判定顺序，每一级都能提前结束：

1. 请求级 `retry: false`：不重试。
2. 方法不在 `methods` 里：不重试。
3. `r.kind` 是 `cancel`、`auth`、`internal` 或 `parse`：不重试。
4. `shouldRetry` 返回布尔值：采用它。
5. `r.kind` 是 `network` 或 `timeout`：重试。
6. 否则看 `statusCodes.includes(r.status)`。

判定里没有 `r.ok` 这一级：成功的响应同样会交给 `shouldRetry`。默认规则下成功不重试；自定义的 `shouldRetry` 返回 `true`，就会对成功响应重试，比如业务上判为异常的成功。

运行时的行为：

- 先调用 `ctx.markReplayable()`，再在循环里调用 `next()`。
- 等待期间监听 `ctx.signal`，取消会立即结束等待。
- 次数用完时返回最后一次的结果，是否抛出由最外层的落定决定。
- 每次尝试都会经过 `axpAuth` 和 `source` 阶段的插件。鉴权会注入最新 token，遇到 401 先刷新再重放。

```ts
axpRetry({ max: 3, statusCodes: [500, 502, 503, 504], jitter: true, delayMax: 10_000 });
api.get('/flaky')(undefined, { retry: 3 });                                         // 本次最多重试 3 次
api.get('/flaky')(undefined, { retry: { max: 2, shouldRetry: (r) => r.code !== 0 } });
api.get('/flaky')(undefined, { retry: false });                                     // 本次不重试
```

### `axpAuth(options)`

阶段：`credential`。负责令牌守卫、401/403 的单飞刷新和重放。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `tokenManager` | **必填** | `ITokenManager` 实例 |
| `onRefresh(r, tm)` | **必填** | 返回 `false` 或抛错即刷新失败。同一时刻只跑一个刷新 |
| `onAccessExpired(r, tm)` | **必填** | 会话过期。401、刷新失败这条路径上，每一轮只通知一次 |
| `onAccessDenied(r, tm)` | 同 `onAccessExpired` | 越权（403），或本地没有 token。本地没有 token 时，每个受保护请求都会调用一次，不去重 |
| `onFailure(r, tm, ctx)` | `defaultAuthFailure` | 返回 `AuthFailureAction` 之一 |
| `methods` / `urlPattern` | `'*'` | 判断是否受保护。`urlPattern` 只匹配 pathname，使用 URLPattern 语法，`!` 表示否定 |
| `isProtected(request)` | — | 返回布尔值即为最终结果。每次尝试入口求一次值，重试的每一轮都会重新判断，刷新后的重放不再判断 |
| `ready(tm, request)` | 写入 `Authorization` 头 | 返回一个 `AxpRequestPatch` |

`AuthFailureAction` 是一个常量对象，有五个动作：`Refresh`（`'refresh'`）、`Replay`（`'replay'`）、`Deny`（`'deny'`）、`Expired`（`'expired'`）、`Others`（`'others'`，与鉴权无关的失败，原样返回）。`onFailure` 返回 `null`、`undefined` 或不认识的值，效果和 `Others` 一样。

请求级：`protected: boolean`，优先于 `isProtected`、`methods` 和 `urlPattern`。

主流程：

1. 不受保护的请求直接放行。
2. 正在刷新：等刷新结果。刷新失败就按会话过期处理，返回 `reason: 'expired'`；等待期间调用方取消，只结束它自己。
3. 本地没有 token：调用 `onAccessDenied`，返回 `kind: 'auth'`、`reason: 'unauthenticated'` 的结果。每个受保护请求都会走一遍，不去重。没配 `onAccessDenied` 时调用的就是 `onAccessExpired`，所以过期之后、重新登录之前，每发一个受保护请求都会通知一次。
4. 注入 token，发出请求。成功直接返回；`internal`（程序错误）和 `cancel` 也不进 `onFailure`，原样返回。
5. 失败时由 `onFailure` 决定：`refresh` 刷新后重放一次；`replay` 用当前 token 重放一次；`deny` 调用 `onAccessDenied`，返回 `reason: 'denied'`；`expired` 清空 token，调用 `onAccessExpired`，返回 `reason: 'expired'`；其它情况原样返回。`onFailure` 可以是异步的，等它的期间调用方取消了，以取消落定，不再通知。
6. 重放之后仍然要求刷新或重放的，按会话过期处理，防止死循环。

默认的 `defaultAuthFailure` 只看逻辑状态：

- `status === 401`：本地没有 token 时为 `expired`；本次注入的 token 和当前 token 不一样（说明已被别的请求刷新）时为 `replay`；否则为 `refresh`。
- `status === 403`：`deny`。
- 其它：原样返回。

因为读的是 `r.status`，HTTP 200 加业务码 401 的接口同样适用。

刷新的可用性不需要手动维护。判定过期时会清空 token，并记下清空后的状态。这个状态没变之前，不再刷新，也不再重复通知过期。登录写入新 token 后自动恢复，登录流程不用改任何标记。

刷新是单飞的：同一时刻只跑一个，其它请求排队等它的结果。取消只结束发起或排队的那一个请求，刷新本身会跑完。`onRefresh` 抛错按刷新失败处理，不会往外抛；开了 `debug` 才会输出一条 warn。

`ITokenManager` 要求 `accessToken`（getter）、`refreshToken`（getter）、`set(access?, refresh?)`、`clear()`。默认实现 `TokenManager` 的 `accessToken` 返回 `Bearer <token>`，没有 token 时为 `undefined`；`set` 收的是不带 `Bearer ` 的裸 token，省略或空值等于清空。它会持久化到 `localStorage`，构造时恢复上次会话；存储不可用时只在内存里生效，不抛错。

```ts
axpAuth({
  tokenManager: new TokenManager(),
  urlPattern: ['/api/*', '!/api/public/*'],
  onRefresh: (r, tm) => refreshToken(tm),
  onAccessExpired: () => redirectToLogin(),
});
api.get('/public/banner')(undefined, { protected: false });   // 本次不做鉴权
```

### `axpMock(options?)`

阶段：`source`（内置次序 1）。默认关闭。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `enable` | `false` | 通常写成 `import.meta.env.DEV` |
| `mock` | `false` | `true` 时全部请求走 mock |
| `mockUrl` | — | mock 服务器的基址。没配置（或是空串）时跳过 mock，直接请求真实接口 |
| `fallbackWhen(r)` | `r.httpStatus === 404 \|\| r.kind === 'network'` | 为真时回落到真实接口 |

请求级：`false` 或 `{ enable: false }` 关闭；`true` 或任意对象（含空对象）为这次请求开启，对象可以覆盖 `mockUrl` 和 `fallbackWhen`。前提是插件级 `enable` 为真，请求级打不开关着的插件。

没有 `mockUrl` 时（插件级和请求级都没给，或者给的是空串，请求级的空串不会回退到插件级），这次请求不探测，原样发往真实接口；开了 `debug` 会输出一条 warn。

运行时的行为：先把请求改写到 `mockUrl` 上探测一次（`cache: false`、`share: false`，探测结果不写入缓存，也不占用共享条目）。如果 `fallbackWhen(r)` 为真，再走真实接口。改写规则：相对地址拼在 `mockUrl` 后面；绝对地址去掉原来的 origin，保留路径、query 和 hash；请求没有 `url` 时改写 `baseURL`。

```ts
axpMock({ enable: import.meta.env.DEV, mockUrl: 'http://localhost:4000' });
api.get('/pet/1')(undefined, { mock: true });
api.get('/pet/1')(undefined, { mock: { fallbackWhen: (r) => r.httpStatus >= 500 } });
```

### `axpShare(options?)`

阶段：`source`（内置次序 2）。默认关闭，按请求开启。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `policy` | `'start'` | `'start'`、`'end'` 或 `'race'` |
| `methods` | `['get', 'head']` | 其它方法即使请求级开启也不共享 |

请求级：`true`、策略字符串、`{ policy }`，或 `false`。缓存键为 `null` 时（见 key 一节）直接发送，不做共享。

- **start**：第一个调用真正发出请求。后续调用共享它的结果。每个调用各自监听自己的 `signal` 和 `timeout`，单独离开只拒绝它自己。全部离开后才中止共享的请求，所以首发被取消不会连累跟随者。
- **end**：每个调用都会发出请求，只有最后一次的结果会落定为共享结果。
- **race**：每个调用都会发出请求，第一个 `ok` 的结果胜出。全部失败时，用最后一个失败结果。

跟随者拿到的是同一个只读的 `R`，`r.request` 是首发那次的请求。跟随者自己的请求在它自己的 `ctx.request` 上。跟随者超时得到 `kind: 'timeout'`，被取消得到 `kind: 'cancel'`。

```ts
axpShare({ policy: 'start' });
api.get('/list')(undefined, { share: true });
api.get('/list')(undefined, { share: 'race' });
```

### `axpCache(options?)`

阶段：`source`（内置次序 3）。默认关闭，按请求开启。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `expires` | `60_000` | 过期时间，单位毫秒 |
| `max` | `500` | LRU 容量。`Infinity` 表示不限，小于 1 时回退为 500。注入 `store` 后不再生效 |
| `methods` | `['get', 'head']` | 其它方法即使请求级开启也不缓存 |
| `clone` | — | `'shallow'`、`'deep'`，或 `(data) => data`，作用于 `r.data`。默认不拷贝，共享同一个引用 |
| `shouldCache(r)` | `r.ok` | 决定哪些结果写入缓存 |
| `store` | 内存 LRU | 实现 `IAxpCacheStore<R>`（同步的 `get`、`set`、`delete`、`clear`、`size`）。持久化实现以后再做 |

请求级：`true`；数字表示 `expires`；对象 `{ expires, key, clone, shouldCache }`，其中 `key` 是显式缓存键；`false` 关闭。显式键不经过 key 服务，所以不带 `scope`，也优先于请求级 `key: false`；空串或非字符串的键会退回 key 服务。

- 命中时直接返回缓存的 `R`（按 `clone` 拷贝 `data`），不触网，也不会重跑 `transformResponse`。缓存的是判定之后的结果。
- 未命中、请求成功返回时，同样按 `clone` 拷贝 `data`；失败的结果原样返回，不经过 `clone`。`clone: 'deep'` 依赖 `structuredClone`，环境里没有会在发请求前直接抛错，不会悄悄退成浅拷贝。
- 较早发起、较晚返回的响应不会覆盖较新的结果。调用 `clear()` 之后，在途请求返回也不会写回。
- 过期的条目在读取时惰性删除。写入超过容量时才清扫。
- 默认只缓存 GET 和 HEAD。POST 即使请求级写了 `cache: true`，也不会被缓存，要缓存需要在插件级把 `methods` 改掉。
- 缓存键为 `null` 时（请求级 `key: false`，或参数里有 `FormData` 等不可哈希的值，见 key 一节）cache 直通：直接发出请求，不读也不写缓存。请求级 `cache: { key }` 给了显式键的话不受影响，照常缓存。

操作方法：

- `api.plugin(cache)` 返回 `{ remove(key): boolean, clear(): number }`，`cache` 是创建时的那个插件对象。
- `removeCache(client, key)` 和 `clearCache(client)`：客户端没装 cache 时分别返回 `false` 和 `0`。

```ts
axpCache({ expires: 30_000 });
api.get('/list')(undefined, { cache: true });                 // 用插件级的 expires
api.get('/list')(undefined, { cache: 10_000 });               // 只改这次的 expires
api.get('/list')(undefined, { cache: { expires: 10_000, key: 'pets' } });

const cache = axpCache();
const api2 = createAxp({ plugins: [cache] });
api2.plugin(cache)?.clear();
```

### `axpEnvs(rules)`

只有 `setup`，没有中间件，不进链。装上时按规则选中第一个命中的配置，写入 `client.axios.defaults`。

```ts
axpEnvs([
  { rule: () => import.meta.env.DEV, config: { baseURL: 'http://dev' } },
  { rule: () => import.meta.env.PROD, config: { baseURL: 'http://prod' } },
]);
```

- 命中第一条后不再求值后面的规则；都没命中就什么也不改。规则函数抛错时，`createAxp` 或 `use` 会直接抛出。
- 按顶层字段整体覆盖，不做深合并：配置里写了 `headers`，就整个换掉 `defaults` 里原来的 `headers`。
- 卸载（`eject`、`dispose`）不会还原已经写入的配置。
- 除了数组，也可以写成对象 `{ enable, rules }`，用 `enable: false` 整体关掉。

---

## 内核能力

这几项不是插件，装上即有，不需要也不能卸载。

### key

缓存和共享的键由内核的 key 服务算出：

- 由 method、url、params 算出（params 包含实例 `defaults.params`）。有请求体的方法再加上 data。账号、租户隔离请用下面的 `scope` 显式声明，别依赖 defaults 里碰巧带着的字段。
- 惰性计算：第一次需要时才算，之后按请求对象缓存。不用缓存和共享的请求，不会算 key。
- `Date` 和 `URLSearchParams` 按内容参与哈希。无法可靠区分内容的值（`FormData`、`Blob`、`Map`、`Set`、没有可枚举字段的类实例）和循环引用的对象不生成 key。这类请求既不缓存也不共享。宁可没命中，也不能命中错的。

客户端级配置：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `scope` | — | 并入每个 key，比如账号 id，缓存和共享不会跨账号串数据。可以是字符串、数字，或者返回它们的函数 `(request) => 值`。函数在每次算 key 时求值，切换账号不用重建客户端。返回 `null`、`undefined`、空串、`NaN` 时不附加 |
| `ignores` | — | 豁免空值过滤的键名或值 |
| `sample` | `false` | 超过 64 字符的字符串采样计算，而不是全量 |

```ts
const api = createAxp({ key: { scope: () => session.userId } });   // 每次算 key 时取当前用户
```

请求级 `key`：省略则自动计算；传字符串则作为显式的键（同样会带上 `scope`，空白串等同于 `false`）；`false` 表示这次请求不参与 cache 和 share。`true` 和省略等价，都是自动计算，保留它是为了让旧代码的 `key: true, cache: true` 不用改；新代码直接省略即可。自动计算的 key 包含参数。

### 取消

- 每个逻辑请求有一个 `AbortController`，和用户传入的 `signal` 联动。
- `api.cancelAll(reason?)`：中止全部在途的逻辑请求，返回被中止的数量。被取消的请求得到 `kind: 'cancel'` 的结果。
- `api.pending()`：返回在途的逻辑请求数。
- 重试的等待、鉴权的排队、share 的跟随者，都会响应取消。
- 不再支持 `cancelToken`，改用 `signal`。

```ts
const controller = new AbortController();
api.get('/list')(undefined, { signal: controller.signal });
controller.abort();                // 只取消这一个请求

api.cancelAll('页面已离开');        // 取消全部在途请求
```

### debug

```ts
createAxp({ debug: true });        // 输出插件日志，并记录失败的调用点
createAxp({ debug: myLogger });    // 用自己的 logger 输出
```

- 关闭时插件的 `ctx.log` 是空函数，没有额外开销。
- 开启后，抛出的失败带上 `stack`（发起请求那一刻的调用点）。
- 自定义 logger 的接口形状 `AxpLogger`：`{ log, warn, error }` 三个方法，参数都是 `(...args: unknown[])`。`debug: true` 用 `console`。

---

## 阶段与自定义插件

插件是一个具名对象。`handle` 是中间件，`(ctx, next) => Promise<R>`；`taps` 把一个插件拆成多段，各段挂在不同的阶段上。

```ts
interface AxpPlugin<R, A> {
  readonly name: string;
  readonly enable?: boolean;                                                 // false 时不 setup、不进链
  readonly stage?: 'outer' | 'prepare' | 'attempt' | 'credential' | 'source'; // 默认 'attempt'，只有 taps 时忽略
  readonly enforce?: 'pre' | 'post';                                         // 默认 'post'
  setup?(client): AxpPluginInstance<R, A> | void;   // 每个客户端调用一次，状态建在这里
  handle?: (ctx, next) => Promise<R>;                // 无状态插件可以直接给
  taps?: readonly AxpTap<R>[];
}
```

排序规则：

1. 阶段顺序固定，按上表从外到内。
2. 同一阶段内：`enforce: 'pre'` 的自定义插件，然后是内置插件（固定次序），最后是 `enforce: 'post'`（默认）的自定义插件。自定义插件之间按 `plugins` 数组的顺序。
3. 插件名重复直接抛错。`taps` 的每一段独立参与排序，名字记作 `<name>#<序号>`。
4. 链在 `createAxp`、`use`、`eject` 时编译一次。在途请求沿用发起时的链。
5. `api.inspect()` 返回解析后的完整顺序，调试顺序问题只看它。

```ts
import type { AxpPlugin } from '@codejoo/axp';

/** 记录每次尝试的耗时 */
const timing: AxpPlugin = {
  name: 'timing',
  stage: 'attempt',
  async handle(ctx, next) {
    const t = performance.now();
    const r = await next();
    ctx.log.log(`[timing] ${ctx.request.url} ${r.status} ${performance.now() - t}ms`);
    return r;
  },
};

/** 请求侧和响应侧处在不同深度 */
const audit: AxpPlugin = {
  name: 'audit',
  taps: [
    { stage: 'credential', enforce: 'post', onRequest: (ctx) => report('send', ctx.request) },
    { stage: 'outer', onResponse: (r) => report('done', r.kind) },
  ],
};

/** 给内层的请求加上 trace 头，通过 next(patch) 交给下一层 */
const addTrace: AxpPlugin = {
  name: 'add-trace',
  stage: 'prepare',
  handle: (ctx, next) => next({ headers: { 'X-Trace': crypto.randomUUID() } }),
};
```

几条约定：

- 中间件不修改 `ctx.request`。要给内层改请求，用 `next(patch)`。内核把 patch 浅合并成新请求，`headers` 多合并一层。patch 里某个字段写 `undefined`，表示把它从请求里删掉（`headers` 里的单个头也一样）。
- `handle`、`taps` 可以直接写在插件对象上（无状态插件），也可以由 `setup` 返回（有状态插件）。两处都写时以 `setup` 返回的为准，不合并。
- 状态建在 `setup` 里，不要放在工厂的闭包里。这样同一个插件对象可以装到多个客户端，每个客户端各有一份状态。`extend` 继承插件时也靠这一点，各自独立。
- `next()` 不会抛错，它返回的始终是 `R`。

---

## 客户端 API

```ts
function createAxp<S = unknown, R extends IAxpResponse = AxpResponse>(options?: AxpOptions<R>): AxpClient<S, R>;
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `axios` | `axios.create()` | 底层实例 |
| `plugins` | `[]` | 插件数组 |
| `response` | `axpResponse()` | 响应工厂。`R` 不是 `AxpResponse` 时必填 |
| `key` | — | key 服务配置，见"内核能力" |
| `reject` | `(r) => r` | 可预期的失败抛出前的转换 |
| `debug` | `false` | `true` 或自定义 logger |

客户端的成员：

| 成员 | 说明 |
| --- | --- |
| `api.get(path, methodConfig?)(payload?, callConfig?)` 等 | axios 的 10 个小写动词。`delete`、`post`、`put`、`patch` 的 payload 走 `data`，其它走 `params`。`wrap` 和 `throws` 以调用配置为先，没写就继承方法配置 |
| `api.request<D>(config)` | 无类型的逃生口，同样支持 `wrap` 和 `throws` |
| `api.axios` | 底层的 `AxiosInstance` |
| `api.extend(overrides?, opts?)` | 克隆 axios 的 defaults，再写入 `overrides`（按顶层字段整体覆盖）。默认继承插件（`opts.plugins: 'inherit'`），每个插件重新 `setup`，状态不共享。也可以传入新的插件数组。`key`、`reject`、`debug`、`response` 一并继承。`overrides` 在插件 `setup` 之后才写入，所以优先于 `axpEnvs` 写进去的配置 |
| `api.use(plugin)` | 装上一个插件，链会重新编译 |
| `api.eject(name)` | 按名字卸下插件并清理它的实例，返回是否卸下成功。在途请求不受影响，继续沿用发起时的链 |
| `api.plugin(p)` | 取得插件实例的 `api`，比如 cache 的 `clear()`。传的是插件对象，不是名字。没装返回 `undefined` |
| `api.cancelAll(reason?)` / `api.pending()` | 见"取消" |
| `api.inspect()` | 返回 `[{ stage, name }]`，即解析后的插件顺序 |
| `api.isResponse(e)` | 见"返回形态与错误处理" |
| `api.dispose()` | 先中止全部在途请求（它们按 `kind: 'cancel'` 落定），再按注册的逆序卸载插件，释放定时器等资源。可以重复调用，后面的调用什么也不做。销毁后不能再发请求、`use` 或 `extend`。某个插件清理时抛错不影响其余插件，最后抛出第一个异常 |

```ts
const admin = api.extend({ baseURL: '/admin' });                         // 继承插件，状态各自独立
const plain = api.extend({ baseURL: '/v2' }, { plugins: [axpCache()] }); // 只用指定的插件
```

---

## 构建与测试

- `npm test`：单元测试和集成测试（`test/**`）。
- `npm run build`：产出不打包的 ESM 及类型声明，以及 `./min` 对应的压缩版。
<!-- TODO: 待实现确认：产物目录结构和子路径清单，等 B6 打包后确认 -->
- `npm run e2e`：Playwright 真浏览器端到端测试（`e2e/`），对接本地 mock 服务器。
- `npm run accept`：黑盒验收，对接 [api-ws-demo testkit](https://github.com/icodejoo/api-ws-demo/tree/main/testkit)。真实 HTTP 服务器加网络条件代理，按场景、网络、响应风格、adapter 组合运行。
