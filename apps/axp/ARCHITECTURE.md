# axp 架构导读

写给想读源码、或者想给 axp 写插件的人。读完应该能回答三件事：代码是怎么组织的，一次请求怎么走，我要扩展该动哪里。

这是导读，不是规格。字段级细节、选项表、行为变化都在 [docs/design](docs/design/)，文中遇到会给链接，不在这里重抄。

<!-- TODO: 待实现确认：§2 的内核文件（B1、B2）、plugins/ 下的 retry、auth、mock、share、cache 与三个算法模块、objects/TokenManager.ts（B3、B4）已对照 src/ 核对；index.ts 和子路径入口等 B6 落地后复核。旧实现（core.ts、install.ts、helper.ts、bag.ts、objects/Response.ts，以及 plugins/ 下的 cancel.ts、key.ts、logger.ts、normalize.ts）B5 才删除，目前与新内核并存。 -->

## 1. 一段话概述

`createAxp<Schema, R>()` 造出一个客户端。一次调用就是一个逻辑请求：它从外到内穿过 5 个阶段的中间件（洋葱管线），最里面一层才调 `axios.request`。传输边界把 axios 的响应或异常判定成统一的 `R extends IAxpResponse`，链路里只流转这一种对象，`next()` 从不抛错；最外层再"落定"：成功返回 data，可预期的失败直接抛 `R`，程序 bug 抛原始异常。

插件是一个具名对象 `{ name, stage, setup | handle | taps }`，选个阶段挂上去就行。内置插件的位置固定，使用者不用排序。

旧版靠 axios 拦截器和 adapter 凑出插件协作，跨插件状态要靠 WeakMap、Symbol 袋子、字符串键三处保活。新版让 axp 自己管请求的生命周期，这些补丁都用不着了。为什么这么选，见 [ADR 0001](docs/decisions/0001-core-redesign.md)。

## 2. 模块地图

`src/` 下的文件和职责：

| 文件                      | 职责                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.ts`               | `createAxp`、动词分发、`request`、落定 `settle`、`extend`、`use/eject`、`cancelAll`、`inspect`、`dispose`                                            |
| `options.ts`              | `resolveOption`：请求级四种写法（`false`、`true` 或省略、简写、对象）的统一解析，所有插件共用                                                        |
| `pipeline.ts`             | 插件排序、taps 编译、链组合、`next(patch)`、异常兜底                                                                                                 |
| `stages.ts`               | `STAGE_BUILTINS`：阶段和内置插件固定次序的唯一来源，`AxpStage` 类型与排序都从它派生                                                                  |
| `context.ts`              | `AxpContext`：请求视图、signal、状态键（`stateKey`）、`key()`、`fail()`、`markReplayable()`                                                          |
| `transport.ts`            | 调 `axios.request`、按需克隆请求体、交给响应工厂判定                                                                                                 |
| `response.ts`             | `IAxpResponse`、`AxpResponse`、`IAxpResponseFactory`、`axpResponse()`、`isAxpResponse`                                                               |
| `brand.ts`                | 响应品牌 `AXP_RESPONSE` 和类别常量 `AXP_KINDS`。零导入的叶子模块，验收执行器可以直接用 Node 原生加载                                                 |
| `key.ts`                  | key 服务（哈希算法从旧的 `plugins/key.ts` 迁来）                                                                                                     |
| `methods.ts`              | 十个动词按 payload 去向（`data` 或 `params`）分组，`normalizeMethod` 统一方法大小写；client、key 和按方法判断的插件（retry、auth、share、cache）共用 |
| `utils.ts`                | 共用小件：纯对象判断、`defaults` 克隆与写回、默认头展平、通知回调隔离                                                                                |
| `types.ts`                | Schema 推断（沿用现有机制）、请求选项、插件类型、`AxpLogger`                                                                                         |
| `plugins/*.ts`            | 10 个内置插件，一个插件一个文件                                                                                                                      |
| `plugins/retry-timing.ts` | retry 的纯算法：默认退避、抖动与封顶、`Retry-After` 解析（秒数或 HTTP 日期）、可取消的等待                                                           |
| `plugins/auth-match.ts`   | auth 的纯算法：`methods`、`urlPattern` 的编译与匹配（优先 URLPattern，不可用时回退正则）                                                             |
| `plugins/cache-store.ts`  | cache 的纯算法：同步内存 LRU 仓、`IAxpCacheStore` 接口、防止旧响应覆盖新结果的新鲜度屏障                                                             |
| `objects/TokenManager.ts` | 令牌管理：`ITokenManager` 接口和默认实现 `TokenManager`（内存存放，镜像到 `localStorage`），去掉了 `canRefresh`                                      |
| `index.ts`                | 包入口，见下                                                                                                                                         |

`debug` 没有独立的文件：`createAxp` 按选项挑日志器（`true` 用 `console`，对象原样用，关闭时用 `context.ts` 里共享的空实现 `NO_LOG`），插件经 `ctx.log` 使用。

入口：`index.ts` 导出 `createAxp`、响应与类型、10 个插件工厂、`TokenManager` 等；子路径保留 10 个插件各自的 `./<name>` 和 `./min`，删除 `./cancel`、`./key`、`./logger`、`./normalize`。

<!-- TODO: 待实现确认：index.ts 的导出清单和 package.json exports 的最终形态，等 B6 打包后核对 -->

10 个内置插件按阶段分布：

- `outer`：loading、notify
- `prepare`：repath、filter
- `attempt`：retry
- `credential`：auth
- `source`：mock、share、cache
- envs：只有 `setup`，装上时把配置写进 `client.axios.defaults`，不进链；卸载不还原

cancel、key、日志开关、归一化原来是插件，现在降为内核能力，对应的 `axpCancel`、`axpKey`、`axpLogger`、`axpNormalize` 已删除。每个插件的选项和行为见 [插件规格](docs/design/plugin-spec.md)。

## 3. 一次请求怎么走

```
api.get('/pet/{id}')(payload, opts)        一次调用 = 一个逻辑请求
  │                                   ▲
  ▼                                   │  返回 data / 抛 R / 抛原始异常
┌ settle (kernel) ─────────────────────────────────────┐   落定：R -> data | 抛 R | 抛原始异常，每个逻辑请求一次
│ ┌ outer ───────────────────────────────────────────┐ │   loading -> notify        整个逻辑请求进出一次
│ │ ┌ prepare ─────────────────────────────────────┐ │ │   repath -> filter         请求整形，只跑一次
│ │ │ ┌ attempt ─────────────────────────────────┐ │ │ │   retry                    重试边界，往里每次尝试都重跑
│ │ │ │ ┌ credential ──────────────────────────┐ │ │ │ │   auth                     每次尝试注入 token，401 刷新后重放
│ │ │ │ │ ┌ source ──────────────────────────┐ │ │ │ │ │   mock -> share -> cache   结果来源，可短路不触网
│ │ │ │ │ │  transport: axios.request -> R   │ │ │ │ │ │   传输（内核）：判定成 R，打品牌
│ │ │ │ │ └──────────────────────────────────┘ │ │ │ │ │
│ │ │ │ └──────────────────────────────────────┘ │ │ │ │
│ │ │ └──────────────────────────────────────────┘ │ │ │
│ │ └──────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

请求从外往里走，`R` 从里往外回。每一层都能读它、换掉它，或者再调一次 `next()`。

具体六步：

1. **合并请求**：动词调用把 `path`、`payload`、方法级配置、调用级配置浅合并成逻辑请求 `AxpRequestConfig`，合并方式和旧版一致；内核再用 axios 公开的 `mergeConfig` 把实例 `defaults` 合并进来，补齐实际发送的 method（小写）并把默认头展平。**各层看到的都是最终生效的配置**，所以 repath、filter、key 都能处理 `defaults` 里的值，语义和旧版拦截器一致。
2. **建上下文**：内核为这个逻辑请求分配 `id`，建 `AbortController` 并与用户传入的 `signal` 联动，登记到在途集合（`cancelAll()` / `pending()` 用）。
3. **穿链**：按编译好的链从外到内执行中间件。每层的 `ctx.request` 是外层交给它的那一版。
4. **到传输层**：若有层调用过 `markReplayable()`，且 `data` 是纯对象或数组，先克隆再发；然后调用**用户的 axios 实例**的 `request`（实例上的拦截器照常执行），强制 `validateStatus: () => true`，所以 4xx/5xx 也当普通响应处理。axios 自己还会再合并一次 `defaults`，所以交给它的只是差量：以用户原始的请求级配置为底，叠上各层改动过的字段。层删掉的默认 `params` 键写成 `null`、默认头写成 `false`，防止被二次合并带回来。
5. **判定回流**：响应工厂把响应（或异常）判定成 `R`，内核给它打上品牌，沿原路返回。
6. **落定**：最外层从在途集合注销，解除 signal 监听，再按 [§7](#7-落定与-bug-透传) 决定返回 data、返回 `R`、抛 `R` 还是抛原始异常。

重试和鉴权重放没有专门机制，就是某一层"再调一次 `next()`"。

## 4. 阶段与排序

| 阶段         | 语义                                   | 内置插件（外→内）    | 自定义插件典型用途                                 |
| ------------ | -------------------------------------- | -------------------- | -------------------------------------------------- |
| `outer`      | 每个逻辑请求进出一次，看到最终的 `R`   | loading → notify     | 埋点、整体耗时、审计                               |
| `prepare`    | 请求整形，只跑一次                     | repath → filter      | 签名前的参数规整、公共参数                         |
| `attempt`    | 重试边界；retry 以内的层每次尝试都重跑 | retry                | 每次尝试的日志、请求签名（**自定义插件默认阶段**） |
| `credential` | 凭证注入与鉴权失败处理                 | auth                 | 自定义 header 鉴权                                 |
| `source`     | 结果来源，可不触网直接返回             | mock → share → cache | 本地 mock、离线兜底                                |

排序规则：

1. 阶段顺序固定，就是上表。
2. 同阶段内：`enforce: 'pre'` 的自定义插件 → 内置插件（固定次序）→ `enforce: 'post'`（默认）的自定义插件；自定义插件之间按 `plugins` 数组顺序。
   所以在 `attempt` 阶段里，`pre` 落在 retry 外面，`post` 落在 retry 里面，每次尝试都会重跑。
3. 插件名重复直接抛错。`taps` 的每一段独立参与排序，名字记作 `<name>#<序号>`。
4. 链只在 `createAxp`、`use`、`eject` 时编译一次；在途请求沿用发起时的链快照。
5. 排序出问题时看 `client.inspect()`，它返回解析后的完整顺序 `[{ stage, name }]`。

不用 `before/after` 拓扑排序（最终顺序看不见，还有成环风险），也不用纯数组（使用者要记约 8 条顺序约束，写错不报错）。取舍见 [ADR 0001 D2](docs/decisions/0001-core-redesign.md)。

## 5. 上下文与请求不可变

中间件签名是 `(ctx, next) => Promise<R>`。`ctx` 上最常用的：

| 成员                   | 用途                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `id` / `client`        | 逻辑请求序号 / 所属客户端                                                          |
| `request`              | 本层看到的请求，**只读**                                                           |
| `signal`               | 逻辑请求级：用户 signal ∪ `cancelAll`                                              |
| `log`                  | 受 `debug` 开关控制，关闭时是空函数；形状是 `AxpLogger`，即 `{ log, warn, error }` |
| `key()`                | 惰性计算，按 request 对象缓存；不可哈希时为 `null`                                 |
| `get(k)` / `set(k, v)` | 逻辑请求级状态，用 `stateKey<T>()` 建的 Symbol 键，替代字符串键                    |
| `fail(init)`           | 凭空造一个结果，必须经响应工厂，保证扩展字段齐全                                   |
| `markReplayable()`     | 声明本请求可能被重发，传输层据此克隆请求体                                         |

完整签名见 [核心架构 §5](docs/design/core-architecture.md#5-上下文)。

**请求不可变**：中间件不改 `ctx.request`，要给内层换请求就调 `next(patch)`。内核把 patch 浅合并成新请求交给内层，`headers` 多合并一层；patch 里某个字段写 `undefined`，表示把它从请求里删掉。同一层连续调两次 `next()`，拿到的是同一个基准请求，所以重发天然是"干净"的，不用再保存原始请求体快照，也不用 `axp:share`、`axp:cache` 那类保活键。

**signal**：传输层用 `request.signal ?? ctx.signal`。share 的 `start` 策略用 patch 换成共享的 controller signal，这样首发请求被取消时不会连累跟随者；`end`、`race` 每个调用各发各的请求，不换 signal。

## 6. 归一化响应

链路里流转的 `R` 是纯数据契约 `IAxpResponse`，成功、失败、被抛出的都是它。主要字段：

- `ok`、`kind`、`status`：成功与否、响应类别、逻辑状态
- `httpStatus`、`code`、`message`、`data`、`reason`：原始 HTTP 状态、业务码、消息、数据、细分原因
- `request`：实际发出的请求（share/cache 时是发出那一次的）
- `raw`、`error`、`stack`：原始响应、原始异常、debug 模式下的调用点

`kind` 取值：`ok | http | biz | network | timeout | cancel | parse | auth | internal`。`auth` 由 auth 插件经 `ctx.fail` 产生，不在下面的分类表里。字段全表见 [核心架构 §6](docs/design/core-architecture.md#6-归一化响应)。

契约用 interface 而不是 class，是因为 `./min` 入口是独立模块、跨入口 `instanceof` 不可靠；缓存的深拷贝和将来的持久化也会丢原型。默认实现是 `AxpResponse`，品牌是 `Symbol.for('axp.response')`，`isAxpResponse(e)` 认的是品牌，不是 `instanceof`。

### 判定：开放点就是 `ok` 和 `status`

默认实现里这两个是原型 getter，`kind` 跟着它们自动推导：

- `ok`：2xx，且（无业务码，或业务码在 `[0, '0000']` 里）
- `status`：失败、2xx、且业务码是 400–599 的数字时取业务码，否则取 `httpStatus`
- `kind`：成功是 `ok`；否则 2xx 是 `biz`，非 2xx 是 `http`

所有插件判断 401/403/5xx 一律读 `r.status`，所以 HTTP 200 + 业务码 401 这种 business 风格不用任何适配。

想改判定，子类覆盖 getter 就行，不用另设 `isSuccessful` 之类的方法：

```ts
/** 自定义响应：成功码是 200，TOKEN_EXPIRED 视作 401 */
class MyResponse<D = unknown> extends AxpResponse<D> {
  traceId = "";
  get ok() {
    return this.httpStatus < 300 && this.code === 200;
  }
  get status() {
    return this.code === "TOKEN_EXPIRED" ? 401 : super.status;
  }
}
const response = axpResponse<MyResponse>({
  create: (init, raw) => Object.assign(new MyResponse(init), { traceId: raw?.headers["x-trace-id"] ?? "" }),
});
const api = createAxp<Schema, MyResponse>({ response });
```

内核保证这两个 getter **只在收到响应时求值**：其余情况（取消、超时、网络错误……）由工厂在构造时把 `ok: false`、`kind`、`status` 写成实例自有属性，遮住原型 getter。所以覆盖 getter 时只需要判断"响应本身"，不用操心异常分支。

### 默认工厂的分类规则

`axpResponse(options?)` 按下表从上到下匹配，顺序即优先级：

| 输入                                                                 | kind                                    | status     |
| -------------------------------------------------------------------- | --------------------------------------- | ---------- |
| 取消（`axios.isCancel`、`AbortError`，或发送前 signal 已中止）       | `cancel`                                | 0          |
| AxiosError 且超时                                                    | `timeout`                               | 0          |
| AxiosError 且 `ERR_BAD_RESPONSE`                                     | `parse`                                 | 0          |
| 其它 AxiosError                                                      | `network`                               | 0          |
| **非 AxiosError 的异常**（用户拦截器、`transformResponse` 里的 bug） | `internal`                              | 0          |
| `expectJson` 为真，2xx，声明 json/html 但 body 仍是非空字符串        | `parse`                                 | httpStatus |
| 收到响应                                                             | 由 `ok` / `status` / `kind` getter 决定 | 同左       |

前六行在构造时就把 `ok: false`、`kind`、`status` 写成实例自有属性（`expectJson` 判出的 `parse` 也一样，`status` 取原 HTTP 状态），只有最后一行交给 getter。

三个选项：`envelope`（信封字段名，默认 `{ code, data, message }`，`false` 关闭信封识别）、`expectJson`（默认 `false`）、`create(init, raw?)`（扩展点，返回子类或带额外字段的对象；返回普通对象时内核会补不可枚举的品牌属性）。

## 7. 落定与 bug 透传

axp 没有错误类。最外层按下表落定：

| 情况                           | 默认       | `wrap: true`     | `throws: false`                         |
| ------------------------------ | ---------- | ---------------- | --------------------------------------- |
| 成功                           | `data`     | `WithData<R, D>` | `WithData<R, D>`                        |
| 可预期的失败                   | `throw r`  | `throw r`        | resolve `WithData<R, D>`（`ok: false`） |
| 程序 bug（`kind: 'internal'`） | 抛原始异常 | 抛原始异常       | 抛原始异常                              |

`throws` 只有请求级，默认 `true`；没有客户端级默认值（`createAxp<S, R>` 显式泛型时返回类型无法如实反映客户端级开关）。

**bug 不伪装成请求失败。** 中间件、判定类用户回调、用户拦截器或 `transformResponse` 抛出的非 AxiosError，在链内被临时包成 `kind: 'internal'` 的 `R`，原始异常放在 `r.error`。这样 `next()` 依旧不 reject，外层的计数、注销、订阅者离场照常收尾。等落定时，抛出的是 `r.error` 本身，stack 完整，`throws: false` 也不会把它吞掉。

另外几条：

- **调用点**：开了 `debug`，内核在发起请求那一刻 `new Error()` 记下调用点；失败落定时用 `factory.fail({ from: r, stack })` 派生一个带 `stack` 的副本抛出，不改 share/cache 共享的原对象。生产环境不记，零开销。可预期的失败没有有意义的 stack（服务端判的失败，stack 只会指向 axp 内部），所以只记调用点。
- **要 `Error` 的生态**：Sentry、TanStack Query 这类，用 `createAxp({ reject: (r) => unknown })` 在抛出前包成 `Error`。只作用于可预期的失败，默认原样抛 `r`。
- **区分两类异常**：`catch (e) { if (api.isResponse(e)) … else throw e }`，`api.isResponse` 与 `isAxpResponse` 是同一个判断，类型会收窄到该客户端的 `R`。
- **用户回调抛错**：判定类回调（`shouldRetry`、`shouldCache`、`isProtected` 等）按 bug 处理；通知类回调（`loading`、`notify`、`onAccessExpired` 等）被隔离并用 `console.error` 输出。完整名单见 [插件规格 §0](docs/design/plugin-spec.md#0-通用约定)。

## 8. 写插件

### 接口

```ts
type AxpStage = "outer" | "prepare" | "attempt" | "credential" | "source";
type AxpMiddleware<R> = (ctx: AxpContext<R>, next: AxpNext<R>) => Promise<R>;

/** 分段挂载：请求侧、响应侧各挂各的阶段 */
interface AxpTap<R> {
  stage: AxpStage;
  enforce?: "pre" | "post";
  onRequest?(ctx: AxpContext<R>): void | AxpRequestPatch | Promise<void | AxpRequestPatch>;
  onResponse?(r: R, ctx: AxpContext<R>): void | R | Promise<void | R>;
}

interface AxpPlugin<R extends IAxpResponse = IAxpResponse, A = void> {
  readonly name: string;
  readonly enable?: boolean; // false 时不 setup、不进链
  readonly stage?: AxpStage; // 自定义插件默认 'attempt'；只有 taps 时忽略
  readonly enforce?: "pre" | "post"; // 默认 'post'
  setup?(client: AxpClient<unknown, R>): AxpPluginInstance<R, A> | void; // 每个客户端调一次，状态建在这里
  handle?: AxpMiddleware<R>; // 无状态插件可直接给
  taps?: readonly AxpTap<R>[];
}
```

`setup` 返回的 `AxpPluginInstance` 可以带 `handle`、`taps`、`api`（暴露给使用者的操作，如 cache 的 `clear()`，用 `client.plugin(p)` 取）和 `dispose()`。

`handle`、`taps` 既可以写在插件对象上（无状态插件），也可以由 `setup` 返回（有状态插件）。两处都写时以 `setup` 返回的为准，不合并：返回了 `handle` 就用它，对象上的 `handle` 被忽略，`taps` 同理。`handle` 和 `taps` 互相独立，同时存在时各自参与排序，`taps` 的段名从 `<name>#0` 起编号。

### 约定

1. **状态必须建在 `setup` 里**，别放在工厂闭包。这样同一个插件对象能装到多个客户端，各有一份状态；`extend()` 默认继承插件列表、各自重新 `setup`，靠的就是这条。
2. **只透传 `R`，不构造 `R`。** 内置插件工厂写成泛型 `axpRetry<R extends IAxpResponse = AxpResponse>(opts?)`，对任意 `R` 都成立；默认值与客户端一致。需要凭空造结果走 `ctx.fail()`，由响应工厂保证扩展字段存在。
3. **改请求用 `next(patch)`**，不要动 `ctx.request`，也不要 `delete` 请求选项。要重发请求，先 `ctx.markReplayable()`，再多调几次 `next()`。
4. **判断函数的参数是 `R`**：判断 401/403/5xx 一律读 `r.status`（逻辑状态），失败类别读 `r.kind` / `r.reason`。
5. 只有 `setup`、没有中间件的插件（如 envs）不进链，只在装卸时执行。
6. 每个内置插件工厂都接受 `enable?: boolean`（默认 true，mock 默认 false）；`false` 时不进链、不 `setup`、`inspect()` 里也看不到，请求级开关不能把它重新打开。
7. 请求选项靠 `declare module '@codejoo/axp' { interface AxpRequestOptions { … } }` 扩展，不再往 `axios` 模块的 `AxiosRequestConfig` 里塞。

### 例一：一个中间件

```ts
/** 记录每次尝试耗时 */
const timing: AxpPlugin = {
  name: "timing",
  stage: "attempt",
  async handle(ctx, next) {
    const t = performance.now();
    const r = await next();
    ctx.log.log(`[timing] ${ctx.request.url} ${r.status} ${performance.now() - t}ms`);
    return r;
  },
};
```

它在 `attempt` 阶段，默认 `post`，落在 retry 里面，所以重试多少次就记多少条。

### 例二：taps，请求侧和响应侧不对称

```ts
/** 不对称：请求侧看最终发出的请求，响应侧看收敛后的结果 */
const audit: AxpPlugin = {
  name: "audit",
  taps: [
    { stage: "credential", enforce: "post", onRequest: (ctx) => report("send", ctx.request) },
    { stage: "outer", onResponse: (r) => report("done", r.kind) },
  ],
};
```

请求侧挂在 `credential` 阶段、排在内置 auth 之后，看到的是注入 token 后的请求；响应侧挂在 `outer`，看到的是重试、刷新、缓存都收敛之后的最终 `R`。请求侧和响应侧要处在不同深度时，就用 taps 拆成多段。

### 想扩展某处？

| 想做的事                       | 动哪里                                                      |
| ------------------------------ | ----------------------------------------------------------- |
| 加横切逻辑（埋点、签名、日志） | 自定义插件，选阶段；进出不对称就用 `taps`                   |
| 改成功判定、给响应加字段       | 子类覆盖 `ok` / `status`，用 `axpResponse({ create })` 接上 |
| 换信封字段名、要求严格 JSON    | `axpResponse({ envelope, expectJson })`                     |
| 缓存换成持久化存储             | 实现 `IAxpCacheStore<R>`，传给 cache 的 `store`             |
| 调整失败的抛出形态             | `throws`、`wrap`、`createAxp({ reject })`                   |
| 给请求加选项                   | 扩展 `AxpRequestOptions`                                    |
| 排查插件顺序                   | `client.inspect()`                                          |
| 排查谁发起了失败的请求         | `createAxp({ debug: true })`，失败的 `r.stack` 里有调用点   |
| 改客户端本身的 API             | `client.ts`                                                 |
| 改排序、链编译、`next(patch)`  | `pipeline.ts`                                               |

## 9. 性能设计要点

| #   | 做法                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | 链在增删插件时编译，请求时不排序、不查表                                                                                                                |
| P2  | 每层是固定形状的上下文实例，逻辑请求级状态放在各层共享的同一个容器里；没有补丁时直接复用外层上下文，有补丁才新建一个带新 `request` 视图的实例           |
| P3  | `key()` 惰性计算并按 request 对象缓存；不用 cache/share 的请求根本不算 key                                                                              |
| P4  | 只有 `markReplayable()` 且 `data` 是纯对象/数组才 `structuredClone`；克隆失败或环境没有 `structuredClone` 时回退为原引用（debug 下 warn），不让请求失败 |
| P5  | 传输强制 `validateStatus` 全放行，HTTP 错误不构造 AxiosError，省掉调用栈捕获                                                                            |
| P6  | 失败直接抛 `R`，不另建错误对象；调用点 stack 只在 debug 模式记录                                                                                        |
| P7  | 不再包装 `transformResponse`，不再拷贝尝试钩子数组                                                                                                      |
| P8  | 缓存过期惰性删除，写入时按容量节流清扫                                                                                                                  |
| P9  | 逻辑请求入口只合并一次 `defaults`；交给 axios 的是差量，避免它内部那次合并按全部字段计费                                                                |

性能门槛和测法见 [测试方案 §8](docs/design/test-plan.md)。

## 10. 与旧架构的对照

旧版是"axios 拦截器 + adapter 包装"。下面这些机制随重构删除，原因是它们本来就是底座不够用逼出来的补丁：

| 旧机制 / 问题                                                                           | 新方案                                                                   | 为什么                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| adapter 链与单次尝试机制、尝试钩子、`captureRawRequest`、`runAttempt`                   | 洋葱管线，重放就是再调一次 `next()`                                      | 重放不再需要裸 runner 和钩子                                                   |
| `bag.ts` 的 WeakMap/Symbol 袋子、`axp:share`、`axp:cache`、`axp:retry:*` 保活键         | 请求不可变 + `next(patch)`；跨层状态用 `ctx.get/set` 的 Symbol 键        | 请求不可变之后，重发不再需要快照原始请求体（O1）                               |
| loading 包 `transformResponse`（`guardTransform`、`COMPLETE` 层键）                     | loading 放在 `outer`，进入 +1、`finally` 里 -1                           | 洋葱最外层天然成对，唯一的不对称只是 axios 限制下的绕行                        |
| 4 种错误类型、`ApiError`                                                                | 没有错误类：可预期的失败抛 `R`，看 `r.kind` / `r.reason`；bug 抛原始异常 | 一个对象贯穿链路和调用方，概念最少；包一层 `AxpError` 的 stack 只指向 axp 内部 |
| 静态 `isSuccessful`                                                                     | 子类覆盖 `ok` / `status` getter                                          | 静态钩子是全局可变状态，多个客户端会互相覆盖                                   |
| "成没成功"散在 auth、share、retry、notify、normalize 各写一遍；retry 只看 HTTP 码（O5） | 传输边界判定一次，全插件读 `r.status`（逻辑状态）                        | 判定只该有一处                                                                 |
| 三处手动给错误挂 config（O2）                                                           | `R` 自带 `request`                                                       | 由传输层或 `ctx.fail` 统一填写                                                 |
| `canRefresh` 写在用户的 TokenManager 上（O4）                                           | 收进 auth 内部状态                                                       | 登录写入新 token 后自动恢复，不用手动改标志                                    |
| cache 四张表（O3）、全表扫描清过期（O6）                                                | 表收敛；惰性删除 + 容量节流清扫                                          | 见 [插件规格 §6.3](docs/design/plugin-spec.md)                                 |
| `axpCancel`、`axpKey`、`axpLogger`、`axpNormalize`                                      | 内核的取消、key、`debug` 开关、落定                                      | retry 等待、auth 排队、share 跟随者都要 signal，本来就该人人都有               |
| 14 个写死槽位，自定义插件只能靠 4 个插入方法                                            | 5 个阶段 + `use/eject`                                                   | 使用者不用背顺序                                                               |
| notify 里关于 auth 重放双触发的过时警告                                                 | 机制不存在，随旧代码删除                                                 | —                                                                              |

两个使用者能感知的行为变化，单独强调：

- 插件只对 axp 客户端生效，裸 `axios.get` 不再带插件（0.2.0 未发布，现在破坏成本最低）。
- 传输强制放行所有状态码，axios 实例上的错误拦截器不再看到 4xx/5xx。

其余变化（默认值、请求选项、时序等）汇总在 [插件规格 §9](docs/design/plugin-spec.md#9-行为变化汇总发版写进-changelog)；文中的 O1–O6 指 [2026-10-27 全量 review](docs/reports/2026-10-27-codex-full-review.md)「待优化」里的六项架构债。

## 11. 延伸阅读

- [ADR 0001：核心重构的六条决策](docs/decisions/0001-core-redesign.md)：为什么换底座、怎么排序、归一化与错误模型怎么定
- [核心架构方案](docs/design/core-architecture.md)：本文的主要来源，含完整接口定义、客户端 API、类型设计和已确认的新增选择
- [内置插件与内核服务规格](docs/design/plugin-spec.md)：每个插件的选项、行为和相对旧版的变化
- [测试方案](docs/design/test-plan.md)：六层用例、覆盖率、性能门槛
- [实施计划](docs/design/implementation-plan.md)：B0–B7 批次与评审关卡
- [洋葱管线行为迁移总表](docs/reference/pipeline-migration/README.md)：旧用例去向，「终审裁决」一节记录了存疑行为的定论
- [README](README.md)：使用说明
