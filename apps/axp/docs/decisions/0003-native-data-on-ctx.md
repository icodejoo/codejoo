---
title: axp 原生诊断数据移入上下文
status: active
updated: 2026-10-29
summary: 原生响应与异常由上下文短期持有，请求级 raw 按需附到响应副本，取代 N11 与 0002 的相关条款
---

## TL;DR

- `IAxpResponse` 只保留 `ok`、`status`、`code`、`data`；原生响应和异常由共享状态中的 `ctx.native` 提供只读访问，落定后清空。
- 只有请求级 `raw: true` 才把完整 `raw`、`error`、`request` 不可枚举地附到响应副本；它隐含 `wrap: true`，失败抛出时同样生效。
- notify 的 `stringify(r, ctx)` 必传，不再提供默认文案；需要完整请求信息的 retry/auth 回调增加末位 `ctx`。
- `internal` 的原始异常保留在失败标记中，`toJSON` 只投影失败的 `{ type, reason }`，不泄漏异常。

## 背景与范围

失败的 `R` 会被抛出，并被 Sentry、TanStack Query 等外部长期引用。如果它携带 AxiosError（含 `.request`、`.response`、`.config`）、原始响应或完整请求配置（含请求体），这些对象也会随 `R` 存活，导致内存回收不及时。

当前 [response.ts:236–245](../../src/response.ts#L236-L245) 的 `fromError` 将原始 `error` 和 AxiosError 的 `error.config` 放进构造 init；相邻的 `fromResponse` 也传入完整 raw 与 raw.config。不可枚举只能影响遍历和序列化，不能解除引用。这次将原生对象的默认生命周期收进逻辑请求上下文，仅在调用方主动要求时附到返回或抛出的副本。

本决策记录已拍板的方案 v2，作为 B1–B6 的实施依据；B0 只更新决策记录与索引，不表示源码已完成迁移。目标仍为 ES2015，`kind` 仍是内核私有失败标记，cache store 的快照契约允许异步，`retryAfterMax` 默认仍为 60 秒。

本决策明文取代：

- [核心架构 N11](../design/core-architecture.md#13-新增设计选择已确认) 中“删 `raw: true`，改用 `wrap: true` 后读 `r.raw`”的决定；N11 删除 `nullable` 的决定继续有效。
- [ADR 0002](0002-response-contract.md) 中“消息和原始诊断字段可选”、接口包含 `message?` / `raw?` / `error?`、默认类 request 携带完整请求，以及 `failureOf` 仅返回 `{ type, reason? }` 的相关条款。四个必需字段、HTTP 状态、业务码配置、parse/type/create 扩展点继续有效，0002 保持 active。
- 0001 D4、D6 及架构正文中把原始异常放在 `r.error`、默认在 R 上保留完整请求或原生数据的相关表述，统一按本文解释；架构正文迁移留到 B6。

## 决定

### 轻量响应与显式通知

`IAxpResponse` 只声明 `ok`、`status`、`code`、`data` 四个必需字段。`message` 留在默认类 `AxpResponse`，`brandResponse` 不再给接口实现补 message。

notify 的 `stringify` 改为必传，签名为 `(r, ctx) => string | falsy`，返回 falsy 即不提示。内核先过滤成功、取消和 `silent`，这些情况不调用 stringify；没有默认回退文案。

### 上下文持有原生对象，落定负责释放

原生数据放在共享 `state` 的单槽 `{ for: R, raw, error }`，并带 `settled` 标记；插件通过 `ctx.native` 只读访问。不能放在上下文实例字段：`next(patch)` 会派生新 ctx（`pipeline.ts:107`），AxpContext 构造函数共享 state。

传输层每次尝试写入最新 AxiosResponse 与原始异常，HTTP 错误取 `error.response`，成功时清空 error。仅在 `r === slot.for` 时提供对应 native；`ctx.fail({ from })` 派生时，若 `from === slot.for`，将 `for` 改绑到新对象。缓存命中、auth 本地拒绝、share 跟随者等不经自身传输的结果自然没有 native；mock 探测走真实传输（`mock.ts:102`），有真实响应，不能归入“没有响应”的情况。

settle 必须先取 native，再生成副本，最后在覆盖 return、throw、reject 三条路径的 finally 中清空槽并标记 settled。落定后拒绝写入，防止 share 迟到的传输重新保留原生对象。`client.ts:120` 的 dispatch finally 发生在 settle 之前，不能在那里清空。

### 请求级 raw 与返回类型

仅支持请求级 `raw: true`，隐含 `wrap: true`；运行时读取 `ctx.originRequest.raw`，不受 `axios.defaults.raw` 影响。关闭时，R 上没有 raw、error（internal 异常只在失败标记里，经 failureOf 读取），`R.request` 只保留 method、url。

开启时，由内核在响应工厂返回后，经一次 `ctx.fail({ from, stack? })` 派生副本；需要 debug stack 时在这次调用中一并传入。派生完成后，再由内核以不可枚举方式附上 `raw`（完整 AxiosResponse）、`error`（原始异常）和 `request`（完整请求配置）。完整 request 取 `raw.config ?? error.config ?? ctx.request`。这三项不作为 `ctx.fail` 的 init 字段传入，避免经使用者工厂 create 再解析或与业务字段重名。失败且 `throws: true` 时也带上这些数据，internal 仍按原规则抛原始异常。

`TAxpResult` 先判断 raw；`raw` 与 `wrap: false` 同时出现时 raw 优先。`WithNative<R>` 先 `Omit<R, "raw" | "error" | "request">` 再交叉，字段为 `raw: AxiosResponse | undefined`、`error: unknown`、`request: Readonly<AxpRequestConfig>`。`request()` 补对应重载，非字面量 boolean 按联合结果表达。`api.isResponse` 的收窄类型不额外包含这三项；另提供 `nativeOf` 一类的访问器出口，最终名称在实施时确定并写入公共 API 注释。

### 失败事实、重试与缓存

完整 native 只留在 state 单槽；传输层将 `Retry-After` 的原始头字符串以私有 symbol 挂在 R 上随 R 流转（不依赖失败标记，429、503 这类响应也带），retry 解析时再套用 `retryAfterMax`。share 跟随者拿到领导者的同一个 R，因此仍能遵守等待时长与 D1（超过 `retryAfterMax` 不重试），无需携带完整响应。

只有 `internal` 失败的原始 error 默认保留在私有失败标记中，与 kind 同处，通过 `failureOf(r)?.error` 读取。`client.ts` 的 internal 抛出、继承路径（`response.ts:187`）与 guardFactory 的 recover（`response.ts:266`）均改读该字段。`failureOf` / `IAxpFailure` 已公开导出，因此 error 是公开字段，必须记录其仅用于 internal 的约束；网络、超时、取消的 AxiosError 不再默认挂到 R。

保留 `toJSON`，其中 failure 只投影 `{ type, reason }`，不把 error 经 failure 序列化出去。cache 不写入 internal 和 cancel，即使 `shouldCache: () => true` 也不例外，避免 internal 缓存命中后丢失异常而 `throw undefined`。

### 回调补足上下文

retry 的 `respectRetryAfter`、`delay`（`retry-timing.ts`）及 auth 的 `TAuthFunc` 回调统一增加末位 ctx，已有少参数回调仍兼容，用于补偿 `R.request` 瘦身。`accept/lib/client-factory.ts:95` 后续改读回调 ctx；本批不修改该文件。

## 理由

- 失败响应被外部保留时，默认只保留业务结果与必要的小事实，原生诊断对象能在逻辑请求落定后释放。
- state 单槽跨派生 ctx 共享，按响应身份关联，既能服务重试和派生，也能阻止串用原生数据与迟到写入。
- raw 明确由每次请求选择，返回类型和运行时行为一致；需要完整诊断的调用方承担相应保活成本。
- Retry-After 与 internal 异常是管线继续工作所需的事实，单独保留，不要求整份 AxiosError 或 AxiosResponse 跟随 R。

## 放弃的方案

- R 上无条件保留 raw/error：即使不可枚举，仍会随外部引用的 R 保活，不能解决回收问题。
- `WeakMap<R, native>`：R 被外部长期引用时，对应 native 也会继续存活，弱键不能缩短其生命周期。
- 返回值改成 `AxiosResponse<R>`：改变统一 R 的管线契约，也让完整传输对象成为默认返回形态。
- 客户端级 raw 默认开关：调用点无法明确表达保活意图，显式泛型下也难以让返回类型如实反映默认值；保持请求级选择。
- 删除 `toJSON`：失去可控序列化出口；保留它并限制 failure 投影即可避免泄漏 internal error。

## 代价与迁移

- **破坏性：notify stringify 必传**，调用方必须提供文案生成逻辑，falsy 表示不提示，不能再依赖默认文案。
- **破坏性：接口不再声明 message/raw/error**，`IAxpResponse` 只声明四个必需字段，`brandResponse` 不再给接口实现补 message；依赖接口可选字段或自动补齐 message 的代码需要迁移。
- **破坏性：原始异常改从失败标记读取**，默认的 `r.error` 改为 `failureOf(r)?.error`，且只有 internal 有；网络、超时、取消不再有 `r.error`，需要原生异常时显式开启 raw。
- **破坏性：R.request 瘦身**，默认仅有 method、url；需要完整配置的插件读 ctx；调用方需要时显式开启 raw。
- **破坏性：raw 含义变化**，0.1.0 的 `raw: true` 返回信封 body，现在返回带原生数据的 R；旧 raw 对应 `r.raw?.data`。仅 `wrap: true` 不再获得原生数据。
- **回调新增末位 ctx 参数**，respectRetryAfter、delay 与 TAuthFunc 的旧少参数回调保持兼容，需要完整请求的回调改读 ctx。
- **非破坏性的行为变化：缓存排除 internal 和 cancel**，即使配置 `shouldCache: () => true` 也不再缓存这两类失败。
- **体积增加，门槛已放宽**：`./min`（`gzip -9`）从 13,080 增至 14,677 字节（约 +12%），`dist/esm` 逐文件求和 62,043 字节；用户于 2026-10-29 确认接受，并以 14,677 作为新基线。

内核需要维护身份关联、派生改绑和 settle 清理，并验证 return、throw、reject 与 share 迟到传输的释放行为。显式开启 raw 后，原生对象仍会随返回或抛出的副本存活，这是调用方主动选择的成本。B1–B5 完成实现与验证，迁移指南、README 中英、插件规格和架构等正文统一在 B6 更新。
