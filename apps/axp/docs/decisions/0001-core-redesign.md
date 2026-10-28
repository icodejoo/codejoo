---
title: axp 核心重构的六条决策
status: active
updated: 2026-10-28
summary: 为什么把 axios 拦截器底座换成自有洋葱管线，插件怎么排序，归一化响应与错误模型怎么定
---

## TL;DR

- 执行模型：axp 自己管一次请求的生命周期，插件是 `(ctx, next)` 中间件，最内层调 `axios.request`。
- 排序：具名阶段 + 同阶段内数组顺序；不对称需求用 `taps` 分段挂载。不用 `before/after`。
- 归一化进内核：传输边界做**判定**（产出 `IAxpResponse`），最外层做**落定**（返回 data 或抛出）。
- 链路里只流转一个对象 `R extends IAxpResponse`，`next()` 不抛错；所有判断函数的参数都是它；成功判定的开放点是 `ok` / `status` getter，子类覆盖即可。
- 没有错误类：可预期的失败直接抛 `R`，程序 bug 抛原始异常，用 `isAxpResponse(e)` 区分。

背景：2026-10-27 全量 review 留下 O1–O6 六项架构债（见 [review 报告](../reports/2026-10-27-codex-full-review.md)「待优化」），
与 dioman 的对比又暴露出错误模型碎片化、扩展点写死、状态散落三处的问题。这六条决策一起回答它们。
落地方案见 [核心架构](../design/core-architecture.md)。

## D1 自有洋葱管线，最内层调 `axios.request`

**决定**：axp 客户端自己组织中间件链；传输层是对用户 axios 实例的一次 `request()` 调用。

**理由**：

- 现在的插件只能借 axios 的拦截器和 adapter 协作，跨插件状态要靠 WeakMap、Symbol bag、可枚举字符串键三处保活（`bag.ts`、`auth.ts:24-34`、`retry.ts:13-15`），
  重放要靠裸 runner 和尝试钩子（`helper.ts:325-377`），loading 要包 `transformResponse`（`loading.ts:212`）。这些都是底座不够用逼出来的。
- 洋葱模型里，重试和鉴权重放就是"再调一次 `next()`"，上面那批机制全部可以删掉。

**放弃的方案**：

- 增量改造（保留拦截器）：兼容性好，但 hack 只能收拢、去不掉。
- 去掉 axios 改 fetch：体积最好，但工作量最大，上传进度、Node adapter 要自己补。

**代价**：插件只对 axp 客户端生效，裸 `axios.get` 不再带插件。0.2.0 未发布，现在破坏成本最低。

## D2 具名阶段排序

**决定**：内置插件各有固定阶段和阶段内次序，使用者不用排；自定义插件选一个阶段（可加 `enforce: 'pre' | 'post'`），同阶段内按数组顺序。
一个插件需要在请求侧和响应侧处于不同深度时，用 `taps` 拆成多段，各自声明阶段。

**理由**：逐个核对现有插件，在洋葱里全部对称；唯一不对称的 loading 是 axios 限制下的绕行，不是需求。
真正的"不对称"是业务状态判定，已由 D3 收进内核。

**放弃的方案**：

- `before/after` 拓扑排序：最终顺序看不见，有成环风险，十几个插件用不上图算法。
- 纯数组：使用者要记住约 8 条顺序约束，写错不报错，和"心智负担低"冲突；也表达不了分段挂载。

## D3 归一化进内核，拆判定与落定

**决定**：归一化不是插件，是内核在传输边界上的固定步骤，有默认实现，只配置不安装。

| 步骤                                               | 位置       | 次数             |
| -------------------------------------------------- | ---------- | ---------------- |
| 判定：原始响应/错误 → `R`                          | 紧贴传输层 | 每次发送一次     |
| 落定：`ok` 返回 data，否则抛 `R`（bug 抛原始异常） | 洋葱最外层 | 每个逻辑请求一次 |

**理由**：现在"成没成功"散在 auth（`auth.ts:382`）、cache/share race（`share.ts:266`）、retry、notify、normalize 五处各写一遍；
retry 只看 HTTP 码，导致验收执行器要替 axp 补"逻辑状态"适配（O5）。

## D4 `next()` 一律返回 `R`，不抛错

**决定**：HTTP 错误、业务失败、网络错误、超时、取消都变成 `R` 从 `next()` 返回；中间件自身抛出的异常由内核临时包成 `kind: 'internal'` 的 `R`（原始异常放在 `r.error`），
让外层的计数、注销、订阅者离场照常收尾。只有最外层落定时才 throw，抛什么见 D6。

**理由**：现在每个插件都写成功/失败两条路径（`auth.ts:377-395`、`retry.ts:186-199`、notify、cancel、loading），合并成一条。

## D5 `IAxpResponse` 契约 + `AxpResponse` 默认实现

**决定**：

- `interface IAxpResponse<D>` 只含数据字段；`class AxpResponse<D> implements IAxpResponse<D>` 是默认实现。
- 客户端泛型 `R extends IAxpResponse = AxpResponse`；所有插件的判断函数参数都是 `R`，用户可扩展字段。
- 只有响应工厂生产 `R`；插件需要凭空造结果时走 `ctx.fail()`，保证扩展字段永远存在。
- **成功判定的开放点就是 `ok` 字段本身**（`status` 同理）：默认实现是原型 getter，子类覆盖即可，不另设 `isSuccessful` 之类的方法；`kind` 随 `ok` 自动推导。
  内核保证这两个 getter 只在收到响应时求值，其余失败在构造时写成自有属性。

**理由**（契约用 interface 而非 class）：

1. `./min` 自带独立模块（README.zh-CN:15），跨入口 `instanceof` 不可靠，插件只能认结构。
2. cache 的 deep clone 走 `structuredClone`，将来持久化要 JSON 化，都会丢原型；契约只能是纯数据。
3. 现在的 `static isSuccessful`（`Response.ts:51`）是全局可变状态，多客户端会互相覆盖；改成每个客户端用自己的子类覆盖 `ok`。
4. 继承默认类和直接返回普通对象两种扩展方式都合法。

命名沿用 `ITokenManager` / `TokenManager` 的先例：`IAxpResponse` / `AxpResponse`，泛型参数叫 `R`。

## D6 不设错误类：失败抛 `R`，bug 抛原始异常

**决定**：

- 可预期的失败（HTTP、业务、网络、超时、取消、解析、鉴权）落定时直接 `throw r`。
- 程序 bug（插件代码、判定类用户回调、用户拦截器或 `transformResponse` 抛出的非 AxiosError）在链内临时包成 `kind: 'internal'`，
  落定时抛出**原始异常本身**，stack 完整；`throws: false` 也不吞 bug。
- 用 `isAxpResponse(e)` / `api.isResponse(e)` 区分两者，品牌是 `Symbol.for('axp.response')`，不用 `instanceof`。
- `IAxpResponse` 带 `request`（实际发出的请求）；`debug` 模式下失败落定时附上发起请求那一刻的调用点 `stack`。
- 提供 `throws: false`（失败也 resolve 出 `R`）和可选的 `createAxp({ reject })`（给要求 `Error` 的生态做适配）。

**理由**：

- 一个对象贯穿链路和调用方，概念最少；"错误也是归一化的一部分"。
- 可预期的失败没有有意义的 stack：服务端判的失败，落定时补的 stack 只指向 axp 内部；网络错误的原始 stack 留在 `r.error`。
  真正有用的是调用点，所以只在 debug 模式下记录。
- bug 不能伪装成请求失败，必须以原始异常和 stack 暴露出来。

**放弃的方案**：

- `AxpError` 外壳：多一个概念，`e.response` 多一层间接；它的 stack 指向 axp 内部，排查价值低。
- `AxpResponse extends Error`：成功对象打印出来带 stack，看着像错误；接口实现者也无法被强制继承 `Error`。

**代价**：默认抛出的不是 `Error`，没有 `e.stack`、`instanceof Error` 为假；需要 `Error` 的生态（Sentry、TanStack Query 等）用 `reject` 适配，写进迁移指南。
