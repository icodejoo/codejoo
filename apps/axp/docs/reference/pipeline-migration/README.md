---
title: axp 洋葱管线旧测试行为迁移总表
status: active
updated: 2026-10-28
summary: 汇总旧测试逐声明去向、计数差异、删除机制和需终审的存疑行为
---

## TL;DR

- 90 个旧测试文件全部登记，实际 **836 处声明、展开 1002 条**。
- keep 346、change 423、drop 67，没有丢行。
- 给定的 822 处漏计 14 处双引号标题；下方列出原位置，不删用例凑数。
- 本批只归档旧测试，不实现新架构；mirror 均留空。
- 40 条【存疑】已于 2026-10-28 终审裁决，见「终审裁决」一节。

## 明细入口

- [unit 行为清单](unit.md)。
- [rule 行为清单](rule.md)。
- [boundary 行为清单](boundary.md)。
- [combo 行为清单](combo.md)。
- [integration 行为清单](integration.md)。

每层明细均少于 400 行，无需按插件拆分。新位置遵循 [六层判定](../../guides/test-layers.md)：纯函数归 unit，单插件契约归 rule，竞态/极端值归 boundary，多插件交互归 combo，真实环境/装配/类型归 integration。旧文件中重复行为暂不合并；后续重写时同一新行为可由一条用例承接多行旧记录。

## 计数核对

| 层          | keep | change | drop | 声明数 | 展开数 |
| ----------- | ---: | -----: | ---: | -----: | -----: |
| unit        |  141 |     77 |    9 |    227 |    268 |
| rule        |  107 |    133 |   14 |    254 |    279 |
| boundary    |   78 |    173 |   27 |    278 |    358 |
| combo       |   15 |     18 |    0 |     33 |     37 |
| integration |    5 |     22 |   17 |     44 |     60 |
| 合计        |  346 |    423 |   67 |    836 |   1002 |

完整公式：`836 = 346 + 423 + 67`；展开：`1002 = 836 + 166`。

原始口径：`822 = 836 - 14`。 原 822 口径的动作核对也成立：`822 = 334 keep + 421 change + 67 drop`；补记 14 行为 `12 keep + 2 change`。单引号 it 声明 759 处、it.each 声明 62 处、无插值模板字符串 it 声明 1 处，合计 822；另有双引号 it 声明 14 处，必须补入。正则若只按行首 it/test 字样数会得到 837，其中一行是 URLPattern 替身的 `test()` 方法定义，不是用例。已用 TypeScript 语法树独立核对声明、describe 全名、常量拼接标题、each 数组及展开数组；未运行旧测试。

因此题设 `822 = keep + change + drop` 不能用于全声明清单。若坚持该等式，会恰好漏掉下列 14 处。保留原数字作为审计输入，完整核对采用 836。

### 822 口径漏记的 14 处

- unit/auth.unit.test.ts::$compileMethods &gt; [auth.fn.$compileMethods][auth.opt.methods] '\*' → 恒真；'post' → 仅 post；数组 → 任一命中；空 → 恒假。
- unit/auth.unit.test.ts::$compileUrlPatterns / $patternToRegex &gt; [auth.fn.$compileUrlPatterns][auth.opt.urlPattern] '_' 恒真；'/user/_' 前缀；':id' 单段；'!' 否定。
- unit/cache.unit.test.ts::$resolveCloneFn / $shallowClone — 拷贝策略解析 &gt; [cache.fn.$resolveCloneFn][cache.opt.clone] 'shallow' → 浅拷贝函数（仅顶层）。
- unit/cache.unit.test.ts::$resolveCloneFn / $shallowClone — 拷贝策略解析 &gt; [cache.fn.$resolveCloneFn][cache.opt.clone] 'deep' → structuredClone 深拷贝（完整隔离）。
- rule/auth.rule.test.ts::auth — enable / 元信息 &gt; [auth.const.name][auth.prop.name] 工厂 .name === 'axp:auth'。
- rule/auth.rule.test.ts::auth 集成 — urlPattern 按 pathname 匹配 &gt; [auth.opt.urlPattern] urlPattern:'/me' 命中绝对 URL 与带查询串的 URL，不命中其它路径。
- rule/cache.rule.test.ts::cache 集成 — clone 策略 &gt; [cache.opt.clone][cache.req.cache.clone] clone:'shallow' → 顶层隔离，嵌套仍共享。
- rule/cache.rule.test.ts::cache 集成 — clone 策略 &gt; [cache.opt.clone][cache.req.cache.clone] clone:'deep' → 完整隔离，就地改任意层都不污染缓存。
- rule/filter.rule.test.ts::filter — 安装、卸载与请求级覆盖（真实 axios） &gt; [filter.prop.name] 插件实例 name 为 'axp:filter'。
- rule/mock.rule.test.ts::mock — 开关、请求级覆盖与卸载（真实 axios） &gt; [mock.prop.name] 插件实例 name 为 'axp:mock'。
- rule/normalize.rule.test.ts::normalize — 成功路径 &gt; [normalize.fn.axpNormalize] 业务成功（code='0000'）→ 原样返回。
- rule/normalize.rule.test.ts::normalize — 元信息 &gt; [normalize.prop.name] 工厂 .name 对齐插件名 'axp:normalize'。
- rule/notify.rule.test.ts::notify — 安装/卸载与请求级 silent（真实 axios） &gt; [notify.prop.name] 插件实例 name 为 'axp:notify'。
- rule/repath.rule.test.ts::repath — 安装/卸载（真实 axios） &gt; [repath.prop.name] 插件实例 name 为 'axp:repath'。

## drop 按机制分组

删除依据只针对机制本身；行为仍存在的已另判 keep/change，例如重试请求体一致性、卸载不影响剩余插件、派生状态隔离。

### authFailureFactory 与头解析（2）

- unit/auth.unit.test.ts::auth — URLPattern 原生与回退路径 &gt; [auth.fn.authFailureFactory][auth.fn.authFailureFactory.headerName] 自定义凭证头名可从普通小写头读取 — authFailureFactory 的自定义凭证头路由已删除（plugin-spec §5 变化）；默认 token 比较由 defaultAuthFailure 的状态键保证。
- boundary/auth.boundary.options.test.ts::auth — authFailureFactory 边界 &gt; [auth.fn.authFailureFactory.headerName] headerName 自定义大小写/空串：精确名优先、小写兜底；空串名取不到值 → Replay — authFailureFactory 的自定义凭证头路由已删除（plugin-spec §5 变化）；默认 token 比较由 defaultAuthFailure 的状态键保证。

### bag.ts（2）

- unit/bag.unit.test.ts::bag — 私有数据生命周期 &gt; [bag.getInternal][bag.setInternal][bag.delInternal] 读删不存在的 bag 不创建任何属性 — bag.ts 私有配置袋机制删除（D1；core-architecture §5、§12）；新逻辑请求状态由类型化 stateKey/get/set 隔离，不依赖 axios 合并。
- unit/bag.unit.test.ts::bag — 私有数据生命周期 &gt; [bag.getInternal][bag.setInternal][bag.delInternal] 覆写与删除只影响对应 config，枚举、展开与 axios 合并均不可见 — bag.ts 私有配置袋机制删除（D1；core-architecture §5、§12）；新逻辑请求状态由类型化 stateKey/get/set 隔离，不依赖 axios 合并。

### cache 动态 key（7）

- unit/cache.unit.test.ts::$resolveKey &gt; [cache.fn.$resolveKey][cache.req.cache.key] 请求级函数次之 — 旧 cache key 函数配置已不在新契约内（plugin-spec §0、§6.3 / N5）；显式字符串 key 和 key 服务承担分区行为。
- unit/cache.unit.test.ts::$resolveKey &gt; [cache.fn.$resolveKey][cache.cb.key] 插件级函数再次之 — 旧 cache key 函数配置已不在新契约内（plugin-spec §0、§6.3 / N5）；显式字符串 key 和 key 服务承担分区行为。
- unit/cache.unit.test.ts::cache — 解析与错误边界 &gt; [cache.fn.$resolveKey][cache.cb.key] 空 key 函数显式禁用缓存，不回退 config.key；空字符串可回退 — 旧 cache key 函数配置已不在新契约内（plugin-spec §0、§6.3 / N5）；显式字符串 key 和 key 服务承担分区行为。
- rule/cache.rule.options.test.ts::cache — 请求级 cache.key 回调 &gt; [cache.req.cache.key.callback] 回调拿到本次 config，返回值作为缓存 key（优先于 config.key） — 旧 cache key 函数配置已不在新契约内（plugin-spec §0、§6.3 / N5）；显式字符串 key 和 key 服务承担分区行为。
- boundary/cache.boundary.test.ts::cache — 选项与回调边界 &gt; [cache.req.cache.key][cache.cb.key] key 回调返回 undefined/空串 → 不缓存且不回退 config.key — 旧 cache key 函数配置已不在新契约内（plugin-spec §0、§6.3 / N5）；显式字符串 key 和 key 服务承担分区行为。
- boundary/cache.boundary.test.ts::cache — 选项与回调边界 &gt; [cache.cb.key] 插件级 key 回调抛错 → 请求以该错误拒绝且不发出；后续请求不受影响 — 旧 cache key 函数配置已不在新契约内（plugin-spec §0、§6.3 / N5）；显式字符串 key 和 key 服务承担分区行为。
- boundary/cache.boundary.test.ts::cache — 选项与回调边界 &gt; [cache.req.cache.key.callback] 请求级 key 回调抛错 → 以该错误拒绝且不发出；返回 undefined → 直通不缓存 — 旧 cache key 函数配置已不在新契约内（plugin-spec §0、§6.3 / N5）；显式字符串 key 和 key 服务承担分区行为。

### captureRawRequest（1）

- unit/helper.unit.test.ts::helper — 原始请求体与单次尝试钩子 &gt; [helper.captureRawRequest][helper.withRawRequest] 重复 captureRawRequest 不重复插入捕获项，未捕获配置返回新外壳 — captureRawRequest 的重复包装和外壳机制删除（D1；plugin-spec §4 变化）；请求体一致性由 transport 按需克隆保证。

### share 响应与错误重绑（5）

- unit/share.unit.test.ts::share — 订阅清理与错误属性 &gt; [share.fn.$rebindResponse][share.fn.$rebindError] 相同 config 的响应和错误保持身份，不同 config 保留不可枚举属性与原型 — share 的 $rebindResponse/$rebindError 删除（plugin-spec §6.2）；所有订阅者共享同一只读 R，调用方请求从 ctx.request 获取。
- boundary/share.boundary.policy.test.ts::share — 响应外壳与清理边界 &gt; [share.fn.$rebindResponse] 冻结响应仍能重绑，保留原始响应和共享 data — share 的 $rebindResponse/$rebindError 删除（plugin-spec §6.2）；所有订阅者共享同一只读 R，调用方请求从 ctx.request 获取。
- boundary/share.boundary.test.ts::share — 失败时每个订阅者拿到独立 error &gt; [share.fn.$rebindError] 非对象错误原样传递 — share 的 $rebindResponse/$rebindError 删除（plugin-spec §6.2）；所有订阅者共享同一只读 R，调用方请求从 ctx.request 获取。
- boundary/share.boundary.test.ts::share — 订阅清理与错误属性 &gt; [share.fn.$rebindError] 冻结 AxiosError 仍应重绑为 follower 的独立错误 — share 的 $rebindResponse/$rebindError 删除（plugin-spec §6.2）；所有订阅者共享同一只读 R，调用方请求从 ctx.request 获取。
- boundary/share.boundary.test.ts::share — 订阅清理与错误属性 &gt; [share.fn.$rebindError] 冻结错误和响应保留原值与错误原型 — share 的 $rebindResponse/$rebindError 删除（plugin-spec §6.2）；所有订阅者共享同一只读 R，调用方请求从 ctx.request 获取。

### TokenManager.canRefresh（2）

- unit/token-manager.unit.test.ts::TokenManager — 存储不可用环境 &gt; [public.member.TokenManager.canRefresh][public.member.TokenManager.set][public.member.TokenManager.clear] set/clear 不重置刷新许可，登录方必须显式恢复 — TokenManager.canRefresh 删除（plugin-spec §8、§5 O4）；刷新许可由 auth 的 token 快照状态保证。
- boundary/token-manager.boundary.test.ts::TokenManager — 边界 &gt; [public.member.TokenManager.canRefresh] canRefresh 默认 true，可赋任意布尔，实例间互不影响 — TokenManager.canRefresh 删除（plugin-spec §8、§5 O4）；刷新许可由 auth 的 token 快照状态保证。

### 拦截器与 adapter 安装形态（3）

- rule/auth.rule.options.test.ts::auth — 插件契约（install / cleanup） &gt; [auth.method.install] install 注册请求与响应拦截器并返回 cleanup 函数 — 旧 install 注册拦截器/包装 adapter 的数量与形态删除（D1、core-architecture §8）；新插件由 setup/handle 接入。
- rule/cache.rule.options.test.ts::cache — 插件契约（name / install / cleanup） &gt; [cache.method.install] install 把 adapter 包成新函数并返回 cleanup，缓存仓随之可用 — 旧 install 注册拦截器/包装 adapter 的数量与形态删除（D1、core-architecture §8）；新插件由 setup/handle 接入。
- rule/cancel.rule.test.ts::cancel — 插件契约（install / cleanup / name / reason） &gt; [cancel.method.install] install 注册一个请求拦截器和一个响应拦截器，并返回 cleanup 函数 — 旧 install 注册拦截器/包装 adapter 的数量与形态删除（D1、core-architecture §8）；新插件由 setup/handle 接入。

### 鉴权合成业务码（3）

- rule/auth.rule.options.test.ts::auth — accessDeniedCode / 默认常量 &gt; [auth.const.ACCESS_DENIED_CODE] 常量值为 ACCESS_DENIED — ACCESS_DENIED_CODE/accessDeniedCode 合成业务码机制删除（plugin-spec §5 变化）；拒绝改 ctx.fail({kind:auth,reason:unauthenticated})。
- rule/auth.rule.options.test.ts::auth — accessDeniedCode / 默认常量 &gt; [auth.opt.accessDeniedCode][auth.const.ACCESS_DENIED_CODE] 无 token 时合成响应的 data.code：缺省为 ACCESS_DENIED，可自定义 — ACCESS_DENIED_CODE/accessDeniedCode 合成业务码机制删除（plugin-spec §5 变化）；拒绝改 ctx.fail({kind:auth,reason:unauthenticated})。
- boundary/auth.boundary.options.test.ts::auth — 回调抛错与 accessDeniedCode 边界 &gt; [auth.opt.accessDeniedCode] 空串 → 原样用作 code（不回退默认）；undefined → 默认 ACCESS_DENIED — ACCESS_DENIED_CODE/accessDeniedCode 合成业务码机制删除（plugin-spec §5 变化）；拒绝改 ctx.fail({kind:auth,reason:unauthenticated})。

### cancelToken（2）

- rule/cancel.rule.test.ts::cancel — request interceptor 注入 AbortController &gt; [cancel.fn.axpCancel] config.cancelToken 已存在 → 不覆盖 — cancelToken 已废弃且不再支持（plugin-spec §1.3）；取消行为改由 signal 与 client.cancelAll 保证。
- boundary/share.boundary.test.ts::share — 订阅清理与错误属性 &gt; [share.opt.policy][share.fn.$follow] CancelToken 单独取消 leader 后 follower 仍成功，底层不携带 leader token — cancelToken 已废弃且不再支持（plugin-spec §1.3）；取消行为改由 signal 与 client.cancelAll 保证。

### axpCancel 插件机制（8）

- rule/cancel.rule.test.ts::cancel — enable:false &gt; [cancel.opt.enable] 整个插件不安装拦截器 — axpCancel 插件安装、名称及 cleanup 已删除（plugin-spec §1.3 / N1）；取消注销由内核落定保证。
- rule/cancel.rule.test.ts::cancel — 插件契约（install / cleanup / name / reason） &gt; [cancel.prop.name] 插件名为 axp:cancel — axpCancel 插件安装、名称及 cleanup 已删除（plugin-spec §1.3 / N1）；取消注销由内核落定保证。
- rule/cancel.rule.test.ts::cancel — 插件契约（install / cleanup / name / reason） &gt; [cancel.method.cleanup] cleanup 后 cancelAll 返回 0，在飞的 controller 不再被中止 — axpCancel 插件安装、名称及 cleanup 已删除（plugin-spec §1.3 / N1）；取消注销由内核落定保证。
- boundary/cancel.boundary.test.ts::cancel — 插件契约边界 &gt; [cancel.opt.enable] enable:false → install 不返回 cleanup，cancelAll 返回 0；enable 缺省/undefined 视为开启 — axpCancel 插件安装、名称及 cleanup 已删除（plugin-spec §1.3 / N1）；取消注销由内核落定保证。
- boundary/cancel.boundary.test.ts::cancel — 插件契约边界 &gt; [cancel.method.install] 同一实例重复 install → 后装的覆盖集合，只中止新集合内的请求 — axpCancel 插件安装、名称及 cleanup 已删除（plugin-spec §1.3 / N1）；取消注销由内核落定保证。
- boundary/cancel.boundary.test.ts::cancel — 插件契约边界 &gt; [cancel.method.install] 对无 interceptors 的实例 install → 抛错（不静默吞掉） — axpCancel 插件安装、名称及 cleanup 已删除（plugin-spec §1.3 / N1）；取消注销由内核落定保证。
- boundary/cancel.boundary.test.ts::cancel — 插件契约边界 &gt; [cancel.method.cleanup] 重复调用 cleanup → 不抛错，仍保持已清空状态 — axpCancel 插件安装、名称及 cleanup 已删除（plugin-spec §1.3 / N1）；取消注销由内核落定保证。
- boundary/cancel.boundary.test.ts::cancel — 插件契约边界 &gt; [cancel.prop.name] name 在不同 options 下恒定，且不被实例间共享修改影响 — axpCancel 插件安装、名称及 cleanup 已删除（plugin-spec §1.3 / N1）；取消注销由内核落定保证。

### Core adapter 归一化（3）

- rule/core.rule.test.ts::Core — 返回形态与 extends &gt; [public.member.Core.constructor] 构造把非函数 adapter 归一化成函数，并开启 clarifyTimeoutError — Core 构造时取底层/归一化 adapter 的机制删除（D1；core-architecture §9）；传输直接 axios.request，底层 adapter 由 axios 选择。
- boundary/core.boundary.test.ts::Core — 构造与 extends 边界 &gt; [public.member.Core.constructor] 重复对同一 axios 构造 Core 幂等：adapter 保持函数，不抛错 — Core 构造时取底层/归一化 adapter 的机制删除（D1；core-architecture §9）；传输直接 axios.request，底层 adapter 由 axios 选择。
- integration/install-order.integration.test.ts::Core — 运行时动词与 adapter 归一化 &gt; [public.member.Core.constructor] 裸 axios.create() 构造 Core 后 defaults.adapter 已归一化为函数 — Core 构造时取底层/归一化 adapter 的机制删除（D1；core-architecture §9）；传输直接 axios.request，底层 adapter 由 axios 选择。

### Axp.install 与 AxpHandle 插入（18）

- rule/handle.rule.test.ts::AxpHandle — 顺序操作 &gt; [public.handle.prepend][public.handle.append][public.handle.insertBefore][public.handle.insertAfter][public.handle.plugins] 各插入方法后 plugins 与实际执行顺序一致 — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- rule/handle.rule.test.ts::AxpHandle — 顺序操作 &gt; [public.handle.prepend][public.handle.insertBefore][public.handle.insertAfter] 重排会整体 cleanup 并按新顺序重装 — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- boundary/handle.boundary.test.ts::AxpHandle — 边界 &gt; [public.fn.Axp.install] null/false/undefined 的槽位被忽略；初始安装中途抛错则倒序回滚并 rethrow — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- boundary/handle.boundary.test.ts::AxpHandle — 边界 &gt; [public.handle.plugins] 空名称/重复名称插件不影响快照；返回值每次都是新数组 — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- boundary/handle.boundary.test.ts::AxpHandle — 边界 &gt; [public.handle.prepend] 空 handle 上 prepend 等价于唯一插件；install 抛错时回滚到原顺序并 rethrow — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- boundary/handle.boundary.test.ts::AxpHandle — 边界 &gt; [public.handle.append] 同一插件对象重复 append：各自有独立 cleanup；install 抛错则不入列 — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- boundary/handle.boundary.test.ts::AxpHandle — 边界 &gt; [public.handle.insertBefore] anchor 不在 handle 中（含 dispose 后）抛带名称的错，且不触发任何 cleanup — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- boundary/handle.boundary.test.ts::AxpHandle — 边界 &gt; [public.handle.insertAfter] anchor 为最后一个等价于追加；anchor 非本 handle 抛错；新插件装不上时回滚 — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- integration/install-order.integration.test.ts::Axp.install — canonical order &gt; [public.fn.Axp.install] omitted plugins are skipped; a single plugin still installs correctly — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- integration/install-order.integration.test.ts::Axp.install — canonical order &gt; [public.handle.append] append adds after everything the handle tracks — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- integration/install-order.integration.test.ts::Axp.install — canonical order &gt; [public.handle.prepend] prepend adds before everything the handle tracks — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- integration/install-order.integration.test.ts::Axp.install — canonical order &gt; [public.handle.insertBefore][public.handle.insertAfter] insertBefore/insertAfter slot a plugin relative to a tracked anchor — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- integration/install-order.integration.test.ts::Axp.install — canonical order &gt; [public.handle.insertBefore][public.handle.insertAfter] insertBefore/insertAfter throw for an anchor this handle does not track — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- integration/install-order.integration.test.ts::Axp.install — AxpHandle 内部簿记与回滚 &gt; [public.handle.append][public.handle.dispose] 同一个插件对象 append 两次：两份 cleanup 都保留，dispose 全部卸载 — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- integration/install-order.integration.test.ts::Axp.install — AxpHandle 内部簿记与回滚 &gt; [public.handle.prepend][public.handle.dispose] 同一个插件对象重复出现时，重排（prepend）也按下标拆装，数量不漂移 — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- integration/install-order.integration.test.ts::Axp.install — AxpHandle 内部簿记与回滚 &gt; [public.fn.Axp.install] Axp.install 中途有插件 install 抛错：先卸掉已装的（key 的拦截器被摘除）再 rethrow — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- integration/install-order.integration.test.ts::Axp.install — AxpHandle 内部簿记与回滚 &gt; [public.handle.prepend] prepend 失败：list 与已装插件恢复原状，再 rethrow — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。
- integration/install-order.integration.test.ts::Axp.install — AxpHandle 内部簿记与回滚 &gt; [public.handle.append] append 失败：失败的插件不留在 list 里 — Axp.install 槽位/重复安装及 AxpHandle 插入重排机制删除（plugin-spec §9；core-architecture §4 / D2）；排序与重名拒绝由 pipeline.sort、动态 use/eject 保证。

### key before/after 钩子（2）

- rule/key.rule.test.ts::key — 钩子与开关 &gt; [key.cb.before][key.cb.after] 前钩子修改输入，后钩子收到计算后的 key — key before/after 钩子删除（plugin-spec §1.2）；prepare 阶段负责整形，key 在 source 惰性计算。
- boundary/key.boundary.test.ts::key — 拦截与空配置边界 &gt; [key.cb.before][key.cb.after] %s 抛错保留错误身份且不发送请求 — key before/after 钩子删除（plugin-spec §1.2）；prepare 阶段负责整形，key 在 source 惰性计算。

### Core 与 Axp 旧公开形态（2）

- boundary/core.boundary.test.ts::Core — 构造与 extends 边界 &gt; [public.member.Core.extends] 可被子类继承，子类实例保持 Core 行为 — Core 子类化和 Axp 静态对象形态删除（plugin-spec §9）；新客户端由 createAxp 工厂提供，响应扩展走 D5。
- boundary/core.boundary.test.ts::公共导出 — 边界 &gt; [public.export.Core][public.export.Axp] Axp 只含 create/install — Core 子类化和 Axp 静态对象形态删除（plugin-spec §9）；新客户端由 createAxp 工厂提供，响应扩展走 D5。

### loading wrapper 与 COMPLETE（1）

- boundary/loading.boundary.test.ts::cancel/loading — 资源释放边界 &gt; [loading.method.cleanup][loading.fn.$wrap] loading dispose 后旧 wrapper 直通且 finish 对无配置幂等 — loading 旧 wrapper/finish/guardTransform/COMPLETE 清理机制删除（plugin-spec §2.1 变化）；新 outer finally 与 dispose 负责收尾。

### adapter 分层链（4）

- integration/adapter-layers.integration.test.ts::wrapAdapter — #18 每层可独立移除 &gt; [helper.wrapAdapter] 非 LIFO 移除：先摘 A 不影响 B，再摘 B 不会复活 A — wrapAdapter/adapter 分层链/getBaseAdapter 删除（D1；core-architecture §12）；插件排序、卸载与状态独立由 pipeline 与 setup 保证。
- integration/adapter-layers.integration.test.ts::wrapAdapter — #18 每层可独立移除 &gt; [helper.wrapAdapter] 重复 remove 无副作用；层闭包状态在重建链后保留 — wrapAdapter/adapter 分层链/getBaseAdapter 删除（D1；core-architecture §12）；插件排序、卸载与状态独立由 pipeline 与 setup 保证。
- integration/adapter-layers.integration.test.ts::wrapAdapter — #18 每层可独立移除 &gt; [helper.getBaseAdapter] getBaseAdapter 返回最底层 adapter — wrapAdapter/adapter 分层链/getBaseAdapter 删除（D1；core-architecture §12）；插件排序、卸载与状态独立由 pipeline 与 setup 保证。
- integration/helper.integration.test.ts::helper — adapter 外部替换与旧引用 &gt; [helper.wrapAdapter][helper.getBaseAdapter] 外部替换后移除旧层不覆盖新 adapter，旧层引用退化为直通 — wrapAdapter/adapter 分层链/getBaseAdapter 删除（D1；core-architecture §12）；插件排序、卸载与状态独立由 pipeline 与 setup 保证。

### 单次尝试钩子（1）

- integration/helper.integration.test.ts::helper — 原始请求体与单次尝试钩子 &gt; [helper.registerAttemptHook][helper.runAttempt] 钩子按登记顺序运行且注销幂等，运行中注销不改变本次快照 — registerAttemptHook/runAttempt 登记顺序及注销机制删除（D1；plugin-spec §5 变化）；每次 next 自然穿过 credential/source。

### 裸 axios 安装入口（1）

- integration/install-order.integration.test.ts::Axp.install — 裸 axios.create() 上的 adapter 类插件 &gt; [public.fn.Axp.install] 不经 Core，cache/share/mock/loading 一起装到带数组 adapter 的实例上请求正常 — 只对裸 axios 安装插件的入口删除（D1、plugin-spec §9）；新插件仅对 AxpClient 生效，默认 adapter 支持由 transport 集成验证。

## 终审裁决（2026-10-28）

40 条【存疑】按主题裁决如下，规格文档已同步；明细表里的【存疑】标记已改为指向本节。

| 主题 | 行数 | 裁决 | 规格出处 |
|---|---:|---|---|
| 插件级 `enable` | 19 | 每个插件工厂都保留 `enable?: boolean`（默认 true，mock 默认 false）；`false` 时插件不进链、不 `setup`、`inspect()` 不列出；请求级开关不能重新打开 | plugin-spec §0 |
| mock 请求级对象里的 `mock` 字段 | 5 | 改用通用写法：`false` 或 `{ enable: false }` 关闭，对象只保留 `mockUrl`、`fallbackWhen` | plugin-spec §0、§6.1 |
| 请求级 `null` / `0` 等未声明值 | 1 | `null` 与 `undefined` 都按"省略"处理（回退插件级），其它未声明值类型上报错、运行时也按省略处理 | plugin-spec §0 |
| cache `storage` / `memory` 预留选项 | 4 | 删除（旧版只有类型、工厂从不消费），持久化走 `store` 注入；这 4 行改为验证 `store` | plugin-spec §6.3 |
| `removeCache` / `clearCache` 返回值 | 4 | 沿用旧契约：`removeCache(client, key): boolean`、`clearCache(client): number`；客户端没装 cache 时分别返回 `false` / `0` | plugin-spec §6.3 |
| purge / link / unlink 动词 | 3 | **保留**：客户端提供 axios 全部 10 个小写动词，分派规则不变（delete/post/put/patch 走 data，其余走 params） | core-architecture §9 |
| `nullable` 选项 | 2 | 删除（旧版只影响类型、运行时无效）；`data` 为 null/undefined 时原样返回的运行时语义保留 | core-architecture §9 |
| loading 多回调配对 | 1 | 按回调各自计数：每个回调都看到成对的 true/false，不再出现"A 显示、B 隐藏" | plugin-spec §2.1 |
| cache `max < 1` | 1 | 沿用旧行为，回退默认 500；不限容量用 `Infinity` | plugin-spec §6.3 |
| 请求体克隆失败 | 1 | **不抛错**，沿用旧行为回退为原引用，debug 模式下打 warn；`structuredClone` 不存在时同样回退 | core-architecture §11 P4 |
| retry 的 `delay` / `jitter` 回调抛错 | 1 | 归入判定类回调，按 bug 抛原始异常，同时清掉等待定时器 | core-architecture N13、plugin-spec §0 |

与 Codex 倾向不同的只有两处：purge/link/unlink 保留（Codex 倾向改用 `request`），克隆失败回退原引用（Codex 倾向抛错）。前者零成本且避免无谓破坏，后者沿用已验收的 R2-1 行为、不让含函数字段的请求体直接失败。

## 【存疑】汇总（原始记录）

全部先倾向 change，不把方案未写清的边界硬判为保留或删除。每行的具体新位置见对应层明细。

| 旧位置                                                                                                                                                                                                                                                                                                                                                                          | 倾向与理由                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit/helper.unit.test.ts::helper — 原始请求体与单次尝试钩子 &gt; [helper.withRawRequest] structuredClone 缺失或失败均回退原引用                                                                                                                                                                                                                                                 | change：core-architecture §11 P4 只声明 structuredClone 按需克隆，未规定缺失/失败时回退引用；倾向抛原始异常，避免污染后续尝试。【存疑】                                 |
| unit/mock.unit.test.ts::$resolveMock &gt; [mock.fn.$resolveMock][mock.req.mock] 请求 %j 与默认 %j → %j                                                                                                                                                                                                                                                                          | change：plugin-spec §0 与 §6.1：mock 对象不再列 mock 字段，统一有 enable；倾向用 false 或 {enable:false} 关闭，保留 mockUrl 覆盖。【存疑】                              |
| unit/mock.unit.test.ts::$resolveMock &gt; [mock.fn.$resolveMock][mock.req.mock][mock.opt.mockUrl] 对象 mock=false → null（即使有 mockUrl）                                                                                                                                                                                                                                      | change：plugin-spec §0 与 §6.1：mock 对象不再列 mock 字段，统一有 enable；倾向用 false 或 {enable:false} 关闭，保留 mockUrl 覆盖。【存疑】                              |
| rule/auth.rule.test.ts::auth — enable / 元信息 &gt; [auth.opt.enable] enable:false → 不安装拦截器                                                                                                                                                                                                                                                                               | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| rule/cache.rule.options.test.ts::cache — storage / memory 选项仅保留类型，工厂不消费 &gt; [cache.opt.storage][cache.cb.storage.getItem][cache.cb.storage.setItem][cache.cb.storage.removeItem][cache.cb.storage.clear] 传入 storage 后四个方法在读写/失效全流程中都不被调用                                                                                                     | change：plugin-spec §6.3：storage/memory 预留选项未列入新接口，倾向移除并测试 store 注入；文档未明确写删除。【存疑】                                                    |
| rule/cache.rule.options.test.ts::cache — storage / memory 选项仅保留类型，工厂不消费 &gt; [cache.opt.memory] memory 取 true/false 均不改变行为：始终使用进程内缓存                                                                                                                                                                                                              | change：plugin-spec §6.3：storage/memory 预留选项未列入新接口，倾向移除并测试 store 注入；文档未明确写删除。【存疑】                                                    |
| rule/cache.rule.store.test.ts::cache management API &gt; [cache.fn.clearCache][cache.fn.removeCache] removeCache()/clearCache() operate on the live per-instance store (no removeWhere/.size in axp — see file doc)                                                                                                                                                             | change：plugin-spec §6.3：clearCache/removeCache 改接收客户端；清理当前客户端缓存，未装插件的返回值尚未定义。【存疑】                                                   |
| rule/cache.rule.test.ts::removeCache / clearCache &gt; [cache.fn.removeCache] removeCache 删除单条                                                                                                                                                                                                                                                                              | change：plugin-spec §6.3：clearCache/removeCache 改接收客户端；清理当前客户端缓存，未装插件的返回值尚未定义。【存疑】                                                   |
| rule/cache.rule.test.ts::removeCache / clearCache &gt; [cache.fn.clearCache] clearCache 清空全部                                                                                                                                                                                                                                                                                | change：plugin-spec §6.3：clearCache/removeCache 改接收客户端；清理当前客户端缓存，未装插件的返回值尚未定义。【存疑】                                                   |
| rule/cache.rule.test.ts::cache — 卸载、代次与 TTL 边界 &gt; [cache.opt.enable] enable:false 保持 adapter 身份且不创建缓存仓                                                                                                                                                                                                                                                     | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| rule/core.rule.test.ts::Core — 动词方法族 &gt; [public.member.Core.get][public.member.Core.head][public.member.Core.options][public.member.Core.purge][public.member.Core.link][public.member.Core.unlink][public.member.Core.delete][public.member.Core.post][public.member.Core.put][public.member.Core.patch] %s 发出对应 method/url，payload 走正确字段并解包信封           | change：core-architecture §9 只列七动词，§3 沿用现有 payload 分派（DELETE 走 data）；旧十动词中的 purge/link/unlink 是否保留未明确，倾向用 request 代替。【存疑】       |
| rule/core.rule.test.ts::Core — 返回形态与 extends &gt; [public.req.nullable] nullable:true 允许 data 为 null：解包后原样得到 null，不改变其它形态                                                                                                                                                                                                                               | change：core-architecture §9、§10 未列 nullable；倾向保留 data 为 null/undefined 的运行时语义，nullable 类型选项删除需明确。【存疑】                                    |
| rule/filter.rule.test.ts::filter — 集成（拦截器 + runWhen） &gt; [filter.opt.enable] runWhen：enable:false → 恒不运行                                                                                                                                                                                                                                                           | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| rule/loading.rule.test.ts::$wrap — 并发计数器 &gt; [loading.fn.$wrap][loading.req.loading.callback] 请求级覆盖：第一个请求用 customA，第二个用 customB → A(true), B(false)                                                                                                                                                                                                      | change：plugin-spec §2.1 规定回调成对，但并发不同请求回调如何配对未写明；倾向每个回调自身 true/false 成对，替换旧 A(true)/B(false)。【存疑】                            |
| rule/loading.rule.test.ts::cancel/loading — 资源释放边界 &gt; [loading.method.install][loading.opt.enable] loading enable:false 不包装 adapter                                                                                                                                                                                                                                  | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| rule/mock.rule.test.ts::mock — 开关、请求级覆盖与卸载（真实 axios） &gt; [mock.req.mock.mock] 对象形式 mock:true 启用；mock:false 即使带 mockUrl 也走真实                                                                                                                                                                                                                       | change：plugin-spec §0 与 §6.1：mock 对象不再列 mock 字段，统一有 enable；倾向用 false 或 {enable:false} 关闭，保留 mockUrl 覆盖。【存疑】                              |
| rule/repath.rule.test.ts::repath — enable 开关 &gt; [repath.opt.enable] enable:false → 不安装拦截器                                                                                                                                                                                                                                                                             | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| rule/repath.rule.test.ts::repath &gt; [repath.opt.enable] a constructor-level disabled repath never substitutes                                                                                                                                                                                                                                                                 | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| rule/retry.rule.test.ts::retry — 循环终止与 Header 边界 &gt; [retry.opt.enable][retry.method.cleanup] 卸载后不重试，enable:false 不安装任何拦截器                                                                                                                                                                                                                               | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| rule/retry.rule.test.ts::retry: business-failure loop exhaustion and error-path behavior &gt; [retry.opt.enable] a constructor-disabled retry never intercepts a network error at all                                                                                                                                                                                           | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| rule/share.rule.test.ts::share — 关闭与清理边界 &gt; [share.opt.enable] enable:false 不包装 adapter                                                                                                                                                                                                                                                                             | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| boundary/auth.boundary.options.test.ts::auth — enable / tokenManager 边界 &gt; [auth.opt.enable] enable:false 时无 token 的请求也直通、不触发任何回调；enable:undefined 视为开启                                                                                                                                                                                                | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| boundary/cache.boundary.test.ts::removeCache / clearCache &gt; [cache.fn.removeCache][cache.fn.clearCache] 对未安装实例：返回 0/false                                                                                                                                                                                                                                           | change：plugin-spec §6.3：clearCache/removeCache 改接收客户端；清理当前客户端缓存，未装插件的返回值尚未定义。【存疑】                                                   |
| boundary/cache.boundary.test.ts::cache — 卸载、代次与 TTL 边界 &gt; [cache.opt.expires][cache.opt.max] TTL 恰好到期时重新发送，max=0 回退默认容量                                                                                                                                                                                                                               | change：plugin-spec §6.3 未定义 max=0 的归一化；TTL 恰到期仍保留，容量零值倾向沿用默认容量回退。【存疑】                                                                |
| boundary/cache.boundary.test.ts::cache — 选项与回调边界 &gt; [cache.opt.enable] enable:false 时请求级 cache:true 也不缓存；enable:undefined 视为开启                                                                                                                                                                                                                            | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| boundary/cache.boundary.test.ts::cache — 选项与回调边界 &gt; [cache.opt.storage][cache.cb.storage.getItem][cache.cb.storage.setItem][cache.cb.storage.removeItem][cache.cb.storage.clear] storage 方法抛错/返回 rejected Promise 也不影响缓存（工厂未消费）                                                                                                                     | change：plugin-spec §6.3：storage/memory 预留选项未列入新接口，倾向移除并测试 store 注入；文档未明确写删除。【存疑】                                                    |
| boundary/cache.boundary.test.ts::cache — 选项与回调边界 &gt; [cache.opt.memory] memory 为 null/非布尔 → 忽略，仍走进程内缓存                                                                                                                                                                                                                                                    | change：plugin-spec §6.3：storage/memory 预留选项未列入新接口，倾向移除并测试 store 注入；文档未明确写删除。【存疑】                                                    |
| boundary/core.boundary.test.ts::Core — 动词方法族边界 &gt; [public.member.Core.get][public.member.Core.head][public.member.Core.options][public.member.Core.purge][public.member.Core.link][public.member.Core.unlink][public.member.Core.delete][public.member.Core.post][public.member.Core.put][public.member.Core.patch] %s 无 payload、payload 为 0/空串/null 时不抛并解包 | change：core-architecture §9 只列七动词，§3 沿用现有 payload 分派（DELETE 走 data）；旧十动词中的 purge/link/unlink 是否保留未明确，倾向用 request 代替。【存疑】       |
| boundary/core.boundary.test.ts::Core — 响应形态边界 &gt; [public.req.nullable] 信封 data=%s 时 nullable 真/假都原样返回该值，不抛错（该选项仅影响类型）                                                                                                                                                                                                                         | change：core-architecture §9、§10 未列 nullable；倾向保留 data 为 null/undefined 的运行时语义，nullable 类型选项删除需明确。【存疑】                                    |
| boundary/filter.boundary.test.ts::filter — 插件选项边界 &gt; [filter.opt.enable] enable:false 时 filter:true 也不过滤，config.filter 不被清理；省略 enable 视为 true                                                                                                                                                                                                            | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| boundary/loading.boundary.test.ts::loading 逻辑请求与清理 &gt; [loading.opt.enable] 总开关关闭时请求级回调也不参与计数                                                                                                                                                                                                                                                          | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| boundary/mock.boundary.test.ts::mock — 插件选项边界 &gt; [mock.opt.mock] 请求 mock 为 null / 0 时回退插件级 mock 值                                                                                                                                                                                                                                                             | change：plugin-spec §0、§6.1 未规定 null/0 的非法 mock 值；倾向不支持并按声明四种形式迁移，不保留真值宽松转换。【存疑】                                                 |
| boundary/mock.boundary.test.ts::mock — 请求级 mock 配置边界 &gt; [mock.req.mock] 空对象 {} 且无插件级 mockUrl：走真实；有插件级 mockUrl：沿用插件级 mock                                                                                                                                                                                                                        | change：plugin-spec §0 与 §6.1：mock 对象不再列 mock 字段，统一有 enable；倾向用 false 或 {enable:false} 关闭，保留 mockUrl 覆盖。【存疑】                              |
| boundary/mock.boundary.test.ts::mock — 请求级 mock 配置边界 &gt; [mock.req.mock.mock] mock:undefined 视同未指定；mock:false 压过插件级 mock:true                                                                                                                                                                                                                                | change：plugin-spec §0 与 §6.1：mock 对象不再列 mock 字段，统一有 enable；倾向用 false 或 {enable:false} 关闭，保留 mockUrl 覆盖。【存疑】                              |
| boundary/normalize.boundary.test.ts::normalize — 选项与请求级开关边界（真实 axios） &gt; [normalize.opt.enable][normalize.method.install] enable 缺省/undefined 视为开启；enable:false 无 cleanup 且不拦截                                                                                                                                                                      | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| boundary/repath.boundary.test.ts::repath — 选项与安装/卸载边界（真实 axios） &gt; [repath.opt.enable][repath.method.install] enable:false 不装拦截器且无 cleanup；省略/undefined 视为启用                                                                                                                                                                                       | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| boundary/retry.boundary.options.test.ts::retry — 请求开关与空集合 &gt; [retry.opt.enable] 插件关闭时请求级 enable:true 和正预算不能重新开启                                                                                                                                                                                                                                     | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| boundary/retry.boundary.options.test.ts::retry — 零延时与异常回调 &gt; [retry.req.retry.delay.callback][retry.req.retry.jitter.callback] 请求级 %s 抛错后不再发送且不留下定时器                                                                                                                                                                                                 | change：plugin-spec §4 / D6、N13：delay/jitter 回调抛错倾向按判定类 bug 透传，取消等待清理 timer；N13 的枚举未显式列二者。【存疑】                                      |
| boundary/share.boundary.policy.test.ts::share — 策略输入边界 &gt; [share.opt.enable] 插件关闭时请求级策略不能开启共享，也不会调用动态策略                                                                                                                                                                                                                                       | change：plugin-spec §9、core-architecture §8：新插件选项表未统一保留插件级 enable（mock 除外）；倾向以不装插件或 eject 关闭并保留无副作用行为，需明确兼容范围。【存疑】 |
| integration/install-order.integration.test.ts::Core — 运行时动词与 adapter 归一化 &gt; [public.member.Core.purge][public.member.Core.link][public.member.Core.unlink] HttpPrototype 声明的全部动词运行时都存在，purge/link/unlink 走 params                                                                                                                                     | change：core-architecture §9 只声明七动词；purge/link/unlink 未列删除或兼容项，倾向转 request({method})，需确认迁移说明。【存疑】                                       |
