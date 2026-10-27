---
title: 2026-10-27 Codex 全量 review：终审与修复记录
status: active
updated: 2026-10-27
summary: 30 条 review 问题逐条的终审结论、修复方式和对外行为变化，用来追溯每条改动的来龙去脉
---

# 2026-10-27 Codex 全量 review：终审与修复记录

## TL;DR

- Codex 初审报了 30 条。终审后：P1 2 条，P2 14 条，P3 13 条，误报 1 条（#13）。
- 除误报外 29 条全部修复：测试 510 个通过，tsgo 0 错误。代码尚未提交。
- 对外行为有变化，发版前要写进 CHANGELOG，见文末「对外行为变化」一节。
- 后续：用 api-ws-demo 的 testkit 对这些修复做黑盒验收。
- 初审 = Codex，终审 = Claude，修复执行者见下文「流程」第 4 步。

## 流程

1. **初审**：Codex 只读通读整个包，effort 设为 high，共报出 30 条：P0 0 条，P1 5 条，P2 24 条，P3 1 条。原始报告由 Codex 产出，存放在会话 scratchpad，未纳入仓库，要点已经整理进下表。
2. **终审**：按模块分三组，派 sonnet 子代理只读核对。每一条都对照源码检查，能复现的写最小脚本复现，结论分为成立、误报、降级。
3. **修复范围**：用户先定了"P1+P2 修代码，P3 能顺手修的修"，随后改成"P3 也要改"。最终除 1 条误报外，其余 29 条全部修复。
4. **分批修复**：

   | 批次 | 执行者 | 范围 |
   |---|---|---|
   | A | sonnet 子代理 | cache、share、key、core、打包 |
   | B | Codex | auth、retry、cancel、mock、normalize、loading |
   | C | Codex | types、repath、e2e |
   | 补充批 | sonnet 子代理 | #7、#8 |

   每批交付后由 Claude 逐条审 diff。
5. **验证结果**：
   - `vp test run`：25 个文件，510 个用例通过，4 个跳过。基线是 18 个文件、414 个用例。
   - `tsgo --noEmit`：0 错误。修复前是退出码 2。
   - lint：error 从 77 个降到 31 个，剩余的都是存量，不是这次新引入的。

## 终审结论与修复

"终审级别"是终审后的结论，括号里是 Codex 初审时给的级别。

| # | 终审级别 | 问题 | 结论 | 修复 |
|---|---|---|---|---|
| 1 | P3（P1） | 缓存和 share 的 key 不区分登录身份 | 降级：key 只由 method、url、params、data 组成，这是 README 写明的设计 | key 新增 `scope` 选项，可传常量或函数；`clearCache` 让切换前已发出的请求返回后不再写回缓存。**auth 不自动清缓存**：刷新 token 时用户没变，自动清缓存属于误伤，账号切换由调用方处理 |
| 2 | P2（P1） | 全局 `mock:true` 时，单个请求设 `mock:false`，重试会丢掉这个设置 | 成立，降级：需要三个条件同时满足才触发 | mock 不再删除请求级配置；retry 保存并恢复请求级的 `share` |
| 3 | P2（P1） | 根入口和子路径是两套打包产物，`cancelAll`、`ApiError` 等在两边不是同一个对象 | 成立，降级：只在混用根入口和子路径时出问题 | `"."`、`main`、`module`、`types` 都改指向不打包的 `dist/esm/index.mjs`，并去掉 `production` 条件；压缩版只能通过 `./min` 显式引入 |
| 4 | **P1** | 生成的 `MethodRefs` 不满足 schema 约束，类型检查静默失效 | 成立 | 按 schema 的实际键检查结构，用 `NoInfer` 阻止错误参数被推断进去；**使用方需要 TypeScript 5.4 及以上** |
| 5 | **P1** | auth 重放会换掉取消信号，刷新期间调用 `cancelAll` 后请求照样发出 | 成立 | 重放沿用原来的 signal；刷新期间被取消的请求，刷新完成后以 CanceledError 结束；原始请求和重放请求的 controller 都会释放 |
| 6 | P3（P2） | auth 重放会把响应链再走一遍，导致重试预算翻倍、notify 触发两次 | 成立，降级 | 重放只经过鉴权这一步；retry、notify、normalize 只在外层执行一次 |
| 7 | P3（P2） | 重试过程中遇到 401 时绕过了 auth | 成立，降级：README 写明了重试走裸实例 | 新增 `helper.registerAttemptHook` 和 `runAttempt`：重试和鉴权重放的每一次网络尝试都会经过 auth 的单次尝试钩子 |
| 8 | P3（P2） | 重试和重放会再执行一次 `transformRequest` | 成立，降级：默认的转换函数重复执行没有影响 | `captureRawRequest` 把记录函数插到 `transformRequest` 的最前面，保存转换前的原始 data；`withRawRequest` 在重发时把 data 还原回去 |
| 9 | P2 | share 失败时所有调用方拿到同一个 error 对象，`error.config` 都指向第一个请求 | 成立 | `$rebindError` 给每个调用方生成独立的 error，保留原型，并把 `config` 换成调用方自己的 |
| 10 | P3（P2） | share 跟随请求不响应自己的取消和超时 | 成立，降级 | `$follow`：每个跟随者各自监听 signal、cancelToken、timeout，触发时立刻退出 |
| 11 | P2 | `cache` + `share:end` 时，较晚返回的旧响应会覆盖缓存 | 成立 | 写入时比较请求发起序号 `seq`，发起更晚的请求已经写入时，旧响应不再写 |
| 12 | P2 | 缓存的响应会被 `transformResponse` 原地修改，命中时数据被转换两次 | 成立 | 缓存 adapter 返回的原始快照，每次命中返回新的外层对象 |
| 13 | – | `cache:true` 不使用插件级的 clone 策略 | **误报**：源码注释写明 `cache:true` 就是共享引用 | 未改 |
| 14 | P3（P2） | 过期缓存不会主动删除，也没有容量上限 | 成立，降级：进程内 Map 是已知的取舍 | 新增 `max` 选项，默认 500，按最近最少使用淘汰；每次写入时顺带清理过期项 |
| 15 | P3（P2） | 业务失败的响应也被缓存 | 成立，降级：cache 在 adapter 层，本来就早于 normalize 执行 | 新增 `shouldCache` 选项；默认判定沿用 normalize 的成功标准（`AxpResponse.successful`），失败响应不缓存 |
| 16 | P2 | 深度 key 把 Date 当成空值，不同日期得到同一个 key | 成立 | Date 和 URLSearchParams 按内容参与哈希；FormData、Blob、Map、Set 以及没有可枚举字段的类实例无法可靠区分，这类请求不生成 key，也就不缓存、不共享 |
| 17 | P2 | `extends()` 生成的子实例带走了父实例的插件 adapter | 成立：和 README"不会带走插件"的说法矛盾 | `extends()` 改用 `getBaseAdapter`，也就是未经插件包装的底层 adapter |
| 18 | P3（P2） | 多个插件 handle 不按后装先卸的顺序卸载时，会互相覆盖 adapter | 成立，降级 | `helper.wrapAdapter`：adapter 改成分层链，每一层可以按任意顺序单独移除；cache、share、loading、mock 都接入了这个机制 |
| 19 | P3（P2） | loading 回调抛错会让请求失败，计数也卡住 | 成立，降级 | 回调抛出的同步和异步异常都被隔离，不影响请求和计数 |
| 20 | P3（P2） | 卸载 loading 插件时没有清理定时器 | 成立，降级 | dispose 时清理定时器，之后旧请求不再触发 UI 回调 |
| 21 | P2 | loading 按每次 adapter 调用计数，重试等待期间 loading 会闪一下 | 成立 | 按一次逻辑请求计数：用字符串键 `axp:loading:complete` 跨重试保持状态，最终响应时才释放 |
| 22 | P2 | repath 把查询串算进变量名、同一变量出现两次只替换第一次、变量值没有编码 | 成立 | 只在 pathname 部分替换；全部替换完再统一删除参数里的键；变量值用 `encodeURIComponent` 编码 |
| 23 | P2 | Core 把 `loading` 选项的类型收窄成了 boolean | 成立 | 删掉这个收窄，直接继承 AxiosRequestConfig 扩展后的完整类型 |
| 24 | P2 | 请求级 `normalize:false` 不生效 | 成立 | 请求级开关、`{enable:false}` 和函数写法都会生效 |
| 25 | P3（P2） | `canRefresh` 从来没有参与刷新判断 | 成立，降级 | 刷新前先检查 `canRefresh`；判定过期后置为 false，由登录方负责改回 true |
| 26 | P3（P2） | wrap 模式下，没有信封的响应 data 变成 null | 成立，降级 | 先识别响应是否是信封；不是信封时，原始 body 原样放进 data |
| 27 | P2 | 仓库自带配置下 tsgo 类型检查不通过 | 成立 | core 的参数属性改成显式字段；auth 的 enum 改成 const 对象加同名类型，对外用法兼容；cancel 改用 `GenericAbortSignal`；顺带清理测试文件里的类型错误 |
| 28 | P2 | e2e runner 和 playground 的动作 ID 对不上 | 成立 | 两边对齐，删掉没有实现的 `share-retry` 用例 |
| 29 | P2 | e2e 的命中计数是写死的常量，断言会假通过 | 成立 | 改用本地可控的 mock-server，真实读取命中计数；本机真浏览器还没跑，后续由 testkit 取代 |
| 30 | P3 | 本地类型扩展模板扩展的是 `PathRefs`，Core 实际读取的是 `MethodRefs` | 成立，降级 | 模板改成 `LocalMethodRefs extends MethodRefs`，再用交叉类型扩展 |

## 对外行为变化（发版时需写进 CHANGELOG）

- 根入口改为不打包产物，去掉 `production` 条件（#3）。
- 缓存新增 `max`（默认 500）和 `shouldCache`；默认不再缓存业务失败的响应（#14、#15）。
- key 新增 `scope`；FormData、Blob、Map、Set 等值不再生成 key（#1、#16）。
- `extends()` 不再继承插件（#17），repath 会对变量值编码（#22），`canRefresh` 现在真正参与刷新判断（#25）。
- `AuthFailureAction` 从 enum 改为 const 对象，调用方式不变（#27）。
- 类型推断需要 TypeScript 5.4 及以上（#4）。

## 后续

- 本次暴露的问题大多和插件组合、并发、网络异常有关，单测覆盖不到。为此建了跨语言的黑盒验收设施 testkit，
  位于 api-ws-demo 仓库的 `testkit/`，决策过程见那里的 `DECISIONS.md`。axp 的执行器接入后，会用它把上面这些修复再验收一遍。

## 第二轮：跨批次整体审查（2026-10-27）

三批修复是并行完成的，单批审查看不到批次之间的交互，所以修复合入后又让 Codex（high）按未提交的 diff 整体审了一遍。
重点看的交叉点有：adapter 分层链、单次尝试机制、cache 与 share 的组合、打包导出。

| # | 终审级别 | 问题 | 结论 |
|---|---|---|---|
| R2-1 | P3（P2） | `captureRaw` 只保存了原始 data 的引用，如果 `transformRequest` 原地修改 data，重试时的请求体仍会变化 | 成立；原地修改输入的转换函数本身不规范，所以降级 |
| R2-2 | P3（P2） | 条目被 LRU 淘汰后，seq 屏障随之消失，旧响应会重新写入缓存 | 成立；要同时满足容量很小、share 用 end 策略、淘汰恰好落在时间窗口内才会触发 |
| R2-3 | P2 | adapter 已成功返回，`transformResponse` 却抛出不带 config 的错误，loading 计数永久泄漏 | 成立；loading 一直不消失，用户能直接看到 |
| R2-4 | P3（P2） | 同一个实例装了两层 loading 时，两层共用完成键，内层会覆盖外层的完成回调 | 成立；这种用法少见 |

审查中实测通过的部分：
- adapter 四层的 24 种卸载顺序；
- adapter 被外部替换后调用 `extends()`；
- `500 → 重试时 401 → 刷新 → 200` 的完整链路；
- exports 声明的路径都存在。

修复情况：4 条全部修复，每条都先写复现用例、再改代码。全量测试 515 个通过，tsgo 0 错误。

| # | 修法 |
|---|---|
| R2-1 | `helper.ts` 新增 `isPlainData` / `cloneData`：普通对象和数组用 structuredClone 存一份快照，重发时再拷贝一份。FormData、Blob 等类型仍保持引用传递 |
| R2-2 | `cache.ts` 新增两张表：`written`（每个 key 已写入的最大 seq）和 `inflight`（每个 key 的在途请求数）。屏障和缓存条目分开存，key 不再有在途请求、条目也已被淘汰时才回收这个 key 的屏障记录 |
| R2-3 | `loading.ts` 新增 `guardTransform`：把本次请求 config 上的每个 `transformResponse` 包一层，抛错时如果错误对象上没有 config，就补上本次 config 再抛出。已知限制：错误不是对象或者是只读对象时补不上 |
| R2-4 | `loading.ts` 的完成键改为 `axp:loading:complete:<层序号>`，每层只释放自己的 |

## 待优化（下次一起做）

提交前做了一轮 diff-simplify，从复用、简化、效率、修复层级四个角度审查。低风险的问题已经当场修掉；下面这些要改架构或新增 API，用户决定 2026-10-27 记录在案，下次优化时一起处理。

| # | 事项 | 现状 | 建议方向 | 涉及 |
|---|---|---|---|---|
| O1 | 统一快照"可重放的请求级配置" | retry、auth 各自用 `axp:share` 字符串键保存 `config.share`；原始请求体走 `axp:rawRequest` | 在单次尝试机制里，首次进入插件链时统一快照 share、mock、loading、data，重放时整体还原；或者让 share、mock 只读取配置、不删除 | helper、retry、auth、share、mock |
| O2 | 在 core 层统一给最终的 reject 补上 config | loading 的 `guardTransform`、auth 的 `$throwIfCanceled`、normalize，都在各自代码里手动挂 config | 在 dispatch 外层统一做 `err.config ??= config`，删掉三处手动挂载 | core、loading、auth、normalize |
| O3 | cache 的四张表收敛 | `seq`、`epoch`、`written`、`inflight` 分开维护，各自做回收 | `written` 和 `inflight` 合并为 `Map<key, {latestSeq, pending}>` | cache |
| O4 | `canRefresh` 收回 auth 内部 | 失败冻结状态写在用户传入的 TokenManager 上，登录后要手动重置 | 收进 `refreshStates` 的窗口状态，token 写入时自动重置 | auth、TokenManager |
| O5 | axp 增加"逻辑状态"概念 | 业务码风格（HTTP 200 + code）下，auth、retry、notify 都只看 HTTP 状态码；验收执行器在 `accept/lib/client-factory.ts` 里替 axp 补了适配，会掩盖这个缺口 | 新增 `statusOf(response)` 选项，或者由 normalize 暴露 `ApiError.status`，auth、retry、notify 统一读它。做完后删掉执行器里的适配，让验收直接测 axp 自身的能力 | auth、retry、notify、normalize、accept |
| O6 | 效率小项 | 缓存每次写入都要全量清扫过期项（≤500 条）；每个请求都对请求体做一次 structuredClone；`transformResponse` 每个请求都新建包装闭包 | 过期项惰性删除或节流清扫；有重放可能时才克隆；包装只做一次 | cache、helper、loading |

关联的待办（testkit 方面）：
- 执行器发现了几处契约缺口，下次补成 D12：
  - flap 时间表怎么下发、从什么时候开始算；
  - `key:true` 是否包含查询参数；
  - cache 的 `methods` 默认值是什么；
  - log 回显 `X-Test-Req`，让 `from_cache` 能精确按请求关联，不靠推断；
  - 同一用户再次登录时，旧的 refresh 是否失效；
  - 预设的作用范围。
- 首次端到端验收（`npm run accept`）还没跑。按执行器预判，可能失败的有：
  - 并发刷新失败时，`expired` 被重复回调；
  - share 首发请求被取消时，跟随者被连带取消；
  - POST 请求也被缓存。
