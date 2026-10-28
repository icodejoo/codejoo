---
title: axp 测试用例旧→新映射记录
status: draft
updated: 2026-10-28
summary: 测试迁移到六层结构时，每条用例的旧位置、新位置、动作和依据的审计记录。
---
## TL;DR

A 批（单插件规则/补丁/覆盖文件）迁移进行中，基线冻结于 8c12b94。记录规则见 [测试六层分类规范 §4](../guides/test-layers.md)。迁移完成后状态改为 `archived`，不删除。「批次核对」的提交列在批次落地后统一回填哈希。

## 基线（迁移开始时冻结）

| 项 | 值 |
|---|---|
| 冻结日期 | 2026-10-28 |
| 对应提交 | 8c12b94 |
| 用例总数（`vp test`） | 689（36 文件；含 3 条 expected fail、4 条 skip） |
| 通过数 | 682（另 3 expected fail） |
| `it.skip` 数 | 4 |

## 批次核对

| 批次 | 提交 | 旧总数 | drop | N/A | merge 减少 | split 增加 | 新增 | 新总数 | 平 |
|---|---|---|---|---|---|---|---|---|---|
| auth（auth.test、auth.coverage） | 本批提交 | 42 | 0 | 0 | 0 | 0 | 0 | 42 | 是 |
| retry（retry.test、retry.coverage） | 本批提交 | 74 | 0 | 0 | 0 | 0 | 0 | 74 | 是 |

## 映射

| 旧位置 | 新位置 | 动作 | 依据 | mirror |
|---|---|---|---|---|
| test/auth.test.ts::$normalize — 必填校验与缺省 > 缺 tokenManager / onRefresh / onAccessExpired → 抛错 | unit/auth.unit.test.ts::$normalize — 必填校验与缺省 > [auth.fn.$normalize][auth.cb.onRefresh][auth.cb.onAccessExpired][auth.opt.tokenManager] 缺 tokenManager / onRefresh / onAccessExpired → 抛错 | rename | 纯函数 $normalize 的必填校验，无 axios 实例 |  |
| test/auth.test.ts::$normalize — 必填校验与缺省 > onAccessDenied 缺省回退 onAccessExpired；默认 onFailure / ready 填充 | unit/auth.unit.test.ts::$normalize — 必填校验与缺省 > [auth.fn.$normalize][auth.cb.onAccessDenied][auth.cb.onFailure][auth.cb.ready] onAccessDenied 缺省回退 onAccessExpired；默认 onFailure / ready 填充 | rename | 纯函数 $normalize 的缺省填充 |  |
| test/auth.test.ts::$compileMethods > '*' → 恒真；'post' → 仅 post；数组 → 任一命中；空 → 恒假 | unit/auth.unit.test.ts::$compileMethods > [auth.fn.$compileMethods][auth.opt.methods] '*' → 恒真；'post' → 仅 post；数组 → 任一命中；空 → 恒假 | rename | 纯函数 |  |
| test/auth.test.ts::$compileUrlPatterns / $patternToRegex > '*' 恒真；'/user/*' 前缀；':id' 单段；'!' 否定 | unit/auth.unit.test.ts::$compileUrlPatterns / $patternToRegex > [auth.fn.$compileUrlPatterns][auth.opt.urlPattern] '*' 恒真；'/user/*' 前缀；':id' 单段；'!' 否定 | rename | 纯函数 |  |
| test/auth.test.ts::$compileUrlPatterns / $patternToRegex > $patternToRegex：:name 单段、* 任意 | unit/auth.unit.test.ts::$compileUrlPatterns / $patternToRegex > [auth.fn.$patternToRegex] $patternToRegex：:name 单段、* 任意 | rename | 纯函数 |  |
| test/auth.test.ts::authFailureFactory（默认 onFailure） > 非 401/403 → Others | unit/auth.unit.test.ts::authFailureFactory（默认 onFailure） > [auth.fn.authFailureFactory][auth.const.AuthFailureAction.Others] 非 401/403 → Others | rename | 默认 onFailure 是纯决策函数 |  |
| test/auth.test.ts::authFailureFactory（默认 onFailure） > 无 token：401 → Expired，403 → Deny | unit/auth.unit.test.ts::authFailureFactory（默认 onFailure） > [auth.fn.authFailureFactory][auth.const.AuthFailureAction.Expired][auth.const.AuthFailureAction.Deny] 无 token：401 → Expired，403 → Deny | rename | 单元层（unit） |  |
| test/auth.test.ts::authFailureFactory（默认 onFailure） > 未携带 token → Replay | unit/auth.unit.test.ts::authFailureFactory（默认 onFailure） > [auth.fn.authFailureFactory][auth.const.AuthFailureAction.Replay] 未携带 token → Replay | rename | 单元层（unit） |  |
| test/auth.test.ts::authFailureFactory（默认 onFailure） > 携带与当前一致 → Refresh；不一致 → Replay | unit/auth.unit.test.ts::authFailureFactory（默认 onFailure） > [auth.fn.authFailureFactory][auth.const.AuthFailureAction.Refresh][auth.const.AuthFailureAction.Replay] 携带与当前一致 → Refresh；不一致 → Replay | rename | 单元层（unit） |  |
| test/auth.test.ts::auth 集成 — 请求侧 > 受保护 + 有 token → 默认 ready 注入 Authorization 头 | rule/auth.rule.test.ts::auth 集成 — 请求侧 > [auth.cb.ready][auth.opt.tokenManager] 受保护 + 有 token → 默认 ready 注入 Authorization 头 | rename | 单插件声明过的默认行为：受保护请求注入凭证 |  |
| test/auth.test.ts::auth 集成 — 请求侧 > 受保护 + 无 token → onAccessDenied 调用并抛错 | rule/auth.rule.test.ts::auth 集成 — 请求侧 > [auth.cb.onAccessDenied] 受保护 + 无 token → onAccessDenied 调用并抛错 | rename | 无 token 的受保护请求走越权回调 |  |
| test/auth.test.ts::auth 集成 — 请求侧 > config.protected=false → 不受保护，直接放行（不注入） | rule/auth.rule.test.ts::auth 集成 — 请求侧 > [auth.req.protected] config.protected=false → 不受保护，直接放行（不注入） | rename | 请求级开关 |  |
| test/auth.test.ts::auth 集成 — 响应侧路由 > 业务成功 → 原样透传 | rule/auth.rule.test.ts::auth 集成 — 响应侧路由 > [auth.fn.axpAuth] 业务成功 → 原样透传 | rename | 业务成功响应透传 |  |
| test/auth.test.ts::auth 集成 — 响应侧路由 > 401 + token 一致 → Refresh：onRefresh 调一次 + 用同 config 重发 | rule/auth.rule.test.ts::auth 集成 — 响应侧路由 > [auth.cb.onRefresh][auth.const.AuthFailureAction.Refresh] 401 + token 一致 → Refresh：onRefresh 调一次 + 用同 config 重发 | rename | Refresh 动作：刷新后用同 config 重发 |  |
| test/auth.test.ts::auth 集成 — 响应侧路由 > Refresh 失败 → expired：tm.clear + onAccessExpired，原 error 透传 | rule/auth.rule.test.ts::auth 集成 — 响应侧路由 > [auth.cb.onRefresh][auth.cb.onAccessExpired][auth.cb.tokenManager.clear] Refresh 失败 → expired：tm.clear + onAccessExpired，原 error 透传 | rename | 刷新失败走 Expired，文档声明行为 |  |
| test/auth.test.ts::auth 集成 — 响应侧路由 > 已重放过一次仍失败 → 兜底 expired（防回环） | boundary/auth.boundary.test.ts::auth 集成 — 响应侧路由 > [auth.cb.onAccessExpired][auth.const.AuthFailureAction.Replay] 已重放过一次仍失败 → 兜底 expired（防回环） | rename | 防回环属于边缘兜底 |  |
| test/auth.test.ts::auth 集成 — 响应侧路由 > 并发刷新单飞：两个失败请求只触发一次 onRefresh | boundary/auth.boundary.test.ts::auth 集成 — 响应侧路由 > [auth.cb.onRefresh] 并发刷新单飞：两个失败请求只触发一次 onRefresh | rename | 并发单飞属于竞态 |  |
| test/auth.test.ts::auth — enable / 元信息 > 公开动作同时可作为值和类型使用 | unit/auth.unit.test.ts::auth — enable / 元信息 > [auth.const.AuthFailureAction] 公开动作同时可作为值和类型使用 | rename | 枚举值/类型双用，单对象 |  |
| test/auth.test.ts::auth — enable / 元信息 > enable:false → 不安装拦截器 | rule/auth.rule.test.ts::auth — enable / 元信息 > [auth.opt.enable] enable:false → 不安装拦截器 | rename | 总开关 |  |
| test/auth.test.ts::auth — enable / 元信息 > 工厂 .name === 'axp:auth' | rule/auth.rule.test.ts::auth — enable / 元信息 > [auth.const.name][auth.prop.name] 工厂 .name === 'axp:auth' | rename | 插件名 |  |
| test/auth.test.ts::$pathnameOf — 取 URL 的 pathname > 相对路径原样；去掉查询串与 hash | unit/auth.unit.test.ts::$pathnameOf — 取 URL 的 pathname > [auth.fn.$pathnameOf] 相对路径原样；去掉查询串与 hash | rename | 纯函数 |  |
| test/auth.test.ts::$pathnameOf — 取 URL 的 pathname > 绝对 URL 去掉 scheme://host(:port)；协议相对 URL 同理 | unit/auth.unit.test.ts::$pathnameOf — 取 URL 的 pathname > [auth.fn.$pathnameOf] 绝对 URL 去掉 scheme://host(:port)；协议相对 URL 同理 | rename | 单元层（unit） |  |
| test/auth.test.ts::$pathnameOf — 取 URL 的 pathname > 结果为空 → "/" | unit/auth.unit.test.ts::$pathnameOf — 取 URL 的 pathname > [auth.fn.$pathnameOf] 结果为空 → "/" | rename | 单元层（unit） |  |
| test/auth.test.ts::auth — cleanup 保留在途刷新状态 > 有在途刷新时 cleanup 不删状态：重装后的新闭包复用同一次刷新 | boundary/auth.boundary.test.ts::auth — cleanup 保留在途刷新状态 > [auth.method.cleanup][auth.cb.onRefresh] 有在途刷新时 cleanup 不删状态：重装后的新闭包复用同一次刷新 | rename | cleanup 与在途刷新的时序 |  |
| test/auth.test.ts::TokenManager — 存储不可用环境 > set/clear 不重置刷新许可，登录方必须显式恢复 | unit/token-manager.unit.test.ts::TokenManager — 存储不可用环境 > [public.member.TokenManager.canRefresh][public.member.TokenManager.set][public.member.TokenManager.clear] set/clear 不重置刷新许可，登录方必须显式恢复 | rename | TokenManager 单对象 |  |
| test/auth.test.ts::TokenManager — 存储不可用环境 > 访问 localStorage 抛 SecurityError：模块导入不崩，内存态照常工作 | unit/token-manager.unit.test.ts::TokenManager — 存储不可用环境 > [public.member.TokenManager.constructor] 访问 localStorage 抛 SecurityError：模块导入不崩，内存态照常工作 | rename | 存储不可用，单对象边缘 |  |
| test/auth.test.ts::TokenManager — 存储不可用环境 > getItem/setItem/removeItem 抛错（配额/隐私模式）：构造、写入、清除都不抛，内存态照常更新 | unit/token-manager.unit.test.ts::TokenManager — 存储不可用环境 > [public.member.TokenManager.constructor][public.member.TokenManager.set][public.member.TokenManager.clear] getItem/setItem/removeItem 抛错（配额/隐私模式）：构造、写入、清除都不抛，内存态照常更新 | rename | 单元层（unit） |  |
| test/auth.coverage.test.ts::auth — 业务失败的终态标记与原始错误 > %s 终态的已 resolve 业务响应带 authExpired（each） | rule/auth.rule.test.ts::auth — 业务失败的终态标记与原始错误 > [auth.cb.onAccessExpired][auth.cb.onFailure] %s 终态的已 resolve 业务响应带 authExpired | rename | authExpired 终态标记，单插件声明行为 |  |
| test/auth.coverage.test.ts::auth — 业务失败的终态标记与原始错误 > %s 不标记会话过期且保留 token（each） | rule/auth.rule.test.ts::auth — 业务失败的终态标记与原始错误 > [auth.cb.onFailure][auth.cb.tokenManager.clear] %s 不标记会话过期且保留 token | rename | 非 Expired 终态不标记且保留 token |  |
| test/auth.coverage.test.ts::auth — 业务失败的终态标记与原始错误 > Expired 拒绝路径保留原 AxiosError 和响应，并同时标记两处配置 | rule/auth.rule.test.ts::auth — 业务失败的终态标记与原始错误 > [auth.cb.onAccessExpired] Expired 拒绝路径保留原 AxiosError 和响应，并同时标记两处配置 | rename | Expired 拒绝路径保留原错误身份 |  |
| test/auth.coverage.test.ts::auth — 业务失败的终态标记与原始错误 > onFailure 抛错按 Others 放行，ready 抛错不破坏成功请求 | boundary/auth.boundary.test.ts::auth — 业务失败的终态标记与原始错误 > [auth.cb.onFailure][auth.cb.ready] onFailure 抛错按 Others 放行，ready 抛错不破坏成功请求 | rename | 异常回调 |  |
| test/auth.coverage.test.ts::auth — 业务失败的终态标记与原始错误 > protected 判定抛错回退 methods/urlPattern，未匹配请求不要求 token | boundary/auth.boundary.test.ts::auth — 业务失败的终态标记与原始错误 > [auth.cb.isProtected][auth.req.protected.callback] protected 判定抛错回退 methods/urlPattern，未匹配请求不要求 token | rename | protected 判定抛错，异常回调 |  |
| test/auth.coverage.test.ts::auth — 业务失败的终态标记与原始错误 > 受保护决策在重放时复用，不重复调用动态 protected | rule/auth.rule.test.ts::auth — 业务失败的终态标记与原始错误 > [auth.req.protected.callback] 受保护决策在重放时复用，不重复调用动态 protected | rename | 重放复用受保护决策 |  |
| test/auth.coverage.test.ts::auth — 业务失败的终态标记与原始错误 > 刷新窗口内被刷新失败阻断的请求也应标记 authExpired | boundary/auth.boundary.test.ts::auth — 业务失败的终态标记与原始错误 > [auth.cb.onRefresh][auth.cb.onAccessExpired] 刷新窗口内被刷新失败阻断的请求也应标记 authExpired | rename | 已知缺陷的 expected fail，原样保留 it.fails |  |
| test/auth.coverage.test.ts::auth — URLPattern 原生与回退路径 > 仅排除列表默认放行其他路径，空模式忽略 | unit/auth.unit.test.ts::auth — URLPattern 原生与回退路径 > [auth.fn.$compileUrlPatterns][auth.opt.urlPattern] 仅排除列表默认放行其他路径，空模式忽略 | rename | 纯函数 |  |
| test/auth.coverage.test.ts::auth — URLPattern 原生与回退路径 > 原生 URLPattern.test 抛错时返回 false | unit/auth.unit.test.ts::auth — URLPattern 原生与回退路径 > [auth.fn.$compileUrlPatterns] 原生 URLPattern.test 抛错时返回 false | rename | 单元层（unit） |  |
| test/auth.coverage.test.ts::auth — URLPattern 原生与回退路径 > 原生 URLPattern 构造失败回退正则，转义标点并支持单段参数 | unit/auth.unit.test.ts::auth — URLPattern 原生与回退路径 > [auth.fn.$patternToRegex][auth.fn.$compileUrlPatterns] 原生 URLPattern 构造失败回退正则，转义标点并支持单段参数 | rename | 单元层（unit） |  |
| test/auth.coverage.test.ts::auth — URLPattern 原生与回退路径 > 自定义凭证头名可从普通小写头读取 | unit/auth.unit.test.ts::auth — URLPattern 原生与回退路径 > [auth.fn.authFailureFactory][auth.fn.authFailureFactory.headerName] 自定义凭证头名可从普通小写头读取 | rename | 单元层（unit） |  |
| test/auth.coverage.test.ts::TokenManager — 正常持久化路径 > 恢复裸 token、写入和空值删除均同步存储，clear 不重置 canRefresh | unit/token-manager.unit.test.ts::TokenManager — 正常持久化路径 > [public.member.TokenManager.constructor][public.member.TokenManager.set][public.member.TokenManager.clear][public.member.TokenManager.canRefresh] 恢复裸 token、写入和空值删除均同步存储，clear 不重置 canRefresh | rename | 单元层（unit） |  |
| test/retry.test.ts::review #2 — 并发重试始终保留 share:false | combo/retry+share.combo.test.ts::[retry.opt.max × share.req.share] review #2 — 并发重试始终保留 share:false | rename | 两个插件交互：重试重发时 share:false 是否保留；review #2 |  |
| test/retry.test.ts::retry + cache — 失败后重试成功的那次写入缓存，后续请求命中缓存 | combo/cache+retry.combo.test.ts::[retry.opt.max × cache.req.cache.key] retry + cache — 失败后重试成功的那次写入缓存，后续请求命中缓存 | rename | 两个插件交互：重试成功的响应写入缓存 |  |
| test/retry.test.ts::$resolveMax > 请求级 number 优先 | unit/retry.unit.test.ts::$resolveMax > [retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 请求级 number 优先 | rename | 纯函数 |  |
| test/retry.test.ts::$resolveMax > 请求级对象 max 次之 | unit/retry.unit.test.ts::$resolveMax > [retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 请求级对象 max 次之 | rename | 纯函数 |  |
| test/retry.test.ts::$resolveMax > 请求级未指定 → 插件级 | unit/retry.unit.test.ts::$resolveMax > [retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 请求级未指定 → 插件级 | rename | 纯函数 |  |
| test/retry.test.ts::$resolveMax > 全部未指定 → 0 | unit/retry.unit.test.ts::$resolveMax > [retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 全部未指定 → 0 | rename | 纯函数 |  |
| test/retry.test.ts::$resolveMax > 请求级 number=0 显式禁用 | unit/retry.unit.test.ts::$resolveMax > [retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 请求级 number=0 显式禁用 | rename | 纯函数 |  |
| test/retry.test.ts::$resolveMax > 请求级 true → 走插件级（true 不是 number/对象，自然回落） | unit/retry.unit.test.ts::$resolveMax > [retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 请求级 true → 走插件级（true 不是 number/对象，自然回落） | rename | 纯函数 |  |
| test/retry.test.ts::$resolveMethods > 请求级对象优先 | unit/retry.unit.test.ts::$resolveMethods > [retry.fn.$resolveMethods][retry.opt.methods] 请求级对象优先 | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveMethods > 都未指定 → 默认幂等动词，不含 post/patch | unit/retry.unit.test.ts::$resolveMethods > [retry.fn.$resolveMethods][retry.opt.methods] 都未指定 → 默认幂等动词，不含 post/patch | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveShouldRetry > 请求级对象 shouldRetry 优先 | unit/retry.unit.test.ts::$resolveShouldRetry > [retry.fn.$resolveShouldRetry][retry.cb.shouldRetry] 请求级对象 shouldRetry 优先 | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveShouldRetry > 请求级 number → 走插件级 | unit/retry.unit.test.ts::$resolveShouldRetry > [retry.fn.$resolveShouldRetry][retry.cb.shouldRetry] 请求级 number → 走插件级 | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveShouldRetry > 都未指定 → undefined（不设默认值） | unit/retry.unit.test.ts::$resolveShouldRetry > [retry.fn.$resolveShouldRetry][retry.cb.shouldRetry] 都未指定 → undefined（不设默认值） | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveStatusCodes / $resolveAfterStatusCodes > $resolveStatusCodes 都未指定 → 默认 [408,429,500,502,503,504] | unit/retry.unit.test.ts::$resolveStatusCodes / $resolveAfterStatusCodes > [retry.fn.$resolveStatusCodes][retry.opt.statusCodes] $resolveStatusCodes 都未指定 → 默认 [408,429,500,502,503,504] | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveStatusCodes / $resolveAfterStatusCodes > $resolveAfterStatusCodes 都未指定 → 默认 [413,429,503] | unit/retry.unit.test.ts::$resolveStatusCodes / $resolveAfterStatusCodes > [retry.fn.$resolveAfterStatusCodes][retry.opt.afterStatusCodes] $resolveAfterStatusCodes 都未指定 → 默认 [413,429,503] | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveStatusCodes / $resolveAfterStatusCodes > 两者都支持请求级覆盖 | unit/retry.unit.test.ts::$resolveStatusCodes / $resolveAfterStatusCodes > [retry.fn.$resolveStatusCodes][retry.fn.$resolveAfterStatusCodes] 两者都支持请求级覆盖 | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > $resolveDelay 都未指定 → 默认 3000 | unit/retry.unit.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > [retry.fn.$resolveDelay][retry.opt.delay] $resolveDelay 都未指定 → 默认 3000 | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > $resolveDelay 请求级优先 | unit/retry.unit.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > [retry.fn.$resolveDelay][retry.opt.delay] $resolveDelay 请求级优先 | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > $resolveJitter 都未指定 → undefined（默认不抖动） | unit/retry.unit.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > [retry.fn.$resolveJitter][retry.opt.jitter] $resolveJitter 都未指定 → undefined（默认不抖动） | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > $resolveJitter 请求级优先 | unit/retry.unit.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > [retry.fn.$resolveJitter][retry.opt.jitter] $resolveJitter 请求级优先 | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > $resolveDelayMax 都未指定 → 默认不封顶 | unit/retry.unit.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > [retry.fn.$resolveDelayMax][retry.opt.delayMax] $resolveDelayMax 都未指定 → 默认不封顶 | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > $resolveDelayMax 请求级优先 | unit/retry.unit.test.ts::$resolveDelay / $resolveJitter / $resolveDelayMax > [retry.fn.$resolveDelayMax][retry.opt.delayMax] $resolveDelayMax 请求级优先 | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveRespectRetryAfter / $resolveRetryAfterMax > $resolveRespectRetryAfter 都未指定 → 默认 true | unit/retry.unit.test.ts::$resolveRespectRetryAfter / $resolveRetryAfterMax > [retry.fn.$resolveRespectRetryAfter][retry.opt.respectRetryAfter] $resolveRespectRetryAfter 都未指定 → 默认 true | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveRespectRetryAfter / $resolveRetryAfterMax > $resolveRespectRetryAfter 请求级优先 | unit/retry.unit.test.ts::$resolveRespectRetryAfter / $resolveRetryAfterMax > [retry.fn.$resolveRespectRetryAfter][retry.opt.respectRetryAfter] $resolveRespectRetryAfter 请求级优先 | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveRespectRetryAfter / $resolveRetryAfterMax > $resolveRetryAfterMax 都未指定 → 默认不封顶 | unit/retry.unit.test.ts::$resolveRespectRetryAfter / $resolveRetryAfterMax > [retry.fn.$resolveRetryAfterMax][retry.opt.retryAfterMax] $resolveRetryAfterMax 都未指定 → 默认不封顶 | rename | 单元层（unit） |  |
| test/retry.test.ts::$resolveRespectRetryAfter / $resolveRetryAfterMax > $resolveRetryAfterMax 请求级优先 | unit/retry.unit.test.ts::$resolveRespectRetryAfter / $resolveRetryAfterMax > [retry.fn.$resolveRetryAfterMax][retry.opt.retryAfterMax] $resolveRetryAfterMax 请求级优先 | rename | 单元层（unit） |  |
| test/retry.test.ts::$shouldRetry — 否决优先级 > retry:false → 硬性否决，无视 shouldRetry/statusCodes | unit/retry.unit.test.ts::$shouldRetry — 否决优先级 > [retry.fn.$shouldRetry][retry.req.retry] retry:false → 硬性否决，无视 shouldRetry/statusCodes | rename | 单元层（unit） |  |
| test/retry.test.ts::$shouldRetry — 否决优先级 > retry:{enable:false} → 跟 retry:false 等价 | unit/retry.unit.test.ts::$shouldRetry — 否决优先级 > [retry.fn.$shouldRetry][retry.req.retry.enable] retry:{enable:false} → 跟 retry:false 等价 | rename | 单元层（unit） |  |
| test/retry.test.ts::$shouldRetry — 否决优先级 > 方法不在白名单 → 否决，无视 shouldRetry | unit/retry.unit.test.ts::$shouldRetry — 否决优先级 > [retry.fn.$shouldRetry][retry.opt.methods] 方法不在白名单 → 否决，无视 shouldRetry | rename | 单元层（unit） |  |
| test/retry.test.ts::$shouldRetry — 否决优先级 > 方法在自定义 methods 里 → 放行给 shouldRetry/statusCodes 判断 | unit/retry.unit.test.ts::$shouldRetry — 否决优先级 > [retry.fn.$shouldRetry][retry.opt.methods] 方法在自定义 methods 里 → 放行给 shouldRetry/statusCodes 判断 | rename | 单元层（unit） |  |
| test/retry.test.ts::$shouldRetry — 否决优先级 > shouldRetry 返回明确 true/false 覆盖默认状态码判断 | unit/retry.unit.test.ts::$shouldRetry — 否决优先级 > [retry.fn.$shouldRetry][retry.cb.shouldRetry] shouldRetry 返回明确 true/false 覆盖默认状态码判断 | rename | 单元层（unit） |  |
| test/retry.test.ts::$shouldRetry — 否决优先级 > shouldRetry 返回 undefined → 退回状态码表 | unit/retry.unit.test.ts::$shouldRetry — 否决优先级 > [retry.fn.$shouldRetry][retry.cb.shouldRetry][retry.opt.statusCodes] shouldRetry 返回 undefined → 退回状态码表 | rename | 单元层（unit） |  |
| test/retry.test.ts::retry 集成 — 网络/HTTP 错误路径 > max=2：前两次 500、第三次成功 → 恢复，调用方只看到成功 | rule/retry.rule.test.ts::retry 集成 — 网络/HTTP 错误路径 > [retry.opt.max] max=2：前两次 500、第三次成功 → 恢复，调用方只看到成功 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — 网络/HTTP 错误路径 > max=0 → 不重试，直接 reject | boundary/retry.boundary.test.ts::retry 集成 — 网络/HTTP 错误路径 > [retry.opt.max] max=0 → 不重试，直接 reject | rename | max=0 属于零值边界 |  |
| test/retry.test.ts::retry 集成 — 网络/HTTP 错误路径 > 持续失败 → 耗尽重试后 reject 最后一次错误 | rule/retry.rule.test.ts::retry 集成 — 网络/HTTP 错误路径 > [retry.opt.max] 持续失败 → 耗尽重试后 reject 最后一次错误 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — 网络/HTTP 错误路径 > 耗尽次数时最后一次是已 resolve 的响应（shouldRetry 恒为 true）→ 原样 resolve 最后一次响应，不合成错误 | boundary/retry.boundary.test.ts::retry 集成 — 网络/HTTP 错误路径 > [retry.opt.max][retry.cb.shouldRetry] 耗尽次数时最后一次是已 resolve 的响应（shouldRetry 恒为 true）→ 原样 resolve 最后一次响应，不合成错误 | rename | 重试耗尽时的结算形态，边缘 |  |
| test/retry.test.ts::retry 集成 — 网络/HTTP 错误路径 > business 风格（HTTP 200 + 失败码）耗尽后 resolve 最后一次响应，交给下游 normalize 转成失败 | boundary/retry.boundary.test.ts::retry 集成 — 网络/HTTP 错误路径 > [retry.opt.max] business 风格（HTTP 200 + 失败码）耗尽后 resolve 最后一次响应，交给下游 normalize 转成失败 | rename | business 风格耗尽后的结算形态，边缘 |  |
| test/retry.test.ts::retry 集成 — 网络/HTTP 错误路径 > 默认 shouldRetry 只认状态码表，4xx（不在表里）不重试 | rule/retry.rule.test.ts::retry 集成 — 网络/HTTP 错误路径 > [retry.opt.statusCodes] 默认 shouldRetry 只认状态码表，4xx（不在表里）不重试 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — 网络/HTTP 错误路径 > 408/429 也在默认状态码表内，会重试 | rule/retry.rule.test.ts::retry 集成 — 网络/HTTP 错误路径 > [retry.opt.statusCodes] 408/429 也在默认状态码表内，会重试 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — methods 白名单 > post 默认不重试（即使状态码在表里） | rule/retry.rule.test.ts::retry 集成 — methods 白名单 > [retry.opt.methods] post 默认不重试（即使状态码在表里） | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — methods 白名单 > methods 显式包含 post 后可以重试 | rule/retry.rule.test.ts::retry 集成 — methods 白名单 > [retry.opt.methods] methods 显式包含 post 后可以重试 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — methods 白名单 > methods 白名单否决 shouldRetry 的明确 true | rule/retry.rule.test.ts::retry 集成 — methods 白名单 > [retry.opt.methods][retry.cb.shouldRetry] methods 白名单否决 shouldRetry 的明确 true | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — shouldRetry 业务异常路径 > 成功响应被判为业务异常时也触发重试 | rule/retry.rule.test.ts::retry 集成 — shouldRetry 业务异常路径 > [retry.cb.shouldRetry] 成功响应被判为业务异常时也触发重试 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — shouldRetry 业务异常路径 > 正常成功响应不触发重试 | rule/retry.rule.test.ts::retry 集成 — shouldRetry 业务异常路径 > [retry.cb.shouldRetry] 正常成功响应不触发重试 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — delay / jitter / delayMax > 自定义 delay 函数收到 (current, max, response?, err?) | rule/retry.rule.test.ts::retry 集成 — delay / jitter / delayMax > [retry.cb.delay][retry.opt.delay] 自定义 delay 函数收到 (current, max, response?, err?) | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — delay / jitter / delayMax > delay 函数返回非 number 视为 0（不等待） | boundary/retry.boundary.test.ts::retry 集成 — delay / jitter / delayMax > [retry.cb.delay] delay 函数返回非 number 视为 0（不等待） | rename | 回调返回非法值 |  |
| test/retry.test.ts::retry 集成 — delay / jitter / delayMax > 未指定 delay 时默认 3000ms（用 fake timer 验证不会提前触发重试） | rule/retry.rule.test.ts::retry 集成 — delay / jitter / delayMax > [retry.opt.delay] 未指定 delay 时默认 3000ms（用 fake timer 验证不会提前触发重试） | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — delay / jitter / delayMax > jitter:true 落在 [0, 原始 delay) 区间内 | rule/retry.rule.test.ts::retry 集成 — delay / jitter / delayMax > [retry.opt.jitter] jitter:true 落在 [0, 原始 delay) 区间内 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — delay / jitter / delayMax > jitter 函数返回值非有限数/负数时回退原始 delay | boundary/retry.boundary.test.ts::retry 集成 — delay / jitter / delayMax > [retry.cb.jitter] jitter 函数返回值非有限数/负数时回退原始 delay | rename | 回调返回非法值 |  |
| test/retry.test.ts::retry 集成 — delay / jitter / delayMax > delayMax 封顶抖动/计算后的 delay | rule/retry.rule.test.ts::retry 集成 — delay / jitter / delayMax > [retry.opt.delayMax] delayMax 封顶抖动/计算后的 delay | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — Retry-After 响应头 > 数字秒形式的 Retry-After 覆盖 delay | rule/retry.rule.test.ts::retry 集成 — Retry-After 响应头 > [retry.opt.respectRetryAfter] 数字秒形式的 Retry-After 覆盖 delay | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — Retry-After 响应头 > HTTP-date 形式的 Retry-After 也能解析 | rule/retry.rule.test.ts::retry 集成 — Retry-After 响应头 > [retry.opt.respectRetryAfter] HTTP-date 形式的 Retry-After 也能解析 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — Retry-After 响应头 > afterStatusCodes 之外的状态码不采信 Retry-After（照样走 delay） | rule/retry.rule.test.ts::retry 集成 — Retry-After 响应头 > [retry.opt.afterStatusCodes] afterStatusCodes 之外的状态码不采信 Retry-After（照样走 delay） | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — Retry-After 响应头 > retryAfterMax 封顶头给出的等待时长 | rule/retry.rule.test.ts::retry 集成 — Retry-After 响应头 > [retry.opt.retryAfterMax] retryAfterMax 封顶头给出的等待时长 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — Retry-After 响应头 > respectRetryAfter:false 时忽略响应头，走 delay | rule/retry.rule.test.ts::retry 集成 — Retry-After 响应头 > [retry.opt.respectRetryAfter] respectRetryAfter:false 时忽略响应头，走 delay | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — 取消 > 等待重试期间被取消 → 立刻停止等待并 reject，不会空等满整个 delay | boundary/retry.boundary.test.ts::retry 集成 — 取消 > [retry.fn.axpRetry] 等待重试期间被取消 → 立刻停止等待并 reject，不会空等满整个 delay | rename | 取消时机 |  |
| test/retry.test.ts::retry 集成 — 单请求 retry 字段的 number/false/true/对象 语义 > retry:false 显式禁用，即使插件级 max>0 | rule/retry.rule.test.ts::retry 集成 — 单请求 retry 字段的 number/false/true/对象 语义 > [retry.req.retry] retry:false 显式禁用，即使插件级 max>0 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — 单请求 retry 字段的 number/false/true/对象 语义 > retry:true 不覆盖，走插件级默认 | rule/retry.rule.test.ts::retry 集成 — 单请求 retry 字段的 number/false/true/对象 语义 > [retry.req.retry] retry:true 不覆盖，走插件级默认 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — 单请求 retry 字段的 number/false/true/对象 语义 > retry: { enable: false } 跟 retry:false 等价 | rule/retry.rule.test.ts::retry 集成 — 单请求 retry 字段的 number/false/true/对象 语义 > [retry.req.retry.enable] retry: { enable: false } 跟 retry:false 等价 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry 集成 — 单请求 retry 字段的 number/false/true/对象 语义 > retry 未指定时同 true，走插件级默认 | rule/retry.rule.test.ts::retry 集成 — 单请求 retry 字段的 number/false/true/对象 语义 > [retry.req.retry] retry 未指定时同 true，走插件级默认 | rename | 规则层（rule） |  |
| test/retry.test.ts::retry — max=0（默认）时不改写初始结果 > shouldRetry 恒真 + 200 响应 → 原样 resolve，不被改成 "exhausted retries" | boundary/retry.boundary.test.ts::retry — max=0（默认）时不改写初始结果 > [retry.opt.max] shouldRetry 恒真 + 200 响应 → 原样 resolve，不被改成 "exhausted retries" | rename | max=0 时不改写初始结果 |  |
| test/retry.test.ts::retry — max=0（默认）时不改写初始结果 > shouldRetry 恒真 + 500 → 原错误 reject（不是 exhausted），且不重发 | boundary/retry.boundary.test.ts::retry — max=0（默认）时不改写初始结果 > [retry.opt.max] shouldRetry 恒真 + 500 → 原错误 reject（不是 exhausted），且不重发 | rename | 边界层（boundary） |  |
| test/retry.coverage.test.ts::retry — 请求级空对象与插件级回退 > 全部解析器在 retry:{} 时回退插件值，零值与 false 不丢失 | unit/retry.unit.test.ts::retry — 请求级空对象与插件级回退 > [retry.fn.$resolveMethods][retry.fn.$resolveStatusCodes][retry.fn.$resolveAfterStatusCodes][retry.fn.$resolveDelay][retry.fn.$resolveJitter][retry.fn.$resolveDelayMax][retry.fn.$resolveRespectRetryAfter][retry.fn.$resolveRetryAfterMax] 全部解析器在 retry:{} 时回退插件值，零值与 false 不丢失 | rename | 纯函数，零值/false 边缘归 unit |  |
| test/retry.coverage.test.ts::retry — 请求级空对象与插件级回退 > 无响应的网络错误默认不重试，自定义判断可明确启用 | unit/retry.unit.test.ts::retry — 请求级空对象与插件级回退 > [retry.fn.$shouldRetry][retry.cb.shouldRetry] 无响应的网络错误默认不重试，自定义判断可明确启用 | rename | 纯函数 |  |
| test/retry.coverage.test.ts::retry — 请求级空对象与插件级回退 > 空方法和状态码列表显式否决，method 缺失按 get 处理 | unit/retry.unit.test.ts::retry — 请求级空对象与插件级回退 > [retry.fn.$shouldRetry][retry.opt.methods][retry.opt.statusCodes] 空方法和状态码列表显式否决，method 缺失按 get 处理 | rename | 纯函数 |  |
| test/retry.coverage.test.ts::retry — 请求级空对象与插件级回退 > methods 白名单按声明应不区分大小写 | unit/retry.unit.test.ts::retry — 请求级空对象与插件级回退 > [retry.fn.$shouldRetry][retry.opt.methods] methods 白名单按声明应不区分大小写 | rename | 纯函数 |  |
| test/retry.coverage.test.ts::retry — 循环终止与 Header 边界 > Retry-After=%s 无效或过去值不造成额外长等待（each） | boundary/retry.boundary.test.ts::retry — 循环终止与 Header 边界 > [retry.opt.respectRetryAfter] Retry-After=%s 无效或过去值不造成额外长等待 | rename | 无效 Retry-After 头 |  |
| test/retry.coverage.test.ts::retry — 循环终止与 Header 边界 > 重试得到不应重试的错误时立刻停止并返回该错误 | rule/retry.rule.test.ts::retry — 循环终止与 Header 边界 > [retry.cb.shouldRetry] 重试得到不应重试的错误时立刻停止并返回该错误 | rename | 不应重试的错误立刻停止 |  |
| test/retry.coverage.test.ts::retry — 循环终止与 Header 边界 > 错误无 config 时原样拒绝，不启动重试循环 | boundary/retry.boundary.test.ts::retry — 循环终止与 Header 边界 > [retry.fn.axpRetry] 错误无 config 时原样拒绝，不启动重试循环 | rename | 错误无 config |  |
| test/retry.coverage.test.ts::retry — 循环终止与 Header 边界 > 卸载后不重试，enable:false 不安装任何拦截器 | rule/retry.rule.test.ts::retry — 循环终止与 Header 边界 > [retry.opt.enable][retry.method.cleanup] 卸载后不重试，enable:false 不安装任何拦截器 | rename | 总开关与卸载 |  |
| test/retry.coverage.test.ts::retry — 循环终止与 Header 边界 > shouldRetry 抛错明确拒绝，不发出额外尝试 | boundary/retry.boundary.test.ts::retry — 循环终止与 Header 边界 > [retry.cb.shouldRetry] shouldRetry 抛错明确拒绝，不发出额外尝试 | rename | 异常回调 |  |
