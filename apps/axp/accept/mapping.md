# axp 能力映射表

testkit 的中立场景 → axp 的落地方式。代码版在 `lib/mapping.ts`（纯数据，dry-run 不依赖打包产物），
单测 `unit/mapping-report.test.ts` 会核对"schema 的每个字段都已登记"，以及下面的能力清单与代码一致，两边必须一致。

> 本文按新架构（洋葱管线 + 归一化响应 `IAxpResponse`）写，`lib/client-factory.ts` 经 `createAxp` 组装。
> 执行器里没有任何替 axp 补能力的代码：业务码、鉴权、重试、缓存、解析的判定全部由 axp 自己承担。

约定：**已映射** = 有对应的 axp 参数；**显式报错** = 映射不了，执行器直接把该场景判失败（reason 以"映射不了:"开头），不会静默忽略。
缺少整项能力（`requires` 里有 axp 不具备的）走另一条路：`skipped: missing <cap>`。
某个 网络×风格 格子在 axp 上不适用（语义对不上，不是 axp 有 bug）也跳过，理由以 `not applicable:` 开头，规则见 §跳过规则。

axp 的能力：

- 内核具备：`cancel key normalize log`（不再是插件，不用装配）
- 插件提供：`auth cache retry share loading mock notify repath filter envs`
- 行为级：`mock-in-chain keep-alive`（不对应插件或选项，axp 管线本身就满足，场景靠 `requires` 声明；2026-10-28 B7 验收用这两项各 4 格实测通过后登记）
- 缺失：`breaker offline timeout`（对应场景一律跳过）；另外 `multipart`（执行器不构造 multipart 请求体）、`share-retry`、`timeout-send` 也不在能力清单里，同样按缺能力跳过

---

## 表 1：中立选项 → axp 参数

### 1.1 插件选项（`client.plugins`）

| 中立插件.选项                        | 状态         | axp 落地                                                                                                                                                                                                                                              |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.url_pattern`                   | 已映射       | `axpAuth({ urlPattern: [p, p + '/*'] })`。中立语义是路径**前缀**，axp 的 URLPattern 是精确匹配，所以展开成两条；缺省 `/t/private`                                                                                                                     |
| `auth.refresh = 'endpoint'`          | 已映射       | `onRefresh`：执行器用裸 axios（同 adapter、同 baseURL，不经插件链）POST `/t/auth/refresh`，成功则写回令牌。其它取值显式报错                                                                                                                           |
| `auth.refresh_query`                 | 已映射       | 作为刷新请求的查询参数                                                                                                                                                                                                                                |
| （auth 的回调）                      | 执行器提供   | `onAccessExpired`、`onAccessDenied` 只负责上报事件，见表 3；`onFailure` 不传，用 axp 默认的 `defaultAuthFailure`（读逻辑状态）。本地没有 access 令牌的情形（`set_token none/empty`、登出后）由 axp 在发出前直接拒绝，得到 `reason: 'unauthenticated'` |
| `cache.ttl_ms`                       | 已映射       | `axpCache({ expires })`                                                                                                                                                                                                                               |
| `cache.max`                          | 已映射       | `axpCache({ max })`                                                                                                                                                                                                                                   |
| `cache.methods`                      | 已映射       | 直接作为插件选项 `axpCache({ methods })`（转小写）。**未写 `methods` 时不传**，沿用 axp 默认 `get head`，正好和中立默认 GET/HEAD 一致。写成空数组表示任何方法都不缓存                                                                                 |
| `retry.max`                          | 已映射       | `axpRetry({ max })`。未写时不传，沿用 axp 默认（2 次）                                                                                                                                                                                                |
| `retry.delay_ms`                     | 已映射       | `delay`                                                                                                                                                                                                                                               |
| `retry.statuses`                     | 已映射       | `statusCodes`；缺省取中立默认 `[500,502,503,504]`（比 axp 新默认 `[408,429,500,502,503,504]` 少 408/429）                                                                                                                                             |
| `retry.methods`                      | 已映射       | `methods`（转小写）；缺省取中立默认 GET/PUT/HEAD/DELETE/OPTIONS                                                                                                                                                                                       |
| `retry.respect_retry_after`          | 已映射       | `respectRetryAfter`                                                                                                                                                                                                                                   |
| （retry 的 business 适配）           | 不再需要     | axp 的 `statusCodes` / `afterStatusCodes` 读逻辑状态，business 风格（HTTP 200 + code 500）自动生效；取消 / 解析 / 鉴权 / internal 本来就不重试，见 §业务风格适配                                                                                      |
| `share.policy`                       | 已映射       | `axpShare({ policy })`，支持 start/end/race                                                                                                                                                                                                           |
| `loading.delay_ms`                   | 已映射       | `axpLoading({ delay })`                                                                                                                                                                                                                               |
| `loading.delay_close_ms`             | 已映射       | `delayClose`；执行器在场景结束后多等 `delay_close_ms + 60ms` 再取 loading 序列                                                                                                                                                                        |
| `notify` `{}`                        | 已映射       | `axpNotify({ notify })`，回调见表 3；`stringify` 用 axp 默认（成功、取消、`silent` 不提示）                                                                                                                                                           |
| `normalize` `{}`                     | 内核具备     | 归一化响应是内核的一部分，无需装配；所有场景（含没装 normalize 的）都按信封业务码判定，执行器不补；因此 D21 的"未装 normalize 时业务码透传"在 axp 上不适用，相关格子跳过，见 §跳过规则                                                                |
| `key.scope = 'user'`                 | 已映射       | 内核 key 服务：`createAxp({ key: { scope: () => 当前登录用户名 } })`。其它 scope 显式报错                                                                                                                                                             |
| `key` `{}`                           | 内核具备     | key 服务是内核的一部分，无需装配                                                                                                                                                                                                                      |
| `mock.fallback_on_404`               | 已映射       | `axpMock({ enable: true, mockUrl: <baseURL>/t/mock })`；`true`/缺省 = axp 默认回落（404 或 network），`false` = `fallbackWhen: () => false`                                                                                                           |
| `repath` `{}`                        | 已映射       | `axpRepath({})`                                                                                                                                                                                                                                       |
| `filter` `{}`                        | 已映射       | `axpFilter({})`（新架构装上即生效）                                                                                                                                                                                                                   |
| `cancel` `{}`                        | 内核具备     | 取消是内核的一部分（`client.cancelAll()`），无需装配                                                                                                                                                                                                  |
| `envs` `{}`                          | 已映射       | `axpEnvs([])`（无规则，仅为占位）                                                                                                                                                                                                                     |
| `log` `{}`                           | 内核具备     | 日志开关是内核的一部分（`createAxp({ debug })`），执行器不开 debug                                                                                                                                                                                    |
| `breaker.*`                          | **显式报错** | axp 没有熔断。场景因 `requires: breaker` 先被跳过                                                                                                                                                                                                     |
| `offline.*`                          | **显式报错** | axp 没有离线探测插件。同上                                                                                                                                                                                                                            |
| `timeout.*`（connect/receive/total） | **显式报错** | axp 没有分阶段超时（只有 axios 的整体 `timeout`）。同上                                                                                                                                                                                               |
| 其它任何未登记的选项                 | **显式报错** | 例如 `cache.foo`                                                                                                                                                                                                                                      |

### 1.2 请求级选项（`request.options`）

| 中立选项                                                              | 状态         | axp 落地                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`                                                                | 已映射       | `protected`；不写则由插件的 `urlPattern` 决定                                                                                                                                                                                                                                                              |
| `cache` `true/false/{ttl_ms,key}`                                     | 已映射       | `cache: true/false/{ expires, key }`                                                                                                                                                                                                                                                                       |
| `retry` `n/false/{max,delay_ms,statuses,methods,respect_retry_after}` | 已映射       | `retry: n/false/{ max, delay, statusCodes, methods(小写), respectRetryAfter }`；对象里的其它键显式报错                                                                                                                                                                                                     |
| `share` `true/false/'start'/'end'/'race'/'none'`                      | 已映射       | `share` 原样；中立的 `'none'` 翻成 `false`（新架构没有 `'none'` 策略，关闭就是 `false`）                                                                                                                                                                                                                   |
| `loading`                                                             | 已映射       | `loading`                                                                                                                                                                                                                                                                                                  |
| `silent`                                                              | 已映射       | `silent`（内核自带的请求选项，axp 默认的 notify `stringify` 读它）                                                                                                                                                                                                                                         |
| `timeout_ms`                                                          | 已映射       | `timeout`（axios 整体超时）                                                                                                                                                                                                                                                                                |
| `key` `true`                                                          | 已映射       | `key: true`，即 axp key 服务的默认行为：method + url + params，有请求体的方法再加 data。**不再翻译成 `'deep'`**。请求**没写** `key` 时发 `key: false`（中立语义是写了 `key: true` 才生成 key，见 §与 axp 默认行为的对齐）                                                                                  |
| `key` `'deep'`                                                        | 已映射       | 与 `true` 同义，翻成 `key: true`。新 API 里 `'deep'` 已删除，原样传会被当成一条字面 key，所以必须翻译                                                                                                                                                                                                      |
| `key` `'simple'`                                                      | **显式报错** | 只看方法+路径的模式，新 key 服务没有（始终含 params 与请求体）。当前 testkit 场景里没有用到                                                                                                                                                                                                                |
| `key` `false`                                                         | 已映射       | `key: false`，本请求不参与 cache / share                                                                                                                                                                                                                                                                   |
| `key` 其它字符串                                                      | 已映射       | 显式 key，原样传                                                                                                                                                                                                                                                                                           |
| `mock`                                                                | 已映射       | `mock`                                                                                                                                                                                                                                                                                                     |
| `normalize`                                                           | 已映射       | `false` 翻成 `throws: false`：可预期失败（HTTP 非 2xx、业务码非 0）也 resolve 出 `ok: false` 的响应而不抛，执行器按"没抛出"记为成功；`true` 是内核默认，不输出任何字段                                                                                                                                     |
| `filter` `true/false`                                                 | 已映射       | `filter: true/false`。新架构里 `axpFilter` 装上即生效，请求级 `filter: false` 关闭；写 `true` 等同默认。装了 filter 且请求**没写** `filter` 时发 `filter: false`（中立语义是写了 `true` 才开启）。中立语义只含默认剔除 null/undefined/NaN/空白字符串、保留 0/false，不含 ignoreKeys/ignoreValues/predicate |
| `breaker`                                                             | **显式报错** | axp 没有熔断                                                                                                                                                                                                                                                                                               |
| `cancel_after_ms`（request 的同级字段）                               | 已映射       | 执行器给该请求配一个 `AbortController` 作为 `signal`，到点 abort                                                                                                                                                                                                                                           |

### 1.3 step 类型（全部 16 种）

| step                                                 | 实现                                                                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request`                                            | 经 `createAxp` 创建的客户端的 `request()` 发出（`params` 放 query，带 body 的方法再放 `data`），返回信封已解包的 `r.data`；失败抛出 `IAxpResponse`                                                   |
| `parallel` / `sequence` / `repeat` / `fire` / `wait` | `lib/steps.ts` 纯编排；repeat 默认给内部请求 id 追加 `#i`；fire 在场景结束前统一等待                                                                                                                 |
| `login` / `logout` / `revoke` / `server_reset`       | **旁路**：node 原生 `fetch` 直连服务器，不经 netem，不经插件链（CONTRACT 附录 B.2）。login 把令牌写入 `TokenStore`；登录写入新 token 后 axp 的 auth 自动恢复刷新，执行器没有刷新许可之类的状态要维护 |
| `set_token`                                          | `TokenStore.applySetToken`：none/empty/garbage/bad_signature（改签名段）/tampered_payload（改 sub 不重签）/wrong_scheme（前缀改成 `Token`）/previous/keep；refresh 的 none/garbage/previous/keep     |
| `expire_local`                                       | 旁路再登录一次，`access_ttl_ms=1`，只取 access 写入客户端（refresh 不变），等 30ms 让它过期                                                                                                          |
| `cancel_all`                                         | 先等 `after_ms` 再调客户端的 `cancelAll()`                                                                                                                                                           |
| `clear_cache`                                        | cache 插件的 `clearCache(client)`                                                                                                                                                                    |
| `network`                                            | 预设名/profile 对象走 netem `PUT /proxies/{id}`；`flap` 走 `POST /proxies/{id}/schedule`；`dns` 改 `baseURL` 的 host（注意：已装好的 mock 基址不会跟着变）                                           |
| `style`                                              | 改 `X-Test-Style`，从下一个请求起生效                                                                                                                                                                |

---

## 表 2：axp 抛出的失败 → 错误类别

axp 的失败一律抛出 `IAxpResponse`（程序 bug 抛原始异常，不伪装成请求失败）。执行器用共享品牌（`Symbol.for('axp.response')`，等价于 `isAxpResponse`）识别，
**直接读字段归类，不看 message、不猜形状**（`lib/classify.ts` 的 `classifyResponse`）。不是 `IAxpResponse` 的一律记为 `unknown:`，意味着 **axp 有 bug**。

| 抛出的 `IAxpResponse`                                                                           | 错误类别                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `kind: 'cancel'`                                                                                | `canceled`                                                                                                         |
| `kind: 'timeout'`                                                                               | `timeout`                                                                                                          |
| `kind: 'network'`                                                                               | `network`                                                                                                          |
| `kind: 'parse'`（`ERR_BAD_RESPONSE`，或 `expectJson` 检出声明 JSON/HTML 却没解析的 2xx 响应体） | `parse`                                                                                                            |
| `kind: 'auth'`，`reason: 'expired'`                                                             | `expired`                                                                                                          |
| `kind: 'auth'`，`reason: 'denied'`                                                              | `denied`                                                                                                           |
| `kind: 'auth'`，`reason: 'unauthenticated'`                                                     | `unauthenticated`                                                                                                  |
| `kind: 'http'`（非 2xx）                                                                        | `http:<httpStatus>`                                                                                                |
| `kind: 'biz'`（HTTP 2xx 且业务码判失败）                                                        | `business:<code>`                                                                                                  |
| `kind: 'auth'` 但 `reason` 缺失或不认识；或 `ok` / `internal`                                   | `unknown:<kind>:<reason 或 message>`                                                                               |
| 不是 `IAxpResponse` 的任何异常                                                                  | `unknown:<name>:<message>`（不再识别 axios 错误、`ApiError`、auth 错误消息等旧形态，不会匹配任何预期，`any` 除外） |

预期里的 `status:<n>`：http 风格匹配 `http:<n>`，business 风格匹配 `business:<n>`；风格取该请求**发出时**的风格（`style` step 之后会变）。

**解析错误怎么来的**：axios 默认对坏 JSON 静默放过，把原始字符串留在 `data` 里。由响应工厂 `axpResponse({ expectJson: true })` 负责：
声明 `json` 或 `html`、2xx、body 仍是非空字符串时判为 `kind: 'parse'`（覆盖 `bad_json` 与网关 `html` 拦截页）。执行器不再自带解析守卫。

---

## 表 3：axp 回调 → 客户端事件

| 事件（CONTRACT §7） | 来源                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loading`           | `axpLoading({ loading })` 的回调，原样记录布尔序列                                                                                                                      |
| `notify`            | `axpNotify({ notify })` 的回调，记次数与文案。`silent`、用户主动取消（`kind: 'cancel'`）、成功都不提示，由 axp 默认 `stringify` 处理                                    |
| `refresh`           | `onRefresh` 里**实际向服务器发起刷新**才计一次；没有 refresh 令牌时直接返回 false，不计                                                                                 |
| `expired`           | `onAccessExpired`。axp **每轮只通知一次**（plugin-spec §5），执行器如实计数；每个因过期失败的请求靠抛出的 `r.reason === 'expired'` 归类                                 |
| `denied`            | `onAccessDenied`。"越权"与"本地无 token"都会进这个回调，靠 `r.reason`（`denied` / `unauthenticated`）区分，只有 `denied` 计入 `denied` 事件，`unauthenticated` 单独计数 |
| `pending_after`     | 执行器自己的在途计数：请求发出 +1、落定 −1，场景结束时的余额                                                                                                            |

通用断言（MATRIX §4）每次运行都检查：`pending_after = 0`、loading 成对且最后是 false、服务端 `inflight = 0`
（先删 netem 代理关闭连接，再轮询到归零，最长 3 秒）。

---

## 业务风格适配

business 风格下失败是 **HTTP 200 + code**。axp 以逻辑状态 `r.status` 判定（HTTP 2xx 且业务码为数字 4xx/5xx 时取业务码），**执行器不做任何适配**：

| 环节     | axp 的做法                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| auth     | `defaultAuthFailure` 读 `r.status`，HTTP 200 + code 401 自动算 401，code 403 算越权                             |
| retry    | `statusCodes`、`afterStatusCodes` 都对照 `r.status`；取消 / 解析 / 鉴权 / internal 本来就不重试                 |
| notify   | 默认 `stringify` 读 `r.ok` / `r.kind` / `silent`                                                                |
| cache    | 默认 `shouldCache` 是 `r.ok`                                                                                    |
| 结果判定 | 失败统一抛 `IAxpResponse`，`reason` 直接带原因，没有"被 resolve 的失败"（`throws: false` 的请求除外，见表 1.2） |

---

## 与 axp 默认行为的对齐

以下是中立语义与 axp 默认行为的对照（2026-10-28，B7 首轮验收，真实服务器 + netem）：前四条 axp 自己满足，接着两条是执行器用请求级开关做的对齐。axp 上不适用的格子见下一节。

**axp 的新语义已经满足中立预期的**（执行器不做任何事）：

- `expired` 回调一轮失败只触发一次；每个因过期失败的请求靠 `r.reason === 'expired'` 归类。场景 `auth.refresh-expired-concurrent` 等验收通过。
- `share` 首发请求被取消时不连累跟随者（共享请求用独立的 controller，全部订阅者离开才中止）。场景 `share.leader-cancel-followers-survive` 验收通过。
- 缓存自带 `methods`，默认 `get head`：请求级 `cache: true` 的 POST 默认不缓存。场景 `cache.post-not-cached-by-default` 验收通过。
- 新 key 服务默认就含 params 与请求体，中立 `key: true` 直接透传（不再翻成 `'deep'`）。

**执行器用 axp 自己的请求级开关做的对齐**（`lib/mapping.ts` 的 `withNeutralDefaults`，一处函数，要撤掉只删这一个调用）。
理由：这两条的中立语义和 axp 的默认**正好相反**（中立是"请求写了才生效"，axp 是"装上/默认就生效"），axp 又都提供了请求级关闭开关（`key: false`、`filter: false`），所以靠请求级开关对齐，不改插件装配：

| 中立语义                                                  | axp 默认                                            | 执行器的映射                                         | 不映射时的验收结果                                                      |
| --------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| 请求写 `key: true` 才生成 key，没生成就不能误合并、误缓存 | key 惰性自动生成，`share: true` 就会按自动 key 合并 | 请求没写 `key` 时发 `key: false`                     | `key.share-without-key-not-merged` 失败：该发 2 次请求，实际合并成 1 次 |
| 装配了 filter、请求没写 `filter: true` 时原样发送         | 装上即生效，所有普通对象的 params / data 都被过滤   | 装了 filter 且请求没写 `filter` 时发 `filter: false` | `filter.off-by-default-sends-as-is` 失败：空串、null 被悄悄吞掉         |

---

## 跳过规则

某个 网络×风格 格子在 axp 上不适用时直接跳过，不算失败。判定在 `lib/mapping.ts` 的 `inapplicableReason`，由 `lib/plan.ts` 在"缺能力""预期自带 skip"之后调用，全部从场景字段通用识别，不靠场景 id 清单。2026-10-28 对照真实服务器的整轮结果核对过：命中的 38 个格子与规则出现前的 38 个失败格**完全一致**（多跳过 0、漏跳过 0）。

| 规则                                     | 识别方式                                                                                                                                                                                                                                             | 跳过理由（报告里写成 `not applicable: …`）                                          | 命中                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| testkit D21：没装 normalize 时业务码透传 | 场景 `client.plugins` 没有 `normalize`；某个请求（没写 `normalize: false`）按服务端规则会被注入"HTTP 2xx + 非 0 业务码"（`injectsBusinessFailure`：business 风格下 `status`/`code` 注入，或两种风格下单独的 `code` 注入）；该格预期里它是 `ok: true` | axp 归一化为内核能力，不支持关闭；testkit D21 的"未装 normalize 时业务码透传"不适用 | `plugins.single-<插件>` 13 个的 business 风格，`basic.business-code-without-normalize` 两种风格，共 34 格 |
| blackhole 下没有配置超时                 | 网络是 `blackhole`；场景没有 `base_timeout_ms`；某个请求没有 `timeout_ms` 却被预期为 `timeout`                                                                                                                                                       | 场景未配置超时，blackhole 下请求无法落定                                            | `basic.status-matrix` 的 blackhole 档，4 格                                                               |

**为什么 D21 不由执行器补**：axp 把归一化做进内核（设计决策 D3），不能关闭，"未装 normalize 时业务码透传"是已删除的能力。试过让未装 normalize 的场景改用 `axpResponse({ envelope: false })`（不解析信封、成功只看 HTTP 状态），**不可行**：那 14 个场景确实全过，但整轮里前 200 条运行就出现 100 多个失败，全在 `auth.*`，两种症状：
① `data` 不再解包——断言和 `hit` 读的都是信封内的 `data`，`data.meta` 缺失，**http 风格也中招**；
② business 风格的 401/403 是 HTTP 200 + code，不看业务码就认不出，`expired` / `denied` 变成"实际成功"，refresh 一次都不发。
静态统计：443 个场景里 329 个没装 normalize，其中 152 个会受影响（87 个装了 `auth`，91 个断言读信封内 `data` / `hit`），只有 177 个不受影响。旧行为其实是"HTTP 非 2xx 或业务码 401/403 才失败，其余业务码透传，data 照常解包"的混合语义，要在执行器里复现得自定义响应子类，等于重造旧 axp 的怪癖，所以不补。
