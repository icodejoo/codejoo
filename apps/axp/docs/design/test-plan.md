---
title: axp 新架构测试方案（单测、覆盖率、组合、验收矩阵、性能门槛）
status: active
updated: 2026-10-29
summary: 新架构按六层怎么测、覆盖率和 API 台账口径、组合不变量、验收矩阵怎么跑、性能与体积门槛、旧用例怎么迁
---

## TL;DR

- 分层沿用 [测试六层规范](../guides/test-layers.md)：unit → rule → boundary → combo → integration → acceptance，一个行为只在能证明它的最低层测一次。
- 新增 7 条组合不变量（I1–I7），每个 combo 用例和 powerset 扫描都必须检查。
- 覆盖率门槛：全局行 ≥ 95%、分支 ≥ 90%、函数 ≥ 95%，内核四个文件分支 100%；每个公开 API 至少一条 rule 加一条 boundary。
- 验收：testkit 场景 × 7 网络 × 2 风格 × 2 adapter；执行器里替 axp 补的业务码适配全部删掉，直接测 axp 自身能力。
- 性能和体积以重构前的 main 为基线，不许退步；完整插件链的单请求开销目标降低 20%。

## 1. 原则

1. **按新 API 重写，不搬旧断言**：旧用例大量依赖 `Axp.install`、拦截器顺序、`config` 上的标记，机制没了，断言也就没了。
   保留的是**行为**：旧用例先登记行为清单，逐条判定"保留 / 改变 / 删除"（§10）。
2. **用例标题带 `[API id]`**：id 用新 API 重新编号（§7.2），格式沿用规范 §2。
3. **假传输优先**：rule/boundary/combo 用 axios 实例 + `makeNetwork()` 假 adapter（`test/helpers/network.ts`，保留），不起真服务器。
4. **时间用假时钟**：涉及 delay、TTL、loading 防闪烁的用例用 `vi.useFakeTimers()`，不 `sleep`。

## 2. 测试支撑（`test/helpers/`）

| 帮助函数                           | 用途                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `makeNetwork()`                    | 保留。路由、状态码、延迟、计数、调用流水；新增 `echo` 路由回显请求体（I7 用）  |
| `createTestClient(plugins, opts?)` | 新增。建 axios 实例 + `makeNetwork` + `createAxp`，返回 `{ api, net, events }` |
| `recordEvents()`                   | 新增。收集 loading、notify、refresh、expired、denied 回调序列                  |
| `assertInvariants(api, events)`    | 新增。一次性检查 I1–I6                                                         |
| `customResponse()`                 | 新增。带 `traceId` 字段的 `R` 扩展样例，类型测试和插件泛型测试共用             |

## 3. 单元层（`test/unit/`）

| 模块                      | 要点                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 排序 `pipeline.sort`      | 阶段顺序；内置次序；`enforce` pre/post；数组顺序；重名抛错；taps 拆段命名 `<name>#n`；未知阶段抛错                                                              |
| 链组合 `pipeline.compose` | 零插件直达传输；`next` 调用两次拿到同一基准请求；中间件抛错转 `internal`；中间件不调 `next` 可直接返回 `R`                                                      |
| 请求补丁 `mergePatch`     | 浅合并；`headers` 合并一层；`undefined` 值表示删除；不改原对象                                                                                                  |
| 状态键 `stateKey`         | 类型隔离；同描述两个键互不覆盖；逻辑请求级共享                                                                                                                  |
| 响应工厂 `axpResponse`    | §6 分类表逐行；失败标记只由内核写入且强制 ok=false；parse/type、expectJson、create 普通对象的品牌与 code/data/message 缺省值；字符串 code                       |
| `AxpResponse`             | 默认 ok（2xx 且 code=0/0000）；status 保留 HTTP；parse 可覆盖；data 缺省 null、message 空串或 null；内核失败遮住 ok；toJSON 业务字段与失败事实                  |
| `isAxpResponse`           | 品牌识别；跨模块副本（手动构造同品牌对象）识别；普通 `Error`、普通对象返回 false                                                                                |
| 落定 `settle`             | 成功 / 可预期失败 / bug 三类 × 默认、`wrap`、`throws: false` 九格；`reject` 只作用于可预期失败；debug 模式失败时抛出带调用点 `stack` 的派生副本，共享原对象不变 |
| key 服务                  | baseURL/allowAbsoluteUrls；对象仅跳 undefined、null 字段与假值均参与；类型标签、字符串不 trim；二进制 64KiB 边界；scope；不可哈希返回 null                      |
| retry 算法                | `$computeDelay`、jitter、`Retry-After` 解析（数字秒 / HTTP-date / 超限不重试）沿用现有用例                                                                      |
| auth 匹配                 | `$compileMethods`、`$compileUrlPatterns`、`$pathnameOf` 沿用                                                                                                    |
| cache 存储                | LRU、惰性过期、节流清扫；可序列化快照、同步/异步方法与可选 size；每 key 串行写、新鲜度屏障与回收                                                                |
| `TokenManager`            | 沿用，删 `canRefresh` 相关                                                                                                                                      |

## 4. 规则层与边界层（`test/rule/`、`test/boundary/`）

每个插件一组文件。规则层测**文档写明的行为**，边界层测**极端输入和时序**。下表是必须覆盖的要点，不是全部用例。

| 对象                 | rule 要点                                                                                                                                                | boundary 要点                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 客户端               | 十个动词的 data/params 分派；`request`；`extend` 继承插件且状态独立；`use`/`eject` 后链生效；`inspect` 顺序；`cancelAll` 返回数；`pending`；`isResponse` | 在途时 `eject`/`dispose`；`extend` 覆盖 headers 不污染父实例；同一插件对象装两个客户端；用户 `transformResponse` 抛 TypeError 时调用方拿到原始 TypeError          |
| 用户回调抛错（N13）  | 判定类回调抛错 → 调用方拿到原始异常；通知类回调抛错 → 请求结果不变、`console.error` 被调用一次                                                           | `onRefresh` 抛错 → 按刷新失败处理，不当 bug                                                                                                                       |
| 取消                 | 用户 signal 联动；`cancelAll` 后 `api.isCancel(r)` 且 ok=false、status=0、code=0                                                                         | 已中止的 signal 直接落定；取消发生在 retry 等待、auth 排队、share 跟随中                                                                                          |
| loading              | 一对显示/隐藏；`delay`/`delayClose`；请求级四种写法                                                                                                      | 回调抛错隔离；卸载取消定时器；并发交错的 0↔1 边界                                                                                                                 |
| notify               | 默认 stringify；`silent`；`notify: false`；每逻辑请求 ≤ 1 次                                                                                             | stringify 抛错隔离；取消不通知                                                                                                                                    |
| repath               | 三种占位符；params 优先 data；编码；`removeKey`                                                                                                          | 缺值保留占位；同名占位多次；不碰 query/hash/host                                                                                                                  |
| filter               | 默认生效；`filter: false`；predicate、ignoreKeys、ignoreValues                                                                                           | 非纯对象 data（FormData、Blob）原样；不改调用方对象                                                                                                               |
| retry                | 每个选项一条；判定顺序 6 级各一条；请求级写法                                                                                                            | `max: 0`；delay 返回非数字；等待中取消；Retry-After 超上限不重试；business 429 配判定函数                                                                         |
| auth                 | 五动作；单飞刷新；排队请求等刷新；`protected`；`ready` patch；过期每轮一次通知                                                                           | `onRefresh` 同步抛错；刷新中取消；重放后仍 401 判 expired；token 变化后恢复刷新（O4）；本地无 token；refreshTimeout；旧刷新失败不清新会话；ready/onFailure 可取消 |
| mock                 | 探测命中；404 回落；不可达回落；`fallbackWhen`                                                                                                           | 探测不写缓存、不占共享；mockUrl 缺失跳过；一次性体不重放                                                                                                          |
| share                | 三种策略；`methods`；key 为 null 绕过                                                                                                                    | 首发取消不连累跟随者；跟随者各自超时；全部离开中止底层；end/race 撤回不影响别人；race 全败用最后一个未撤回失败                                                    |
| cache                | 命中不触网；TTL；`methods`；`shouldCache`；`clone` 三种；`remove`/`clear`                                                                                | 慢的旧响应不覆盖新结果；`clear` 后在途不回写；淘汰后屏障仍有效（R2-2）；max: 1；异步 store 故障隔离；命中重建与当前 request；取消不命中                           |
| envs                 | 第一个命中规则生效                                                                                                                                       | 无规则；规则抛错                                                                                                                                                  |
| 响应工厂（经客户端） | business 风格 401/403/500 保持 HTTP status=200、code 保留业务码，ok=false；业务路由显式配置                                                              | 非 JSON、空 body、HTML 拦截页（`expectJson`）                                                                                                                     |

## 5. 组合层（`test/combo/`）

### 5.1 不变量

每个组合用例结束时都调 `assertInvariants`：

| #   | 不变量                                                         |
| --- | -------------------------------------------------------------- |
| I1  | 每个逻辑请求恰好落定一次（resolve 或 reject，只一次）          |
| I2  | loading 回调成对，最后一个是 `false`                           |
| I3  | 结束后 `api.pending() === 0`，逻辑请求的 signal 上没有残留监听 |
| I4  | 每个逻辑请求 notify ≤ 1 次                                     |
| I5  | 并发 401 只调用一次 `onRefresh`                                |
| I6  | 测试模式下内核断言 `next()` 从不 reject                        |
| I7  | 同一逻辑请求的每次发送，请求体一致（`echo` 比对）              |

### 5.2 有交互风险的组合

| 组合                             | 要证明的性质                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| auth + retry                     | 重试中遇 401 先刷新再继续；刷新不消耗重试次数；每次尝试带最新 token                                       |
| retry + share                    | 并发同 key 时每一轮尝试只发一次网络请求；重试时各调用方重新合并到新一轮共享；所有调用方最终拿到一致的结果 |
| retry + cache                    | 只有最终成功的那次写缓存；命中不进入重试                                                                  |
| cache + share                    | 并发未命中只发一次，结果写缓存一次                                                                        |
| mock + cache / mock + share      | 探测结果不进缓存、不占共享；回落后的真实结果正常缓存                                                      |
| auth + share                     | 跟随者共享首发的刷新后结果；scope 不同不共享                                                              |
| loading + retry / loading + auth | 重试、刷新等待期间不闪烁，只有一对                                                                        |
| notify + retry / notify + auth   | 最终失败才通知，且只一次；刷新成功不通知                                                                  |
| 取消 + share / retry / auth      | 取消后 I1、I3 成立；share 首发取消不连累跟随者                                                            |
| repath + filter + cache          | 不同路径变量、不同参数不串缓存；空字段被剥离后 key 相同                                                   |
| 自定义 taps + 内置插件           | outer 段看到最终 `R`、credential 段看到注入后的请求；顺序与 `inspect()` 一致                              |
| 自定义 `R` + 全插件              | 扩展字段在 `ctx.fail` 合成的响应上也存在（auth 拒绝、share 超时、取消）                                   |

文件命名沿用规范：插件名按字母序，如 `auth+retry.combo.test.ts`；内核能力写 `cancel`、`response`。

### 5.3 powerset

`powerset.combo.test.ts`：9 个有中间件的插件（loading、notify、repath、filter、retry、auth、mock、share、cache）的全部 512 个子集，
每个子集跑同一组脚本化流程：成功、HTTP 500 两次后成功、business 401 刷新、网络错误、并发同 key、中途取消。只检查 I1–I7，不检查具体结果。

## 6. 集成层（`test/integration/`、`e2e/`）

| 主题         | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 装配         | `inspect()` 对全部内置插件给出 [核心架构 §4](core-architecture.md#4-阶段与排序) 的顺序；动态 `use`/`eject`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 真实 adapter | axios `http` 与 `fetch` 两种 adapter 对 e2e mock 服务器（`e2e/server/mock-server.mjs`）各跑一遍主流程                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 类型         | 见下                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 产物         | `test/integration/dist.integration.test.ts` 验证 `dist` 而不是 `src`：`exports` 恰为根入口、`./min`、10 个插件与 `./package.json`，且指向的文件都存在；每个子路径能被 Node 按 `exports` 实际导入，子路径与根入口共有的导出是同一引用；旧子路径（`./cancel`、`./key`、`./logger`、`./normalize`）和内部算法模块（`auth-match`、`cache-store`、`retry-timing`）不可导入（`ERR_PACKAGE_PATH_NOT_EXPORTED`）；`./min` 与根入口混用时 `isAxpResponse` 互认对方的成功与失败响应，不误认非响应；声明产物里 `declare module` 的相对说明符都以 `.mjs` 结尾且指向真实文件；nodenext、bundler 两种消费方用 tsgo 检查（`skipLibCheck: false`，请求选项增强生效、错误写法报错）；`dist` 缺失或比源码旧时先自动 `npm run build` 再测 |
| 浏览器       | `e2e/` Playwright 用例改用新 API，覆盖 loading、取消、缓存在真实浏览器下的表现                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**类型测试**（`expectTypeOf`）必须覆盖：

- Schema 推断：路径、payload、响应类型（迁移现有 `types.integration.test.ts`）。
- `wrap: true` 和 `throws: false` 的返回类型是 `WithData<R, D>`。
- `createAxp<S, MyResponse>` 不传 `response` 报错；`response` 产出类型不是 `MyResponse` 时报错。
- 插件判断函数的参数在内联时推断为 `MyResponse`；单独定义时手写泛型。
- `api.isResponse(e)` 收窄为 `MyResponse`；`isAxpResponse<MyResponse>(e)` 同理。
- 子类覆盖 `ok` / `status` getter 后仍满足 `IAxpResponse`。
- 插件请求选项的模块扩展在 `api.get(p)(x, { retry: 2, cache: true })` 上生效，错误写法报错。

## 7. 覆盖率与 API 台账

### 7.1 覆盖率

- 工具：vitest 的 v8 覆盖率，devDependency `@vitest/coverage-v8`（4.1.6，与 vite-plus-test 0.1.22 的 peer 要求一致，经 catalog 管理），2026-10-28 已引入。
- 范围：`src/**`，排除纯类型文件。
- 全局门槛：行 ≥ 95%、分支 ≥ 90%、函数 ≥ 95%。
- 内核门槛：`src/{pipeline,context,response,transport}.ts` 分支 100%。整条链压在这四个文件上，任何一个没走到的分支都可能是"某种请求永远不落定"之类的漏洞。
  确实走不到的防御分支不许用 `/* v8 ignore */` 糊过去，要么删掉，要么在评审里说明为什么保留、为什么测不到，经主会话同意后才能豁免。
- 都写进 `vitest.config.ts` 的 `coverage.thresholds`（按文件的门槛用 glob 键），不达标即失败：

  ```ts
  coverage: {
    provider: 'v8',
    include: ['src/**'],
    thresholds: {
      lines: 95, branches: 90, functions: 95,
      'src/{pipeline,context,response,transport}.ts': { branches: 100 },
    },
  }
  ```

- 生效时间：内核门槛从 B1 起生效（B1 交付这四个文件）；全局门槛 B5 起生效（插件全部迁完之后）。
- 命令：`vp test --coverage`。
- 旧代码基线（2026-10-28，main@be379e3）：语句 90.5%、分支 94.15%、函数 85.83%、行 91.67%。

### 7.2 API 台账

- 新 API 编号规则：`<插件或core>.<类别>.<名字>`，类别沿用台账现有的 opt / cb / req / fn / const / method / prop。
- 口径沿用规范 §5：每个公开 API 至少一条 rule 加一条 boundary（或写明"无边界"的理由），加上 §5.2 的组合。
- testkit 仓库的 `coverage/axp-api.json` 要按新 API 重建：只改 axp 台账和 axp 映射，不碰 dioman 部分，在 api-ws-demo 仓库单独提交。

## 8. 性能与体积

**基线**：动工前在当前 main 上量一次，结果写进实施报告。

| 场景（`bench/*.bench.ts`，vitest 自带 bench，不新增依赖） | 门槛                            |
| --------------------------------------------------------- | ------------------------------- |
| B1 裸 axios + 假 adapter                                  | 参照值                          |
| B2 axp 无插件                                             | 相对 B1 的额外开销 ≤ 旧版对应值 |
| B3 axp 全插件、缓存未命中                                 | 额外开销比旧版降低 ≥ 20%        |
| B4 缓存命中                                               | 不低于旧版                      |
| B5 100 个并发同 key 的 share                              | 不低于旧版                      |
| B6 带 data 的 POST + retry 装上但不触发                   | 不低于旧版（验证按需克隆）      |

**体积**：`dist/index.min.js` 用 `gzip -9` 量，不大于基线。
**内存**：powerset 跑完后，cache/share 内部表在 `clear()` 和 `dispose()` 后为空（白盒断言）。

**实测结果（2026-10-28，B6）**：详见 [B6 报告](../reports/2026-10-28-pipeline-b6.md) §5。机器有外部负载，绝对值与 B0 不可比，所以把 B0 源码与 bench 导出，与新 bench 交错各跑三轮，按同一轮里相对 B1 的倍数与最小延迟比较。

| 场景 | 结果（三轮中位）                                                | 结论                               |
| ---- | --------------------------------------------------------------- | ---------------------------------- |
| B2   | 额外开销 -0.08 → 0.87（B1 倍数）；min 10.8 → 19.4µs，多约 8.6µs | 按表中原文不达标，按 A1 调整后达标 |
| B3   | 额外开销 4.26 → 2.51，降 41%；min 每轮都降                      | 达标                               |
| B4   | min 11.8 → 9.8µs，三轮都更快                                    | 达标                               |
| B5   | 总耗时倍数 120.85 → 93.73；min 三轮都更快                       | 达标                               |
| B6   | 额外开销 0.42 → 1.16；min 15.6 → 23.1µs，多约 7.5µs             | 按表中原文不达标，按 A1 调整后达标 |

**B2、B6 的门槛按方案 A1 决策调整为"额外开销不超过约 10µs（入口合并 defaults 的固定成本）"：B2 相对 B1，B6 相对旧版同场景（B6 带请求体，不能直接与 GET 的 B1 比）。** 出处：[B2 报告「方案 A1」一节](../reports/2026-10-28-pipeline-b2.md)，该节实测入口 `mergeConfig` 合并实例 defaults 约 +10.4µs，用户据此选定 A1。旧版无插件路径几乎零开销，A1 之下不可能回到零；B6 多出的 7–8µs 同样是这份固定成本（POST 不在 retry 默认方法里，不触发克隆）。上表 B2、B6 两行的原始门槛文字不变，以这条调整为准。

**体积实测**：`dist/index.min.js` gzip -9 为 12,975 字节，基线 13,080，少 105 字节（-0.8%），达标；原始 35,033，基线 39,174（-10.6%）。`dist/esm` 全部 `.mjs` 逐个 gzip -9 求和 57,466（34 个文件），基线 78,283（33 个文件），-26.6%。

## 9. 验收矩阵（`accept/` + testkit）

### 9.1 维度

一次运行 = 场景 × 网络 × 风格 × adapter，定义见 testkit 的 `MATRIX.md`：

- 场景：`scenarios/*.json`，当前 443 个，axp 可执行 358 个；
- 网络：normal、weak、lossy、offline、blackhole、flap、dns；
- 风格：http、business；
- adapter：http、fetch。

breaker、offline、timeout 三类场景继续因缺能力跳过。

### 9.2 执行器改造（`accept/lib/`）

| 文件                        | 改动                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client-factory.ts`         | 改用 `createAxp`。删除 `logicalStatus`、`makeShouldRetry`、`notifyText`、`makeShouldCache`、`makeOnFailure` 里的业务码适配（O5 做完后的约定）；`parseGuard` 改为 `axpResponse({ expectJson: true })`；`expiredMarked` 改读 `r.reason` |
| `classify.ts`               | 抛出的就是 `R`：`isAxpResponse(e)` 后直接读 failureOf(e) / e.ok / e.status / e.code 归类，不再识别 `ApiError`、`CanceledError` 等多种形态；非 `R` 一律记为 `unknown:`（意味着 axp 有 bug）                                            |
| `mapping.ts` / `mapping.md` | 中立 `key: true` 直接映射为 axp 的 `key` 默认行为，不再翻译成 `'deep'`；`cache.methods` 映射到插件选项；能力清单里 cancel、key、normalize、log 改为"内核具备"                                                                         |
| `unit/*`                    | 执行器自测随上面同步更新，仍不计入六层                                                                                                                                                                                                |

改完后执行器里不应再出现任何"替 axp 补能力"的代码；评审时逐个函数核对。

### 9.3 通过标准

1. 所有可执行格子通过；跳过的格子都有写明的理由。
2. 旧版预判会失败的三项必须通过：并发刷新失败时 `expired` 回调只触发一次；share 首发取消不连累跟随者；POST 默认不缓存。
3. 通用断言每格都成立：`pending_after = 0`、loading 成对且最后为 false、服务端 `inflight = 0`。
4. 结果写成报告 `docs/reports/<日期>-acceptance-pipeline.md`，列出通过数、跳过数和跳过理由，同一次提交更新索引。

testkit 侧的 D12 契约缺口（flap 时间表、`key: true` 是否含查询参数等）不在本轮范围。axp 这边的语义按本方案定，D12 补齐时以本方案为准。

## 10. 旧用例迁移

现有 90 个文件、836 处用例声明，`it.each` 展开后实际执行 1002 条（2026-10-28 B0 用语法树核对；早先估的 822 漏了 14 处双引号标题）。映射按声明记，核对时同时报执行条数。按规范 §4 记映射，记录在 [pipeline-migration](../reference/pipeline-migration/README.md)，按层分文件。

| 动作     | 用于                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------- |
| `keep`   | 行为不变，按新 API 重写；记新位置                                                                 |
| `change` | 行为按 [插件规格 §9](plugin-spec.md#9-行为变化汇总发版写进-changelog) 改变；记新断言              |
| `drop`   | 机制已删除（adapter 分层、bag、尝试钩子、`Axp.install` 槽位、`authExpired` 标记等）；写明删除依据 |

- 行为清单先于新用例写完，评审确认后再写新用例。
- 核对公式：`旧总数 = keep + change + drop`，不平不许提交。
- 迁移期间旧用例移到 `test/legacy/`，从 `include` 里排除；对应插件迁完就删掉对应的旧文件。

## 11. 完成定义

- `vp test` 全绿，覆盖率达到 §7.1 门槛；tsgo 0 错误；`vp check` 通过。
- §5.2 的组合全部有用例，powerset 512 个子集全绿。
- §8 的性能和体积门槛全部满足，数字写进报告。
- `npm run accept` 达到 §9.3 标准，报告已提交。
- 迁移映射核对公式成立。
