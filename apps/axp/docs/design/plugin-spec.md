---
title: axp 内置插件与内核服务规格（新架构）
status: active
updated: 2026-10-28
summary: 10 个内置插件和 4 项内核服务在洋葱管线下的阶段、选项、请求级写法、行为与相对现状的变化
---
## TL;DR

- 内置插件 10 个：loading、notify（outer）；repath、filter（prepare）；retry（attempt）；auth（credential）；mock、share、cache（source）；envs（只在装卸时执行）。
- 内核服务 4 项：归一化响应、key、取消、日志开关；`axpKey`、`axpCancel`、`axpLogger`、`axpNormalize` 删除。
- 所有判断函数的第一个参数都是 `R`；请求级选项统一四种写法；只读不删请求上的字段。
- 改变数据新鲜度的 cache、share 按请求开启（只写 `cache: true` 即可，key 自动算）；其余插件装上即生效。
- 架构背景见 [核心架构](core-architecture.md)，每条行为变化在末尾汇总，发版时抄进 CHANGELOG。

## 0. 通用约定

**请求级选项的四种写法**（每个插件都一样，内核提供统一解析函数 `resolveOption`，不再每个插件各写一套 `$resolveXxx`）：

| 写法 | 含义 |
|---|---|
| `false` | 本次关闭 |
| `true` 或省略 | 用插件级配置 |
| 简写（各插件注明，如 retry 的数字、share 的策略字符串） | 只覆盖主参数 |
| 对象 | 按字段覆盖：`请求级 ?? 插件级 ?? 内置默认`；数组字段整体替换；`enable: false` 等同 `false` |

- 不再接受函数形式（N5）；**例外**是值本身就是回调的选项，比如 loading 的请求级回调。
- `null` 与 `undefined` 都按"省略"处理；其它未声明的值类型上报错，运行时也按省略处理。
- **插件级 `enable`**：每个插件工厂都接受 `enable?: boolean`（默认 true，mock 默认 false）。`false` 时插件不进链、不调用 `setup`、`inspect()` 不列出；请求级开关不能把它重新打开。
- 插件只读请求选项，不 `delete`；需要给内层改请求时用 `next(patch)`。
- 请求选项类型通过 `declare module '@codejoo/axp' { interface AxpRequestOptions {…} }` 扩展。
- 内核自带的请求选项：`wrap`、`throws`、`silent`、`key`、`signal`。
- 统一解析函数 `resolveOption` 放在 `src/options.ts`，B2 实现。
- 命名：内置插件工厂一律 `axpXxx()`，插件 `name` 一律 `'axp:xxx'`（`axp:` 前缀保留给内置插件）：loading、notify、repath、filter、retry、auth、mock、share、cache、envs。

**用户回调抛错**（N13）：
- 通知类（`loading`、`notify`、`stringify`、`onAccessExpired`、`onAccessDenied`）：隔离，不影响请求结果和插件状态，用 `console.error` 输出，不受 debug 开关控制。
- 判定类（`shouldRetry`、retry 的 `delay` / `jitter` 函数、`onFailure`、`isProtected`、`fallbackWhen`、`shouldCache`、`ready`）：按程序 bug 处理，落定时抛原始异常。
- 例外：`onRefresh` 抛错按约定算刷新失败，不算 bug。

## 1. 内核服务

### 1.1 归一化响应

见 [核心架构 §6](core-architecture.md#6-归一化响应)。`createAxp({ response })` 配置，默认 `axpResponse()`。

### 1.2 key

- 来源：`plugins/key.ts` 的 FNV 哈希算法整体迁到 `src/key.ts`，算法和"不可哈希值返回 null"的规则不变。
- 计算时机：`ctx.key()` 首次调用时惰性计算，按 request 对象缓存。cache、share 在 source 阶段调用，此时 repath、filter 已经生效，所以"filter 必须在 key 前"的约束自然满足。
- 内容：method + url + params（**含实例 `defaults.params`**，因为各层看到的是合并后的有效配置），有请求体的方法再加 data（N2）。
  账号 / 租户隔离请用 `scope` 显式声明，不要依赖 defaults 里恰好带着的 tenant 之类字段：defaults 通常固定不变，靠它隔离只是偶然的副作用。旧版 `key: true` 只哈希 method+url，同一路径不同参数会命中同一条缓存，这是正确性问题。
- 客户端配置 `createAxp({ key: { scope, ignores, sample } })`：`scope` 并入每个 key（防跨账号串数据），可以是值，也可以是 `(request) => string | number | null | undefined`（每次计算 key 时取当前用户，切换账号无需重建客户端；N5 只限制请求级选项）；其余两项语义不变。
- 请求级 `key`：省略或 `true` = 需要时自动算（保留 `true` 兼容旧写法）；`string` = 显式 key；`false` = 本请求不参与 cache/share。
- 删除：`fastMode`、`before/after` 钩子、`'deep'` / 数字等写法。

### 1.3 取消

- 每个逻辑请求一个 `AbortController`，与用户传入的 `signal` 联动；`ctx.signal` 对所有插件可用（N1）。
- `client.cancelAll(reason?)` 返回中止的逻辑请求数；被取消的请求得到 `kind: 'cancel'` 的响应。
- 落定时注销并解除监听，`client.pending()` 归零。
- 不再支持已废弃的 `cancelToken`。

### 1.4 日志开关

`createAxp({ debug: true | AxpLogger })`，`true` 用 `console`，`AxpLogger` 形状是 `{ log, warn, error }`；插件通过 `ctx.log` 输出，关闭时零开销（三个方法都是空函数）。

## 2. outer 阶段

### 2.1 loading（outer，内置次序 1）

| 选项 | 默认 | 说明 |
|---|---|---|
| `loading(visible)` | — | 显示/隐藏回调 |
| `delay` | 0 | 0→1 后延迟显示，期间回落到 0 就不显示 |
| `delayClose` | 0 | 1→0 后延迟隐藏，期间有新请求就不隐藏 |

- 请求级：`false` / `true` / 函数（作为本次回调）/ `{ enable, loading, delay, delayClose }`。
- 行为：进入时计数 +1，`next()` 返回后在 `finally` 里 -1；一个逻辑请求恰好一对显示/隐藏，重试和重放都在里面。
- 计数按回调分开：请求级换了回调的请求，计入它自己那个回调的计数，所以每个回调都看到成对的 true/false（旧版可能出现"A 显示、B 隐藏"）。
- 卸载（`dispose`）取消未触发的定时器，并对已显示的回调立即发一次 `false`，避免页面上的 loading 卡住。
- 变化：显示从逻辑请求开始算，包括等待 token 刷新的时间（N10）；`guardTransform`、`COMPLETE` 层键、`logical` 参数全部删除（R2-3、R2-4 的问题不再存在）。

### 2.2 notify（outer，内置次序 2）

| 选项 | 默认 | 说明 |
|---|---|---|
| `notify(message, r)` | **必填** | 拿到非空消息时调用 |
| `stringify(r, ctx)` | 见下 | 返回空串表示不通知 |

- 默认 `stringify`：`r.ok`、`r.kind === 'cancel'`、`ctx.request.silent` 时返回 `''`；否则 `r.message || \`${r.kind} ${r.status}\``。
- 请求级：`notify: false`，或内核选项 `silent: true`（现在 `silent` 真正生效）。
- 行为：每个逻辑请求最多一次。
- 变化：`stringify` 从 `(data, message, status, config)` 改为 `(r, ctx)`，并且有默认值；文件头那段关于 auth 重放双触发的过时警告随旧代码删除。

## 3. prepare 阶段

### 3.1 repath（prepare，内置次序 1）

- 选项不变：`pattern`（默认匹配 `{id}` / `:id` / `[id]`）、`removeKey`（默认 true）。
- 行为不变：只处理 pathname；先从 params 取值（含实例 `defaults.params`），再从 data 取；按路径段 `encodeURIComponent`；同一个占位符出现多次全部替换。
- 实现：算出新的 url、params、data 后调用 `next({ url, params, data })`，不改调用方传入的对象。
- 请求级：`false` / `true` / `{ enable, pattern, removeKey }`（按字段覆盖）。

### 3.2 filter（prepare，内置次序 2）

- 选项不变：`predicate([k, v])`（默认丢弃 null、undefined、NaN、空白串）、`ignoreKeys`、`ignoreValues`。
- 行为：剥离 params 和 data（纯对象）里的空字段，生成新对象，用 patch 交给内层；params 含实例 `defaults.params`，被剥掉的默认键不会被 axios 二次合并带回。
- 请求级：`false` / `true` / `{ enable, predicate, ignoreKeys, ignoreValues }`（按字段覆盖）。
- 变化：**装上即生效**（N6），请求级 `filter: false` 关闭；旧版要请求级写 `filter: true` 才过滤，装了不生效是个坑。

## 4. attempt 阶段：retry

| 选项 | 默认 | 说明 |
|---|---|---|
| `max` | **2**（旧 0） | 最大重试次数 |
| `methods` | `get put head delete options trace` | 硬否决：方法不在表里一律不重试 |
| `statusCodes` | `[408, 429, 500, 502, 503, 504]` | 对照 `r.status`（逻辑状态） |
| `shouldRetry(r, attempt, ctx)` | — | 返回 true/false 即采用，undefined 继续往下判 |
| `delay` | `attempt => 300 * 2 ** (attempt - 1)`（旧 3000） | 数字或函数 `(attempt, max, r) => number` |
| `jitter` | — | `true` 或 `(delay) => number` |
| `delayMax` | 10_000（旧 Infinity） | 只封顶自己算出的 delay |
| `respectRetryAfter` | true | 命中 `afterStatusCodes` 时按 `Retry-After`（数字秒或 HTTP-date）等待，上限 `retryAfterMax`；**不叠加** jitter、**不受** `delayMax` 限制（沿用旧行为）；头缺失或非法时回退到 `delay` |
| `afterStatusCodes` | `[413, 429, 503]` | 对照 `r.status`；business 风格的 429 也能用 |
| `retryAfterMax` | Infinity | — |

**判定顺序**（每级都能提前结束）：
1. 请求级 `retry: false` → 不重试；
2. 方法不在 `methods` → 不重试；
3. `r.kind` 为 `cancel` / `auth` / `internal` / `parse` → 不重试；
4. `shouldRetry` 返回布尔值 → 采用；
5. `r.kind` 为 `network` / `timeout` → 重试；
6. 否则 `statusCodes.includes(r.status)`。

**行为**：
- 先调 `ctx.markReplayable()`，再在循环里调 `next()`。
- 等待期间监听 `ctx.signal`，取消立即结束等待。
- 次数用尽时返回最后一次的 `R`，由落定决定抛不抛。
- 每次尝试都穿过 credential、source 阶段：auth 注入最新 token，401 会先刷新再重放；mock、share、cache 每次都参与。

**请求级**：数字 = `max`；`false`；`true`；对象按字段覆盖。

**变化**：
- 删除 `axp:retry:share`、`axp:retry:cache` 保活键、`captureRawRequest`、`runAttempt`（O1）。
- 默认值变化（N6）：`max` 0→2、`delay` 3000→指数退避、`delayMax` Infinity→10_000。
- `statusCodes` 和 `afterStatusCodes` 改读逻辑状态（O5）。
- `shouldRetry` 签名从 `(response?, err?)` 改为 `(r, attempt, ctx)`。

## 5. credential 阶段：auth

| 选项 | 默认 | 说明 |
|---|---|---|
| `tokenManager` | **必填** | `ITokenManager`（不再有 `canRefresh`） |
| `onRefresh(r, tm)` | **必填** | 返回 `false` 或抛错算失败；同一时刻只跑一个 |
| `onAccessExpired(r, tm)` | **必填** | 会话过期，每轮只通知一次 |
| `onAccessDenied(r, tm)` | → `onAccessExpired` | 越权或本地无 token |
| `onFailure(r, tm, ctx)` | `defaultAuthFailure` | 返回 `AuthFailureAction` 五动作之一 |
| `methods` / `urlPattern` | `'*'` | 受保护判定，语义不变（URLPattern，`!` 否定） |
| `isProtected(request)` | — | 布尔即终值 |
| `ready(tm, request)` | 写 `Authorization` 头 | 返回 `AxpRequestPatch` |

**主流程**：

```
未受保护 → return next()
ctx.markReplayable()
正在刷新 → 等刷新结果；失败 → onAccessExpired（每轮一次），返回 ctx.fail({ kind: 'auth', reason: 'expired' })
本地无 token → onAccessDenied，返回 ctx.fail({ kind: 'auth', reason: 'unauthenticated' })
patch = ready(tm, request)；记下本次注入的 token（状态键）
r = await next(patch)
r.ok → return r
switch onFailure(r, tm, ctx):
  refresh → 加入或发起刷新；成功则带新 token 再 next() 一次；失败按 expired 处理
  replay  → 带当前 token 再 next() 一次
  deny    → onAccessDenied；返回 fail({ kind: 'auth', reason: 'denied', from: r })
  expired → tm.clear()；onAccessExpired；返回 fail({ kind: 'auth', reason: 'expired', from: r })
  others  → return r
重放后仍判 refresh / replay → 按 expired 处理（防循环，沿用现有规则）
```

**默认路由 `defaultAuthFailure`**：
- `r.status === 401`：tm 无 token → expired；本次注入的 token ≠ 当前 token → replay（已被并发刷新）；否则 → refresh。
- `r.status === 403` → deny。
- 其它 → others。

因为读的是逻辑状态，business 风格（HTTP 200 + code 401）自动适用。

**刷新可用性（O4）**：
- `canRefresh` 从 `ITokenManager` 删除，收进插件状态。
- 判定过期时记下当时的 token 快照；token 没变之前不再刷新、不再重复通知过期；登录写入新 token 后自动恢复，登录流程不用再手动改 `canRefresh = true`。

**单飞刷新**：状态建在 `setup` 里（每个客户端一份），不再挂 `WeakMap<AxiosInstance>`。

**请求级**：`protected?: boolean`。

**变化**：
- 回调参数统一为 `(r, tm)`；`onFailure` 收到的是 `R` 而不是 `AxiosResponse`。
- 删除 `config.authExpired` 标记，改看 `r.reason === 'expired'`。
- 删除 `accessDeniedCode`、`ACCESS_DENIED_CODE`、`authFailureFactory`（由 `defaultAuthFailure` 取代，按状态键识别携带的 token，不再解析请求头）。
- 删除尝试钩子 `registerAttemptHook`：retry 的每次尝试本来就会穿过 auth。

## 6. source 阶段

### 6.1 mock（source，内置次序 1）

| 选项 | 默认 | 说明 |
|---|---|---|
| `enable` | false | 通常写 `import.meta.env.DEV` |
| `mock` | false | 全部请求走 mock |
| `mockUrl` | — | mock 服务器基址；请求开启了 mock 但没有 mockUrl 时跳过 mock、直接走真实接口（debug 下 warn） |
| `fallbackWhen(r)` | `r.httpStatus === 404 \|\| r.kind === 'network'` | 判定回落真实接口 |

- 行为：探测 `next({ url: <改写到 mockUrl>, cache: false, share: false })`；`fallbackWhen(r)` 为真时再 `next()` 走真实接口。探测不写缓存、不占共享条目（沿用现有规则）。
- 请求级：`false` / `true` / `{ mockUrl, fallbackWhen }`。
- 变化：`fallbackWhen` 参数从 `{ response?, error? }` 改为 `r`。

### 6.2 share（source，内置次序 2）

| 选项 | 默认 | 说明 |
|---|---|---|
| `policy` | `'start'` | `start` / `end` / `race` |
| `methods` | `get head` | 其它方法即使请求级开启也不共享 |

- 开启：请求级 `share: true` / 策略字符串 / `{ policy }`；`ctx.key()` 为 null 时直接 `next()`。
- **start**：首发调用 `next({ signal: 共享 controller })`；每个订阅者监听自己的 `ctx.signal` 和 `timeout`，单独离开只 reject 自己；全部离开才中止共享请求。首发取消不连累跟随者。
- **end**：每个新调用都发送，只有最新一次的结果落定共享结果。
- **race**：每个调用都发送，第一个 `r.ok` 的胜出；全部失败时用最后一个。
- 跟随者拿到的是同一个 `R`（只读，`r.request` 是首发那次的请求，URL 与参数和跟随者一致）；不再需要 `$rebindResponse` / `$rebindError`。各调用方自己的请求在各自的 `ctx.request` 上。
- 跟随者超时用 `ctx.fail({ kind: 'timeout' })`；取消用 `kind: 'cancel'`。
- 共享以"一次尝试"为单位：retry 在 share 外层，每次重试都会重新经过 share。同 key 的并发调用在每一轮尝试里只发一次网络请求，失败后各调用方由自己外层的 retry 决定是否重试，重试时又会合并到新一轮共享里。
- 变化：策略 `'none'` 删除（用 `false`）；race 的胜负判定从 `$defaultShouldCache` 改为 `r.ok`；新增 `methods`。

### 6.3 cache（source，内置次序 3）

| 选项 | 默认 | 说明 |
|---|---|---|
| `expires` | 60_000 | ms |
| `max` | 500 | LRU 容量，`Infinity` 不限；小于 1 时回退 500 |
| `methods` | `get head`（N7） | 其它方法即使请求级开启也不缓存 |
| `clone` | — | `'shallow'` / `'deep'` / `(data) => data`，作用于 `r.data` |
| `shouldCache(r)` | `r.ok` | 是否写入 |
| `store` | 内存 LRU | `IAxpCacheStore<R>`，持久化实现留给以后 |

- 开启：请求级 `cache: true`；数字 = `expires`；对象 `{ expires, key, clone, shouldCache }`，其中 `key` 是显式缓存键。
- `ctx.key()` 为 null（不可哈希）且没有显式 key 时，直接 `next()`，既不读也不写缓存（与 share 一致）。
- 命中：直接返回缓存的 `R`（按 `clone` 拷贝 data），不触网，不重跑 `transformResponse`（N9）。
- 新旧顺序：较早发起、较晚返回的响应不覆盖较新的结果；`clear()` 之后在途请求返回也不写回。语义沿用现状。
- 表收敛（O3）：`written` 和 `inflight` 合并为 `Map<key, { latestSeq, pending }>`；`epoch` 保留；条目被淘汰且没有在途请求时回收这个 key 的记录。
- 过期：读时惰性删除；写入超过容量时清扫，不再每次写入全表扫描（O6）。
- 操作：`client.plugin(cachePlugin)` 返回 `{ remove(key): boolean, clear(): number }`；另导出 `removeCache(client, key): boolean`、`clearCache(client): number`，客户端没装 cache 时返回 `false` / `0`。
- 删除旧版只有类型、从未生效的 `storage`、`memory` 选项，持久化统一走 `store`。

```ts
/** 缓存存储接口：同步，键是 key 服务算出的字符串 */
interface IAxpCacheStore<R extends IAxpResponse> {
  get(key: string): IAxpCacheEntry<R> | undefined
  set(key: string, entry: IAxpCacheEntry<R>): void
  delete(key: string): boolean
  clear(): void
  readonly size: number
}
interface IAxpCacheEntry<R> { response: R; expiresAt: number }
```

- 变化：`clearCache(ax)` 参数从 axios 实例改为客户端；默认不缓存 POST；`shouldCache` 参数改为 `r`。

## 7. envs

- 只有 `setup`：装上时按规则选第一个命中的配置，写进 `client.axios.defaults`；不进中间件链。卸载（`eject` / `dispose`）不还原已写入的配置。
- 选项不变：`axpEnvs([{ rule, config }])`。

## 8. TokenManager

- `ITokenManager`：`accessToken`、`refreshToken`、`set(access?, refresh?)`、`clear()`；删除 `canRefresh`（O4）。
- 默认实现 `TokenManager` 行为不变，仍持久化到 `localStorage`。

## 9. 行为变化汇总（发版写进 CHANGELOG）

| 范围 | 变化 |
|---|---|
| 入口 | `Axp.create` / `Axp.install` / `AxpHandle` / `Core` → `createAxp` + `AxpClient`；插件只对 axp 客户端生效 |
| 错误 | 没有错误类：可预期的失败直接抛 `R`（不是 `Error`），类别看 `r.kind` / `r.reason`；bug 抛原始异常；用 `isAxpResponse` / `api.isResponse` 区分；需要 `Error` 时用 `reject` 适配。`ApiError` 删除；旧 `AxpResponse` 重写为新的默认实现（静态 `isSuccessful`、`fromResponse` 删除） |
| 成功判定 | `AxpResponse.isSuccessful` 静态钩子 → 子类覆盖 `ok` / `status` getter |
| 回调抛错 | 判定类回调抛错不再被吞，抛原始异常（N13） |
| 返回 | `raw: true` 删除；`wrap: true` 成功时返回 `WithData<R, D>`、失败照常抛出；新增请求级 `throws: false`（没有客户端级默认值） |
| 插件 | 删除 `axpCancel`、`axpKey`、`axpLogger`、`axpNormalize`，能力并入内核 |
| 请求选项 | 不再接受函数形式；`normalize: false` → `throws: false`；`key: true` 包含参数 |
| 默认值 | filter 装上即生效；retry `max: 2`、指数退避、`delayMax: 10_000`；cache 只缓存 GET/HEAD |
| 判定 | auth、retry、notify、cache、share、mock 统一读 `R`，`status` 为逻辑状态 |
| auth | 回调参数 `(r, tm)`；`canRefresh` 删除；`authExpired` 标记 → `r.reason` |
| 时序 | loading 覆盖 token 刷新等待；缓存命中不重跑 `transformResponse`；axios 错误拦截器不再看到 4xx/5xx |
| 派生 | `extend()` 默认继承插件，各自独立状态 |
| 子路径 | 删除 `./cancel` `./key` `./logger` `./normalize` |
