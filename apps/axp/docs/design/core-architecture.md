---
title: axp 核心架构方案（洋葱管线 + 归一化响应）
status: draft
updated: 2026-10-28
summary: 新内核的结构、数据流、阶段排序、上下文、归一化响应与错误模型、插件接口、客户端 API 和性能设计
---
## TL;DR

- `createAxp<Schema, R>()` 产出客户端；一次调用 = 一个逻辑请求，穿过 5 个阶段的中间件，最内层调 `axios.request`。
- 传输边界把原始响应/错误判定成 `R extends IAxpResponse`；链路里只流转 `R`，`next()` 不抛错；最外层落定：成功返回 data，失败直接抛 `R`，程序 bug 抛原始异常。
- 插件 = 具名对象 `{ name, stage, setup | handle | taps }`；内置插件位置固定，自定义插件选阶段即可。
- 请求在链上不可变，内层改请求用 `next(patch)`；重试、重放就是再调一次 `next()`。
- cancel、key、日志开关、归一化从插件降为内核能力；剩 10 个插件。决策依据见 [0001](../decisions/0001-core-redesign.md)，插件细则见 [插件规格](plugin-spec.md)。

## 1. 目标与手段

| 目标 | 手段 |
|---|---|
| 扩展性强 | 中间件 + 阶段 + taps；`R` 可扩展；响应工厂、缓存存储、令牌管理都是接口 |
| API 易用且灵活 | 内置插件免排序；请求级选项统一四种写法；`wrap` / `throws` 两个开关覆盖三种返回形态 |
| 性能好 | 链只在增删插件时编译；key 惰性；按需克隆；HTTP 错误不构造 AxiosError；失败不额外分配错误对象 |
| 心智负担低 | 一个对象（`R`，成功失败都是它，抛出的也是它）、一条路径（`next()` 不抛）；装上即生效，只有改变数据新鲜度的插件按请求开启 |

**非目标（本轮不做）**：fetch 传输层；熔断、离线队列、分阶段超时、缓存持久化实现（只留接口）；分页、轮询。

## 2. 结构

```
api.get('/pet/{id}')(payload, opts)
  │
  ▼
┌──────────────────────── 落定（内核）：R → data | R | throw R；bug → throw 原始异常 ─────────────────────┐
│ outer       loading → notify                       每个逻辑请求一次                                  │
│ prepare     repath → filter                        请求整形，一次                                    │
│ attempt     retry                                  重试边界：往里的层每次尝试都重跑                    │
│ credential  auth                                   每次尝试注入 token；401 刷新后再调 next()          │
│ source      mock → share → cache                   结果来源，可短路                                  │
│ ┌──────────────────── 传输（内核）：axios.request + 判定 → R ────────────────────┐                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

模块划分（`src/`）：

| 文件 | 职责 |
|---|---|
| `client.ts` | `createAxp`、动词分发、`request`、`extend`、`use/eject`、`cancelAll`、`inspect` |
| `pipeline.ts` | 插件排序、taps 编译、链组合、`next(patch)`、异常兜底 |
| `context.ts` | `AxpContext`：请求视图、signal、状态键、`key()`、`fail()`、`markReplayable()` |
| `transport.ts` | 调 `axios.request`、按需克隆请求体、交给响应工厂判定 |
| `response.ts` | `IAxpResponse`、`AxpResponse`、`IAxpResponseFactory`、`axpResponse()`、`isAxpResponse` |
| `key.ts` | key 服务（由 `plugins/key.ts` 的哈希算法迁来） |
| `types.ts` | Schema 推断（保留现有机制）、请求选项、插件类型 |
| `plugins/*.ts` | 10 个内置插件 |
| `objects/TokenManager.ts` | 保留，去掉 `canRefresh` |

删除：`core.ts`、`install.ts`、`helper.ts` 中的 adapter 链与单次尝试机制、`bag.ts`、`objects/Response.ts`、`plugins/{cancel,key,logger,normalize}.ts`。

## 3. 一次请求的数据流

1. 动词调用把 `path`、`payload`、方法级配置、调用级配置浅合并成逻辑请求 `AxpRequestConfig`（与现在 `core.ts:91-97` 相同）。
2. 内核建逻辑请求级上下文：分配 `id`，建 `AbortController` 并与用户 `signal` 联动，登记到在途集合（`cancelAll` / `pending()` 用）。
3. 按编译好的链从外到内执行中间件。每层拿到的 `ctx.request` 是外层交给它的版本。
4. 到达传输层：若有层调用过 `markReplayable()` 且 `data` 是纯对象/数组，先克隆一份再发；调用 `axios.request`，强制 `validateStatus: () => true`。
5. 响应工厂把响应（或异常）判定成 `R`，内核给它打上品牌，原路返回；每层可读、可替换、可再次调用 `next()`。
6. 最外层落定：从在途集合注销，解除 signal 监听，再按 §7 决定返回 data、返回 `R`、抛 `R` 或抛原始异常。

## 4. 阶段与排序

| 阶段 | 语义 | 内置插件（外→内） | 自定义插件典型用途 |
|---|---|---|---|
| `outer` | 每个逻辑请求进出一次，看到最终 `R` | loading → notify | 埋点、整体耗时、审计 |
| `prepare` | 请求整形，只跑一次 | repath → filter | 签名前的参数规整、公共参数 |
| `attempt` | 重试边界；本阶段内、retry 以内的层每次尝试都重跑 | retry | 每次尝试的日志、请求签名（**自定义插件默认阶段**） |
| `credential` | 凭证注入与鉴权失败处理 | auth | 自定义 header 鉴权 |
| `source` | 结果来源，可不触网直接返回 | mock → share → cache | 本地 mock、离线兜底 |

排序规则：
1. 阶段顺序固定为上表。
2. 同阶段内：`enforce: 'pre'` 的自定义插件 → 内置插件（固定次序）→ `enforce: 'post'`（默认）的自定义插件；自定义插件之间按 `plugins` 数组顺序。
3. 插件名重复直接抛错；`taps` 的每一段独立参与排序，名字记作 `<name>#<序号>`。
4. 链在 `createAxp`、`use`、`eject` 时编译一次；在途请求沿用发起时的链快照。
5. `client.inspect()` 返回解析后的完整顺序：`[{ stage, name }]`，调试顺序问题只看它。

## 5. 上下文

```ts
/** 中间件拿到的上下文；逻辑请求级字段在各层共享，request 是本层视图 */
interface AxpContext<R extends IAxpResponse = IAxpResponse> {
  readonly id: number                               // 逻辑请求序号
  readonly client: AxpClient<unknown, R>
  readonly request: Readonly<AxpRequestConfig>      // 本层看到的请求，只读
  readonly signal: AbortSignal                      // 逻辑请求级：用户 signal ∪ cancelAll
  readonly log: AxpLogger                           // 受 debug 开关控制
  key(): string | null                              // 惰性计算，按 request 对象缓存；不可哈希时为 null
  get<T>(k: AxpStateKey<T>): T | undefined          // 逻辑请求级状态，替代字符串键
  set<T>(k: AxpStateKey<T>, v: T): void
  fail(init: AxpResponseInit<R>): R                   // 凭空造结果，必须经响应工厂
  markReplayable(): void                            // 声明本请求可能被重发，传输层据此克隆请求体
}
type AxpNext<R> = (patch?: AxpRequestPatch) => Promise<R>
function stateKey<T>(description: string): AxpStateKey<T>   // 基于 Symbol 的类型化键
```

**请求不可变**：中间件不改 `ctx.request`，而是 `next(patch)`。内核把 patch 浅合并成新请求交给内层，`headers` 多合并一层。
同一层两次调用 `next()` 拿到的是同一个基准请求，所以重发天然"干净"，不再需要原始请求体快照和 `axp:share`、`axp:cache` 这类保活键（O1）。

**signal**：传输层用 `request.signal ?? ctx.signal`。share 用 patch 换成共享 controller 的 signal，实现"首发取消不连累跟随者"。

## 6. 归一化响应

```ts
/** 响应类别 */
type AxpKind = 'ok' | 'http' | 'biz' | 'network' | 'timeout' | 'cancel' | 'parse' | 'auth' | 'internal'

/** 归一化响应契约：只有数据字段，插件只读这些；成功、失败、被抛出的都是它 */
interface IAxpResponse<D = unknown> {
  readonly ok: boolean                 // 成功判定，唯一的开放点
  readonly kind: AxpKind
  readonly status: number              // 逻辑状态：插件判断 401/403/5xx 一律读它
  readonly httpStatus: number          // 原始 HTTP 状态，无响应为 0
  readonly code?: string | number      // 业务码，非信封响应为 undefined
  readonly message: string
  readonly data: D
  readonly reason?: string             // 细分原因，如 auth 的 expired / denied / unauthenticated
  readonly request: Readonly<AxpRequestConfig>   // 实际发出的请求；share/cache 时是发出那一次的
  readonly stack?: string              // 仅 debug 模式：失败落定时附上发起请求那一刻的调用点
  readonly raw?: AxiosResponse         // 逃生口
  readonly error?: unknown             // 原始异常（网络错误的 stack 在这里）
}

/** 响应工厂：每个客户端一份，只负责解析和构造，不负责判定 */
interface IAxpResponseFactory<R extends IAxpResponse> {
  fromResponse(res: AxiosResponse, ctx: AxpContext<R>): R
  fromError(err: unknown, ctx: AxpContext<R>): R
  fail(init: AxpResponseInit<R>, ctx: AxpContext<R>): R   // init.from 可带上原响应，未覆盖的字段沿用
}

/** 默认实现 */
class AxpResponse<D = unknown> implements IAxpResponse<D> {
  constructor(init: AxpResponseInit)
  get ok(): boolean        // 默认：2xx 且（无业务码，或业务码 ∈ [0, '0000']）
  get status(): number     // 默认：失败且 2xx 且业务码是 400–599 的数字 → 业务码；否则 httpStatus
  get kind(): AxpKind      // ok → 'ok'；否则 2xx → 'biz'，非 2xx → 'http'
  toJSON(): object         // getter 不进 JSON.stringify，这里补齐全部字段
}
function isAxpResponse<R extends IAxpResponse = AxpResponse>(e: unknown): e is R   // Symbol.for('axp.response') 品牌
```

**判定的开放点就是 `ok` 和 `status` 本身**：子类覆盖 getter 即可，`kind` 自动跟着走，不另设 `isSuccessful` 之类的方法。
内核保证这两个 getter **只在收到响应时求值**：其余情况由工厂在构造时把 `ok: false`、`kind`、`status` 写成实例自有属性，遮住原型 getter，所以覆盖时只需判断响应本身。

```ts
class MyResponse<D = unknown> extends AxpResponse<D> {
  traceId = ''
  get ok() { return this.httpStatus < 300 && this.code === 200 }          // 我们的成功码是 200
  get status() { return this.code === 'TOKEN_EXPIRED' ? 401 : super.status }
}
const response = axpResponse<MyResponse>({
  create: (init, raw) => Object.assign(new MyResponse(init), { traceId: raw?.headers['x-trace-id'] ?? '' }),
})
const api = createAxp<Schema, MyResponse>({ response, plugins: [axpRetry({ shouldRetry: (r) => r.traceId !== '' })] })
```

**默认工厂 `axpResponse(options?)` 的分类规则**（顺序即优先级；前五行在构造时写死，后两行交给 getter）：

| 输入 | kind | status |
|---|---|---|
| 取消（`axios.isCancel`、`AbortError`，或发送前 signal 已中止） | `cancel` | 0 |
| AxiosError 且超时（`ETIMEDOUT`，或 `ECONNABORTED` 且消息含 timeout） | `timeout` | 0 |
| AxiosError 且 `ERR_BAD_RESPONSE` | `parse` | 0 |
| 其它 AxiosError | `network` | 0 |
| **非 AxiosError 的异常**（用户拦截器、`transformResponse` 里的 bug） | `internal` | 0 |
| `expectJson` 为真，2xx，声明 json/html 但 body 仍是非空字符串 | `parse` | httpStatus |
| 收到响应 | 由 `ok` / `status` / `kind` getter 决定 | 同左 |

| 选项 | 默认 | 说明 |
|---|---|---|
| `envelope` | `{ code: 'code', data: 'data', message: 'message' }` | 信封字段名；`false` 关闭信封识别 |
| `expectJson` | `false` | 声明 JSON 却解析失败时判为 `parse` |
| `create(init, raw?)` | `new AxpResponse(init)` | 扩展点：返回子类或带额外字段的对象 |

**品牌**：`AxpResponse` 原型上自带品牌；`create` 返回普通对象时，内核在拿到产出时补一个不可枚举的品牌属性。

## 7. 落定与错误

axp 没有错误类。落定规则：

| 情况 | 默认 | `wrap: true` | `throws: false` |
|---|---|---|---|
| 成功 | `data` | `WithData<R, D>` | `WithData<R, D>` |
| 可预期的失败 | `throw r` | `throw r` | resolve `WithData<R, D>`（`ok: false`） |
| 程序 bug（`kind: 'internal'`） | 抛原始异常 | 抛原始异常 | 抛原始异常 |

- `throws` 的默认值可在 `createAxp({ throws })` 上改。
- **bug 不伪装成请求失败**：中间件、判定类用户回调（见 N13）、用户拦截器或 `transformResponse` 抛出的非 AxiosError，链内临时包成 `internal` 交给外层，保证 `next()` 不 reject、外层的计数和注销照常完成；
  落定时抛出 `r.error` 本身，stack 完整，`throws: false` 也不吞。
- **调用点**：`debug` 开启时，内核在发起请求那一刻 `new Error()` 记下调用点；失败落定时用 `factory.fail({ from: r, stack })` 派生一个带 `stack` 的副本抛出，不改被 share/cache 共享的原对象。生产环境不记录，零开销。
- **适配需要 `Error` 的生态**：`createAxp({ reject: (r) => unknown })`，默认原样返回 `r`；接 Sentry、TanStack Query 时可以在这里包成 `Error`。只作用于可预期的失败。
- **区分**：`catch (e) { if (api.isResponse(e)) … else throw e }`；`api.isResponse` 与 `isAxpResponse` 同一判断，类型收窄到该客户端的 `R`。

## 8. 插件接口

```ts
type AxpStage = 'outer' | 'prepare' | 'attempt' | 'credential' | 'source'
type AxpMiddleware<R> = (ctx: AxpContext<R>, next: AxpNext<R>) => Promise<R>

interface AxpTap<R> {
  stage: AxpStage
  enforce?: 'pre' | 'post'
  onRequest?(ctx: AxpContext<R>): void | AxpRequestPatch | Promise<void | AxpRequestPatch>
  onResponse?(r: R, ctx: AxpContext<R>): void | R | Promise<void | R>
}

interface AxpPluginInstance<R, A = void> {
  handle?: AxpMiddleware<R>
  taps?: readonly AxpTap<R>[]
  api?: A                                  // 暴露给使用者的操作，如 cache 的 clear()
  dispose?(): void
}

interface AxpPlugin<R extends IAxpResponse = IAxpResponse, A = void> {
  readonly name: string
  readonly stage?: AxpStage                // 自定义插件默认 'attempt'；只有 taps 时忽略
  readonly enforce?: 'pre' | 'post'        // 默认 'post'
  setup?(client: AxpClient<unknown, R>): AxpPluginInstance<R, A> | void   // 每个客户端调用一次，状态建在这里
  handle?: AxpMiddleware<R>                // 无状态插件可直接给
  taps?: readonly AxpTap<R>[]
}
```

约定：
- **状态必须建在 `setup` 里**，不能放在工厂闭包。这样同一个插件对象可以装到多个客户端（`extend` 默认继承插件就靠这个），各自一份状态。
- 内置插件工厂写成泛型 `axpRetry<R extends IAxpResponse = IAxpResponse>(opts?: IRetryOptions<R>)`，只透传 `R`、不构造 `R`，所以对任意 `R` 都成立。
- 插件只有 `setup` 没有中间件（如 envs）时不进链，只在装卸时执行。

自定义插件示例：

```ts
/** 记录每次尝试耗时 */
const timing: AxpPlugin = {
  name: 'timing',
  stage: 'attempt',
  async handle(ctx, next) {
    const t = performance.now()
    const r = await next()
    ctx.log.log(`[timing] ${ctx.request.url} ${r.status} ${performance.now() - t}ms`)
    return r
  },
}

/** 不对称：请求侧看最终发出的请求，响应侧看收敛后的结果 */
const audit: AxpPlugin = {
  name: 'audit',
  taps: [
    { stage: 'credential', enforce: 'post', onRequest: (ctx) => report('send', ctx.request) },
    { stage: 'outer', onResponse: (r) => report('done', r.kind) },
  ],
}
```

## 9. 客户端 API

```ts
function createAxp<S = unknown, R extends IAxpResponse = AxpResponse>(options?: AxpOptions<R>): AxpClient<S, R>

interface AxpOptions<R> {
  axios?: AxiosInstance               // 默认 axios.create()
  plugins?: readonly AxpPlugin<R, any>[]
  response?: IAxpResponseFactory<R>       // R 不是 AxpResponse 时类型上必填
  key?: IKeyOptions                   // key 服务配置：scope、ignores、sample
  throws?: boolean                    // 默认 true
  reject?: (r: R) => unknown          // 可预期失败抛出前的转换，默认原样抛 r
  debug?: boolean | AxpLogger         // 取代 axpLogger 插件；开启时还记录调用点 stack
}

interface AxpClient<S, R> extends HttpVerbs<S, R> {   // axios 全部 10 个小写动词（含 purge/link/unlink），柯里化形态与 data/params 分派不变
  readonly axios: AxiosInstance
  request<D = unknown>(config: AxpRequestConfig): Promise<D>          // 无类型逃生口，同样支持 wrap/throws 重载
  extend(overrides?: AxiosRequestConfig, opts?: { plugins?: 'inherit' | readonly AxpPlugin<R, any>[] }): AxpClient<S, R>
  use(plugin: AxpPlugin<R, any>): void
  eject(name: string): boolean
  plugin<A>(p: AxpPlugin<R, A>): A | undefined        // 取插件实例 API
  cancelAll(reason?: string): number
  pending(): number                                    // 在途逻辑请求数
  inspect(): ReadonlyArray<{ stage: AxpStage; name: string }>
  isResponse(e: unknown): e is R                         // 区分可预期的失败与程序 bug
  dispose(): void
}
```

`extend()` 克隆 axios defaults（沿用 `cloneAxiosDefaults`），默认继承插件列表并各自重新 `setup`，状态不共享。
使用方式示例：

```ts
const api = createAxp<Schema>({
  axios: axios.create({ baseURL: '/api' }),
  plugins: [axpRetry({ max: 2 }), axpAuth({ tokenManager, onRefresh, onAccessExpired }), axpCache()],
})
const pet = await api.get('/pet/{id}')({ id: 1 })                    // Pet
const out = await api.get('/pet/{id}')({ id: 1 }, { wrap: true })   // WithData<AxpResponse, Pet>
try { await api.post('/pet')(body) } catch (e) { if (api.isResponse(e)) toast(e.message); else throw e }
const res = await api.post('/pet')(body, { throws: false })        // 不写 try/catch：res.ok 判断
```

## 10. 类型

- **Schema 推断**：保留 `types.ts` 现有的方法优先 schema、O(1) 查表、`NoInfer` 机制，TS ≥ 5.4 不变。
- **两个泛型都要显式写**：TS 不支持部分推断，写了 `S` 就推不出 `R`。`AxpOptions` 用条件类型约束：`R` 不是 `AxpResponse` 时 `response` 必填，且其产出必须是 `R`。
- **`WithData<R, D>`** = `Omit<R, 'data'> & { readonly data: D }`：TS 没有高阶类型，`R` 里的 `data` 是 `unknown`，每个接口的具体类型靠它替换。
- **插件工厂推断**：内联写在 `plugins` 数组里时从上下文推出 `R`；单独定义成变量时手写 `axpRetry<MyResponse>()`。用 `expectTypeOf` 守住。
- **请求选项**：插件通过 `declare module '@codejoo/axp' { interface AxpRequestOptions { retry?: … } }` 扩展，不再污染 `axios` 模块的 `AxiosRequestConfig`。

## 11. 性能设计

| # | 做法 | 解决 |
|---|---|---|
| P1 | 链在增删插件时编译，请求时不排序、不查表 | — |
| P2 | 每层上下文用原型继承逻辑请求级字段，只新建 `request` 视图 | — |
| P3 | `key()` 惰性计算并按 request 对象缓存；不用 cache/share 的请求不算 key | — |
| P4 | 只有 `markReplayable()` 且 data 是纯对象/数组时才 `structuredClone`；克隆失败或环境没有 `structuredClone` 时回退原引用（debug 下 warn），不让请求失败 | O6、R2-1 |
| P5 | 传输强制 `validateStatus` 全放行，HTTP 错误不构造 AxiosError（省掉调用栈捕获） | — |
| P6 | 失败直接抛 `R`，不另建错误对象；调用点 stack 只在 debug 模式记录 | D6 |
| P7 | 不再包装 `transformResponse`，不再拷贝尝试钩子数组 | O6、R2-3 |
| P8 | 缓存过期惰性删除，写入时按容量节流清扫 | O6 |

性能门槛和测法见 [测试方案](test-plan.md) §8。

## 12. 与现状的对照

| 现状问题 | 新方案 |
|---|---|
| O1 重放要快照 share/cache/data | 请求不可变 + `next(patch)`，无快照 |
| O2 三处手动给错误挂 config | `R` 自带 `request`，由传输层或 `ctx.fail` 统一填写 |
| O3 cache 四张表 | 见插件规格 cache 节 |
| O4 `canRefresh` 写在用户的 TokenManager 上 | 收进 auth 内部状态，见插件规格 auth 节 |
| O5 business 风格只看 HTTP 码 | `IAxpResponse.status` 为逻辑状态，全插件统一读 |
| O6 效率小项 | §11 P4、P7、P8 |
| 错误类型 4 种 | 没有错误类：可预期的失败抛 `R`，类别看 `r.kind` / `r.reason`；bug 抛原始异常 |
| 14 个写死槽位，自定义插件只能靠 4 个插入方法 | 阶段 + `use/eject` |
| notify 关于 auth 重放双触发的过时警告 | 机制不存在了，随旧代码删除 |

## 13. 新增设计选择（已确认）

讨论中没逐条过、由本方案补上的选择，2026-10-28 用户确认全部采纳：

| # | 选择 | 理由 | 破坏性 |
|---|---|---|---|
| N1 | cancel 进内核：每个逻辑请求一个 controller，`client.cancelAll()` | retry 等待、auth 排队、share 跟随者都依赖 signal，本来就该人人都有 | 删 `axpCancel` |
| N2 | key 降为内核服务；`key: true` 包含 query 和 body | 不再有"filter 必须在 key 前"的约束；旧 `true` 不含 params，同 URL 不同参数会串缓存 | 删 `axpKey`，`fastMode` 去掉 |
| N3 | 删 `axpNormalize`，由内核落定；请求级 `normalize: false` 改用 `throws: false` | D3 | 是 |
| N4 | 删 `axpLogger`，改 `debug` 选项 | 原插件只设两个开关 | 是 |
| N5 | 请求级选项不再接受函数形式（`MaybeFun`） | 调用点本就在写代码，函数形式只增加分支 | 是 |
| N6 | 装上即生效；只有改变数据新鲜度的 cache、share 按请求开启 | 现在 filter 装了不生效、retry 默认 `max=0`，都是"装了没用"的坑 | filter 默认生效；retry 默认 `max: 2`、指数退避、`delayMax: 10_000`；share 新增 `methods`（默认 GET/HEAD） |
| N7 | cache 默认只缓存 GET/HEAD | 验收预判"POST 也被缓存" | 是 |
| N8 | 传输强制 `validateStatus` 全放行 | P5；单一路径 | axios 实例上的错误拦截器不再看到 4xx/5xx |
| N9 | 缓存存判定后的响应，命中不再重跑 `transformResponse` | 更快，也更好理解 | 是 |
| N10 | loading 从逻辑请求一开始显示，包括等待 token 刷新的时间 | 洋葱最外层的自然结果，体验更好 | 时序变化 |
| N11 | 删返回形态 `raw: true`，改用 `wrap: true` 后读 `r.raw`；同时删除只影响类型的 `nullable` 选项（data 为 null/undefined 时照常原样返回） | 三种形态收成两个开关 | 是 |
| N12 | `extend()` 默认继承插件（各自新状态） | 状态建在 `setup` 里之后，继承变得安全 | 与 #17 相反 |
| N13 | 判定类回调（`shouldRetry`、retry 的 `delay` / `jitter` 函数、`onFailure`、`isProtected`、`fallbackWhen`、`shouldCache`、`ready`）抛错按 bug 处理，抛原始异常；通知类回调（`loading`、`notify`、`stringify`、`onAccessExpired`、`onAccessDenied`）仍隔离，但用 `console.error` 输出，不受 debug 开关控制 | bug 不伪装成请求失败，也不悄悄吞掉 | 判定类回调以前被吞 |
