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
