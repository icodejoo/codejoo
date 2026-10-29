---
title: axp 洋葱管线重构后终审：问题清单、拍板结论与测试缺口
status: active
updated: 2026-10-29
summary: 重构合回 main 后对架构、测试与验收矩阵、性能与 API 的终审，含 9 项必修、9 项建议修、D1–D4 拍板结论、Codex 初审裁决和给 dioman/testkit 的提示
---

## TL;DR

- 终审时主干设计成立，但确认了 **9 项必修**（P1 4 项、P2 5 项）和 **9 项建议修**（P3）。必修项全部躲过了 100% 覆盖率和整轮验收，除第 9 项外都对 dist 写脚本复现过。
- 用户拍板：D1–D4 照推荐执行；响应契约精简为 `ok`、`status`（HTTP 状态码）、`code`、`data`，`kind` 改为内核私有的失败标记，取消逻辑状态（业务风格由使用者配置）；key 采用高性能精简版。见 §4 和 ADR 0002。
- **9 项必修和全部拍板项都已修完**：Codex 分 8 批执行（A、B、C、D、K、E1、E2、F），主会话逐批终审、复跑门槛，过程中又纠正了 4 处问题，见 §9。
- **最终门槛**：107 个文件、5794 条全绿，覆盖率四项 100%；两套 tsgo 零错误；执行器单测 166 条全过；e2e 62/62；验收按 testkit `50012ea` 合计通过 2250、失败 0、跳过 442。性能达标。`./min` 单文件体积 gzip -9 为 14,018 字节，**超出基线 13,080 约 7%，待用户定**。见 §10。
- 未做：9 项建议修（P3）和测试方案层面的建议（I8、I9 不变量，双 adapter 集成用例，台账对齐），等用户另行安排。

## 1. 范围与方法

- 基线：codejoo main `f210983`（axp 0.2.0，未发布）。
- 主会话通读 `src/` 全部运行时代码（约 4000 行），对照 `ARCHITECTURE.md`、`docs/design/{core-architecture,plugin-spec,test-plan}.md`、ADR 0001。
- Codex 只读初审（reasoning effort high）报 10 条；主会话逐条读码终审，关键项写脚本对 `dist/esm` 复现。脚本放在会话临时目录，没有入库。
- 测试盘点由 sonnet(low) 子代理对照 test-plan 与 testkit 台账完成，主会话抽查后采信。
- 全量复核：`npx vp test run --coverage`，91 个文件、5677 条通过，四项覆盖率 100%，`src/` 里没有 `v8 ignore`。
- 审查期间仓库没有任何改动。

## 2. 必修

| #   | 级别 | 问题                                                                                                                                     | 复现结果                                                         | 修复方向                                                                                                                                                     | 来源   |
| --- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | P1   | share 的 `end`、`race` 策略里，某个调用方自己取消后，它的 cancel 会成为共享结果，其他调用方跟着变成 cancel，自己的真实结果被吞           | `end`：A 没取消也得到 cancel；`race`：A 的 500 被换成 `cancel 0` | 调用方自己的 signal 引起的 cancel 视为"撤回"，不落定共享条目；`end` 回退到仍在途或最近完成的那个请求，`race` 回退到上一个非撤回的失败                        | 主会话 |
| 2   | P1   | key 不含 `baseURL`。请求级换 baseURL，或 `extend` 出的子客户端共用同一个自定义 store 时，cache、share 会串到另一个后端的数据             | v2 的请求拿到 v1 的缓存                                          | url 不是绝对地址（或 `allowAbsoluteUrls: false`）时，按 axios `buildFullPath` 的规则把 baseURL 并进 key；没有 baseURL 的请求 key 保持不变                    | 主会话 |
| 3   | P1   | 上一轮刷新失败会清掉刷新期间新登录的 token，并误发一次过期通知                                                                           | 新 token 被清空，`onAccessExpired` 调用 1 次                     | 刷新开始时记 token 快照；失败时 token 已被替换，就不判过期，等待者按当前 token 继续                                                                          | Codex  |
| 4   | P1   | `onRefresh` 里用同一个客户端调刷新接口，且没写 `protected: false` 时，刷新请求排队等待它自己，所有受保护请求挂到被取消为止。文档没有提醒 | 500ms 内没落定，`pending()` 为 2                                 | README 写明约束；新增 `refreshTimeout`（默认 30s，超时按刷新失败处理）兜底                                                                                   | 主会话 |
| 5   | P2   | 请求在途时修改 `defaults.params`：key 按入口快照算，axios 发送时读新的 defaults，错误数据进了缓存。这是 A1"交差量给 axios"的副作用       | page=2 的结果存在 page=1 的 key 下，再查 page=1 命中错误数据     | 传输层固定参与 key 的字段：`method`、`baseURL` 取视图的值；`defaults.params` 为纯对象时始终带掩码发出完整 params。其余 defaults 字段在文档声明"以发送时为准" | Codex  |
| 6   | P2   | 二进制请求体只按 `byteLength` 哈希，长度相同、内容不同也会撞 key，与 README"宁可没命中，也不能命中错的"矛盾                              | 第二次 POST 拿到第一次的结果                                     | 一定大小以内按字节哈希，超过就不生成 key（不参与 cache、share）                                                                                              | 主会话 |
| 7   | P2   | auth 的 `ready`、`onFailure` 用普通 await，回调挂起时取消不生效，`pending()` 和 loading 一直挂着                                         | 取消后 200ms 仍未落定                                            | 两处改用可取消等待，取消后立即以 cancel 落定                                                                                                                 | Codex  |
| 8   | P2   | 已取消的请求仍可能命中缓存并返回 ok：auth 在 await 之后没有按内核约定重查 signal                                                         | 已取消的请求得到 `kind: 'ok'`                                    | auth 每次 await 之后 `cancelIfAborted`；cache 命中返回前也查一次                                                                                             | Codex  |
| 9   | P2   | 一次性请求体（Node Readable、ReadableStream）被 retry、auth、mock 重放时变成空体，服务端收到空内容，调用方却拿到成功                     | Codex 用真实 http adapter 复现，主会话读码确认                   | 内核识别一次性请求体，提供 `ctx.canReplay()`；内置的重放方在重放前检查，不能重放时把原失败交给调用方；传输层兜底拒绝重发已消耗的流                           | Codex  |

## 3. 建议修（P3）

1. 自定义插件忘了 `return`，调用方只看到 `Cannot read properties of undefined (reading 'kind')`。建议在 `guardLayer` 校验返回值，不是 R 就转 internal 并带上插件名。
2. 两种显式 key 语义不一致：请求级 `key: "x"` 带 scope，`cache: { key: "x" }` 不带。实测切换账号后 u2 读到 u1 的缓存。建议统一带 scope。
3. cache 卸载后，旧链快照里的后续重试仍会往外部 store 写。
4. `defaults.params` 是 URLSearchParams 时，层里删不掉它。
5. 中间件改了 method 之后再改头，会配错方法级默认头。
6. `clone: 'shallow'` 会把 Blob 等特殊对象展开成 `{}`。
7. `wrap`、`throws` 不是字面量时（比如变量类型是 `AxpRequestConfig`），返回类型推成 `D`，运行时拿到的却是 R。建议非字面量时返回 `D | WithData<R, D>`。
8. notify 的默认 stringify 也会给程序 bug（internal）弹提示，内容是 "internal 0" 或原始错误文本。
9. `expectJson` 对显式设置 `responseType: 'text'` 的请求误判为 parse。

## 4. 设计取舍：2026-10-29 已拍板

| #   | 问题                                                                                     | 结论                                                                                                                                                                                                                                                           | 落地要点                                                                      |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| D1  | `retryAfterMax` 默认 `Infinity`，503 带 `Retry-After: 3600` 实测挂一小时，loading 一直转 | 默认改为 60s；服务端要求的等待超过上限时不再重试，直接返回本次响应                                                                                                                                                                                             | `Infinity` 表示始终照办；这是语义变化（以前是"封顶后照样等"），写进 CHANGELOG |
| D2  | 信封识别要求 `code`、`data` 同时存在                                                     | 用户选定：归一化后的 R 上 `code`、`data`、`message` 三个字段始终存在。只有 `data` 可以为 `null`；`code` 始终有默认值；`message` 类型允许 `null`，默认空串。axp 不关心后端接口契约，转换逻辑开放给使用者：实现 `IAxpResponse` 接口或继承 `AxpResponse` 后自定义 | 见下方 D2 落地要点                                                            |
| D3  | `extend()` 新建 axios 实例，父实例拦截器全丢，文档没写                                   | 文档写明；新增 `extend(overrides, { axios })`，传入的实例原样使用                                                                                                                                                                                              | 传了 `axios` 时不复制父实例 defaults，`overrides` 仍在插件 setup 之后写入     |
| D4  | cache store 是同步接口、存活的 R 对象，撑不起持久化                                      | 趁 0.2.0 未发布改造：store 方法可返回 Promise，条目存可序列化快照，命中时经响应工厂重建 R                                                                                                                                                                      | 见下                                                                          |

**2026-10-29 用户二次拍板（取代下面 D2 落地要点里与之冲突的部分）**：

- `IAxpResponse` 只留 `ok`（getter，布尔）、`status`（HTTP 状态码，没有响应为 0）、`code`（业务码，泛型 `string | number`，默认 number）以及 `data`。`message` 在默认实现里默认空串、允许 `null`。`request`、`stack`、`toJSON`、`parse` 只放在默认实现 `AxpResponse` 上。
- 去掉 `kind`：不让使用者提供枚举，免得填错引发严重错误。失败类别（取消、超时、网络、解析、鉴权、程序 bug）由内核判定并挂成隐藏标记，使用者不可设置；需要读的时候用内核提供的只读辅助函数。
- 原来的"逻辑状态"（HTTP 200 加业务码 401 也算 401）随之取消，`status` 就是 HTTP 状态码。
- **`kind` 的落地（用户确认）**：`kind` 改为内核私有的事实。
  - 内核在传输边界和 `ctx.fail` 判定失败来源（`cancel`、`timeout`、`network`、`parse`、`auth`、`internal`），在使用者的工厂返回之后挂成隐藏标记，同时强制该响应 `ok === false`。使用者写不了、也写不错。
  - 插件统一通过 `failureOf(r)` 读；调用方用 `api.isCancel(e)` 判断取消；造失败只有插件作者能做：`ctx.fail({ failure, reason })`。
  - `ok`、`http`、`biz` 三个类别取消，改看 `ok`、`status`、`code`。
- **业务风格判定（用户确认）**：插件默认只看 HTTP 状态码。业务风格接口的 401、403、5xx、429 由使用者配置：auth 的 `onFailure`、retry 的 `shouldRetry`，以及新增的 `respectRetryAfter` 判定函数，也可以写子类。等于撤回了重构时"业务风格零适配"的 O5 约定；验收执行器的业务风格要按使用者的方式补上这些配置。
- key 采用高性能精简版：保留流式哈希、对象字段可交换累加、分帧、类型标签；删掉 `ignores`、`sample`、深层空值折叠、冻结的旧算法参考实现和差分测试；baseURL 照旧并进 key。60 行的极简原型不采纳。

D2 的落地要点（主会话定的默认，用户可以推翻）：

- `code` 类型 `string | number`，内置转换在没有业务码时给 `0`；默认 `ok` 简化为"2xx 且 `code` 是 `0` 或 `'0000'`"。验收执行器只在 `kind: 'biz'` 时读 `code`，默认 `0` 不影响分类。
- `message` 类型 `string | null`，内置转换默认空串。
- `data` 没有数据时（无响应、信封里没有或为 `null`）是 `null`。
- 继承：`AxpResponse` 新增可覆盖的 `protected parse(body, raw)`，返回 `{ code, data, message }`。内置实现只是一个默认约定：有 `code`、且有 `data` 或 `message` 才当信封。子类用 `axpResponse({ type: MyResponse })` 交给工厂。
- 实现接口：`axpResponse({ create })` 拿到原始响应自己转换。`create` 返回的普通对象缺这几个字段时，内核按上面的默认值补齐，和补品牌一样。
- 删除 `envelope` 选项（字段名不同就覆盖 `parse`），保留 `expectJson`。

D4 的落地要点（主会话定的默认，用户可以推翻）：

- `IAxpCacheStore` 的 `get`、`set`、`delete`、`clear` 可以返回值或 Promise，`size` 改为可选。内置内存仓保持同步，并走同步快路径，不给命中路径加额外的 await。
- 条目只存可序列化的快照：`httpStatus`、`code`、`message`、`data`、`reason`、`kind`、`status`，以及自定义 R 的自有数据字段（`extra`）。命中时用 `ctx.fail` 经工厂重建 R，`request` 取当前调用方的请求。
- `AxpResponseInit<R>` 补上自定义 R 的扩展数据字段类型，自定义 `create` 可以从 `init` 读回扩展字段（命中时没有 `raw`）。
- `remove`、`clear` 以及 `removeCache`、`clearCache` 的返回值可能是 Promise，文档要求统一 `await`。
- 异步 store 下按 key 串行写入，屏障在真正写入前再判一次，旧响应仍然盖不过新结果。

## 5. Codex 初审的终审裁决

Codex 报了 10 条，全部成立，没有误报，调整了 7 条的级别。

| Codex                            | 原级别 | 终审 | 对应   | 理由                                                |
| -------------------------------- | ------ | ---- | ------ | --------------------------------------------------- |
| 1 auth 异步回调不可取消          | P1     | P2   | 必修 7 | 需要用户回调挂起才会触发                            |
| 2 旧刷新失败清除新登录           | P1     | P1   | 必修 3 | 触发窗口窄，但后果是刚登录就被踢出，修起来很便宜    |
| 3 在途改 defaults 致 key 错位    | P1     | P2   | 必修 5 | 文档已建议用 scope 做隔离；在途改 defaults 本身少见 |
| 4 一次性流重放为空体             | P2     | P2   | 必修 9 | 静默写空，Node 侧上传有实际风险                     |
| 5 取消后命中缓存                 | P2     | P2   | 必修 8 | 违反"await 之后重查取消"的内核约定                  |
| 6 cache 卸载后仍写 store         | P2     | P3   | 建议 3 | 需要卸载、在途和外部 store 三者同时成立             |
| 7 URLSearchParams 默认参数删不掉 | P2     | P3   | 建议 4 | 用法少见                                            |
| 8 改 method 后头掩码错配         | P2     | P3   | 建议 5 | 中间件改 method 少见                                |
| 9 shallow clone 损坏 Blob        | P2     | P3   | 建议 6 | 需要显式开 shallow 且响应是二进制                   |
| 10 动态开关返回类型不可靠        | P2     | P3   | 建议 7 | 类型层问题，字面量写法不受影响                      |

Codex 没有发现必修 1、2、4、6 和 D1–D3；主会话也没有独立发现 Codex 的第 1、2、3、4、5 条。两边互补，说明这类审查值得双路做。

## 6. 测试、覆盖与验收矩阵

### 6.1 为什么 100% 覆盖率没拦住

- **不变量只查账，不查归属**。I1–I7 管的是落定一次、计数归零、loading 成对、请求体一致，没有一条检查"调用方拿到的结果是不是属于它自己"。必修 1、2、5、6 都是归属错误。
- **powerset 里 I7 基本空转**。只有一条 POST 流程，而 POST 不在 retry、cache、share 的默认方法里，powerset 从没发生过带体重发。
- **testkit 的形状太规整**：只有一个 baseURL，执行器不发 multipart 和流，share 的取消场景只覆盖 start 策略。

### 6.2 建议

- **新增两条不变量**：
  - I8 结果归属：一个调用方的取消或超时，不改变其他调用方结果的类别；
  - I9 来源一致：响应回显的实际请求（method、完整 URL、请求体摘要）等于调用方发出的请求。I9 一条就能兜住 key 错位一类问题。
- **powerset**：补一条带体重发的流程（PUT 加 retry，请求级开 cache、share）；补上方案 §8 写了却没做的白盒断言：`clear()`、`dispose()` 之后 cache、share 的内部表为空。
- **撤回矩阵**（组合层）：share 三种策略 ×｛首发、跟随者、最新者、最后完成者｝×｛取消、超时｝，断言其余参与者的结果。
- **每个必修项一条回归用例**，放在最低能证明它的层。
- **新建 `test/integration/adapters.integration.test.ts`**：http、fetch 两种 adapter 对本地服务器各跑一遍主流程。这是 test-plan §6 唯一整行缺失的一项，流请求体重放、超时语义也放在这里测。
- **层级缺口**（子代理盘点、主会话抽查确认）：
  - 没有 `test/rule/cancel.rule.test.ts`；
  - N13（用户回调抛错）和 auth 单飞、排队只测在 boundary 层；
  - `filter+repath` 组合没挂不变量检查；
  - mock"探测不写缓存、不占共享"只在 combo 层。
- **台账漂移**：按 testkit 台账现有命名，225 个公开 API id 里 120 个没有 rule 层用例、142 个没有 boundary 层用例，71 个在任何层的标题里都没出现（例如 `retry.opt.jitter` 零命中）。多数行为其实测了，是 id 命名在两边对不上；`cache.opt.storage`、`cache.opt.memory` 这类已删除的选项还挂在标题里。`docs/guides/test-layers.md` §6"只剩 `prop.name` 和纯常量申请豁免"的说法已不成立。建议对齐 id 后加一个 `--check` 脚本挡住漂移。

### 6.3 验收矩阵

- 跳过的 368 格"缺能力"集中在 timeout（180）、breaker（168）、offline（128），三者有重叠。
- 约 12 个只用 `total_ms` 的 timeout 场景，不要直接映射成 axios `timeout`：axios 1.18 的 http adapter 用 `req.setTimeout`（按套接字空闲计时），fetch adapter 才是整段计时，两边语义不一致。应等内核有了逻辑请求截止时间（§7）再放开。
- 建议 testkit 补三类场景：share `end`、`race` 参与者取消；超大 `Retry-After`；执行器构造 multipart（顺带放开 `auth.expired-multipart-replay`，并在黑盒层验证必修 9）。
- 按用户约定，信封三个字段始终存在，所以不再建议"失败信封缺 `data`"这类场景。
- D21 的 34 格、blackhole 的 4 格维持跳过，等 testkit 修正。
- 协调（2026-10-29 dioman-20 回复）：dioman 的 B7 正在改 testkit（决策记为 D24），新增能力名 `raw-business-code`（D21 那类"未归一化时业务码透传"）和 `timeout-total`（`total_ms`），给 `basic.status-matrix` 的 blackhole 档补超时，给用 `cancel_after_ms` 的场景补 `requires: cancel`。B7 提交前 axp 不动 testkit 的契约、schema 和这几类场景。提交后 axp 执行器不声明 `raw-business-code`（归一化关不掉），`timeout-total` 等内核有了截止时间再声明，并删掉 `accept/lib/mapping.ts` 里 D21 和 blackhole 两条跳过规则。上面建议的新场景由谁加，B7 之后再对。
- 更新（2026-10-29）：dioman 的 testkit D24 已提交（api-ws-demo main `2d698f8`），场景数 443 → 459。`raw-business-code` 覆盖 18 个场景（其中 16 个另拆出 `-http` 场景，保留 HTTP 成功、500、取消的检查），`timeout-total` 覆盖 11 个配置了 `total_ms` 的场景；用到 `cancel_after_ms`、`cancel_all` 的场景补了 `requires: cancel`；`basic.status-matrix` 加了 `base_timeout_ms=4000`。axp 侧待办：本轮修复批次完成后改执行器（不声明 `raw-business-code`，暂不声明 `timeout-total`，删除 D21、blackhole 两条跳过规则），整轮重跑验收。share `end`/`race` 参与者取消、超大 `Retry-After` 两类新场景，等 dioman B8 修完 share 撤回语义、两边都能跑通后再加。dioman B8 还会给 share 的 2 个"单一请求预算"场景补 `requires: timeout-total`，提交前会通知 axp。B8 已完成并推送：testkit 最新为 api-ws-demo main `50012ea`，只给 `share.single-all-timeout-aborts-server`（http、business 两格）补了 `requires: timeout-total`，D24 下追加了说明。axp 重跑验收按 `50012ea` 进行，要记下 testkit 的提交号，以及工作区有没有未提交的改动。dioman 侧已按本报告修完同类问题，验收 1280 通过、0 失败；share `end`/`race` 参与者取消、超大 `Retry-After` 两类新场景，dioman 已能跑通，axp 修完后再定由谁来加。

## 7. 性能、功能、扩展性、API 易用性

**性能**：不建议再做优化。B3 额外开销降 41%，min 产物 gzip -9 为 12,975 字节，比基线小。B2、B6 多出的约 8µs 是 A1 的固定成本，已经接受。headers 合并优化已试过撤回，不要再碰。必修 5 和 D4 修完后复测 B2、B4、B6，额外开销不超过约 10µs。`bench/` 下 19 个 A/B 结果 JSON 进了 git，建议移走。

**功能**（按性价比排）：

1. 逻辑请求截止时间（总超时）。内核持有每个请求的 controller，加一个计时器就行，落定为 `timeout`，覆盖重试等待和刷新排队，两种 adapter 行为一致。
2. 缓存失效：自动 key 是哈希值，使用方算不出来，`remove(key)` 实际只对显式 key 有用。建议加 `removeWhere(predicate)` 或 tags；SWR 可以一起考虑。
3. TokenManager：存储键写死，两个后端各用一个实例会互相覆盖；不监听 `storage` 事件，另一个标签页轮换 refresh token 后，本页拿旧 token 刷新失败而被登出，`clear()` 还会顺手删掉另一个页面刚写入的新 token。建议加 `{ prefix, storage }` 选项和跨标签页同步。
4. `cancelAll(reason)` 的 reason 没写进 R，调用方分不清是离开页面还是被新请求顶替。

**扩展性**：

- `kind` 是封闭集合，retry 又按 kind 决定是否重试。熔断、离线、限流这类"客户端主动拦下、不该重试"的失败没有合适的 kind：用 network 会被重试，用 internal 会被当成 bug 抛出。做熔断或离线插件（验收里各 100 多格）之前先定这个口子。
- 插件实例的 `dispose` 只能同步执行，异步清理没法等待。

**API 易用性**：最大的坑是必修 4（onRefresh 重入）和 D3（extend 丢拦截器），使用者很自然会写出来，出了事又很难查。其次是建议 1（插件忘 return 的报错）和建议 2（两种显式 key）。四种请求级写法、固定阶段、`inspect()`、`next(patch)`、`stateKey`、`wrap`/`throws` 都顺手，不用动。

## 8. 给 dioman 与 testkit 的提示

和语言无关、dioman 洋葱管线重构可以对照自查的点：

- share `end`、`race` 的撤回语义：调用方自己取消产生的结果不应成为别人的结果。
- key 是否包含 baseURL；二进制请求体按内容哈希，做不到就不生成 key。
- 刷新期间重新登录，旧刷新失败不应清掉新会话；刷新要有超时兜底；`onRefresh` 经同一客户端发受保护请求会重入死锁。
- `Retry-After` 默认上限，以及超过上限时不重试。
- 每个 await 之后重查取消：auth 的异步回调要可取消，取消后不应命中缓存。
- 一次性请求体（流）不能静默重放。
- 信封约定：`code`、`data`、`message` 始终存在，缺值为 `null`。
- 不变量 I8（结果归属）、I9（来源一致）。
- testkit 场景建议见 §6.3。axp 侧之后改 testkit 场景或契约时，会再通知 dioman-20 重跑。
- 架构分歧（2026-10-29）：axp 按用户拍板去掉了 `kind`（改为内核隐藏标记）和逻辑 status（`status` 改为纯 HTTP 状态码，业务风格由使用者配置）。dioman 依其 ADR 0001 D3 暂时保留 `kind` 与逻辑 status，是否跟进由 dioman 的用户决定。axp 已向 dioman-20 说明理由：响应对象只负责转换，库不猜后端格式；契约要精简；不能让使用者去填内部枚举。axp 不改 testkit 契约，`status:<n>` 的中立含义不变，business 风格由执行器像使用者那样配置判定回调来满足。

## 9. 修复进度

修复由 Codex 执行，主会话终审，结果更新在这张表里。分支 `jelon/axp-final-review-fixes`（基于 main `f210983`）；A、B 在 worktree 槽位 `E:\workspaces\codejoo-slot1`、`codejoo-slot2` 里做，D 在主工作区做，三批按文件归属互不重叠。

| 批次 | 内容                                                                                                                 | 状态                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | auth：必修 3、4、7，必修 8 的 auth 部分                                                                              | 终审通过，已合入主工作区（未提交）。Codex 修补时去掉了 `next()` 返回后的多余取消检查                                                                                                                                                                                                                                                                                                                |
| B    | share 与 key：必修 1、2、6                                                                                           | 终审通过，已合入主工作区（未提交）。key 的长字符串 bench 波动经复测属噪声                                                                                                                                                                                                                                                                                                                           |
| C    | 传输与重试：必修 5、9，D1                                                                                            | 终审通过（100 个文件、5787 条全绿，覆盖率 100%，tsgo 两套零输出，build 成功，check 0 错误）。新增 `ctx.canReplay()`；`retryAfterMax` 默认 60s，超限不重试                                                                                                                                                                                                                                           |
| D    | cache 与客户端：D3、D4，必修 8 的 cache 部分                                                                         | 功能终审通过（98 个文件、5753 条全绿，覆盖率 100%，tsgo 两套零输出，check 0 错误）。遗留性能问题：同进程交替实测缓存命中慢约两成（最小 24.75 → 31.08µs），并入 E 优化并设门槛                                                                                                                                                                                                                       |
| E    | 响应契约重构：D2、精简 `IAxpResponse`、去掉 `kind`、`status` 改为 HTTP 状态码                                        | E1（src 与 test）终审通过：108 个文件、5811 条全绿，覆盖率 100%，tsgo 零输出；缓存命中同进程实测比 D 之前还快约两成（最小 11.99 → 9.71µs）。E2（验收执行器与 e2e 迁移，并更新能力声明、删掉两条跳过规则）终审通过：两套 tsgo 零错误，lint 0 错误，执行器单测 145 条全过，e2e 浏览器用例 62/62 全过。验收计划：459 个场景、2692 格，执行 2250 格、跳过 442 格                                        |
| K    | key 高性能精简版：保留流式哈希，砍掉 `ignores`、`sample`、空值折叠和旧算法对照测试                                   | 实现与性能终审通过：key.ts 389 → 238 行，删掉 547 行旧算法参考实现与差分测试；同进程交替实测小 params 快 47%、中等嵌套 data 快 21%、长字符串持平。终审发现规格漏洞（JSON 请求体里的 null 字段被当成"没有"），已修为只跳过 undefined；修补后复跑 93 个文件、5688 条全绿，覆盖率 100%。已合入主工作区，合入后全量 107 个文件、5794 条全绿，覆盖率 100%                                                |
| F    | 文档：README（中英）、plugin-spec、core-architecture、ARCHITECTURE、CHANGELOG，新增 ADR 0002，以及迁移指南、项目技能 | 终审通过：13 份文档对齐新契约，现行文档里不再出现 `kind`、`httpStatus`、`envelope`、`ignores`、`sample`；README 写了五条警告和完整的业务风格示例；新增 ADR 0002（取代 0001 D3、D5 的相关条款）。终审纠正了一处误导写法：README 原本建议把父实例 `api.axios` 传给 `extend`，这会让 `overrides` 连父客户端一起改，已改为用工厂函数给子客户端新建实例，并加了警告。fmt、check 0 错误，文档索引检查通过 |
| 验收 | 整轮 `npm run accept`（testkit `50012ea`）                                                                           | 完成，结果见 §10。用 50012ea 新编的 release 在 47180/47190 起 axp 专用实例跑，跑完已关闭；共享在 47080/47090 的实例是 2026-10-27 的旧版本，没有使用，见下方说明                                                                                                                                                                                                                                     |

验收环境的发现（2026-10-29）：

- 共享在 47080/47090 的 testkit 服务（`api-ws-demo.exe` PID 26572、`netem.exe` PID 34144）是 2026-10-27 18:13 编译启动的，早于服务端 10-28 的两次改动（d7146d8：连接标识、慢读请求体、multipart；9820bdb：含 netem）。它的 `/t/ping` 只返回 `{"code":0}`，没有 `data.meta`。
- 隐患：在这套旧实例上，"连接复用"一类用 `same_as` 比较 `meta.conn` 的场景，可能是两个 undefined 相等的假通过。已核对：axp 2026-10-28 的 B7 验收（见该报告 §6 测量环境），以及 dioman 的 B7、B8 两轮验收，用的都是当场新编、起在 47180/47190 的专用实例，没有用这套旧实例，结论不受影响。
- 本轮 axp 不动共享实例（dioman 也在用，已通知 dioman-20），改用 50012ea 新编的 release（`CARGO_TARGET_DIR=C:\cargo-target\cisox`），在 47180/47190 起专用实例跑验收，跑完关闭。
- 执行器单测首次整套运行时，`unit/pipeline.test.ts` 有 21 条失败；随后两次整套重跑、以及单独跑这个文件都全部通过。疑似负载下的时序敏感，记录待观察。

终审中发现的一个基线问题：`test/combo/loading+notify.combo.test.ts:48` 把 `TestResponse` 的工厂传给只认 `AxpResponse` 的 `uiClient`，能不能通过类型检查取决于检查顺序（主会话实测：只多加一个无关的测试文件，就会报 TS2322）。由 D 修补一并改掉。

## 10. 修复后的最终门槛（2026-10-29）

在最终工作区（分支 `jelon/axp-final-review-fixes`，未提交）上，主会话亲自复跑。

### 10.1 测试、类型与检查

| 门槛                                        | 结果                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npx vp test run --coverage`                | 107 个文件、5794 条全部通过；语句 1399/1399、分支 1044/1044、函数 273/273、行 1168/1168，四项 100%；内核四文件分支 100% |
| `npx tsgo -p tsconfig.json --noEmit`        | 零输出                                                                                                                  |
| `npx tsgo --noEmit -p accept/tsconfig.json` | 零输出                                                                                                                  |
| 执行器单测（`accept/vitest.config.ts`）     | 8 个文件、166 条全部通过                                                                                                |
| `npm run build`                             | 两组产物都成功                                                                                                          |
| `npm run fmt` 后 `npm run check`            | 0 errors，466 warnings（重构完成时约 385，增加的多是测试里有意的类型断言）                                              |
| 文档索引检查                                | 通过                                                                                                                    |
| `npm run e2e`（Playwright 真浏览器）        | 62/62 通过，覆盖 69 个 API 动作；4570、5180 端口事先确认空闲，跑完自动回收                                              |

### 10.2 验收矩阵（testkit `50012ea`，axp 专用实例 47180/47190）

- 整轮：2692 格，**通过 2247、失败 3、跳过 442**，产物 `accept/.report/report-2026-10-29T05-59-34-078Z.json`。跳过数与 `accept:dry` 的计划一致。
- 3 个失败的处理：
  - `retry.custom-status-list` 的 business 风格 × http、fetch 两格：执行器业务风格的 `shouldRetry` 把默认状态码列表写死了，没有用场景自定义的列表。这是执行器配置 bug，不是 axp 的 bug。已修为"请求级优先、其次插件级"的有效列表，并补了执行器单测。随后重跑所有配置了自定义状态码的 6 个场景，共 66 格：54 通过、0 失败、12 格为场景自带跳过。
  - `share.leader-failure-all-fail` 的 weak × http 风格 × fetch 一格：5 个请求都是 Network Error，服务端一次都没收到。连续重跑 3 次、24 格全部通过，判定为 weak 网络模拟下的偶发问题，已告知 dioman-20。
- **合计口径：通过 2250、失败 0、跳过 442**。
- 跳过 442 格：
  - 缺能力（breaker、offline、timeout、timeout-total、raw-business-code、multipart、share-retry 及其组合）共 410 格；
  - 场景自带的 not applicable 共 32 格。
  - D21、blackhole 两条执行器通用跳过规则已经删除，改由 testkit D24 的能力声明表达。

### 10.3 性能

- **缓存命中**：同进程交替实测，最终版对比 D 之前的实现，最小 11.99 → 9.71µs、中位 13.54 → 11.21µs，快约两成；对比 D 首轮实现（慢约两成）已完全找回。
- **key**：同进程交替实测，对比原始实现，小 params 快 47%、中等嵌套 data 快 21%、长字符串持平。
- **client bench**：取两边裸 axios 基线最接近的一轮（12.6µs 对 12.1µs），最终版对比基线代码：
  - B2 系列多 0 到 1.6µs，B3 多 0.6µs，均在 A1 门槛（额外开销不超过约 10µs）之内；
  - B4 持平，B5 多 1.8%（在噪声范围内），B6 快 0.8µs。
  - 机器负载较重，另一轮两边的 B1 相差约 50%，不可比，已舍弃。

### 10.4 体积（未达标，待用户定）

| 产物                           | 基线（B0） | 重构完成时（B6） | 最终                                    |
| ------------------------------ | ---------- | ---------------- | --------------------------------------- |
| `dist/index.min.js` gzip -9    | 13,080     | 12,975           | **14,018（比基线多 938 字节，约 +7%）** |
| `dist/esm` 逐文件 gzip -9 求和 | 78,283     | 57,466           | 59,484（34 个文件，仍比基线小 24%）     |

增量来自本轮修复和拍板新增的代码：可取消等待、`refreshTimeout`、一次性请求体保护（`canReplay`）、异步缓存仓与快照、内核失败标记、`parse` 钩子、`respectRetryAfter` 判定函数等；key 精简省下的体积没能抵消。要压回基线以下，需要砍掉约 7% 的代码，基本只能拿功能换。是否放宽 `./min` 的体积门槛，由用户决定。

### 10.5 仍未做的事

- 9 项建议修（§3）。其中 notify 默认不给 internal 弹提示这一项，dioman 已经做了。
- 测试方案层面的建议（§6.2）：
  - I8、I9 不变量；
  - 撤回矩阵（已部分覆盖：share 撤回用例）；
  - http/fetch 双 adapter 集成用例（replay 集成测试已用真实 http adapter）；
  - 台账 id 对齐与 `--check` 脚本。
- 逻辑请求截止时间（总超时），这是放开 `timeout-total` 能力和 breaker、offline 插件的前提（§7）。
- 与 dioman 的架构分歧：dioman 暂时保留 `kind` 和逻辑 status，由它的用户决定（§8）。
- testkit 新场景：share `end`/`race` 参与者取消、超大 `Retry-After`，由谁来加和 dioman 再定。
- worktree 槽位 `E:\workspaces\codejoo-slot1`、`codejoo-slot2` 在提交完成后删除。
