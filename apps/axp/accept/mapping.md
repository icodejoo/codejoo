# axp 能力映射表

testkit 的中立场景 → axp 的落地方式。代码版在 `lib/mapping.ts`（纯数据，dry-run 不依赖打包产物），
单测 `unit/mapping-report.test.ts` 会核对"schema 的每个字段都已登记"，两边必须一致。

约定：**已映射** = 有对应的 axp 参数；**显式报错** = 映射不了，执行器直接把该场景判失败（reason 以"映射不了:"开头），不会静默忽略。
缺少整项能力（`requires` 里有 axp 不具备的）走另一条路：`skipped: missing <cap>`。

axp 具备的能力：`auth cache retry share cancel loading mock normalize notify repath key filter envs log`。
缺失：`breaker offline timeout`（对应场景一律跳过）。

---

## 表 1：中立选项 → axp 参数

### 1.1 插件选项（`client.plugins`）

| 中立插件.选项 | 状态 | axp 落地 |
|---|---|---|
| `auth.url_pattern` | 已映射 | `axpAuth({ urlPattern: [p, p + '/*'] })`。中立语义是路径**前缀**，axp 的 URLPattern 是精确匹配，所以展开成两条；缺省 `/t/private` |
| `auth.refresh = 'endpoint'` | 已映射 | `onRefresh`：执行器用裸 axios（同 adapter、同 baseURL，不经插件链）POST `/t/auth/refresh`，成功则写回令牌。其它取值显式报错 |
| `auth.refresh_query` | 已映射 | 作为刷新请求的查询参数 |
| （auth 的回调） | 执行器提供 | `onFailure`、`onAccessExpired`、`onAccessDenied` 见表 3 |
| `cache.ttl_ms` | 已映射 | `axpCache({ expires })` |
| `cache.max` | 已映射 | `axpCache({ max })` |
| `cache.methods` | 已映射 | axp 没有方法白名单，用 `shouldCache(res)` 叠加：方法在名单内且业务成功才写缓存。**未写 `methods` 时取中立默认 GET/HEAD**（axp 本身的缓存由请求级 `cache` 开关驱动、不区分方法，这里让中立语义与 retry 的默认方法对称） |
| `retry.max` | 已映射 | `axpRetry({ max })` |
| `retry.delay_ms` | 已映射 | `delay` |
| `retry.statuses` | 已映射 | `statusCodes`；缺省取中立默认 `[500,502,503,504]`（比 axp 默认少 408/429） |
| `retry.methods` | 已映射 | `methods`（转小写）；缺省取中立默认 GET/PUT/HEAD/DELETE/OPTIONS |
| `retry.respect_retry_after` | 已映射 | `respectRetryAfter` |
| （retry 的 business 适配） | 执行器提供 | `shouldRetry`、`afterStatusCodes: [200,413,429,503]`，见 §业务风格适配 |
| `share.policy` | 已映射 | `axpShare({ policy })`，支持 start/end/race |
| `loading.delay_ms` | 已映射 | `axpLoading({ delay })` |
| `loading.delay_close_ms` | 已映射 | `delayClose`；执行器在场景结束后多等 `delay_close_ms + 60ms` 再取 loading 序列 |
| `notify` `{}` | 已映射 | `axpNotify({ notify, stringify })`，回调见表 3 |
| `normalize` `{}` | 已映射 | `axpNormalize({})` |
| `key.scope = 'user'` | 已映射 | `axpKey({ scope: () => 当前登录用户名 })`。其它 scope 显式报错 |
| `mock.fallback_on_404` | 已映射 | `axpMock({ enable: true, mockUrl: <baseURL>/t/mock })`；`true`/缺省 = axp 默认回落（404 或 mock 不可达），`false` = `fallbackWhen: () => false` |
| `repath` `{}` | 已映射 | `axpRepath({})` |
| `filter` `{}` | 已映射 | `axpFilter({})` |
| `cancel` `{}` | 已映射 | `axpCancel({})` |
| `envs` `{}` | 已映射 | `axpEnvs([])`（无规则，仅为占位） |
| `log` `{}` | 已映射 | `axpLogger({})`（默认关闭 debug） |
| `breaker.*` | **显式报错** | axp 没有熔断。场景因 `requires: breaker` 先被跳过 |
| `offline.*` | **显式报错** | axp 没有离线探测插件。同上 |
| `timeout.*`（connect/receive/total） | **显式报错** | axp 没有分阶段超时（只有 axios 的整体 `timeout`）。同上 |
| 其它任何未登记的选项 | **显式报错** | 例如 `cache.foo` |

### 1.2 请求级选项（`request.options`）

| 中立选项 | 状态 | axp 落地 |
|---|---|---|
| `auth` | 已映射 | `protected`；不写则由插件的 `urlPattern` 决定 |
| `cache` `true/false/{ttl_ms,key}` | 已映射 | `cache: true/false/{ expires, key }` |
| `retry` `n/false/{max,delay_ms,statuses,methods,respect_retry_after}` | 已映射 | `retry: n/false/{ max, delay, statusCodes, methods(小写), respectRetryAfter }`；对象里的其它键显式报错 |
| `share` `true/false/'start'/'end'/'race'/'none'` | 已映射 | `share` 原样 |
| `loading` | 已映射 | `loading` |
| `silent` | 已映射 | `silent`（axp 的 notify 本身不读它，由执行器的 `stringify` 读） |
| `timeout_ms` | 已映射 | `timeout`（axios 整体超时） |
| `key` `true/'deep'` | 已映射 | axp `key: 'deep'`。**注意**：axp 的 `key: true` 是 simple，只哈希 method+url，不含 `params`；而中立语义里 `true` 要把查询参数算进 key（场景 `share.different-keys-independent` 等依赖这一点），所以翻成 `'deep'` |
| `key` `'simple'` | 已映射 | axp `key: true` |
| `key` 其它字符串 | 已映射 | 显式 key，原样传 |
| `mock` | 已映射 | `mock` |
| `normalize` | 已映射 | `normalize` |
| `filter` `true/false` | 已映射 | `filter: true/false`（axp 的 `axpFilter` 只在请求级 `config.filter` 为真时才过滤，不写则原样发送；插件级 `filter: {}` 只装配插件、不自动生效）。中立语义只含默认剔除 null/undefined/NaN/空白字符串、保留 0/false，不含 ignoreKeys/ignoreValues/predicate |
| `breaker` | **显式报错** | axp 没有熔断 |
| `cancel_after_ms`（request 的同级字段） | 已映射 | 执行器给该请求配一个 `AbortController` 作为 `signal`，到点 abort |

### 1.3 step 类型（全部 16 种）

| step | 实现 |
|---|---|
| `request` | 经 axp（`Axp.create(instance)` 的 `core.get/post…`）发出，返回信封已解包的 data |
| `parallel` / `sequence` / `repeat` / `fire` / `wait` | `lib/steps.ts` 纯编排；repeat 默认给内部请求 id 追加 `#i`；fire 在场景结束前统一等待 |
| `login` / `logout` / `revoke` / `server_reset` | **旁路**：node 原生 `fetch` 直连服务器，不经 netem，不经插件链（CONTRACT 附录 B.2）。login 把令牌写入 `TokenStore`，并重置 `canRefresh` |
| `set_token` | `TokenStore.applySetToken`：none/empty/garbage/bad_signature（改签名段）/tampered_payload（改 sub 不重签）/wrong_scheme（前缀改成 `Token`）/previous/keep；refresh 的 none/garbage/previous/keep |
| `expire_local` | 旁路再登录一次，`access_ttl_ms=1`，只取 access 写入客户端（refresh 不变），等 30ms 让它过期 |
| `cancel_all` | 先等 `after_ms` 再调 axp 的 `cancelAll(instance)` |
| `clear_cache` | axp 的 `clearCache(instance)` |
| `network` | 预设名/profile 对象走 netem `PUT /proxies/{id}`；`flap` 走 `POST /proxies/{id}/schedule`；`dns` 改 `baseURL` 的 host（注意：已装好的 mock 基址不会跟着变） |
| `style` | 改 `X-Test-Style`，从下一个请求起生效 |

---

## 表 2：axp 错误 → 错误类别

判定顺序（`lib/classify.ts`）：auth 标签 → auth 插件自身错误 → 取消 → 解析标记 → `ApiError` → 带响应的状态码 → 超时 → 网络 → 解析 → `unknown:`。

| axp / axios 表现 | 错误类别 |
|---|---|
| 请求被 auth 打上 expired 标签；或抛 `[axp:auth] refresh failed; aborting request`（排队请求等刷新失败） | `expired` |
| 请求被打上 denied 标签（403，两种风格都识别） | `denied` |
| 请求被打上 unauthenticated 标签（客户端没有 access 时 axp 本地拒绝，抛 `[axp:auth] access denied`；或服务端 `reason=missing` 且没有 refresh） | `unauthenticated` |
| `CanceledError`、`code=ERR_CANCELED`、`AbortError` | `canceled` |
| `parseGuard` 打的解析标记（见下） | `parse` |
| `ApiError`（normalize 业务失败）：`response.status ≥ 400` | `http:<status>` |
| `ApiError`：HTTP 2xx 且 code ≠ 0 | `business:<code>` |
| AxiosError 带 `response`，状态码 ≥ 400 | `http:<status>`（优先于超时/网络判断） |
| `ETIMEDOUT`，或 `ECONNABORTED` 且消息含 timeout | `timeout` |
| `ERR_NETWORK`、`ECONNREFUSED`、`ECONNRESET`、`ENOTFOUND`、`EAI_AGAIN`、`EPIPE`、`UND_ERR_*`（含 `cause.code`），或消息含 socket hang up / fetch failed / stream has been aborted | `network` |
| 其它 `ERR_BAD_RESPONSE`、`SyntaxError` | `parse` |
| 认不出来的 | `unknown:<name>:<message>`，不会匹配任何预期（`any` 除外） |

预期里的 `status:<n>`：http 风格匹配 `http:<n>`，business 风格匹配 `business:<n>`；风格取该请求**发出时**的风格（`style` step 之后会变）。

**解析错误怎么来的**：axios 默认对坏 JSON 静默放过，把原始字符串留在 `data` 里。执行器在 `transformResponse` 末尾加了 `parseGuard`：
服务端声明 `json` 或 `html`、状态码 < 400、body 仍是非空字符串时，抛一个带解析标记的 `AxiosError`，让 notify/loading/retry 整条链都把它当失败（覆盖 `bad_json` 与网关 `html` 拦截页）。
这属于"应用层要求 JSON"的策略，不是 axp 自带行为。

---

## 表 3：axp 回调 → 客户端事件

| 事件（CONTRACT §7） | 来源 |
|---|---|
| `loading` | `axpLoading({ loading })` 的回调，原样记录布尔序列 |
| `notify` | `axpNotify({ notify })` 的回调，记次数与文案。`stringify` 返回空串即不提示：`silent`、用户主动取消（`config.signal.aborted`）、成功（2xx 且信封 code 为 0 或无信封）都不提示 |
| `refresh` | `onRefresh` 里**实际向服务器发起刷新**才计一次；没有 refresh 令牌时直接返回 false，不计 |
| `expired` | `onAccessExpired`。**每个**走到过期的请求各触发一次（axp 就是这样），执行器如实计数，不去重 |
| `denied` | `onAccessDenied`，仅当响应不是 axp 合成的"无令牌"响应（`status=0` 且 `data.code='ACCESS_DENIED'`）时计；合成的那种记为 unauthenticated 标签，不计 denied |
| `pending_after` | 执行器自己的在途计数：请求发出 +1、落定 −1，场景结束时的余额 |

通用断言（MATRIX §4）每次运行都检查：`pending_after = 0`、loading 成对且最后是 false、服务端 `inflight = 0`
（先删 netem 代理关闭连接，再轮询到归零，最长 3 秒）。

---

## 业务风格适配

business 风格下失败是 **HTTP 200 + code**，axp 默认只看 HTTP 状态码的几个环节需要执行器补一层"逻辑状态"
（`logicalStatus`：HTTP ≥ 400 取状态码；HTTP 2xx 且信封 code 为非 0 数字取 code）：

| 环节 | 适配 |
|---|---|
| auth | 自定义 `onFailure`：用逻辑状态判 401/403；`reason=missing` 且没有 refresh → 不刷新；其余复用 axp 的 `authFailureFactory` |
| retry | 自定义 `shouldRetry`：用逻辑状态判是否在 `statuses` 内；没有响应时只有网络错误与超时可重试，取消/解析/鉴权本地错误不重试。`afterStatusCodes` 额外加入 200，让 business 风格的 `Retry-After` 也生效 |
| notify | `stringify` 同样看逻辑状态 |
| 结果判定 | auth 在"过期/越权"后会把失败响应原样 resolve（尤其未装 normalize 时），此时以 auth 标签为准判为失败 |

---

## 已知与 axp 原生行为的差异（不是执行器 bug，会体现在结果里）

- `expired` 回调一轮失败只触发一次；每个因过期失败的请求靠 `config.authExpired` 标记归类为 `expired`（执行器在 auth 之后的响应拦截器里读标记）。
- `share` 的首发请求被取消时，底层请求用的是首发请求的 signal，会连带取消跟随者（场景要求"首发取消不连累跟随者"）。
- 缓存不区分方法：请求级 `cache: true` 的 POST 也会被缓存；执行器用 `cache.methods` 默认值（GET/HEAD）叠加 `shouldCache` 对齐中立语义（场景 `cache.post-not-cached-by-default`）。

这些都是用真实服务器跑之后才能最终确认的结论，这里只记录从源码读到的预判。
