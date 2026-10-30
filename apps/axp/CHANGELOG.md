# Changelog

## 0.2.0（尚未发布到 npm）

内核重构为洋葱管线：一次调用是一个逻辑请求，从外到内穿过 outer / prepare / attempt / credential / source 五个阶段的中间件，成功、失败、被抛出的都是同一种归一化响应。Codex 全量 review 的逐条记录见 [docs/reports/2026-10-27-codex-full-review.md](docs/reports/2026-10-27-codex-full-review.md)。

### 破坏性变化

- **`raw` 含义变了（升级者必看）**：0.1.0 的 `raw: true` 是“返回原始信封 body”；现在它是请求级开关，隐含 `wrap: true`，落定时返回带 `raw`（完整 AxiosResponse，可能为 undefined）、`error`（原始异常）、`request`（完整请求配置）的副本，这三项是不可枚举自有属性。老代码写着 `raw: true` 不会报错，但拿到的形状已经不同；旧用法取信封改读 `r.raw?.data`。只做请求级，读 `ctx.originRequest`，`axios.defaults.raw` 不生效。仅 `wrap: true` 不再带原生数据。详见 [ADR 0003](docs/decisions/0003-native-data-on-ctx.md)。
- **notify 的 `stringify` 必传**：签名 `(r, ctx) => string | null | undefined | false`，返回假值或空串即不提示；不再有默认回退文案。内核先过滤成功、取消、`silent`（这些情况不调用 stringify），`internal` 失败内核不过滤，交给使用者决定。迁移写法见迁移指南和 README 的可复制示例。
- **`IAxpResponse` 瘦身**：接口只声明 `ok`、`status`、`code`、`data`；`message` 留在默认类 `AxpResponse`，接口不再声明 `message`、`raw`、`error`，`brandResponse` 不再给接口实现补 `message`。读 `r.message` 的地方，类型要用 `AxpResponse`（或自己的类），自己实现接口的代码要自行提供 `message`。
- **`R.request` 轻量化**：只剩 `{ method, url }`。要完整请求配置，读回调的 `ctx.request` / `ctx.originRequest`，或开 `raw: true` 读副本的 `request`。
- **`error` 读取方式变了**：`R` 上没有 `error`。`internal` 失败的原始 Error 放在内核失败标记里，用 `failureOf(r)?.error` 读（只有 internal 有，网络、超时、取消不再带 error）；要网络、超时的原生异常，开 `raw: true`。`toJSON` 只投影失败的 `{ type, reason }`，不含 raw/error。
- **终审响应契约（2026-10-29）**：删除 kind、AXP_KINDS、httpStatus 和顶层 reason；status 只表示 HTTP。内核失败标记强制 ok 为 false，用 failureOf/api.isCancel 读取。取消逻辑状态与业务风格自动适配，显式配置 onFailure、shouldRetry、respectRetryAfter，见 [ADR 0002](docs/decisions/0002-response-contract.md)。
- **解析与缺省值**：删除 envelope 选项，字段转换改为覆盖 parse；code 缺省 0、data 缺省 null，默认类 message 为空串且允许 null；接口只要求 ok/status/code/data。
- **key 精简**：删除 ignores、sample，仅保留 scope；对象只跳过 undefined 字段，null 字段、空串、0、false、NaN、空数组/对象均参与。值带类型标签、字符串不 trim、显式 key 原样使用（空串关闭）。旧持久化 key 应清理。
- **缓存仓**：条目改为可序列化 `{ snapshot, expiresAt }`；方法可异步、size 可选；命中工厂重建新 R，不保存 raw/error/stack。remove/clear/removeCache/clearCache 返回 MaybePromise，统一 await。
- **Retry-After**：retryAfterMax 默认由 Infinity 改为 60_000；超过上限返回本次响应，不再封顶后重试。显式 Infinity 表示永远照办。

- **入口**：`Axp.create`、`Axp.install`、`Core` 删除，改用 `createAxp({ axios, plugins, ... })`，返回 `AxpClient`。插件只对 axp 客户端生效，裸 `axios` 实例不再带插件。类型参数 `T` 换成 `S`（`createAxp<S>()`）；要自定义响应类时 `S`、`R` 都要写出来。
- **错误**：可预期的失败（HTTP、业务、网络、超时、取消、解析、鉴权）抛出的是归一化响应 `R`（默认 `IAxpResponse`），不是 `Error`，默认没有 `stack`。用 `isAxpResponse(e)` 或 `api.isResponse(e)` 判断，内核失败用 failureOf(e)，HTTP/业务失败看 ok/status/code；原来的 `e.response` 不再存在。程序 bug（中间件、用户回调里抛出的非 axp 异常）仍然原样抛出。需要 `Error` 的上报库或状态库，用 `createAxp({ reject })` 适配。
- **成功判定**：`AxpResponse.isSuccessful` 静态钩子改为子类覆盖 ok，字段转换覆盖 parse，通过 `createAxp({ response: axpResponse({ create }) })` 每个客户端一份，不再全局可变。`successful` 字段改名为 `ok`。
- **返回形态**：`wrap: true` 成功时返回 `WithData<R, D>`，失败照常抛出；`raw: true` 的新含义见上。`normalize: false` 改为请求级 `throws: false`：成功判定仍然生效，失败时 resolve 出 `ok` 为 `false` 的响应而不是抛出（没有客户端级默认值）。
- **请求选项不再接受函数**：`key`、`cache.key`、`share`、`retry` 等请求级选项传函数不再支持，改成在调用处判断，再传字符串或布尔。`share: 'none'` 改为 `share: false`；`key` 的数字形式不再支持（字符串、`true`、省略可用）；`cancelToken` 删除，用 `signal`。本身就是回调的选项（如 `axpLoading` 的请求级回调）不受影响。
- **回调签名统一读 `R`**：auth 的 `onRefresh`、`onAccessExpired`、`onAccessDenied`、`onFailure` 为 `(r, tm, ctx)`，`ready` 返回补丁 `AxpRequestPatch` 而不是直接改 `config`；`shouldRetry(r, attempt, ctx)`（成功响应也会传入）；`shouldCache(r, ctx)`；`stringify(r, ctx)`（必传）；`fallbackWhen(r, ctx)`。retry 的 `statusCodes`、`afterStatusCodes` 与 auth 的默认 401/403 判定读 `ctx.statusOf(r)`（有效状态，默认等于 `r.status`）；业务风格 HTTP 200 + 业务码时配置 `createAxp({ statusOf })`。
- **auth**：`config.authExpired` 标记改为看 `failureOf(r)?.reason === 'expired'`；没有 token 时不再合成 `data.code === 'ACCESS_DENIED'` 的响应，改判 `failureOf(r)?.type === 'auth' && failureOf(r)?.reason === 'unauthenticated'`。
- **mock、notify 的请求级选项**：mock 请求级对象里的 `mock` 字段删除，关闭写 `mock: false` 或 `{ enable: false }`；notify 请求级只是开关（`false` 或 `{ enable: false }`）。
- **清缓存**：`removeCache(ax, key)`、`clearCache(ax)` 的参数改为客户端：`removeCache(client, key)`、`clearCache(client)`；没装 cache 时分别返回 `false` 和 `0`。
- **派生**：`extends` 改名为 `extend`，默认继承插件，每个插件各自重新 `setup`。状态按它代表的资源作用域共享：cache、share 按客户端各自一份；auth 的刷新、过期、通知状态按 TokenManager 共享（子客户端与共用同一 tm 的客户端一起）；loading 的计数按回调函数共享。旧版派生实例不带插件。
- **插件生命周期**：`handle.plugin('axp:cache')` 按名字取，改为 `api.plugin(插件对象)`；`handle.dispose()` 改为 `api.dispose()`（先中止在途请求，再卸载全部插件，销毁后客户端不能再用）；只卸一个用 `api.eject(name)`，不影响在途请求。
- **自定义插件**：从拦截器改为中间件 `{ name, stage, handle }`（可选 `setup`、`taps`），`next()` 不抛错、返回 `R`；`Plugin` 类型换成 `AxpPlugin`，`pluginLog(config, ...)` 换成 `ctx.log`。

### 新增

- `axpResponse({ type: MyResponse })` 与受保护的 parse(body, raw)；接口路径保留 create，扩展字段支持从快照恢复。
- **`raw` 开关与原生数据**：请求级 `raw: true`；新增类型 `WithNative`（`WithNative<WithData<R, D>>`，不写 raw 时类型上没有 raw/error）与导出函数 `nativeOf(value)`（读取抛出对象上的 raw/error/request，catch 里是 unknown）；动词重载与 `request()` 按有效 raw/wrap/throws 选返回形态，宽 boolean 返回联合。限制：方法级传类型为 `AxpRequestConfig` 的变量时，无法与缺省区分，仍推成数据。
- **`ctx.native`**：共享的只读原生数据槽 `{ response?, error? }`，是最近一次传输尝试的结果（传输前提前返回的尝试不刷新，不保证与当前响应配对），落定后清空并封闭。插件读 ctx，不读 R 上的可选字段。
- **回调新增末位 `ctx` 参数**（向后兼容，旧的少参数写法照常可用）：retry 的 `respectRetryAfter`（函数形态）与 `delay`，auth 的 `onRefresh` / `onAccessExpired` / `onAccessDenied`，cache 的 `shouldCache`（插件级与请求级），mock 的 `fallbackWhen`。auth 单飞刷新时，`onRefresh` / `onAccessExpired` 拿到的 `ctx` 属于首个触发请求，别用它的 `ctx.signal` 去中止共享刷新。
- **Retry-After 随 R 走**：作为私有小事实跟着 R，share 跟随者拿到的是领导者的同一个 R，也能读到；retry 改读它，超过 retryAfterMax 不重试的规则不变（见破坏性变化里的 Retry-After 条目）。
- `AXP_FAILURE`、`AXP_FAILURES`、`failureOf`、`isAxpCancel`、`api.isCancel`；插件通过 ctx.fail({ failure, reason, from }) 合成失败。
- `ctx.canReplay()`：自定义插件重放前检查一次性体是否已消耗。
- auth 的 refreshTimeout 默认 30_000，0/Infinity 不限时，超时按刷新失败处理；README 补同客户端刷新必须 protected: false 的约束。
- `extend(overrides, { axios })` 原样使用指定实例；默认派生新实例只复制 defaults、不复制拦截器。
- retry 的 respectRetryAfter 支持独立判定函数，便于业务码风格采信服务端等待。

- **`createAxp`**：选项 `{ axios, plugins, response, key, reject, debug }`。内置 10 个插件（loading、notify、repath、filter、retry、auth、mock、share、cache、envs）的位置固定，插件数组的顺序不用排；自定义插件用 `stage` 和 `enforce` 指定位置。
- **客户端方法**：`api.use(p)`、`api.eject(name)`、`api.plugin(p)`、`api.inspect()`、`api.cancelAll(reason)`、`api.isResponse(e)`、`api.extend(config, { plugins })`。
- **归一化响应**：IAxpResponse 的字段只有 ok、status（HTTP）、code、data；message 属于默认实现 AxpResponse。
- **key 配置**：`createAxp({ key: { scope } })`。`scope` 可以是函数，每次算 key 时求值，切换账号不用重建客户端。
- **debug**：`createAxp({ debug })`，`true` 或自定义 logger；开启后失败响应会附上调用点 `stack`。
- **auth**：`AuthFailureAction` 新增第五个动作 `Others`（与鉴权无关的失败，原样返回）；根入口导出 `defaultAuthFailure`，自定义 `onFailure` 只想改个别情况时可以调用它沿用默认判定。
- **share**：新增 `methods`，默认 `get`、`head`。
- **repath**：请求级除了 `false`，还可以写对象 `{ pattern, removeKey }` 覆盖。

### 本轮架构评审修复

- **有效状态 `statusOf`**：新增客户端选项 `statusOf(r) => number` 与 `ctx.statusOf(r)`，retry、auth 的默认规则读它；`r.status` 仍是 HTTP 状态。见 [ADR 0002](docs/decisions/0002-response-contract.md)。
- **共享状态按资源作用域**：auth 会话（单飞刷新、过期标记、无 token 通知标记）按 TokenManager 共享，用模块级 WeakMap 加持有者计数；loading 计数按回调共享，父子客户端共用同一个 spinner 回调时只显示、隐藏一次。
- **传输层不再克隆请求体**：原地改 `data` 的转换器会污染重放和调用方，约定不要原地改。`debug: true` 下会检测请求体、缓存数据被原地修改并告警，未装插件却传了对应请求选项也告警。
- **断流归 network**：`stream has been aborted`、响应体中途断开归 `network`；`ERR_BAD_RESPONSE` 只有 SyntaxError 或 maxContentLength 超限才算 `parse`。
- **请求选项合并**：方法级 < payload < 调用级三层；`wrap`、`throws`、`raw` 只读 `originRequest`；缓存 key 并入 `responseType`。
- **`throws: false` 的类型**：返回按 `ok` 可辨识的联合 `AxpResult`，失败分支 `data` 为 `unknown`；显式写 `<unknown>`、`<any>` 会覆盖 schema 推断。
- **导出插件工具**：`cancelIfAborted`、`waitAbortable`、`fireNotice`、`resolveOption`、`resolveRequestOption`、`isEnabled`，类型 `AxpOption`、`IPluginSwitch`。
- **包与存储**：`package.json` 加 `sideEffects: false`；TokenManager 首次读写时才探测存储，不再在模块加载时探测。
- **体积与测试**：`./min`（`gzip -9`）门槛放宽到 15,401 字节（此前 14,677）；测试 117 文件 5,967 条，覆盖率 100%。

### 删除

- **插件**：`axpCancel`、`axpKey`、`axpLogger`、`axpNormalize` 删除，能力进内核：取消用 `api.cancelAll(reason)`（函数形式的 `cancelAll(ax, reason)` 一并删除，`signal` 照常可用），key 用 `createAxp({ key })`，日志用 `createAxp({ debug })`，归一化由内核完成。
- **子路径**：`./cancel`、`./key`、`./logger`、`./normalize` 从 `exports` 删除，导入会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。保留 10 个插件各自的 `./<name>` 与 `./min`；插件内部的算法模块不对外。
- **类与静态方法**：`ApiError`、`AxpResponse.fromResponse`、`AxpResponse.isSuccessful`、`AxpHandle`。
- **手动排序**：`prepend`、`append`、`insertBefore`、`insertAfter` 删除，内置插件位置固定。
- **auth**：`canRefresh` 从 `ITokenManager` 和 `TokenManager` 删除。判定过期后插件会清空 token 并记下清空后的状态，登录写入新 token 后自动恢复，登录流程不用再手动改标记；另删除 `accessDeniedCode` 选项与 `ACCESS_DENIED_CODE`、`authFailureFactory`、`DEFAULT_ON_AUTH_FAILURE`（由 `defaultAuthFailure` 取代）、`registerAttemptHook`（retry 的每次尝试本来就会经过 auth）。
- **选项**：`nullable`；`axpKey` 的 `fastMode`、`before`、`after`；cache 的 `storage`、`memory`（持久化走 `store`）；loading 的 `guardTransform`、`logical`。
- **类型**：`Plugin`、`PluginCleanup`、`CoreOptions`、`ICommonOptions`、`IPluginCommonRequestOptions`、`IPluginCommonResponseOptions`、`IBaseOptions`、`IMethodOptions`、`IHttpOptions`、`IInnerOptions`、`NormalizeOptions`、`HttpInternalRequestConfig`、`HttpPrototype`、`Primitive`、`MaybeFun`、`Falsy` 删除，替代写法见迁移指南第 13 节；`PluginLogger` 并入 `AxpLogger`。`MethodSchema` 和 `HttpMethodLower` 保留。

### 行为变化

- **retry 默认值**：`max` 默认 2（旧版 0），`delay` 默认指数退避 `300 * 2 ** (attempt - 1)`（旧版固定 3000），`delayMax` 默认 `10_000`（旧版 `Infinity`）。依赖旧默认值的地方要显式写回去。
- **filter 默认值**：装上即生效，要关闭才写请求级 `filter: false`；旧版要请求级 `filter: true` 才过滤。
- **cache**：只缓存 `get` 和 `head`，POST 要缓存只能在插件级改 `methods`；命中缓存时不再重跑 `transformResponse`。
- **判定统一读 `R`**：auth、retry、notify、cache、share、mock 的判定都读归一化响应；`r.status` 始终是 HTTP 状态，retry/auth 的默认规则读 `ctx.statusOf(r)`，业务码风格用 `statusOf` 配置。
- **回调抛错**：判定类回调（`shouldRetry`、retry 的 `delay` / `jitter` 函数、`onFailure`、`isProtected`、`fallbackWhen`、`shouldCache`、`ready`）抛错不再被吞，作为程序 bug 原样抛出。通知类回调（`loading`、`notify`、`stringify`、`onAccessExpired`、`onAccessDenied`）仍然隔离，错误用 `console.error` 输出，不受 `debug` 开关控制。
- **时序**：loading 的显示从逻辑请求开始算，覆盖等待 token 刷新的时间；HTTP 4xx、5xx 不再进入 axios 实例的错误拦截器（传输层放行所有状态码，由 axp 统一判定）。
- **auth 过期通知**：401、刷新失败这条路径上，`onAccessExpired` 每一轮只通知一次，并发请求一起失败也只通知一次；过期后在 token 没变之前不再刷新。本地没有 token 时，无 token 的拒绝每轮会话最多通知一次（`onAccessDenied`，没配则回退 `onAccessExpired`），写入新 token 后重新计数。会话状态按 TokenManager 共享。
- **派生上下文的 `ctx.signal`**：自定义插件在补丁里换了 `signal` 后，内层的 `ctx.signal` 跟随补丁里的 `signal`。
- **调用级 `undefined`**：`api.get(path, 方法级配置)(payload, 调用级配置)` 里，调用级值为 `undefined` 的任意键不再覆盖方法级的同名键，与 axios `mergeConfig` 一致。
- **axpEnvs**：卸载（`eject`、`dispose`）不再还原写入 `defaults` 的配置。
- **cache 不缓存 `internal` 与 `cancel` 失败**：即使 `shouldCache: () => true` 也不缓存，避免命中后丢失异常或把某个调用方的取消泄给别人；快照读取 message 改为结构化读取。
- **respectRetryAfter 为函数时，fromError 路径也采信 Retry-After**：响应拦截器抛出带 `response` 的 `AxiosError`（归为 network）时，`R.status` 是 0；布尔形态要查 `afterStatusCodes.includes(r.status)`，所以默认配置下这类 R 不采信 Retry-After。只有 `respectRetryAfter` 写成函数、由它独立判定时，才会读 `error.response` 的头（旧版读不到）。这是新增的可观察行为边界，不是修复。
- **性能**：全插件、缓存未命中的单请求额外开销比旧版降低约 41%；缓存命中与 100 并发 share 不低于旧版。无插件时每次请求比旧版多约 7–10µs，这是入口合并实例 `defaults` 的固定成本。详见 [B6 报告](docs/reports/2026-10-28-pipeline-b6.md)。

### 修复

- **auth / cache 终审三项**：ready 期间登出时本地拒绝，不再发出无凭证请求；dispose 后在途刷新迟到失败不再清会话、不再触发 onAccessExpired；cache 异步存储的 get、过期删除、set 等待可被取消，立即以 cancel 落定，迟到结果不回写。

- **auth**：旧刷新失败不清掉刷新期间重新登录或登出的会话；ready/onFailure 挂起可取消，每次等待后重查取消；已取消请求不返回缓存命中。
- **share**：end/race 中调用方自己取消视为撤回，不成为别人的结果；end 回退在途或最近完成调用，race 回退最后一个未撤回失败；超时不算撤回。
- **来源与请求体**：key 按 axios buildFullPath 包含 baseURL；二进制不超过 64KiB 按内容哈希，超出不生成 key。传输固定参与 key 的 method/baseURL/纯对象 params 入口视图，其余未覆盖 defaults 以发送时为准。
- **一次性体重放**：retry/auth/mock 在流已发送时交回原响应；强行重放由传输层标记 internal，落定抛原始 Error。
- **缓存持久化**：命中绑定当前请求；store get 失败按未命中，写删清理异常隔离并 console.error；同 key 异步写入串行，提交前重查新鲜度，clear/eject 后旧请求不回写。
- **执行器与 e2e**：迁移到 failureOf/api.isCancel；业务风格显式配置回调；不声明 raw-business-code/timeout-total，删除 D21、blackhole 特判。验收数字由整轮验收报告记录。

- **key**：请求级 `key: true` 现在包含 params，有请求体的方法还包含 data。旧版 `key: true` 只哈希 method 和 url，同一路径不同参数会串缓存。
- **notify**：`silent: true` 真正生效，由内核在调用 stringify 之前过滤。
- **TokenManager**：令牌放进不可枚举属性，`JSON.stringify`、`Object.keys` 不再带出 token 明文。
- **类型（发布产物）**：插件的请求选项类型（`retry`、`cache` 等）在消费方丢失的问题已修，nodenext 与 bundler 两种解析下都生效。
- **类型（泛型）**：不写泛型时 `createAxp({ plugins: [axpRetry()] })` 可以直接编译；插件工厂以及 `AxpPlugin` 等插件作者类型的默认响应改为 `AxpResponse`，装进默认客户端不再报错。

完整的旧写法到新写法对照见 [迁移指南](docs/guides/migrating-to-pipeline.md)。

### 重构前的 review 修复记录

以下条目写于重构之前、均未发版；只保留在新架构下仍然成立的部分，涉及已删除 API（`Core.extends()`、`canRefresh`、`axpKey`、请求级 `normalize`、adapter 链）的条目已删去。

#### Breaking

- **入口**：`"."`、`main`、`module`、`types` 现在指向不打包的 `dist/esm/index.mjs`，并去掉了 `production` 条件。
  根入口与 `./cache` 等插件子路径共用同一份模块。压缩版只能通过 `./min` 显式引入。（#3）
- **TypeScript**：类型推断需要 TS ≥ 5.4（用到了 `NoInfer`）。（#4）
- **key**：`FormData`、`Blob`、`Map`、`Set`，以及没有可枚举字段的类实例，不再生成 key。这类请求不再被缓存或共享，以前会被当成空值，导致命中错误的缓存。（#16）
- **cache**：默认不再缓存非 2xx 和业务失败的信封响应，可以用 `shouldCache` 自定义。（#15）
- **repath**：变量值会做 `encodeURIComponent` 编码，并且只替换 pathname 部分。（#22）
- **auth**：`AuthFailureAction` 从 enum 改成 const 对象加同名类型，调用方式不变。（#27）

#### Added

- `axpCache({ max, shouldCache })`：`max` 是容量上限，默认 500，超出按 LRU 淘汰；`shouldCache` 决定哪些响应可以写入缓存。（#14、#15）
- 本地类型扩展模板改为扩展 `MethodRefs`。（#30）
- `npm run accept`：对接 api-ws-demo testkit 的黑盒验收。

#### Fixed

- **auth**
  - 刷新期间调用 `cancelAll()`，重放请求也会一起取消，controller 不再泄漏。（#5）
  - 重放只走鉴权这一步：notify 不再触发两次，重试次数不再翻倍。（#6）
  - 重试过程中遇到 401 会正常走刷新流程。（#7）
- **retry**
  - 请求级的 `mock: false`、`share` 在重试时保留。（#2）
  - 重试和重放不再重复执行 `transformRequest`。（#8）
- **share**
  - 每个调用方拿到独立的 error 和自己的 config。（#9）
  - 跟随者能立即响应自己的取消和超时。（#10）
- **cache**
  - 较晚返回的旧响应不再覆盖缓存。（#11）
  - 命中缓存时 `transformResponse` 不再执行两次。（#12）
  - `clearCache` 之后，已在途的请求不会再写回缓存。
- **loading**
  - 按逻辑请求计数，重试期间不再闪烁。（#21）
  - 回调抛错时被隔离，不影响请求和计数。（#19）
  - 卸载插件时会清理定时器。（#20）
- **Core**：`loading` 选项的类型不再被收窄成 boolean。（#23）
- **wrap 模式**：非信封响应的 data 不再变成 null。（#26）
- **工程**
  - 源码可以通过 `tsgo --noEmit`。（#27）
  - e2e 的 runner 和 playground 对齐，改用本地可控后端，命中计数如实反映请求次数。（#28、#29）
