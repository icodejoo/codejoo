# Changelog

## Unreleased

内核重构为洋葱管线：一次调用是一个逻辑请求，从外到内穿过 outer / prepare / attempt / credential / source 五个阶段的中间件，成功、失败、被抛出的都是同一种归一化响应。Codex 全量 review 的逐条记录见 [docs/reports/2026-10-27-codex-full-review.md](docs/reports/2026-10-27-codex-full-review.md)。

### 破坏性变化

- **入口**：`Axp.create`、`Axp.install`、`Core` 删除，改用 `createAxp({ axios, plugins, ... })`，返回 `AxpClient`。插件只对 axp 客户端生效，裸 `axios` 实例不再带插件。类型参数 `T` 换成 `S`（`createAxp<S>()`）；要自定义响应类时 `S`、`R` 都要写出来。
- **错误**：可预期的失败（HTTP、业务、网络、超时、取消、解析、鉴权）抛出的是归一化响应 `R`（默认 `IAxpResponse`），不是 `Error`，默认没有 `stack`。用 `isAxpResponse(e)` 或 `api.isResponse(e)` 判断，类别看 `e.kind`、`e.reason`；原来的 `e.response` 不再存在。程序 bug（中间件、用户回调里抛出的非 axp 异常）仍然原样抛出。需要 `Error` 的上报库或状态库，用 `createAxp({ reject })` 适配。
- **成功判定**：`AxpResponse.isSuccessful` 静态钩子改为子类覆盖 `ok`、`status` getter，通过 `createAxp({ response: axpResponse({ create }) })` 每个客户端一份，不再全局可变。`successful` 字段改名为 `ok`。
- **返回形态**：`raw: true` 删除，改用 `wrap: true` 后读 `r.raw`；`wrap: true` 成功时返回 `WithData<R, D>`，失败照常抛出。`normalize: false` 改为请求级 `throws: false`：成功判定仍然生效，失败时 resolve 出 `ok` 为 `false` 的响应而不是抛出（没有客户端级默认值）。
- **请求选项不再接受函数**：`key`、`cache.key`、`share`、`retry` 等请求级选项传函数不再支持，改成在调用处判断，再传字符串或布尔。`share: 'none'` 改为 `share: false`；`key` 的数字形式不再支持（字符串、`true`、省略可用）；`cancelToken` 删除，用 `signal`。本身就是回调的选项（如 `axpLoading` 的请求级回调）不受影响。
- **回调签名统一读 `R`**：auth 的 `onRefresh`、`onAccessExpired`、`onAccessDenied`、`onFailure` 为 `(r, tm)`，`ready` 返回补丁 `AxpRequestPatch` 而不是直接改 `config`；`shouldRetry(r, attempt, ctx)`（成功响应也会传入）；`shouldCache(r)`；`stringify(r, ctx)`；`fallbackWhen(r)`。retry 的 `statusCodes`、`afterStatusCodes` 对照逻辑状态 `r.status`，业务失败也算。
- **auth**：`config.authExpired` 标记改为看 `r.reason === 'expired'`；没有 token 时不再合成 `data.code === 'ACCESS_DENIED'` 的响应，改判 `r.kind === 'auth' && r.reason === 'unauthenticated'`。
- **mock、notify 的请求级选项**：mock 请求级对象里的 `mock` 字段删除，关闭写 `mock: false` 或 `{ enable: false }`；notify 请求级只是开关（`false` 或 `{ enable: false }`）。
- **清缓存**：`removeCache(ax, key)`、`clearCache(ax)` 的参数改为客户端：`removeCache(client, key)`、`clearCache(client)`；没装 cache 时分别返回 `false` 和 `0`。
- **派生**：`extends` 改名为 `extend`，默认继承插件，每个插件各自重新 `setup`，缓存、token 刷新等状态不共享。旧版派生实例不带插件。
- **插件生命周期**：`handle.plugin('axp:cache')` 按名字取，改为 `api.plugin(插件对象)`；`handle.dispose()` 改为 `api.dispose()`（先中止在途请求，再卸载全部插件，销毁后客户端不能再用）；只卸一个用 `api.eject(name)`，不影响在途请求。
- **自定义插件**：从拦截器改为中间件 `{ name, stage, handle }`（可选 `setup`、`taps`），`next()` 不抛错、返回 `R`；`Plugin` 类型换成 `AxpPlugin`，`pluginLog(config, ...)` 换成 `ctx.log`。

### 新增

- **`createAxp`**：选项 `{ axios, plugins, response, key, reject, debug }`。内置 10 个插件（loading、notify、repath、filter、retry、auth、mock、share、cache、envs）的位置固定，插件数组的顺序不用排；自定义插件用 `stage` 和 `enforce` 指定位置。
- **客户端方法**：`api.use(p)`、`api.eject(name)`、`api.plugin(p)`、`api.inspect()`、`api.cancelAll(reason)`、`api.isResponse(e)`、`api.extend(config, { plugins })`。
- **归一化响应**：`IAxpResponse`、`AxpResponse`、`axpResponse` 工厂、`isAxpResponse`。成功、失败、被抛出的都是它，字段有 `kind`、`reason`、`status`（逻辑状态）、`httpStatus`、`code`、`message`、`data`、`raw`。
- **key 配置**：`createAxp({ key: { scope, ignores, sample } })`。`scope` 可以是函数，每次算 key 时求值，切换账号不用重建客户端。
- **debug**：`createAxp({ debug })`，`true` 或自定义 logger；开启后失败响应会附上调用点 `stack`。
- **auth**：`AuthFailureAction` 新增第五个动作 `Others`（与鉴权无关的失败，原样返回）；根入口导出 `defaultAuthFailure`，自定义 `onFailure` 只想改个别情况时可以调用它沿用默认判定。
- **share**：新增 `methods`，默认 `get`、`head`。
- **notify**：`stringify` 有默认值，可以不写。
- **repath**：请求级除了 `false`，还可以写对象 `{ pattern, removeKey }` 覆盖。

### 删除

- **插件**：`axpCancel`、`axpKey`、`axpLogger`、`axpNormalize` 删除，能力进内核：取消用 `api.cancelAll(reason)`（函数形式的 `cancelAll(ax, reason)` 一并删除，`signal` 照常可用），key 用 `createAxp({ key })`，日志用 `createAxp({ debug })`，归一化由内核完成。
- **子路径**：`./cancel`、`./key`、`./logger`、`./normalize` 从 `exports` 删除，导入会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。保留 10 个插件各自的 `./<name>` 与 `./min`；插件内部的算法模块不对外。
- **类与静态方法**：`ApiError`、`AxpResponse.fromResponse`、`AxpResponse.isSuccessful`、`AxpHandle`。
- **手动排序**：`prepend`、`append`、`insertBefore`、`insertAfter` 删除，内置插件位置固定。
- **auth**：`canRefresh` 从 `ITokenManager` 和 `TokenManager` 删除。判定过期后插件会清空 token 并记下清空后的状态，登录写入新 token 后自动恢复，登录流程不用再手动改标记；另删除 `accessDeniedCode` 选项与 `ACCESS_DENIED_CODE`、`authFailureFactory`、`DEFAULT_ON_AUTH_FAILURE`（由 `defaultAuthFailure` 取代）、`registerAttemptHook`（retry 的每次尝试本来就会经过 auth）。
- **选项**：`raw`、`nullable`；`axpKey` 的 `fastMode`、`before`、`after`；cache 的 `storage`、`memory`（持久化走 `store`）；loading 的 `guardTransform`、`logical`。
- **类型**：`Plugin`、`PluginCleanup`、`CoreOptions`、`ICommonOptions`、`IPluginCommonRequestOptions`、`IPluginCommonResponseOptions`、`IBaseOptions`、`IMethodOptions`、`IHttpOptions`、`IInnerOptions`、`NormalizeOptions`、`HttpInternalRequestConfig`、`HttpPrototype`、`Primitive`、`MaybeFun`、`Falsy` 删除，替代写法见迁移指南第 13 节；`PluginLogger` 并入 `AxpLogger`。`MethodSchema` 和 `HttpMethodLower` 保留。

### 行为变化

- **retry 默认值**：`max` 默认 2（旧版 0），`delay` 默认指数退避 `300 * 2 ** (attempt - 1)`（旧版固定 3000），`delayMax` 默认 `10_000`（旧版 `Infinity`）。依赖旧默认值的地方要显式写回去。
- **filter 默认值**：装上即生效，要关闭才写请求级 `filter: false`；旧版要请求级 `filter: true` 才过滤。
- **cache**：只缓存 `get` 和 `head`，POST 要缓存只能在插件级改 `methods`；命中缓存时不再重跑 `transformResponse`。
- **判定统一读 `R`**：auth、retry、notify、cache、share、mock 的判定都读归一化响应，`status` 是逻辑状态，业务失败也算失败。
- **回调抛错**：判定类回调（`shouldRetry`、retry 的 `delay` / `jitter` 函数、`onFailure`、`isProtected`、`fallbackWhen`、`shouldCache`、`ready`）抛错不再被吞，作为程序 bug 原样抛出。通知类回调（`loading`、`notify`、`stringify`、`onAccessExpired`、`onAccessDenied`）仍然隔离，错误用 `console.error` 输出，不受 `debug` 开关控制。
- **时序**：loading 的显示从逻辑请求开始算，覆盖等待 token 刷新的时间；HTTP 4xx、5xx 不再进入 axios 实例的错误拦截器（传输层放行所有状态码，由 axp 统一判定）。
- **auth 过期通知**：401、刷新失败这条路径上，`onAccessExpired` 每一轮只通知一次，并发请求一起失败也只通知一次；过期后在 token 没变之前不再刷新。本地没有 token 时，每个受保护请求仍会调用一次 `onAccessDenied`（没配则回退 `onAccessExpired`），不去重。
- **派生上下文的 `ctx.signal`**：自定义插件在补丁里换了 `signal` 后，内层的 `ctx.signal` 跟随补丁里的 `signal`。
- **调用级 `undefined`**：`api.get(path, 方法级配置)(payload, 调用级配置)` 里，调用级值为 `undefined` 的任意键不再覆盖方法级的同名键，与 axios `mergeConfig` 一致。
- **axpEnvs**：卸载（`eject`、`dispose`）不再还原写入 `defaults` 的配置。
- **性能**：全插件、缓存未命中的单请求额外开销比旧版降低约 41%；缓存命中与 100 并发 share 不低于旧版。无插件时每次请求比旧版多约 7–10µs，这是入口合并实例 `defaults` 的固定成本。详见 [B6 报告](docs/reports/2026-10-28-pipeline-b6.md)。

### 修复

- **key**：请求级 `key: true` 现在包含 params，有请求体的方法还包含 data。旧版 `key: true` 只哈希 method 和 url，同一路径不同参数会串缓存。
- **notify**：`silent: true` 真正生效（只作用于默认的 `stringify`，自定义的自己读 `ctx.request.silent`）。
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
