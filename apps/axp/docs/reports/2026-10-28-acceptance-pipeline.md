---
title: axp 洋葱管线 B7 验收矩阵报告
status: active
updated: 2026-10-28
summary: 最终代码上整轮 npm run accept：2692 项，通过 2246、失败 0、跳过 446；登记 mock-in-chain 与 keep-alive 后补充复跑 8 格全过，合计通过 2254、失败 0、跳过 438；含跳过理由分类、test-plan §9.3 逐条核对、与旧 API 末轮的对照、测量环境与给 testkit 的反馈
---

## TL;DR

两组数字，先分清关系：

| 口径                                                         | 通过 | 失败 | 跳过 | 说明                                                             |
| ------------------------------------------------------------ | ---: | ---: | ---: | ---------------------------------------------------------------- |
| 整轮 `npm run accept`（执行器登记这两项能力之前）            | 2246 |    0 |  446 | 2692 项，一次性跑完，耗时 38 分 11 秒                            |
| 补充复跑（登记 `mock-in-chain`、`keep-alive` 后，只跑 8 格） |   +8 |    0 |   −8 | 这 8 格原本在整轮的 446 个跳过里，见 §4                          |
| **合计口径**                                                 | 2254 |    0 |  438 | 整轮加补充复跑拼出来的，与登记后 `npm run accept:dry` 的计划一致 |

- 整轮 `npm run accept`（串行，jobs=1）：**2692 项，通过 2246，失败 0，跳过 446**。443 个场景里 355 个至少跑了一格，88 个整场景跳过。产物 `accept/.report/report-2026-10-28T16-12-43-088Z.json`。下面第 1–3 节的数字都是这一轮的。
- 补充复跑：整轮之后，主会话裁定 axp 实际具备 `mock-in-chain` 与 `keep-alive`，执行器白名单已如实登记（`multipart` 不登记）。`requires` 含这两项的场景只有 3 个、共 8 格，用执行器的 `--id` 过滤正式复跑，**8 通过、0 失败**，产物 `report-2026-10-28T16-21-36-201Z.json`。合计 **通过 2254、失败 0、跳过 438**，登记后 358 个场景至少跑了一格、85 个整场景跳过。
- test-plan §9.3 四条都成立：可执行格子全部通过、跳过都有理由；并发刷新失败 `expired` 只触发一次、share 首发取消不连累跟随者、POST 默认不缓存三项都通过；通用断言（`pending_after = 0`、loading 成对且最后为 false、服务端 `inflight = 0`）在整轮 2246 格与补充复跑 8 格上无一违反。
- 整轮跳过 446 = 缺能力 376 + not applicable 70。70 里 32 格是场景自带的 `skip`，38 格是执行器的两条通用规则：testkit D21 业务码透传 34 格、blackhole 未配超时 4 格。登记后缺能力降到 368，合计跳过 438。
- 与旧 API 末轮（9 个失败）对照：`auth.token-garbage-refresh-none`、`combo.cache-mock-no-key-collision` 在整轮通过；`combo.cache-mock-fallback-cached-once`、`combo.mock-share-fallback-single-flight` 整轮时**是被跳过，不是通过**（白名单没登记 `mock-in-chain`），登记后补充复跑 4 格全过。旧失败的 4 个场景现在都是通过。

## 1. 结果总览

| 项       |                                                                           数量 |
| -------- | -----------------------------------------------------------------------------: |
| 运行总数 |       2692（场景 443 × 网络 × 风格 × adapter，按场景自己声明的网络与风格展开） |
| 通过     |                                                                           2246 |
| 失败     |                                                                              0 |
| 跳过     |                                                                            446 |
| 场景口径 | 337 个全部执行、18 个部分跳过、88 个整场景跳过（87 个缺能力，1 个 D21 不适用） |

整轮时的计划数与 `npm run accept:dry` 一致：443 场景、2692 条，其中需执行 2246 条。登记 `mock-in-chain`、`keep-alive` 之后 dry 的计划变为需执行 2254 条、跳过 438 条（见 §4）。

### 1.1 按网络

| 网络      | 通过 | 失败 | 跳过 |
| --------- | ---: | ---: | ---: |
| normal    | 1294 |    0 |  330 |
| weak      |  432 |    0 |   24 |
| offline   |  164 |    0 |   20 |
| dns       |  148 |    0 |    8 |
| blackhole |  132 |    0 |   16 |
| lossy     |   56 |    0 |   12 |
| flap      |   20 |    0 |   36 |
| 合计      | 2246 |    0 |  446 |

### 1.2 按风格与 adapter

| 维度          | 通过 | 失败 | 跳过 |
| ------------- | ---: | ---: | ---: |
| 风格 http     | 1154 |    0 |  212 |
| 风格 business | 1092 |    0 |  234 |
| adapter http  | 1123 |    0 |  223 |
| adapter fetch | 1123 |    0 |  223 |

两个 adapter 的数字逐格一致。business 比 http 多跳 22 格：D21 的 34 格里 business 占 30、http 占 4，差 26；`mock-in-chain` 的 4 格只在 http 风格，抵掉 4。

### 1.3 网络 × 风格

| 网络      | http 通过/跳过 | business 通过/跳过 |
| --------- | -------------: | -----------------: |
| normal    |      676 / 154 |          618 / 176 |
| weak      |       218 / 12 |           214 / 12 |
| offline   |        82 / 10 |            82 / 10 |
| dns       |         74 / 4 |             74 / 4 |
| blackhole |         66 / 8 |             66 / 8 |
| lossy     |         28 / 6 |             28 / 6 |
| flap      |        10 / 18 |            10 / 18 |

所有格失败均为 0。

### 1.4 按域

| 域        | 场景 | 通过 | 失败 | 跳过 |
| --------- | ---: | ---: | ---: | ---: |
| auth      |   72 |  496 |    0 |    4 |
| plugins   |   77 |  114 |    0 |  198 |
| basic     |   20 |  200 |    0 |   24 |
| breaker   |   13 |    0 |    0 |   64 |
| cache     |   23 |  120 |    0 |    0 |
| cancel    |   12 |   68 |    0 |    0 |
| combo     |   33 |  162 |    0 |    8 |
| conc      |   16 |  112 |    0 |    0 |
| faults    |   16 |  120 |    0 |    8 |
| filter    |    4 |   32 |    0 |    0 |
| key       |    7 |   28 |    0 |    0 |
| loading   |   17 |  136 |    0 |    4 |
| mock      |    7 |   44 |    0 |    0 |
| network   |   14 |   76 |    0 |    4 |
| normalize |    9 |   54 |    0 |    0 |
| notify    |   11 |   74 |    0 |    0 |
| offline   |    8 |    0 |    0 |   44 |
| repath    |    7 |   36 |    0 |    0 |
| retry     |   42 |  262 |    0 |   20 |
| share     |   20 |  112 |    0 |    4 |
| timeout   |   15 |    0 |    0 |   64 |

breaker、offline、timeout 三个域整域跳过（缺能力），`plugins` 域的 198 格跳过里大部分是这三类插件的单插件、两两组合和全流程场景。

## 2. 跳过理由

446 格 = 缺能力 376 + not applicable 70。每一格的 `reasons` 都写了理由，没有无理由的跳过。

### 2.1 缺能力（376 格，87 个场景）

| 理由                                   | 格数 | 场景数 | 说明                                                                       |
| -------------------------------------- | ---: | -----: | -------------------------------------------------------------------------- |
| missing timeout                        |  108 |     26 | axp 没有分阶段超时                                                         |
| missing breaker                        |  100 |     22 | axp 没有熔断                                                               |
| missing offline                        |   64 |     13 | axp 没有离线探测                                                           |
| missing breaker+offline+timeout        |   32 |      7 |                                                                            |
| missing breaker+timeout                |   20 |      5 |                                                                            |
| missing offline+timeout                |   16 |      4 |                                                                            |
| missing breaker+offline                |   16 |      4 |                                                                            |
| missing mock-in-chain                  |    4 |      2 | 整轮时白名单没登记；登记后补充复跑 4/4 通过（§3.3、§4）                    |
| missing multipart                      |    4 |      1 | `auth.expired-multipart-replay`；执行器不构造 multipart 请求体             |
| missing keep-alive                     |    4 |      1 | `basic.keep-alive-recovery-isolated`；同上，登记后补充复跑 4/4 通过        |
| missing share-retry                    |    4 |      1 | `share.retry-recovers-single-result`；axp 的 share 只有 start / end / race |
| missing timeout+timeout-send+multipart |    4 |      1 | `timeout.send-slow-reader`                                                 |

按单项能力累计（组合有重叠）：timeout 180 格，breaker 168 格，offline 128 格。

### 2.2 not applicable（70 格）

**场景自带的 `skip`（32 格）**，理由来自场景预期，不是执行器判的：

| 场景                                                                                  | 网络  | 格数 | 理由                                                                                                                   |
| ------------------------------------------------------------------------------------- | ----- | ---: | ---------------------------------------------------------------------------------------------------------------------- |
| `basic.status-matrix`                                                                 | lossy |    4 | lossy 每条连接 15% 概率注入 RST，9 个并发请求总有请求以 network 失败，无法确定性断言状态码分类                         |
| `basic.status-matrix`                                                                 | flap  |    4 | 本场景没有重试，请求落在 flap 前 1500ms 离线窗口内只会得到 network；断网恢复由 `retry.flap-recovers` 覆盖              |
| `faults.status-with-business`                                                         | lossy |    4 | 单发无重试请求可能以 network 失败，无法确定性断言状态码分类                                                            |
| `faults.status-with-business`                                                         | flap  |    4 | 同上，没有重试，落在离线窗口内只会得到 network                                                                         |
| `retry.429-retried`、`retry.503-retry-after`、`retry.respects-retry-after-over-delay` | flap  |   12 | 重试预算（3 次、每次 100ms 退避）短于 flap 前 1500ms 离线窗口，不是重试能恢复的有效对照；由 `retry.flap-recovers` 覆盖 |
| `retry.respects-retry-after-over-delay`                                               | lossy |    4 | lossy 的随机 RST 会额外消耗重试次数，本场景只比必需的 3 次多 1 次预算，结果取决于随机决策                              |

**执行器通用规则（38 格）**，`lib/mapping.ts` 的 `inapplicableReason`，从场景字段识别，不靠场景 id 清单（见 `accept/mapping.md` §跳过规则）：

| 规则                                     | 格数 | 场景数 | 理由原文                                                                                              | 命中                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ---: | -----: | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| testkit D21：没装 normalize 时业务码透传 |   34 |     14 | `not applicable: axp 归一化为内核能力，不支持关闭；testkit D21 的“未装 normalize 时业务码透传”不适用` | `plugins.single-{auth, envs, log, cache, cancel, loading, mock, notify, filter, key, repath, retry, share}` 的 normal / business，每个 2 格（两个 adapter）共 26 格；`basic.business-code-without-normalize` 的 normal 与 weak、两种风格、两个 adapter 共 8 格 |
| blackhole 下没有配置超时                 |    4 |      1 | `not applicable: 场景未配置超时，blackhole 下请求无法落定`                                            | `basic.status-matrix` 的 blackhole、两种风格、两个 adapter                                                                                                                                                                                                     |

这 38 格与 B7 第二轮（`report-2026-10-28T14-51-21-179Z.json`）的 38 个失败格逐格相同：规则出现前它们是失败，规则出现后是跳过，没有多跳也没有漏跳（本轮用报告 JSON 的 key 逐条核对过）。

### 2.3 为什么 D21 不由执行器补

axp 把归一化做进内核，不能关闭。让执行器在没装 normalize 的场景里改用 `axpResponse({ envelope: false })` 试过，不可行（整轮前 200 条就出现 100 多个失败，全在 `auth.*`），原因与静态统计见 `accept/mapping.md` §跳过规则末段。

## 3. test-plan §9.3 逐条核对

### 3.1 第 1 条：可执行格子全部通过，跳过都有理由

整轮 2246 个可执行格全部通过，446 个跳过格都带理由，分类见 §2；补充复跑把其中 8 格转为可执行并通过（合计 2254 / 0 / 438，见 §4）。成立。

### 3.2 第 2 条：旧版预判会失败的三项

三项场景都只在 normal 网络上，两种风格 × 两个 adapter 共 4 格，**全部通过**。

| 项                                  | 场景                                    | 结果 | 断言要点                                                                                                                                    |
| ----------------------------------- | --------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 并发刷新失败时 `expired` 只触发一次 | `auth.refresh-expired-concurrent`       | 4/4  | access 与 refresh 都过期，5 个并行请求 r0–r4 全部以 `expired` 失败；服务端 `/t/auth/refresh` 恰好 1 次，客户端 `refresh = 1`、`expired = 1` |
| share 首发取消不连累跟随者          | `share.leader-cancel-followers-survive` | 4/4  | `share: start`，lead 在 1000ms 取消，f1、f2 仍成功（共享请求用独立的 controller，订阅者全部离开才中止）                                     |
| POST 默认不缓存                     | `cache.post-not-cached-by-default`      | 4/4  | 两次相同的 POST 都带 `cache: true`，服务端 `/t/echo` 收到 2 次，r2 `from_cache = false`（缓存自带 `methods`，默认 `get head`）              |

同一主题的相邻场景也全部通过：

- expired 只触发一次一类：`auth.concurrent-401-single-refresh-8`（20 格）、`auth.concurrent-401-single-refresh-32`、`auth.code-only-401-refresh-once-then-expired`、`auth.token-garbage-concurrent-{refresh-ok, refresh-bad, no-refresh}`、`auth.refresh-expired-session`、`auth.refresh-window-blocked-expired`、`auth.refresh-fail-times`。
- share 取消一类：`share.follower-cancel-isolated`、`share.all-cancelled-aborts-server`、`share.leader-failure-all-fail`、`combo.cancel-share-follower`。
- 缓存不写入的一类：`cache.http-error-not-cached`、`cache.business-failure-not-cached`、`cache.cancel-not-cached`、`cache.timeout-not-cached`、`combo.share-failure-not-cached`。

### 3.3 mock-in-chain 与几个"缺能力"的真实状态

整轮时，执行器的 `SUPPORTED_CAPABILITIES`（`accept/lib/constants.ts`）是白名单：不在里面的能力名一律按"缺能力"跳过，不看 axp 实际有没有。其中 `mock-in-chain`、`keep-alive` 是 testkit 后来新增的能力名，当时没登记。

为判断这两项是真缺还是没登记，整轮之后我在 scratchpad 里写了一个临时脚本（不进仓库、不写 JSON 报告、不计入整轮的数字），导入执行器的 `buildPlan` / `runEntry`，只把白名单多放进几项，对相关场景单独跑：

| 场景                                        | 加进白名单的能力 | 结果                                                                                 |
| ------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `combo.cache-mock-fallback-cached-once`     | mock-in-chain    | normal/http × 两个 adapter，2/2 通过                                                 |
| `combo.mock-share-fallback-single-flight`   | mock-in-chain    | normal/http × 两个 adapter，2/2 通过                                                 |
| `combo.cache-mock-no-key-collision`（对照） | mock-in-chain    | 4/4 通过（正式轮里本来就在跑）                                                       |
| `basic.keep-alive-recovery-isolated`        | keep-alive       | 4/4 通过                                                                             |
| `auth.expired-multipart-replay`             | multipart        | 4/4 失败：`r1.data.multipart` 缺失，执行器没有构造 multipart 请求体，不是 axp 的结论 |

结论：

- `mock-in-chain`：axp 新架构具备。mock 是 source 阶段次序 1，探测用 `cache: false, share: false` 发出，回落后的真实请求才过 share / cache（plugin-spec §6.1），正好是 testkit CONTRACT §7 说的语义。是执行器没登记，不是 axp 缺。
- `keep-alive`：同样是没登记。
- `multipart`：执行器没实现，保持跳过是对的。
- `share-retry`、`timeout-send`：axp 确实没有。

主会话据此裁定登记 `mock-in-chain`、`keep-alive`，`multipart` 不登记。登记与正式复跑见 §4。

### 3.4 第 3 条：通用断言

每个可执行格都检查三项，任一项违反该格判失败：

- `pending_after = 0`：`accept/lib/assertions.ts` 的通用断言。
- loading 成对且最后一个是 false：`accept/lib/events.ts`。
- 服务端 `inflight = 0`：`accept/lib/runner.ts` 在场景结束后删掉 netem 代理、轮询到归零，最长等 3 秒。

整轮失败为 0，没有任何一格出现"通用:"开头的失败原因，2246 格全部成立；补充复跑的 8 格同样全部通过，通用断言也成立。

### 3.5 第 4 条：报告

即本文。索引由主会话合并时统一登记，本次没有改 `docs/README.md`。

## 4. 补充复跑：登记 mock-in-chain 与 keep-alive 之后

整轮之后，主会话裁定 axp 实际具备 `mock-in-chain` 与 `keep-alive`，执行器白名单应如实登记，`multipart` 保持不登记。

### 4.1 执行器改动（均在 `accept/`，未提交）

- `lib/constants.ts`：新增 `BEHAVIOR_CAPABILITIES = ["mock-in-chain", "keep-alive"]`（行为级能力，不对应插件或请求选项），并入 `SUPPORTED_CAPABILITIES`。
- `mapping.md`：能力清单新增"行为级"一行；"缺失"一行补充说明 `multipart`、`share-retry`、`timeout-send` 也不在清单里。
- `unit/mapping-report.test.ts`：能力清单的断言同步——行为级清单、`multipart` / `share-retry` / `timeout-send` 不在白名单里、`mapping.md` 四行名单与代码一致；"白名单等于映射表登记的插件"那条改成对 插件 + 内核。

校验结果：

| 检查                                                          | 结果                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 执行器自测 `npx vp test run --config accept/vitest.config.ts` | 7 个文件、131 条全过                                                                                                       |
| `npx tsgo --noEmit -p accept/tsconfig.json`                   | 无输出，退出码 0                                                                                                           |
| `npx vp fmt -c oxfmt.config.ts accept --check`                | 源码与 `mapping.md` 全部合格；仅有 4 个 `accept/.report/*.json`（gitignored 的运行产物）被扫到并报格式问题，与本次改动无关 |
| `npx vp lint -c oxlint.config.ts accept`                      | 0 error，91 条 warning；`constants.ts` 无告警，测试文件里的告警都在没改动的旧行                                            |

登记后 `npm run accept:dry` 的计划：2692 条，需执行 2254（http、fetch 各 1127），跳过 438。跳过理由分布与整轮逐项相同，只有 `missing mock-in-chain`（4）和 `missing keep-alive`（4）两项消失，所以不在这 3 个场景里的 2246 格的执行/跳过判定都没变，没有必要整轮重跑。

### 4.2 复跑

命令：`npm run accept -- --id basic.keep-alive-recovery-isolated,combo.cache-mock-fallback-cached-once,combo.mock-share-fallback-single-flight --verbose`（先 `vp pack`，jobs = 1，执行器自己的 id 过滤）。服务端沿用整轮那份临时目录二进制，端口 47180 / 47190。`requires` 含这两项能力的场景在 443 个里只有这 3 个。

| 场景                                      | 网络 × 风格 × adapter           | 格数 | 结果 |
| ----------------------------------------- | ------------------------------- | ---: | ---- |
| `basic.keep-alive-recovery-isolated`      | normal × http / business × 两个 |    4 | 4/4  |
| `combo.cache-mock-fallback-cached-once`   | normal × http × 两个            |    2 | 2/2  |
| `combo.mock-share-fallback-single-flight` | normal × http × 两个            |    2 | 2/2  |

共 8 项：**通过 8，失败 0，跳过 0**。产物 `accept/.report/report-2026-10-28T16-21-36-201Z.json`（gitignored）；这次复跑写入后，`latest.json` 指向这份，而不是整轮那份。

### 4.3 合计口径

| 口径                                 | 通过 | 失败 | 跳过 |
| ------------------------------------ | ---: | ---: | ---: |
| 整轮（登记前）                       | 2246 |    0 |  446 |
| 补充复跑（原在 446 个跳过里的 8 格） |   +8 |    0 |   −8 |
| **合计**                             | 2254 |    0 |  438 |

合计里的跳过 438 = 缺能力 368（446 − 8）+ not applicable 70，与登记后 dry 的计划一致。需要说明：2254 不是一次整轮跑出来的，是整轮加补充复跑拼出来的；整轮那一份报告 JSON 里这 8 格仍记为跳过。

场景口径：登记后 340 个场景全部执行、18 个部分跳过、85 个整场景跳过，即 358 个至少跑了一格。

## 5. 与旧 API 上一轮的对照

旧 API 末轮：`report-2026-10-28T02-47-08-531Z.json`，435 个场景、2648 条，服务端在 47080。

| 轮次                             | 总数 | 通过 | 失败 | 跳过 | 失败场景数 |
| -------------------------------- | ---: | ---: | ---: | ---: | ---------: |
| 旧 API 末轮（10-28 02:47Z）      | 2648 | 2147 |    9 |  492 |          4 |
| 新 API B7 首轮（10-28 14:02Z）   | 2692 | 2231 |   53 |  408 |         18 |
| 新 API B7 第二轮（10-28 14:51Z） | 2692 | 2246 |   38 |  408 |         15 |
| **本轮（10-28 16:12Z，最终）**   | 2692 | 2246 |    0 |  446 |          0 |

旧 API 末轮 9 个失败格在这轮的状态：

| 旧失败格                                                   | 整轮                          | 登记 `mock-in-chain` 后补充复跑 |
| ---------------------------------------------------------- | ----------------------------- | ------------------------------- |
| `auth.token-garbage-refresh-none` normal/http/fetch        | 通过                          | 不涉及                          |
| `combo.cache-mock-no-key-collision` 4 格                   | 4/4 通过                      | 不涉及                          |
| `combo.cache-mock-fallback-cached-once` normal/http 2 格   | 跳过（missing mock-in-chain） | 2/2 通过                        |
| `combo.mock-share-fallback-single-flight` normal/http 2 格 | 跳过（missing mock-in-chain） | 2/2 通过                        |

几点说明：

- 旧轮的 `auth.token-garbage-refresh-none`（fetch）是 `期望 expired，实际 network`，当时看像偶发；新 API 的三轮都通过。
- 跳过数从 492 到 446：旧轮有 140 格因当时"遇 429/503 立即停止"的约束被跳过，这轮已全部执行；另一头新增 56 格（场景自带 `skip` 32、testkit 新增的能力名 20、`missing breaker` 多出 4）加执行器两条规则 38 格，合计比旧轮少 46 格跳过。
- B7 首轮 53 个失败：D21 34 格 + blackhole 4 格，加 `filter.off-by-default-sends-as-is` 8 格、`key.share-without-key-not-merged` 4 格（这两项后来靠请求级 `filter: false` / `key: false` 在执行器里对齐，见 `accept/mapping.md`「与 axp 默认行为的对齐」），再加 `conc.barrier-64-desc-order` 3 格。`conc.barrier-64-desc-order` 是并发测量，只在首轮出现，第二轮和本轮都通过（本轮 conc 域 112/112），按测量噪声处理。
- 前两轮跑在当时的源码上（其后 `src/` 还有 4bef080、8875493 两个提交），只用来看收敛过程；本轮才是最终代码上的数字。第二轮的 38 个失败格就是 D21 与 blackhole 那 38 格，本轮它们按执行器规则（`2c990d2`）改判为不适用，其余格全部通过。

## 6. 测量环境

| 项           | 值                                                                                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| axp 提交     | 运行时 HEAD 为 `5769d7c`（分支 `jelon/axp-pipeline`，工作区干净）；`vp pack` 以此打包。其后 HEAD 前进到 `08f83a1`，只涉及 `docs/` 与 `CHANGELOG.md`，`src`、`accept`、`test`、`package.json` 无变化                                       |
| 执行器       | 提交 `2c990d2`（B7 验收执行器迁到新 API）；axp 包版本 0.2.0                                                                                                                                                                               |
| Node         | v24.11.0                                                                                                                                                                                                                                  |
| 并发度       | jobs = 1（默认串行）                                                                                                                                                                                                                      |
| 场景         | `E:\workspaces\api-ws-demo\testkit\scenarios`，443 个                                                                                                                                                                                     |
| 服务端源码   | api-ws-demo 提交 `d7146d8`；编译时工作区另有 3 个台账/脚本文件未提交（`testkit/COVERAGE.md`、`testkit/coverage/axp-api.json`、`testkit/tools/gen-coverage.mjs`），其后被提交为 `b035fc6`，`src/` 与 `Cargo.*` 与 `d7146d8` 无差异         |
| 服务端二进制 | 本机编译：`cargo build --release --locked --bin api-ws-demo --bin netem --target-dir <临时目录>`，2026-10-28 23:31:53 至 23:33:49（1 分 54 秒），cargo / rustc 1.96.0；用 `--locked` 保证不改 `Cargo.lock`                                |
| 为什么不复用 | 47080 / 47090 上在跑的服务（`target\release\api-ws-demo.exe`、`netem.exe`）二进制时间是 10-27 18:13，早于服务端源码最新改动（10-28 15:20），按 testkit AGENTS.md 不能复用；那两个进程不是本次启动的，没动                                 |
| 端口         | 测试服务器 `0.0.0.0:47180`（`PORT=47180`、`TEST_MODE=1`），netem 控制面 `127.0.0.1:47190`；环境变量 `TESTKIT_SERVER=http://127.0.0.1:47180`、`TESTKIT_NETEM=http://127.0.0.1:47190`；启动后 `/t/ping` 返回 `{"code":0}`，执行器预检也通过 |
| 运行时间     | 2026-10-28 23:34:32 至 2026-10-29 00:12:43（本机时间，UTC+8），38 分 11 秒，含 `vp pack`；各条运行耗时合计 2284 秒                                                                                                                        |
| 产物         | 整轮：`accept/.report/report-2026-10-28T16-12-43-088Z.json`；补充复跑：`report-2026-10-28T16-21-36-201Z.json`（都在 gitignored 的 `accept/.report/`），`latest.json` 现指向补充复跑这份                                                   |
| 补充复跑环境 | 2026-10-29 00:21 前后（本机时间）。工作区在 `5769d7c`/`08f83a1` 之上带有 `accept/` 的三处未提交改动（§4.1）；服务端沿用整轮那份临时目录二进制，端口与启动方式同上，`/t/ping` 返回 `{"code":0}`；`src/` 与整轮一致                         |
| 善后         | 整轮、中途的临时探测、补充复跑，三次自己启动的 api-ws-demo 与 netem 进程都已关闭，47180 / 47190 已释放；47080 / 47090 上不是我启动的进程没动                                                                                              |

## 7. 给 testkit 的反馈（只是建议，没改 testkit）

1. **D21 与 axp 新架构不兼容**。D21 的"未装 normalize 时业务码透传"在 axp 里不成立（归一化是内核能力，不可关闭），涉及 14 个场景 34 格：13 个 `plugins.single-<插件>` 的 business 风格，加 `basic.business-code-without-normalize` 的两种风格。建议二选一：给这个语义加一条能力声明（例如 `raw-business-code`），这 14 个场景 `requires` 它，不具备的执行器统一按缺能力跳过；或者把 `plugins.single-*` 在 business 风格下的期望改成"归一化后判失败"，让与 normalize 绑定的行为不依赖是否装了插件。
2. **`basic.status-matrix` 的 blackhole 档缺超时**。场景没有 `base_timeout_ms`，blackhole 下请求永远无法落定，却有请求被预期为 `timeout`。建议给场景补 `base_timeout_ms`，或在 blackhole 档的 `expect` 里写 `skip`。目前由执行器的通用规则跳过 4 格。
3. **17 个场景用了 `cancel_after_ms` 却没声明 `cancel` 能力**（已核实）。443 个场景里 37 个用了 `cancel_after_ms`，其中 17 个的 `requires` 没有 `cancel`：`plugins.single-{auth, envs, log, breaker, cache, loading, mock, normalize, notify, offline, filter, key, repath, retry, share, timeout}` 这 16 个（每个里面带一个 `cancel_after_ms: 10` 的取消请求）和 `breaker.half-open-probe-cancel`。没有取消能力的执行器会把它们当可执行场景，结果判错而不是跳过。`tools/validate.mjs` 已对 multipart / share-retry / `timeout.send_ms` 做"用了字段必须声明能力"的检查（DECISIONS D23），建议把 `cancel_after_ms` 同样纳入。

## 8. 遗留与待决

- testkit 三条反馈（§7）等 testkit 侧处理后，D21 与 blackhole 两条执行器规则可以随之删除（`inapplicableReason` 里对应的两个分支）。
- 执行器的改动（`accept/lib/constants.ts`、`accept/mapping.md`、`accept/unit/mapping-report.test.ts`）以及 `test-plan.md` §9.1 的场景数（改为 443 个、axp 可执行 358 个）都还没提交。
- 本轮没有失败，没有需要归因到 axp 实现、执行器映射或 testkit 场景的项。
