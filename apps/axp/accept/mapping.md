# axp 能力映射表

testkit 的中立场景 → axp 的落地方式。代码版在 `lib/mapping.ts`（纯数据，dry-run 不依赖打包产物），
单测 `unit/mapping-report.test.ts` 会核对"schema 的每个字段都已登记"，以及下面的能力清单与代码一致，两边必须一致。

> **过渡期说明**：本文按新架构（洋葱管线 + 归一化响应 `IAxpResponse`）写。`lib/client-factory.ts` 的组装留给 B7，
> 目前仍是旧 API 的写法，所以标了"B7"的条目是目标状态，client-factory 还没跟上。

约定：**已映射** = 有对应的 axp 参数；**显式报错** = 映射不了，执行器直接把该场景判失败（reason 以"映射不了:"开头），不会静默忽略。
缺少整项能力（`requires` 里有 axp 不具备的）走另一条路：`skipped: missing <cap>`。

axp 的能力：
- 内核具备：`cancel key normalize log`（不再是插件，不用装配）
- 插件提供：`auth cache retry share loading mock notify repath filter envs`
- 缺失：`breaker offline timeout`（对应场景一律跳过）

---

## 表 1：中立选项 → axp 参数

### 1.1 插件选项（`client.plugins`）

| 中立插件.选项 | 状态 | axp 落地 |
|---|---|---|
| `auth.url_pattern` | 已映射 | `axpAuth({ urlPattern: [p, p + '/*'] })`。中立语义是路径**前缀**，axp 的 URLPattern 是精确匹配，所以展开成两条；缺省 `/t/private` |
| `auth.refresh = 'endpoint'` | 已映射 | `onRefresh`：执行器用裸 axios（同 adapter、同 baseURL，不经插件链）POST `/t/auth/refresh`，成功则写回令牌。其它取值显式报错 |
| `auth.refresh_query` | 已映射 | 作为刷新请求的查询参数 |
| （auth 的回调） | 执行器提供 | `onAccessExpired`、`onAccessDenied` 只负责上报事件，见表 3；`onFailure` 用 axp 默认的 `defaultAuthFailure`（读逻辑状态），B7 删除执行器自带的 `makeOnFailure` |
| `cache.ttl_ms` | 已映射 | `axpCache({ expires })` |
| `cache.max` | 已映射 | `axpCache({ max })` |
| `cache.methods` | 已映射 | 直接作为插件选项 `axpCache({ methods })`（转小写）。**未写 `methods` 时不传**，沿用 axp 默认 `get head`，正好和中立默认 GET/HEAD 一致。不再用 `shouldCache` 叠加（B7 删除 `makeShouldCache` 与 `DEFAULT_CACHE_METHODS`）。写成空数组表示任何方法都不缓存 |
| `retry.max` | 已映射 | `axpRetry({ max })` |
| `retry.delay_ms` | 已映射 | `delay` |
| `retry.statuses` | 已映射 | `statusCodes`；缺省取中立默认 `[500,502,503,504]`（比 axp 新默认 `[408,429,500,502,503,504]` 少 408/429） |
| `retry.methods` | 已映射 | `methods`（转小写）；缺省取中立默认 GET/PUT/HEAD/DELETE/OPTIONS |
| `retry.respect_retry_after` | 已映射 | `respectRetryAfter` |
| （retry 的 business 适配） | 不再需要 | axp 的 `statusCodes` / `afterStatusCodes` 读逻辑状态，business 风格自动生效；B7 删除 `shouldRetry`、`afterStatusCodes` 补丁，见 §业务风格适配 |
| `share.policy` | 已映射 | `axpShare({ policy })`，支持 start/end/race |
| `loading.delay_ms` | 已映射 | `axpLoading({ delay })` |
| `loading.delay_close_ms` | 已映射 | `delayClose`；执行器在场景结束后多等 `delay_close_ms + 60ms` 再取 loading 序列 |
| `notify` `{}` | 已映射 | `axpNotify({ notify })`，回调见表 3；`stringify` 用 axp 默认（B7 删除 `notifyText`） |
| `normalize` `{}` | 内核具备 | 归一化响应是内核的一部分，无需装配 |
| `key.scope = 'user'` | 已映射 | 内核 key 服务：`createAxp({ key: { scope: () => 当前登录用户名 } })`。其它 scope 显式报错 |
| `key` `{}` | 内核具备 | key 服务是内核的一部分，无需装配 |
| `mock.fallback_on_404` | 已映射 | `axpMock({ enable: true, mockUrl: <baseURL>/t/mock })`；`true`/缺省 = axp 默认回落（404 或 network），`false` = `fallbackWhen: () => false` |
| `repath` `{}` | 已映射 | `axpRepath({})` |
| `filter` `{}` | 已映射 | `axpFilter({})`（新架构装上即生效） |
| `cancel` `{}` | 内核具备 | 取消是内核的一部分（`client.cancelAll()`），无需装配 |
| `envs` `{}` | 已映射 | `axpEnvs([])`（无规则，仅为占位） |
| `log` `{}` | 内核具备 | 日志开关是内核的一部分（`createAxp({ debug })`），执行器不开 debug |
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
| `share` `true/false/'start'/'end'/'race'/'none'` | 已映射 | `share` 原样。新架构里策略 `'none'` 已删除（改用 `false`），**待 B7 把 `'none'` 翻成 `false`** |
| `loading` | 已映射 | `loading` |
| `silent` | 已映射 | `silent`（内核自带的请求选项，axp 默认的 notify `stringify` 读它，B7 不用再自己判断） |
| `timeout_ms` | 已映射 | `timeout`（axios 整体超时） |
| `key` `true` | 已映射 | `key: true`，即 axp key 服务的默认行为：method + url + params，有请求体的方法再加 data。**不再翻译成 `'deep'`** |
| `key` `'deep'` | 已映射 | 与 `true` 同义，翻成 `key: true`。新 API 里 `'deep'` 已删除，原样传会被当成一条字面 key，所以必须翻译 |
| `key` `'simple'` | **显式报错** | 只看方法+路径的模式，新 key 服务没有（始终含 params 与请求体）。当前 testkit 场景里没有用到 |
| `key` `false` | 已映射 | `key: false`，本请求不参与 cache / share |
| `key` 其它字符串 | 已映射 | 显式 key，原样传 |
| `mock` | 已映射 | `mock` |
| `normalize` | 已映射（**待 B7**） | 目前仍原样传 `normalize`；新架构里请求级 `normalize: false` 被 `throws: false` 取代（plugin-spec §9），失败不抛而是 resolve 出 `ok: false` 的结果，执行器的结果判定要跟着改，留给 B7 |
| `filter` `true/false` | 已映射 | `filter: true/false`。新架构里 `axpFilter` 装上即生效，请求级 `filter: false` 关闭；写 `true` 等同默认。中立语义只含默认剔除 null/undefined/NaN/空白字符串、保留 0/false，不含 ignoreKeys/ignoreValues/predicate |
| `breaker` | **显式报错** | axp 没有熔断 |
| `cancel_after_ms`（request 的同级字段） | 已映射 | 执行器给该请求配一个 `AbortController` 作为 `signal`，到点 abort |

### 1.3 step 类型（全部 16 种）

| step | 实现 |
|---|---|
| `request` | 经 axp 客户端发出，返回信封已解包的 data（旧 API 是 `Axp.create(instance)` 的 `core.get/post…`，B7 改 `createAxp`） |
| `parallel` / `sequence` / `repeat` / `fire` / `wait` | `lib/steps.ts` 纯编排；repeat 默认给内部请求 id 追加 `#i`；fire 在场景结束前统一等待 |
| `login` / `logout` / `revoke` / `server_reset` | **旁路**：node 原生 `fetch` 直连服务器，不经 netem，不经插件链（CONTRACT 附录 B.2）。login 把令牌写入 `TokenStore`，并重置 `canRefresh`（新架构删除 `canRefresh`，登录写入新 token 后 auth 自动恢复刷新，B7 去掉这一步） |
| `set_token` | `TokenStore.applySetToken`：none/empty/garbage/bad_signature（改签名段）/tampered_payload（改 sub 不重签）/wrong_scheme（前缀改成 `Token`）/previous/keep；refresh 的 none/garbage/previous/keep |
| `expire_local` | 旁路再登录一次，`access_ttl_ms=1`，只取 access 写入客户端（refresh 不变），等 30ms 让它过期 |
| `cancel_all` | 先等 `after_ms` 再调客户端的 `cancelAll()` |
| `clear_cache` | cache 插件的 `clearCache(client)` |
| `network` | 预设名/profile 对象走 netem `PUT /proxies/{id}`；`flap` 走 `POST /proxies/{id}/schedule`；`dns` 改 `baseURL` 的 host（注意：已装好的 mock 基址不会跟着变） |
| `style` | 改 `X-Test-Style`，从下一个请求起生效 |

---

## 表 2：axp 抛出的失败 → 错误类别

新架构下，axp 的失败一律抛出 `IAxpResponse`（程序 bug 抛原始异常，不伪装成请求失败）。执行器用 `isAxpResponse` 的共享品牌识别，
**直接读字段归类，不看 message、不猜形状**（`lib/classify.ts` 的 `classifyResponse`）。判定顺序：IAxpResponse 品牌 → 〔过渡期旧形态，B7 删除〕→ `unknown:`。

| 抛出的 `IAxpResponse` | 错误类别 |
|---|---|
| `kind: 'cancel'` | `canceled` |
| `kind: 'timeout'` | `timeout` |
| `kind: 'network'` | `network` |
| `kind: 'parse'`（`ERR_BAD_RESPONSE`，或 `expectJson` 检出声明 JSON/HTML 却没解析的 2xx 响应体） | `parse` |
| `kind: 'auth'`，`reason: 'expired'` | `expired` |
| `kind: 'auth'`，`reason: 'denied'` | `denied` |
| `kind: 'auth'`，`reason: 'unauthenticated'` | `unauthenticated` |
| `kind: 'http'`（非 2xx） | `http:<httpStatus>` |
| `kind: 'biz'`（HTTP 2xx 且业务码判失败） | `business:<code>`，与旧口径一致 |
| `kind: 'auth'` 但 `reason` 缺失或不认识；或 `ok` / `internal` | `unknown:<kind>:<reason 或 message>` |
| 不是 `IAxpResponse` 的任何异常 | 按旧形态兜底；都认不出就是 `unknown:<name>:<message>`。新架构下这意味着 **axp 有 bug**（程序异常原样抛出），不会匹配任何预期（`any` 除外） |

预期里的 `status:<n>`：http 风格匹配 `http:<n>`，business 风格匹配 `business:<n>`；风格取该请求**发出时**的风格（`style` step 之后会变）。

### 过渡期保留的旧形态（B7 删除）

client-factory 还没改，仍会抛旧形态的错误，所以 classify 里保留了下面这些识别（代码里都标了"B7 删除：旧 API 形态"）：

| 旧 axp / axios 表现 | 错误类别 |
|---|---|
| 请求被 auth 打上 expired / denied / unauthenticated 标签；或抛 `[axp:auth] refresh failed`、`[axp:auth] access denied` | `expired` / `denied` / `unauthenticated` |
| `CanceledError`、`code=ERR_CANCELED`、`AbortError` | `canceled` |
| `parseGuard` 打的解析标记；其它 `ERR_BAD_RESPONSE`、`SyntaxError` | `parse` |
| 旧 `ApiError`：`response.status ≥ 400` / HTTP 2xx 且 code ≠ 0 | `http:<status>` / `business:<code>` |
| AxiosError 带 `response`，状态码 ≥ 400 | `http:<status>`（优先于超时/网络判断） |
| `ETIMEDOUT`，或 `ECONNABORTED` 且消息含 timeout | `timeout` |
| `ERR_NETWORK`、`ECONNREFUSED`、`ECONNRESET`、`ENOTFOUND`、`EAI_AGAIN`、`EPIPE`、`UND_ERR_*`（含 `cause.code`），或消息含 socket hang up / fetch failed / stream has been aborted | `network` |

**解析错误怎么来的**：axios 默认对坏 JSON 静默放过，把原始字符串留在 `data` 里。新架构由响应工厂 `axpResponse({ expectJson: true })` 负责：
声明 `json` 或 `html`、2xx、body 仍是非空字符串时判为 `kind: 'parse'`（覆盖 `bad_json` 与网关 `html` 拦截页）。
过渡期执行器还在用自己的 `parseGuard`（`transformResponse` 末尾抛带标记的 AxiosError），B7 换成 `expectJson` 后删除。

---

## 表 3：axp 回调 → 客户端事件

| 事件（CONTRACT §7） | 来源 |
|---|---|
| `loading` | `axpLoading({ loading })` 的回调，原样记录布尔序列 |
| `notify` | `axpNotify({ notify })` 的回调，记次数与文案。`silent`、用户主动取消（`kind: 'cancel'`）、成功都不提示，由 axp 默认 `stringify` 处理 |
| `refresh` | `onRefresh` 里**实际向服务器发起刷新**才计一次；没有 refresh 令牌时直接返回 false，不计 |
| `expired` | `onAccessExpired`。新架构**每轮只通知一次**（plugin-spec §5）；旧 API 是每个走到过期的请求各触发一次，执行器如实计数，不去重 |
| `denied` | `onAccessDenied`。新架构里"越权"与"本地无 token"都会进这个回调，靠 `r.reason`（`denied` / `unauthenticated`）区分，只有 `denied` 计入；旧 API 靠 axp 合成的"无令牌"响应（`status=0` 且 `data.code='ACCESS_DENIED'`）区分，B7 改读 `r.reason` |
| `pending_after` | 执行器自己的在途计数：请求发出 +1、落定 −1，场景结束时的余额 |

通用断言（MATRIX §4）每次运行都检查：`pending_after = 0`、loading 成对且最后是 false、服务端 `inflight = 0`
（先删 netem 代理关闭连接，再轮询到归零，最长 3 秒）。

---

## 业务风格适配

business 风格下失败是 **HTTP 200 + code**。旧版 axp 默认只看 HTTP 状态码，执行器得自己补一层"逻辑状态"
（`logicalStatus`）。**新架构由 axp 自身的逻辑状态（`r.status`）处理，执行器不再适配**：

| 环节 | 旧做法（B7 删除 client-factory 里的这些代码） | 新架构 |
|---|---|---|
| auth | 自定义 `onFailure`（`makeOnFailure`）：用逻辑状态判 401/403 | auth 默认的 `defaultAuthFailure` 读 `r.status`，HTTP 200 + code 401 自动算 401 |
| retry | 自定义 `shouldRetry`（`makeShouldRetry`），`afterStatusCodes` 额外加 200 | `statusCodes`、`afterStatusCodes` 都对照 `r.status`；取消 / 解析 / 鉴权 / internal 本来就不重试 |
| notify | `stringify`（`notifyText`）看逻辑状态 | 默认 `stringify` 读 `r.ok` / `r.kind` / `silent` |
| cache | `shouldCache`（`makeShouldCache`）自己解析信封判业务成功 | 默认 `shouldCache` 是 `r.ok` |
| 结果判定 | auth 在"过期/越权"后把失败响应原样 resolve，需以标签为准判失败 | 失败统一抛 `IAxpResponse`，`reason` 直接带原因，没有"被 resolve 的失败" |

---

## 已知与 axp 原生行为的差异（不是执行器 bug，会体现在结果里）

- `expired` 回调一轮失败只触发一次；每个因过期失败的请求靠 `config.authExpired` 标记归类为 `expired`（执行器在 auth 之后的响应拦截器里读标记）。
  **新架构已解决（待 B7 验收确认）**：回调每轮只通知一次，归类靠 `r.reason === 'expired'`，`authExpired` 标记删除。
- `share` 的首发请求被取消时，底层请求用的是首发请求的 signal，会连带取消跟随者（场景要求"首发取消不连累跟随者"）。
  **新架构已解决（待 B7 验收确认）**：共享请求用独立的 controller，全部订阅者离开才中止（plugin-spec §6.2）。
- 缓存不区分方法：请求级 `cache: true` 的 POST 也会被缓存；执行器用 `cache.methods` 默认值（GET/HEAD）叠加 `shouldCache` 对齐中立语义（场景 `cache.post-not-cached-by-default`）。
  **新架构已解决（待 B7 验收确认）**：cache 插件自带 `methods`，默认 `get head`，执行器直接传选项即可。
- 旧 `key: true` 只哈希 method+url，不含 `params`，所以执行器曾把中立 `true` 翻成 `'deep'`。
  **新架构已解决（待 B7 验收确认）**：新 key 服务默认含 params 与请求体，`true` 直接透传。
- `filter` 装上不自动生效，要请求级写 `filter: true`。
  **新架构已解决（待 B7 验收确认）**：装上即生效，请求级 `filter: false` 关闭。

这些都是用真实服务器跑之后才能最终确认的结论，这里只记录从设计文档读到的预判。
