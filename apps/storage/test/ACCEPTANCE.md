# Storage 验收矩阵

2026-11-06 第六波 X2 同步（全量运行按续跑内存约束留主会话）。BUG 判定保留 final-plan §1.1/§1.2 原结论，S 项标补充发现；判定与本轮处置分开。所有声称修复的引用已核对测试断言。测试行精确引用 Vitest JSON 的祖先与展开标题；每行同时登记 describe 祖先，无动态标题与未映射豁免。

## 不变量 INV-xx

| ID | 描述／核对结论 | 精确引用（文件 :: 层级标题） | 判定与处置 |
| --- | --- | --- | --- |
| INV-01 | 读侧副作用发起前检查完整有效性：续期、过期删、损坏删；写侧每键令牌见 INV-33 | test/core-regressions.browser.test.ts :: core races FIFO > B1 renew read then set guards backend and memo | 已通过 |
| INV-02 | purge 的读后删除不得覆盖后发 set/remove | test/matrix-races.browser.test.ts :: Additional race invariant IDB > B1 delayed purge cannot overwrite a newer set | 已通过 |
| INV-03 | memo 仅在版本未变时回填，在途写后 remove/clear 不复活 | test/core-regressions.browser.test.ts :: core races FIFO > B2 dispatched set then remove does not refill memo | 已通过 |
| INV-04 | destroy 撤销在途读取的 memo 回填，保留后端 | test/core-regressions.browser.test.ts :: core races FIFO > destroy prevents pending read backfill | 已通过 |
| INV-05 | 一次操作只用开始时捕获的 keyspace | test/core-regressions.browser.test.ts :: core races FIFO > B3 clear keeps its initial keyspace | 已通过 |
| INV-06 | 除正常过期清理外，读路径仅 corrupt 删除；type mismatch 保留数据与 memo | test/core-regressions.browser.test.ts :: core races FIFO > corrupt/type distinctions preserve backend and memo contract | 已通过 |
| INV-07 | 共享兜底与独立 memo 分离，ls/ss 兜底相互隔离 | test/platform-logic.browser.test.ts :: platform 浏览器兜底 > 共享 ls/ss 兜底保留数据，memo 与两种后端互相隔离 | 已通过 |
| INV-08 | 命名空间只转义 % 与冒号；clear/keys 不越界 | test/core-regressions.browser.test.ts :: core keyspace compatibility and cache > scoped clear separates a, a:b and percent namespaces | 已通过 |
| INV-09 | readonly 有效 null 算存在，异步同键首次写入获胜 | test/core-regressions.browser.test.ts :: core races FIFO > readonly preserves null and concurrent first writer wins | 已通过 |
| INV-10 | onError write/abort 保留原始异常身份 | test/core-regressions.browser.test.ts :: core memo Hub and safe dictionaries > write and abort preserve original backend errors and callback exceptions | 已通过 |
| INV-11 | onError serialize 异步 reject，回调异常保留身份 | test/core-regressions.browser.test.ts :: core races FIFO > serialize rejects asynchronously and callback errors preserve identity | 已通过 |
| INV-12 | onError corrupt/type 分类、默认值与非破坏性检查 | test/core-regressions.browser.test.ts :: core races FIFO > corrupt/type distinctions preserve backend and memo contract | 已通过 |
| INV-13 | 各 kind 用户回调只执行一次且原异常传播 | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > user callback exception for serialize propagates unchanged exactly once | 已通过 |
| INV-14 | Hub 按 area 区分 local/session、空键与 clear | test/core-regressions.browser.test.ts :: core memo Hub and safe dictionaries > storage events distinguish area, empty key, and clear | 已通过 |
| INV-15 | 非 memo 实例零订阅，最后 destroy 释放监听 | test/core-regressions.browser.test.ts :: core memo Hub and safe dictionaries > nonmemo instances never register and destroy releases final listener | 已通过 |
| INV-16 | 跨标签原生事件使父页面 memo 失效 | test/core-regressions.browser.test.ts :: core native events and atomic update > same origin iframe write invalidates parent memo | 已通过 |
| INV-17 | IDB 广播失效必须 opt-in，destroy 释放 | test/core-regressions.browser.test.ts :: core native events and atomic update > IDB BroadcastChannel invalidation is opt-in and releases on destroy | 已通过 |
| INV-18 | crossTab v2 仅 local 内存参与，session 隔离 | test/sync-crosstab.browser.test.ts :: crossTab v2 > session 原生与内存均拒绝同步，每个 handler 只警告一次 | 已通过 |
| INV-19 | crossTab v2 落盘串回放、memo 失效且无回环 | test/sync-crosstab.browser.test.ts :: crossTab v2 > 加密键和自定义 codec 直写，raw 空串有效且不二次提交 | 已通过 |
| INV-20 | crossTab v2 LWW 按 ts/from，clear 保留已知更新键 | test/sync-crosstab.browser.test.ts :: crossTab v2 > clear 屏障防复活并保留较新的键，空 clear 也建立屏障 | 已通过 |
| INV-21 | crossTab 绝对过期时间，过期 SET 按带戳 REMOVE 删除旧值且不重建 TTL | test/sync-crosstab.browser.test.ts :: crossTab v2 > 过期 SET 按带戳 REMOVE 回放，永不重建 TTL | 已通过 |
| INV-22 | 导入无探测副作用，首次访问独立缓存且保留用户键 | test/platform-helper.node.test.ts :: platform SSR 与惰性探测 > 导入不访问 getter，首次读取独立探测缓存且保留用户探测键 | 已通过 |
| INV-23 | IDB update 同事务条件写；string/null/undefined 语义 | test/platform-idb.browser.test.ts :: platform IDB 原子更新 > 两个连接并发条件写只有一个成功，旧读条件删除不覆盖新值 | 已通过 |
| INV-24 | IDB update 回调失败回滚，显式 abort 返回 AbortError | test/platform-idb.browser.test.ts :: platform IDB 原子更新 > fn 抛错回滚，显式 abort 以 AbortError 拒绝 | 已通过 |
| INV-25 | 正常 IDB 与打开失败内存兜底始终 kind=idb | test/platform-idb.browser.test.ts :: platform IDB 原子更新 > 打开失败不污染全局能力或其他实例，退避后可重试 | 已通过 |
| INV-26 | TTL 到期边界 now=expireAt，90% 剩余时才续期 | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > renews at exactly ninety percent remaining and not one millisecond earlier | 已通过 |
| INV-27 | 无 createdAt 的外部信封既不过期也不续期 | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > external entity without createdAt neither expires nor renews | 已通过 |
| INV-28 | 配额清理重试仅同步后端；保留 live/外部/其他空间数据 | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant ls > force retry reclaims exactly dead entries and preserves live and foreign payloads | 已通过 |
| INV-29 | JSONX 转义普通标签对象且兼容旧富类型标签 | test/platform-serialization.node.test.ts :: platform JSONX > 普通 Date 标签往返仍为对象 | 已通过 |
| INV-30 | 操作令牌与 readonly 队列完成后释放 | test/core-regressions.browser.test.ts :: core error callbacks FIFO > completed operations release version and readonly queue maps | 已通过 |
| INV-31 | 不同键的写入不撤销无关在途读的 memo 回填 | test/core-regressions.browser.test.ts :: core races FIFO > unrelated key write does not discard pending memo fill | 已通过 |
| INV-32 | debug 使用开始时快照且不写入调试数据 | test/core-regressions.browser.test.ts :: core snapshots FIFO > debug keeps captured namespace across asynchronous enumeration | 已通过 |

| INV-33 | 写有效性只用每键令牌；destroy/setNamespace/Hub 全量失效不取消已发起写 | test/core-x1.browser.test.ts :: X1 FIFO > F1 pending write survives destroy in its original namespace | 已通过 |
| INV-34 | clear 后发起的读等待删除完成 | test/core-x1.browser.test.ts :: X1 IDB > F2 clear before get waits for removal namespace=ns | 已通过 |
| INV-35 | clear 屏障后的成功写入保留，跳过或失败的后写不保护旧值 | test/core-x1.browser.test.ts :: clear preserves writes started during scanning namespace=ns | 已通过 |
| INV-36 | 历史信封 ttl:null/expireAt:null 视为缺失且不报 corrupt | test/core-x1.browser.test.ts :: F3 historical envelopes preserve null metadata without corrupt reports | 已通过 |
| INV-37 | clear 仅一次 COMMIT 与一次广播 | test/core-x1.browser.test.ts :: F12 clear emits one COMMIT and one broadcast namespace=ns | 已通过 |
| INV-38 | Hub 通道首次 publish 惰性打开并持久到 destroy | test/core-x1.browser.test.ts :: F13 memo broadcast opens once until destroy | 已通过 |
| INV-39 | Idb 同库名共享 area，跨实例 memo 自动失效 | test/core-x1.browser.test.ts :: F14 same-name Idb instances invalidate each other memo | 已通过 |
| INV-40 | 过期 SET 作为带戳 REMOVE 删除旧值并拒绝旧消息 | test/core-x1.browser.test.ts :: F10 real BroadcastChannel replays expired SET as stamped REMOVE | 已通过 |
| INV-41 | crossTab LWW 按 ts/from 拒绝乱序及重复 | test/sync-crosstab.browser.test.ts :: crossTab v2 > LWW 拒绝乱序和重复消息，相同 ts 按 from 排序 | 已通过 |

| INV-42 | FIFO/IDB 按调用顺序派发异步写，get/keys 读己之写 | test/core-x2.browser.test.ts :: X2 IDB > G1 read own writes memo=false | 已通过（定向实测） |
| INV-43 | clear 屏障覆盖读写与枚举，不提前派发 | test/core-x2.browser.test.ts :: G9 plain clear blocks backend dispatch until the barrier settles | 已通过（定向实测） |
| INV-44 | 单键 Hub evict 不取消在途写 | test/core-x2.browser.test.ts :: X2 IDB > G3 peer eviction preserves a write waiting for clear | 已通过（定向实测） |
| INV-45 | 扫描 clear 全部成功才发 COMMIT，失败仍失效 Hub | test/core-x2.browser.test.ts :: G6 partial clear suppresses COMMIT and invalidates peer memo | 已通过（定向实测） |

## 缺陷回归 BUG-xx

| ID | 描述／核对结论 | 精确引用（文件 :: 层级标题） | 判定与处置 |
| --- | --- | --- | --- |
| BUG-A1 | JSONX 标签碰撞：普通 Date/bigint 业务对象及嵌套对象仍原样往返 | test/platform-serialization.node.test.ts :: platform JSONX > 普通 Date 标签往返仍为对象 | 降级 P3；已修复：标签转义 |
| BUG-A2 | 不同口令可能互解；格式兼容变更本轮不做，不以普通错口令测试冒充碰撞修复 | README.md :: Codecs | 降级未修：D11；口令不是隔离边界 |
| BUG-A3 | base64 enckey 孤立代理经 UTF-8 可能丢失码元，值 JSON 路径不受影响 | README.md :: Codecs | 降级未修：D11；需新格式及兼容读取 |
| BUG-A4 | 随机临时探测键，原有 __storage_probe__ 用户值保留且仅探测一次 | test/platform-helper.node.test.ts :: platform SSR 与惰性探测 > 导入不访问 getter，首次读取独立探测缓存且保留用户探测键 | 降级 P3；已修复 |
| BUG-A5 | indexedDB getter 抛错仍可导入，localStorage 继续可用 | test/platform-helper.browser.test.ts :: platform 浏览器探测 > indexedDB getter 抛错仍可导入并使用真实 localStorage | 成立 P2；已修复 |
| BUG-A6 | batchFast/debug 的 __proto__ 为自有键且返回对象无原型 | test/core-regressions.browser.test.ts :: core memo Hub and safe dictionaries > __proto__ stays an own dictionary key | 降级 P3；已修复 |
| BUG-A7 | debug 异步枚举在切空间后仍输出旧空间并检查两侧后端 | test/core-regressions.browser.test.ts :: core snapshots FIFO > debug keeps captured namespace across asynchronous enumeration | 降级 P3；已修复 |
| BUG-A8 | 显式 V 要提供 K；拒绝多余键，见同文件 rejectedTypeContracts 与 test/types.check.ts 的编译断言；由 lint 类型链核验 | test/core-types.node.test.ts :: core A9/D12 undefined defaults and literal batch keys retain exact types | 成立 P2；已修复：D12(a) |
| BUG-A9 | get/fast 显式 undefined 默认值的返回类型包含 null | test/core-types.node.test.ts :: core A9/D12 undefined defaults and literal batch keys retain exact types | 降级 P3；已修复：类型断言经 lint 核验 |
| BUG-A10 | JSONX.stringify 的 string 声明沿用 JSON.stringify；storage 总是序列化 entity，不为根 undefined 改坏序列化选项类型 | test/ACCEPTANCE.md :: 处置依据 | 误报：按 final-plan §1.1 保留原签名 |
| BUG-A11 | 虽然计划只弃用 key，平台层已对齐 unsigned long：Infinity、回绕、负数等与真实 Storage 比较 | test/platform-logic.browser.test.ts :: platform 浏览器兜底 > Memory.key 与真实 Storage 的 unsigned long 转换一致 | 降级 P3；已修复：同时保留弃用标记 |
| BUG-A12 | 断言 dead 物理键删除、同步重试恰两次，live/外部/其他空间数据保留 | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant ls > force retry reclaims exactly dead entries and preserves live and foreign payloads | 成立 P3；已修复：同步自动重试与 IDB 主动 purge 分开断言 |
| BUG-B1 | renew/expired/corrupt × set/remove 检查后端及 memo；完整展开见下方 API/INV 用例登记 | test/core-regressions.browser.test.ts :: core races FIFO > B1 renew read then set guards backend and memo | 成立 P1；已修复 |
| BUG-B1-atomic | 跨 IDB 实例旧读续期／到期条件删除不得覆盖新值 | test/core-regressions.browser.test.ts :: core native events and atomic update > atomic conditional renewal and expiry deletion cannot overwrite another instance | 成立 P1；已修复：D8 |
| BUG-B2 | pending set 后 remove/clear，后端与 memo 均为空；destroy 禁回填另见 INV-04 | test/core-regressions.browser.test.ts :: core races FIFO > B2 dispatched set then clear does not refill memo | 成立 P1；已修复 |
| BUG-B3 | 异步 clear 切命名空间后仅旧空间被清理，另一个空间与 memo 正确 | test/core-regressions.browser.test.ts :: core races FIFO > B3 clear keeps its initial keyspace | 成立 P1；已修复 |
| BUG-B4 | 两个独立 IDB readonly 实例只写入一个胜者，两个 memo/后端均核对 | test/core-regressions.browser.test.ts :: core native events and atomic update > two independent IDB readonly instances use one atomic winner | 成立 P2；已修复：同键队列及事务条件写 |
| BUG-B5 | readonly 已存 null 不覆盖，过期后可重写 | test/matrix-readonly-write.browser.test.ts :: Readonly invariant ls > writes only absent or expired values and treats stored null as present | 降级 P3；已修复 |
| BUG-B6 | {}、普通对象、错误时间元数据返回默认值并清除后端与 memo | test/core-regressions.browser.test.ts :: core races FIFO > corrupt/type distinctions preserve backend and memo contract | 成立 P2；已修复 |
| BUG-B7 | 轻量类型检查不符返回默认值、上报 type 且不删除底层数据 | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > type mismatch 0 returns fallback and preserves stored value | 降级为设计决策；已落实 D3 |
| BUG-B8 | 原生与内存 session 均 no-op，每 handler 只警告一次 | test/sync-crosstab.browser.test.ts :: crossTab v2 > session 原生与内存均拒绝同步，每个 handler 只警告一次 | 降级 P3（部分成立）；已修复实际模式识别 |
| BUG-B9 | 实现有限 LWW：乱序／重复忽略，相同 ts 按 from 排序；不宣称通用收敛，限制见 README.md 的 crossTab v2 | test/sync-crosstab.browser.test.ts :: crossTab v2 > LWW 拒绝乱序和重复消息，相同 ts 按 from 排序 | 降级 P3；已落实 D9，CRDT 明确不做 |
| BUG-B10 | 滑动续期通过提交事件广播，接收端与发送端落盘串相同 | test/sync-crosstab.browser.test.ts :: crossTab v2 > sliding 真实续期也广播，绝对到期时间保持不变 | 降级 P3；已修复 |
| BUG-B11 | 已过期延迟 SET 按带戳 REMOVE 回放，不复活也不重新计算 TTL | test/sync-crosstab.browser.test.ts :: crossTab v2 > 过期 SET 按带戳 REMOVE 回放，永不重建 TTL | 降级 P3；已修复：与 B10 的精确落盘串断言共同核验 |
| BUG-B12 | 畸形、v1、未知操作、回声及错误字段均忽略且自有键保留 | test/sync-crosstab.browser.test.ts :: crossTab v2 > 畸形、v1、未知操作和回声消息全部忽略 | 降级 P3；已修复：v2 字段校验，旧数组不再回放 |
| BUG-B13 | 真实事务显式 abort 后报告 kind=abort 与 AbortError，后端/memo 均无值 | test/idb.browser.test.ts :: IDB platform-specific contracts > request success followed by transaction abort reports abort and rolls back memo and disk | 成立 P3；已修复 |
| BUG-S1 | 文档已按真实 factory/ls/ss/db、17 模块、内部 Symbol 重写；无虚构自动后端选择；第五波已核验文档移除矩阵骨架旧措辞 | ARCHITECTURE.md :: 模块与依赖方向 | 文档核对：已对齐 API 与完整矩阵描述 |
| BUG-S1-debug | debug 子路径示例、读路径副作用已明确；README 双语与技能文件同口径 | README.md :: Debug snapshot | 文档核对：已核验 |
| BUG-S2 | 值编码异常异步 reject、原异常身份、serialize 分类及无落盘；同步路径见 API 登记 | test/core-x1.browser.test.ts :: S2 codec value encode preserves exception identity async=true | 补充发现成立 P2；已修复：值编码与序列化路径分别核对 |
| BUG-S2-force | force:false 写失败仅调用一次并上报原始错误，不抛出 | test/core-options.browser.test.ts :: core force false reports the original failure without retry | 补充发现成立 P2；已修复 |
| BUG-S3 | 换 codec 读取损坏值上报 corrupt 并删落盘键 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > codeable obscures physical values and a changed codec self heals old data | 补充发现成立 P2；已修复 |
| BUG-S4 | a/a:b/a%3Ab 互不越界，物理键转义及 memo 均验证 | test/core-regressions.browser.test.ts :: core keyspace compatibility and cache > scoped clear separates a, a:b and percent namespaces | 补充发现成立 P2；已修复 |
| BUG-S5 | 真实同源 iframe 写后父页读到新值；同标签、area、clear、释放见 INV-14～17 | test/core-regressions.browser.test.ts :: core native events and atomic update > same origin iframe write invalidates parent memo | 补充发现成立 P2；已修复：IDB 广播仍 opt-in |
| BUG-S6 | 缺 createdAt 外部实体既不续期也不被过期删除 | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > external entity without createdAt neither expires nor renews | 补充发现成立 P3；已修复 |
| BUG-S7 | 多个 factory 共享兜底，ls/ss/memo 隔离，destroy/切空间不删兜底 | test/platform-logic.browser.test.ts :: platform 浏览器兜底 > 共享 ls/ss 兜底保留数据，memo 与两种后端互相隔离 | 补充发现成立 P3；已修复：IDB 同库兜底另含于此断言 |
| BUG-S8 | 单实例打开失败不污染全局／其他实例，退避后恢复真实 IDB | test/platform-idb.browser.test.ts :: platform IDB 原子更新 > 打开失败不污染全局能力或其他实例，退避后可重试 | 补充发现成立 P3；已修复；指数上限另有用例 |
| BUG-S9 | 1000 个 enckey 第二次 keys/length 的 decode 次数为 0；仍需 O(n) 枚举，key 连续遍历 O(n²) 与 purge 完整解码未优化 | test/core-regressions.browser.test.ts :: core keyspace compatibility and cache > 1000 encrypted keys reuse reverse decoding across keys and length | 补充发现 P3；部分改善：逆向缓存；其余按 P1-6 保留 |
| BUG-S10 | 写 b 不应撤销 a 的在途 memo 回填，后端/memo 双断言 | test/core-regressions.browser.test.ts :: core races FIFO > unrelated key write does not discard pending memo fill | 补充发现成立 P3；已修复：每键版本 |
| BUG-S11 | 导入零 getter/写探测；首次读才调用并缓存 | test/platform-helper.node.test.ts :: platform SSR 与惰性探测 > 导入不访问 getter，首次读取独立探测缓存且保留用户探测键 | 补充发现成立 P3；已修复 |
| BUG-S12 | Vite Plus 自报 0.1.22，而 browser/coverage-v8 为 4.1.6，仍有警告；合并覆盖率和 gate 实测通过，不伪改版本号 | test/ACCEPTANCE.md :: 运行摘要 | 工具链核对：未消除上游版本警告，采集可用 |
| BUG-S13 | 五后端同组特性矩阵，Date-only 可控时钟，另有 Node SSR、类型契约和覆盖率门禁 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 ls > 仅 fake Date 时 TTL 精确到期且真实异步完成 | 补充发现成立 P3；已完成 P2-1～5；bench 可选未做 |

| BUG-F1 | 全量生命周期失效保留已发起写的旧空间落盘 | test/core-x1.browser.test.ts :: X1 IDB > F1 pending write survives namespace in its original namespace | 终审成立；已修复：断言已核对 |
| BUG-F2 | clear 后读等待屏障，不返回旧 token | test/core-x1.browser.test.ts :: X1 IDB > F2 clear before get waits for removal namespace=ns | 终审成立；已修复：断言已核对 |
| BUG-F3 | 历史 null 元数据兼容，不报错不删除 | test/core-x1.browser.test.ts :: F3 historical envelopes preserve null metadata without corrupt reports | 终审成立；已修复：断言已核对 |
| BUG-F4 | 缺 randomUUID 可挂载 crossTab | test/core-x1.browser.test.ts :: F4 crossTab mounts without crypto.randomUUID | 终审成立；已修复：断言已核对 |
| BUG-F5 | 已存 null 静默返回原始类型默认值并保留落盘 | test/core-x1.browser.test.ts :: F5 stored null silently uses primitive defaults and preserves data | 终审成立；已修复：断言已核对 |
| BUG-F6 | 发布行为变化由 G2 文档收尾核对 | CHANGELOG.md :: 0.2.0 (unreleased) | 文档核对：已核验 remove/clear、写合并、null、快路径与 UUID 回退说明 |
| BUG-F7 | 维持命名空间转义 BREAKING；D-b 选择手动迁移以避免歧义旧键兼容读 | README.md :: Namespaces and existing data | 文档核对：已决策／维持现状 |
| BUG-F8 | D-c 仅发 0.2.0，合并未发布条目；不在本路修改版本 | CHANGELOG.md :: 0.2.0 (unreleased) | 文档核对：已核验仅发 0.2.0 决策 |
| BUG-F9 | readonly force 配额清理后恰重试一次 | test/core-x1.browser.test.ts :: F9 readonly force retries after purging expired data | 终审成立；已修复：断言已核对 |
| BUG-F10 | 过期 SET 删除旧值并记录戳拒绝旧消息 | test/core-x1.browser.test.ts :: F10 real BroadcastChannel replays expired SET as stamped REMOVE | 终审成立；已修复：断言已核对 |
| BUG-F11 | 滑动续期失败上报 op=get | test/core-x1.browser.test.ts :: F11 sliding write errors identify get operation | 终审成立；已修复：断言已核对 |
| BUG-F12 | clear 仅一次 COMMIT 与广播 | test/core-x1.browser.test.ts :: F12 clear emits one COMMIT and one broadcast namespace=ns | 终审成立；已修复：断言已核对 |
| BUG-F13 | Hub 惰性通道复用直至 destroy | test/core-x1.browser.test.ts :: F13 memo broadcast opens once until destroy | 终审成立；已修复：断言已核对 |
| BUG-F14 | 同名 Idb 共享 area，非 memo 写使另一实例 memo 失效 | test/core-x1.browser.test.ts :: F14 same-name Idb instances invalidate each other memo | 终审成立；已修复：断言已核对 |
| BUG-F15 | 真实 IDB key/count 不枚举全键 | test/core-x1.browser.test.ts :: F15 real IDB key and count bypass full key enumeration | 终审成立；已修复：断言已核对 |
| BUG-F16 | 模块级 Memory 已有 PURE 注解；缺打包器 tree-shaking 定向回归 | test/ACCEPTANCE.md :: 处置依据 | 工具链核对：源码已核对；缺回归测试 |
| BUG-F17 | B2 先确认后端已落盘，再 remove；释放旧写后后端与 memo 均为空 | test/core-regressions.browser.test.ts :: core races FIFO > B2 dispatched set then remove does not refill memo | 测试质量：已加强且断言已核对 |
| BUG-F18 | 技能文档矩阵骨架旧措辞由 G2 修订 | .claude/skills/codejoo-storage/SKILL.md :: Tests and gates | 文档核对：G2 更新后已重新核验，旧措辞已移除 |
| BUG-F19 | 维持 IDB 退避内存兜底策略；恢复不迁移临时数据，文档已明确限制 | ARCHITECTURE.md :: memo 失效与共享内存兜底 | 文档核对：已决策／维持现状 |

| BUG-F17-force | force:false 检查后端 set 恰一次且上报原异常 | test/core-options.browser.test.ts :: core force false reports the original failure without retry | 测试质量：已核对加强后的断言 |
| BUG-F17-raw | raw 非字符串输入明确断言后端无写入与告警次数 | test/core-options.browser.test.ts :: core batch and options async=true > raw validation, invalid expiry and cloned objects preserve storage | 测试质量：已核对加强后的断言 |
| BUG-F17-serialization | 序列化失败初次写不落盘、续期不改原串，回调两次 | test/core-contracts.browser.test.ts :: core option combinations > serialization callbacks skip initial writes and failed renewals | 测试质量：已核对加强后的断言 |
| BUG-F17-broadcast | Hub 真正打开指定缺省通道；跨标签异步投递另见 F10 | test/core-contracts.browser.test.ts :: core option combinations > broadcast custom async backends use the default channel name | 测试质量：已核对加强后的断言 |

## 处置依据

- A2/A3：D11 明确延后新 codec 格式；README.md「Codecs」、ARCHITECTURE.md「已知限制」写明碰撞与孤立代理风险。普通错口令的 null 断言不能证明任意口令互斥。
- A10：final-plan §1.1 已判误报。JSONX.stringify 声明沿用标准 JSON.stringify；Storage 路径输入为 entity，不因根 undefined 的理论情况改变 serialize 的 string 契约。
- A8/A9：运行时 expectTypeOf 只提供类型断言载体；真正的拒绝多余键、返回联合类型等由 pnpm lint 的 typeCheck（test/types.check.ts、core-types.node.test.ts）及 node scripts/check-type-chain.mjs 验证。
- B9：仅落实 D9 的有限 LWW；CRDT、任意交错下收敛、初始快照与离线回放明确不做，见 README.md「crossTab v2」。
- S9：逆向键缓存已验证；枚举仍扫描，key(index) 已弃用，purge 仍完整解码。没有宣称建立索引或完成整项性能重构。
- S1 为人工文档核对，S12 为工具链实测，两者不假借业务测试证明；校验器只允许 BUG 的降级未修／误报／文档核对／工具链核对引用现存 Markdown 精确章节。已修复项必须引用测试。
- 缺回归测试：F16 的 PURE 注解只通过 src/core.ts 源码核对，未找到 tree-shaking 专项回归，不能以普通 factory 测试证明打包器行为。S2 缺口已由 core-x1 的同步／异步值编码用例补齐。A2/A3 明确延后，S9 仅登记局部改善。

## API-xx

以下完整登记每个运行时用例及其 describe 祖先，包括共享 node 测试在浏览器文件内的真实归属。API 行亦包含内部回归和夹具契约，便于双向追踪。

| ID | 描述／核对结论 | 精确引用（文件 :: 层级标题） | 判定与处置 |
| --- | --- | --- | --- |
| API-001 | 内部不变量与平台／夹具契约：Maybe 保留同步结果并串联 Promise，处理器异常不被二次捕获 | test/core-pure.node.test.ts :: core pure modules > Maybe 保留同步结果并串联 Promise，处理器异常不被二次捕获 | 已通过 |
| API-002 | 内部不变量与平台／夹具契约：keyspace 转义不重叠，普通键兼容，双向缓存有界 | test/core-pure.node.test.ts :: core pure modules > keyspace 转义不重叠，普通键兼容，双向缓存有界 | 已通过 |
| API-003 | 内部不变量与平台／夹具契约：entity 验证形状、数字元数据、过期边界和续期标志 | test/core-pure.node.test.ts :: core pure modules > entity 验证形状、数字元数据、过期边界和续期标志 | 已通过 |
| API-004 | 内部不变量与平台／夹具契约：entity 创建和错误上报保留原异常 | test/core-pure.node.test.ts :: core pure modules > entity 创建和错误上报保留原异常 | 已通过 |
| API-005 | get/fast/batchFast 类型契约（由 lint 验证）：core A9/D12 undefined defaults and literal batch keys retain exact types | test/core-types.node.test.ts :: core A9/D12 undefined defaults and literal batch keys retain exact types | 已通过 |
| API-006 | 内部不变量与平台／夹具契约：area 保留原生身份且所有方法绑定原生对象 | test/platform-core.node.test.ts :: platform 原生适配器契约 > area 保留原生身份且所有方法绑定原生对象 | 已通过 |
| API-007 | 内部不变量与平台／夹具契约：无 window 导入并创建 factory，兜底共享且与 memo 隔离 | test/platform-helper.node.test.ts :: platform SSR 与惰性探测 > 无 window 导入并创建 factory，兜底共享且与 memo 隔离 | 已通过 |
| API-008 | 内部不变量与平台／夹具契约：导入不访问 getter，首次读取独立探测缓存且保留用户探测键 | test/platform-helper.node.test.ts :: platform SSR 与惰性探测 > 导入不访问 getter，首次读取独立探测缓存且保留用户探测键 | 已通过 |
| API-009 | 内部不变量与平台／夹具契约：探测写失败 QuotaExceededError 仍清理临时键 | test/platform-helper.node.test.ts :: platform SSR 与惰性探测 > 探测写失败 QuotaExceededError 仍清理临时键 | 已通过 |
| API-010 | 内部不变量与平台／夹具契约：探测写失败 NS_ERROR_DOM_QUOTA_REACHED 仍清理临时键 | test/platform-helper.node.test.ts :: platform SSR 与惰性探测 > 探测写失败 NS_ERROR_DOM_QUOTA_REACHED 仍清理临时键 | 已通过 |
| API-011 | 内部不变量与平台／夹具契约：探测写失败 SecurityError 仍清理临时键 | test/platform-helper.node.test.ts :: platform SSR 与惰性探测 > 探测写失败 SecurityError 仍清理临时键 | 已通过 |
| API-012 | JSONX/Memory 平台契约：带标签对象的 toJSON 仍遵循 JSON 语义 | test/platform-serialization.node.test.ts :: platform JSONX > 带标签对象的 toJSON 仍遵循 JSON 语义 | 已通过 |
| API-013 | JSONX/Memory 平台契约：普通 Date 标签往返仍为对象 | test/platform-serialization.node.test.ts :: platform JSONX > 普通 Date 标签往返仍为对象 | 已通过 |
| API-014 | JSONX/Memory 平台契约：普通 Map 标签往返仍为对象 | test/platform-serialization.node.test.ts :: platform JSONX > 普通 Map 标签往返仍为对象 | 已通过 |
| API-015 | JSONX/Memory 平台契约：普通 Set 标签往返仍为对象 | test/platform-serialization.node.test.ts :: platform JSONX > 普通 Set 标签往返仍为对象 | 已通过 |
| API-016 | JSONX/Memory 平台契约：普通 bigint 标签往返仍为对象 | test/platform-serialization.node.test.ts :: platform JSONX > 普通 bigint 标签往返仍为对象 | 已通过 |
| API-017 | JSONX/Memory 平台契约：普通 Object 标签往返仍为对象 | test/platform-serialization.node.test.ts :: platform JSONX > 普通 Object 标签往返仍为对象 | 已通过 |
| API-018 | JSONX/Memory 平台契约：普通 unknown 标签往返仍为对象 | test/platform-serialization.node.test.ts :: platform JSONX > 普通 unknown 标签往返仍为对象 | 已通过 |
| API-019 | JSONX/Memory 平台契约：递归转义外壳、特殊类型和 __proto__ | test/platform-serialization.node.test.ts :: platform JSONX > 递归转义外壳、特殊类型和 __proto__ | 已通过 |
| API-020 | JSONX/Memory 平台契约：旧标签可读，非法 bigint 仍抛错 | test/platform-serialization.node.test.ts :: platform JSONX > 旧标签可读，非法 bigint 仍抛错 | 已通过 |
| API-021 | JSONX/Memory 平台契约：unsigned long 下标 NaN | test/platform-serialization.node.test.ts :: platform Memory > unsigned long 下标 NaN | 已通过 |
| API-022 | JSONX/Memory 平台契约：unsigned long 下标 Infinity | test/platform-serialization.node.test.ts :: platform Memory > unsigned long 下标 Infinity | 已通过 |
| API-023 | JSONX/Memory 平台契约：unsigned long 下标 -Infinity | test/platform-serialization.node.test.ts :: platform Memory > unsigned long 下标 -Infinity | 已通过 |
| API-024 | JSONX/Memory 平台契约：unsigned long 下标 4294967296 | test/platform-serialization.node.test.ts :: platform Memory > unsigned long 下标 4294967296 | 已通过 |
| API-025 | JSONX/Memory 平台契约：unsigned long 下标 -4294967296 | test/platform-serialization.node.test.ts :: platform Memory > unsigned long 下标 -4294967296 | 已通过 |
| API-026 | JSONX/Memory 平台契约：unsigned long 下标 -0.5 | test/platform-serialization.node.test.ts :: platform Memory > unsigned long 下标 -0.5 | 已通过 |
| API-027 | JSONX/Memory 平台契约：向零取整、负数回绕、越界与基础方法 | test/platform-serialization.node.test.ts :: platform Memory > 向零取整、负数回绕、越界与基础方法 | 已通过 |
| API-028 | SSR factory 与后端 kind 契约：ls/ss 内存兜底种类不同，各自模块级共享且身份稳定 | test/sync-kind.node.test.ts :: sync 后端 kind 契约 > ls/ss 内存兜底种类不同，各自模块级共享且身份稳定 | 已通过 |
| API-029 | SSR factory 与后端 kind 契约：Memory 无参兼容 IDB 兜底，显式 kind 不改变存储行为 | test/sync-kind.node.test.ts :: sync 后端 kind 契约 > Memory 无参兼容 IDB 兜底，显式 kind 不改变存储行为 | 已通过 |
| API-030 | SSR factory 与后端 kind 契约：所有 kind 保留键顺序、原生下标转换与删除清空契约 | test/sync-kind.node.test.ts :: sync 后端 kind 契约 > 所有 kind 保留键顺序、原生下标转换与删除清空契约 | 已通过 |
| API-031 | 内部不变量与平台／夹具契约：set/advance 保留真实 timeout，restore 恢复真实 Date | test/helpers/d-clock.node.test.ts :: D node clock > set/advance 保留真实 timeout，restore 恢复真实 Date | 已通过 |
| API-032 | 内部不变量与平台／夹具契约：默认起点固定且允许数字绝对时间 | test/helpers/d-clock.node.test.ts :: D node clock > 默认起点固定且允许数字绝对时间 | 已通过 |
| API-033 | codec/codecBase64/codecAtob 编码格式与兼容契约：非法 base64 和缺少 XOR 标记返回 null，编码格式保持不变 | test/codec.browser.test.ts :: codec — 混淆/编解码 > 非法 base64 和缺少 XOR 标记返回 null，编码格式保持不变 | 已通过 |
| API-034 | codec/codecBase64/codecAtob 编码格式与兼容契约：codec encode/decode 往返 | test/codec.browser.test.ts :: codec — 混淆/编解码 > codec encode/decode 往返 | 已通过 |
| API-035 | codec/codecBase64/codecAtob 编码格式与兼容契约：codec 全 BMP 码元 + 增补平面字符往返，输出恒为合法 UTF-16 | test/codec.browser.test.ts :: codec — 混淆/编解码 > codec 全 BMP 码元 + 增补平面字符往返，输出恒为合法 UTF-16 | 已通过 |
| API-036 | codec/codecBase64/codecAtob 编码格式与兼容契约：codec 长字符串往返 | test/codec.browser.test.ts :: codec — 混淆/编解码 > codec 长字符串往返 | 已通过 |
| API-037 | codec/codecBase64/codecAtob 编码格式与兼容契约：codecBase64 输出无标准 base64 特征（无 + / = 字符） | test/codec.browser.test.ts :: codec — 混淆/编解码 > codecBase64 输出无标准 base64 特征（无 + / = 字符） | 已通过 |
| API-038 | codec/codecBase64/codecAtob 编码格式与兼容契约：codecBase64 无 toBase64 时回退 atob/btoa，格式与原生一致、可互解 | test/codec.browser.test.ts :: codec — 混淆/编解码 > codecBase64 无 toBase64 时回退 atob/btoa，格式与原生一致、可互解 | 已通过 |
| API-039 | codec/codecBase64/codecAtob 编码格式与兼容契约：codecBase64 与 codecAtob 同格式互解；三变体错口令均为 null | test/codec.browser.test.ts :: codec — 混淆/编解码 > codecBase64 与 codecAtob 同格式互解；三变体错口令均为 null | 已通过 |
| API-040 | codec/codecBase64/codecAtob 编码格式与兼容契约：codec 错误口令解码 → null | test/codec.browser.test.ts :: codec — 混淆/编解码 > codec 错误口令解码 → null | 已通过 |
| API-041 | codec/codecBase64/codecAtob 编码格式与兼容契约：空字符串口令按真实口令使用：codecAtob/codecBase64 往返 | test/codec.browser.test.ts :: codec — 混淆/编解码 > 空字符串口令按真实口令使用：codecAtob/codecBase64 往返 | 已通过 |
| API-042 | codec/codecBase64/codecAtob 编码格式与兼容契约：以 U+FEFF 开头的明文往返不丢首字符 | test/codec.browser.test.ts :: codec — 混淆/编解码 > 以 U+FEFF 开头的明文往返不丢首字符 | 已通过 |
| API-043 | 内部不变量与平台／夹具契约：STORE exposes identity and APPLY preserves payload, expiry and commit silence | test/core-contracts.browser.test.ts :: core internal contracts > STORE exposes identity and APPLY preserves payload, expiry and commit silence | 已通过 |
| API-044 | 内部不变量与平台／夹具契约：APPLY always invalidates memo after the backend write completes | test/core-contracts.browser.test.ts :: core internal contracts > APPLY always invalidates memo after the backend write completes | 已通过 |
| API-045 | 内部不变量与平台／夹具契约：APPLY uses encrypted keys while bypassing serialization and value encoding | test/core-contracts.browser.test.ts :: core internal contracts > APPLY uses encrypted keys while bypassing serialization and value encoding | 已通过 |
| API-046 | 内部不变量与平台／夹具契约：snapshot reads retain their namespace | test/core-contracts.browser.test.ts :: core internal contracts > snapshot reads retain their namespace | 已通过 |
| API-047 | 内部不变量与平台／夹具契约：Hub handles absent areas, repeated teardown and malformed broadcasts | test/core-contracts.browser.test.ts :: core internal contracts > Hub handles absent areas, repeated teardown and malformed broadcasts | 已通过 |
| API-048 | 内部不变量与平台／夹具契约：raw memo, readonly, batch omissions and codec warnings remain consistent | test/core-contracts.browser.test.ts :: core option combinations > raw memo, readonly, batch omissions and codec warnings remain consistent | 已通过 |
| API-049 | 内部不变量与平台／夹具契约：serialization callbacks skip initial writes and failed renewals | test/core-contracts.browser.test.ts :: core option combinations > serialization callbacks skip initial writes and failed renewals | 已通过 |
| API-050 | 内部不变量与平台／夹具契约：readonly replaces corrupt values and memo accepts externally supplied entities | test/core-contracts.browser.test.ts :: core option combinations > readonly replaces corrupt values and memo accepts externally supplied entities | 已通过 |
| API-051 | 内部不变量与平台／夹具契约：purge tolerates vanished keys and clear enumeration failures release state | test/core-contracts.browser.test.ts :: core option combinations > purge tolerates vanished keys and clear enumeration failures release state | 已通过 |
| API-052 | 内部不变量与平台／夹具契约：pending sets reach the backend in invocation order | test/core-contracts.browser.test.ts :: core option combinations > pending sets reach the backend in invocation order | 已通过 |
| API-053 | 内部不变量与平台／夹具契约：broadcast custom async backends use the default channel name | test/core-contracts.browser.test.ts :: core option combinations > broadcast custom async backends use the default channel name | 已通过 |
| API-054 | 内部不变量与平台／夹具契约：failed backend deletions preserve corrupt and expired data | test/core-contracts.browser.test.ts :: core option combinations > failed backend deletions preserve corrupt and expired data | 已通过 |
| API-055 | 批量／选项／同步异步返回值契约：batch defaults align with keys and removal reports logical commit keys | test/core-options.browser.test.ts :: core batch and options async=false > batch defaults align with keys and removal reports logical commit keys | 已通过 |
| API-056 | 批量／选项／同步异步返回值契约：raw validation, invalid expiry and cloned objects preserve storage | test/core-options.browser.test.ts :: core batch and options async=false > raw validation, invalid expiry and cloned objects preserve storage | 已通过 |
| API-057 | 批量／选项／同步异步返回值契约：key and value codecs round trip across namespace changes | test/core-options.browser.test.ts :: core batch and options async=false > key and value codecs round trip across namespace changes | 已通过 |
| API-058 | 批量／选项／同步异步返回值契约：batch defaults align with keys and removal reports logical commit keys | test/core-options.browser.test.ts :: core batch and options async=true > batch defaults align with keys and removal reports logical commit keys | 已通过 |
| API-059 | 批量／选项／同步异步返回值契约：raw validation, invalid expiry and cloned objects preserve storage | test/core-options.browser.test.ts :: core batch and options async=true > raw validation, invalid expiry and cloned objects preserve storage | 已通过 |
| API-060 | 批量／选项／同步异步返回值契约：key and value codecs round trip across namespace changes | test/core-options.browser.test.ts :: core batch and options async=true > key and value codecs round trip across namespace changes | 已通过 |
| API-061 | 批量／选项／同步异步返回值契约：core async synchronous backend errors become rejected promises | test/core-options.browser.test.ts :: core async synchronous backend errors become rejected promises | 已通过 |
| API-062 | 批量／选项／同步异步返回值契约：core fast and lazy share accessors and forward write options | test/core-options.browser.test.ts :: core fast and lazy share accessors and forward write options | 已通过 |
| API-063 | 批量／选项／同步异步返回值契约：core force false reports the original failure without retry | test/core-options.browser.test.ts :: core force false reports the original failure without retry | 已通过 |
| API-064 | 内部不变量与平台／夹具契约：Maybe 保留同步结果并串联 Promise，处理器异常不被二次捕获 | test/core-pure.browser.test.ts :: core pure modules > Maybe 保留同步结果并串联 Promise，处理器异常不被二次捕获 | 已通过 |
| API-065 | 内部不变量与平台／夹具契约：keyspace 转义不重叠，普通键兼容，双向缓存有界 | test/core-pure.browser.test.ts :: core pure modules > keyspace 转义不重叠，普通键兼容，双向缓存有界 | 已通过 |
| API-066 | 内部不变量与平台／夹具契约：entity 验证形状、数字元数据、过期边界和续期标志 | test/core-pure.browser.test.ts :: core pure modules > entity 验证形状、数字元数据、过期边界和续期标志 | 已通过 |
| API-067 | 内部不变量与平台／夹具契约：entity 创建和错误上报保留原异常 | test/core-pure.browser.test.ts :: core pure modules > entity 创建和错误上报保留原异常 | 已通过 |
| API-068 | 内部不变量与平台／夹具契约：B1 renew read then set guards backend and memo | test/core-regressions.browser.test.ts :: core races FIFO > B1 renew read then set guards backend and memo | 已通过 |
| API-069 | 内部不变量与平台／夹具契约：B1 renew read then remove guards backend and memo | test/core-regressions.browser.test.ts :: core races FIFO > B1 renew read then remove guards backend and memo | 已通过 |
| API-070 | 内部不变量与平台／夹具契约：B1 expired read then set guards backend and memo | test/core-regressions.browser.test.ts :: core races FIFO > B1 expired read then set guards backend and memo | 已通过 |
| API-071 | 内部不变量与平台／夹具契约：B1 expired read then remove guards backend and memo | test/core-regressions.browser.test.ts :: core races FIFO > B1 expired read then remove guards backend and memo | 已通过 |
| API-072 | 内部不变量与平台／夹具契约：B1 corrupt read then set guards backend and memo | test/core-regressions.browser.test.ts :: core races FIFO > B1 corrupt read then set guards backend and memo | 已通过 |
| API-073 | 内部不变量与平台／夹具契约：B1 corrupt read then remove guards backend and memo | test/core-regressions.browser.test.ts :: core races FIFO > B1 corrupt read then remove guards backend and memo | 已通过 |
| API-074 | 内部不变量与平台／夹具契约：B2 dispatched set then remove does not refill memo | test/core-regressions.browser.test.ts :: core races FIFO > B2 dispatched set then remove does not refill memo | 已通过 |
| API-075 | 内部不变量与平台／夹具契约：B2 dispatched set then clear does not refill memo | test/core-regressions.browser.test.ts :: core races FIFO > B2 dispatched set then clear does not refill memo | 已通过 |
| API-076 | 内部不变量与平台／夹具契约：B3 keys keeps its initial keyspace | test/core-regressions.browser.test.ts :: core races FIFO > B3 keys keeps its initial keyspace | 已通过 |
| API-077 | 内部不变量与平台／夹具契约：B3 clear keeps its initial keyspace | test/core-regressions.browser.test.ts :: core races FIFO > B3 clear keeps its initial keyspace | 已通过 |
| API-078 | 内部不变量与平台／夹具契约：B3 purge keeps its initial keyspace | test/core-regressions.browser.test.ts :: core races FIFO > B3 purge keeps its initial keyspace | 已通过 |
| API-079 | 内部不变量与平台／夹具契约：destroy prevents pending read backfill | test/core-regressions.browser.test.ts :: core races FIFO > destroy prevents pending read backfill | 已通过 |
| API-080 | 内部不变量与平台／夹具契约：unrelated key write does not discard pending memo fill | test/core-regressions.browser.test.ts :: core races FIFO > unrelated key write does not discard pending memo fill | 已通过 |
| API-081 | 内部不变量与平台／夹具契约：readonly preserves null and concurrent first writer wins | test/core-regressions.browser.test.ts :: core races FIFO > readonly preserves null and concurrent first writer wins | 已通过 |
| API-082 | 内部不变量与平台／夹具契约：serialize rejects asynchronously and callback errors preserve identity | test/core-regressions.browser.test.ts :: core races FIFO > serialize rejects asynchronously and callback errors preserve identity | 已通过 |
| API-083 | 内部不变量与平台／夹具契约：corrupt/type distinctions preserve backend and memo contract | test/core-regressions.browser.test.ts :: core races FIFO > corrupt/type distinctions preserve backend and memo contract | 已通过 |
| API-084 | 内部不变量与平台／夹具契约：foreign entity without createdAt never renews | test/core-regressions.browser.test.ts :: core races FIFO > foreign entity without createdAt never renews | 已通过 |
| API-085 | 内部不变量与平台／夹具契约：successful commits include exact payload and renewal source | test/core-regressions.browser.test.ts :: core races FIFO > successful commits include exact payload and renewal source | 已通过 |
| API-086 | 内部不变量与平台／夹具契约：B1 renew read then set guards backend and memo | test/core-regressions.browser.test.ts :: core races IDB > B1 renew read then set guards backend and memo | 已通过 |
| API-087 | 内部不变量与平台／夹具契约：B1 renew read then remove guards backend and memo | test/core-regressions.browser.test.ts :: core races IDB > B1 renew read then remove guards backend and memo | 已通过 |
| API-088 | 内部不变量与平台／夹具契约：B1 expired read then set guards backend and memo | test/core-regressions.browser.test.ts :: core races IDB > B1 expired read then set guards backend and memo | 已通过 |
| API-089 | 内部不变量与平台／夹具契约：B1 expired read then remove guards backend and memo | test/core-regressions.browser.test.ts :: core races IDB > B1 expired read then remove guards backend and memo | 已通过 |
| API-090 | 内部不变量与平台／夹具契约：B1 corrupt read then set guards backend and memo | test/core-regressions.browser.test.ts :: core races IDB > B1 corrupt read then set guards backend and memo | 已通过 |
| API-091 | 内部不变量与平台／夹具契约：B1 corrupt read then remove guards backend and memo | test/core-regressions.browser.test.ts :: core races IDB > B1 corrupt read then remove guards backend and memo | 已通过 |
| API-092 | 内部不变量与平台／夹具契约：B2 dispatched set then remove does not refill memo | test/core-regressions.browser.test.ts :: core races IDB > B2 dispatched set then remove does not refill memo | 已通过 |
| API-093 | 内部不变量与平台／夹具契约：B2 dispatched set then clear does not refill memo | test/core-regressions.browser.test.ts :: core races IDB > B2 dispatched set then clear does not refill memo | 已通过 |
| API-094 | 内部不变量与平台／夹具契约：B3 keys keeps its initial keyspace | test/core-regressions.browser.test.ts :: core races IDB > B3 keys keeps its initial keyspace | 已通过 |
| API-095 | 内部不变量与平台／夹具契约：B3 clear keeps its initial keyspace | test/core-regressions.browser.test.ts :: core races IDB > B3 clear keeps its initial keyspace | 已通过 |
| API-096 | 内部不变量与平台／夹具契约：B3 purge keeps its initial keyspace | test/core-regressions.browser.test.ts :: core races IDB > B3 purge keeps its initial keyspace | 已通过 |
| API-097 | 内部不变量与平台／夹具契约：destroy prevents pending read backfill | test/core-regressions.browser.test.ts :: core races IDB > destroy prevents pending read backfill | 已通过 |
| API-098 | 内部不变量与平台／夹具契约：unrelated key write does not discard pending memo fill | test/core-regressions.browser.test.ts :: core races IDB > unrelated key write does not discard pending memo fill | 已通过 |
| API-099 | 内部不变量与平台／夹具契约：readonly preserves null and concurrent first writer wins | test/core-regressions.browser.test.ts :: core races IDB > readonly preserves null and concurrent first writer wins | 已通过 |
| API-100 | 内部不变量与平台／夹具契约：serialize rejects asynchronously and callback errors preserve identity | test/core-regressions.browser.test.ts :: core races IDB > serialize rejects asynchronously and callback errors preserve identity | 已通过 |
| API-101 | 内部不变量与平台／夹具契约：corrupt/type distinctions preserve backend and memo contract | test/core-regressions.browser.test.ts :: core races IDB > corrupt/type distinctions preserve backend and memo contract | 已通过 |
| API-102 | 内部不变量与平台／夹具契约：foreign entity without createdAt never renews | test/core-regressions.browser.test.ts :: core races IDB > foreign entity without createdAt never renews | 已通过 |
| API-103 | 内部不变量与平台／夹具契约：successful commits include exact payload and renewal source | test/core-regressions.browser.test.ts :: core races IDB > successful commits include exact payload and renewal source | 已通过 |
| API-104 | 内部不变量与平台／夹具契约：same backend factories invalidate each other including nonmemo writer | test/core-regressions.browser.test.ts :: core memo Hub and safe dictionaries > same backend factories invalidate each other including nonmemo writer | 已通过 |
| API-105 | 内部不变量与平台／夹具契约：storage events distinguish area, empty key, and clear | test/core-regressions.browser.test.ts :: core memo Hub and safe dictionaries > storage events distinguish area, empty key, and clear | 已通过 |
| API-106 | 内部不变量与平台／夹具契约：nonmemo instances never register and destroy releases final listener | test/core-regressions.browser.test.ts :: core memo Hub and safe dictionaries > nonmemo instances never register and destroy releases final listener | 已通过 |
| API-107 | 内部不变量与平台／夹具契约：__proto__ stays an own dictionary key | test/core-regressions.browser.test.ts :: core memo Hub and safe dictionaries > __proto__ stays an own dictionary key | 已通过 |
| API-108 | 内部不变量与平台／夹具契约：write and abort preserve original backend errors and callback exceptions | test/core-regressions.browser.test.ts :: core memo Hub and safe dictionaries > write and abort preserve original backend errors and callback exceptions | 已通过 |
| API-109 | 内部不变量与平台／夹具契约：debug keeps captured namespace across asynchronous enumeration | test/core-regressions.browser.test.ts :: core snapshots FIFO > debug keeps captured namespace across asynchronous enumeration | 已通过 |
| API-110 | 内部不变量与平台／夹具契约：undefined envelope is corrupt even when set memoized | test/core-regressions.browser.test.ts :: core snapshots FIFO > undefined envelope is corrupt even when set memoized | 已通过 |
| API-111 | 内部不变量与平台／夹具契约：debug keeps captured namespace across asynchronous enumeration | test/core-regressions.browser.test.ts :: core snapshots IDB > debug keeps captured namespace across asynchronous enumeration | 已通过 |
| API-112 | 内部不变量与平台／夹具契约：undefined envelope is corrupt even when set memoized | test/core-regressions.browser.test.ts :: core snapshots IDB > undefined envelope is corrupt even when set memoized | 已通过 |
| API-113 | 内部不变量与平台／夹具契约：same origin iframe write invalidates parent memo | test/core-regressions.browser.test.ts :: core native events and atomic update > same origin iframe write invalidates parent memo | 已通过 |
| API-114 | 内部不变量与平台／夹具契约：two independent IDB readonly instances use one atomic winner | test/core-regressions.browser.test.ts :: core native events and atomic update > two independent IDB readonly instances use one atomic winner | 已通过 |
| API-115 | 内部不变量与平台／夹具契约：atomic conditional renewal and expiry deletion cannot overwrite another instance | test/core-regressions.browser.test.ts :: core native events and atomic update > atomic conditional renewal and expiry deletion cannot overwrite another instance | 已通过 |
| API-116 | 内部不变量与平台／夹具契约：IDB BroadcastChannel invalidation is opt-in and releases on destroy | test/core-regressions.browser.test.ts :: core native events and atomic update > IDB BroadcastChannel invalidation is opt-in and releases on destroy | 已通过 |
| API-117 | 内部不变量与平台／夹具契约：corrupt callback throws before deletion and remains the same error | test/core-regressions.browser.test.ts :: core error callbacks FIFO > corrupt callback throws before deletion and remains the same error | 已通过 |
| API-118 | 内部不变量与平台／夹具契约：write callback exceptions are never recategorized | test/core-regressions.browser.test.ts :: core error callbacks FIFO > write callback exceptions are never recategorized | 已通过 |
| API-119 | 内部不变量与平台／夹具契约：completed operations release version and readonly queue maps | test/core-regressions.browser.test.ts :: core error callbacks FIFO > completed operations release version and readonly queue maps | 已通过 |
| API-120 | 内部不变量与平台／夹具契约：corrupt callback throws before deletion and remains the same error | test/core-regressions.browser.test.ts :: core error callbacks IDB > corrupt callback throws before deletion and remains the same error | 已通过 |
| API-121 | 内部不变量与平台／夹具契约：write callback exceptions are never recategorized | test/core-regressions.browser.test.ts :: core error callbacks IDB > write callback exceptions are never recategorized | 已通过 |
| API-122 | 内部不变量与平台／夹具契约：completed operations release version and readonly queue maps | test/core-regressions.browser.test.ts :: core error callbacks IDB > completed operations release version and readonly queue maps | 已通过 |
| API-123 | 内部不变量与平台／夹具契约：scoped clear separates a, a:b and percent namespaces | test/core-regressions.browser.test.ts :: core keyspace compatibility and cache > scoped clear separates a, a:b and percent namespaces | 已通过 |
| API-124 | 内部不变量与平台／夹具契约：1000 encrypted keys reuse reverse decoding across keys and length | test/core-regressions.browser.test.ts :: core keyspace compatibility and cache > 1000 encrypted keys reuse reverse decoding across keys and length | 已通过 |
| API-125 | 内部不变量与平台／夹具契约：read started during pending set cannot overwrite committed memo | test/core-regressions.browser.test.ts :: core overlapping writes FIFO > read started during pending set cannot overwrite committed memo | 已通过 |
| API-126 | 内部不变量与平台／夹具契约：read started during pending set cannot overwrite committed memo | test/core-regressions.browser.test.ts :: core overlapping writes IDB > read started during pending set cannot overwrite committed memo | 已通过 |
| API-127 | 内部不变量与平台／夹具契约：enumerates backend without keys async=false | test/core-regressions.browser.test.ts :: core optional backend keys > enumerates backend without keys async=false | 已通过 |
| API-128 | 内部不变量与平台／夹具契约：enumerates backend without keys async=true | test/core-regressions.browser.test.ts :: core optional backend keys > enumerates backend without keys async=true | 已通过 |
| API-129 | 内部不变量与平台／夹具契约：sync serializer and corrupt callback errors propagate without retry | test/core-regressions.browser.test.ts :: core optional backend keys > sync serializer and corrupt callback errors propagate without retry | 已通过 |
| API-130 | 内部不变量与平台／夹具契约：cleanup failure reports once and preserves callback thrown identity | test/core-regressions.browser.test.ts :: core force retry errors > cleanup failure reports once and preserves callback thrown identity | 已通过 |
| API-131 | 内部不变量与平台／夹具契约：force cleanup may reclaim the expired value being replaced | test/core-regressions.browser.test.ts :: core quota recovery on the current key > force cleanup may reclaim the expired value being replaced | 已通过 |
| API-132 | 内部不变量与平台／夹具契约：destroy waits for a pending clear enumeration before closing backend | test/core-regressions.browser.test.ts :: core enumeration lifecycle FIFO > destroy waits for a pending clear enumeration before closing backend | 已通过 |
| API-133 | 内部不变量与平台／夹具契约：destroy waits for a pending clear enumeration before closing backend | test/core-regressions.browser.test.ts :: core enumeration lifecycle IDB > destroy waits for a pending clear enumeration before closing backend | 已通过 |
| API-134 | 内部不变量与平台／夹具契约：debug skips legacy _$debug without deleting it async=false | test/core-regressions.browser.test.ts :: core debug legacy compatibility > debug skips legacy _$debug without deleting it async=false | 已通过 |
| API-135 | 内部不变量与平台／夹具契约：debug skips legacy _$debug without deleting it async=true | test/core-regressions.browser.test.ts :: core debug legacy compatibility > debug skips legacy _$debug without deleting it async=true | 已通过 |
| API-136 | Idb 原语与 factory 生命周期契约：direct string backend set get remove clear length and key | test/idb.browser.test.ts :: IDB platform-specific contracts > direct string backend set get remove clear length and key | 已通过 |
| API-137 | Idb 原语与 factory 生命周期契约：using db without an explicit instance rejects with actionable guidance | test/idb.browser.test.ts :: IDB platform-specific contracts > using db without an explicit instance rejects with actionable guidance | 已通过 |
| API-138 | Idb 原语与 factory 生命周期契约：factory destroy releases all layers and preserves their persisted values | test/idb.browser.test.ts :: IDB platform-specific contracts > factory destroy releases all layers and preserves their persisted values | 已通过 |
| API-139 | Idb 原语与 factory 生命周期契约：request success followed by transaction abort reports abort and rolls back memo and disk | test/idb.browser.test.ts :: IDB platform-specific contracts > request success followed by transaction abort reports abort and rolls back memo and disk | 已通过 |
| API-140 | Idb 原语与 factory 生命周期契约：sliding renewal and unrelated write leave memo expiry identical to committed entity | test/idb.browser.test.ts :: IDB platform-specific contracts > sliding renewal and unrelated write leave memo expiry identical to committed entity | 已通过 |
| API-141 | 批量／fast／lazy／batchFast／debug 契约：mixed memo hits backend reads and missing defaults compose in one batch | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ls > mixed memo hits backend reads and missing defaults compose in one batch | 已通过 |
| API-142 | 批量／fast／lazy／batchFast／debug 契约：batch tuples use position defaults including missing defaults and explicit generic | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ls > batch tuples use position defaults including missing defaults and explicit generic | 已通过 |
| API-143 | 批量／fast／lazy／batchFast／debug 契约：empty batches are noops and short values skip missing positions with a warning | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ls > empty batches are noops and short values skip missing positions with a warning | 已通过 |
| API-144 | 批量／fast／lazy／batchFast／debug 契约：fast lazy and batchFast forward get set remove and protect __proto__ | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ls > fast lazy and batchFast forward get set remove and protect __proto__ | 已通过 |
| API-145 | 批量／fast／lazy／batchFast／debug 契约：debug snapshot preserves namespace and own __proto__ without adding storage keys | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ls > debug snapshot preserves namespace and own __proto__ without adding storage keys | 已通过 |
| API-146 | 批量／fast／lazy／batchFast／debug 契约：mixed memo hits backend reads and missing defaults compose in one batch | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ss > mixed memo hits backend reads and missing defaults compose in one batch | 已通过 |
| API-147 | 批量／fast／lazy／batchFast／debug 契约：batch tuples use position defaults including missing defaults and explicit generic | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ss > batch tuples use position defaults including missing defaults and explicit generic | 已通过 |
| API-148 | 批量／fast／lazy／batchFast／debug 契约：empty batches are noops and short values skip missing positions with a warning | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ss > empty batches are noops and short values skip missing positions with a warning | 已通过 |
| API-149 | 批量／fast／lazy／batchFast／debug 契约：fast lazy and batchFast forward get set remove and protect __proto__ | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ss > fast lazy and batchFast forward get set remove and protect __proto__ | 已通过 |
| API-150 | 批量／fast／lazy／batchFast／debug 契约：debug snapshot preserves namespace and own __proto__ without adding storage keys | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ss > debug snapshot preserves namespace and own __proto__ without adding storage keys | 已通过 |
| API-151 | 批量／fast／lazy／batchFast／debug 契约：mixed memo hits backend reads and missing defaults compose in one batch | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant db > mixed memo hits backend reads and missing defaults compose in one batch | 已通过 |
| API-152 | 批量／fast／lazy／batchFast／debug 契约：batch tuples use position defaults including missing defaults and explicit generic | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant db > batch tuples use position defaults including missing defaults and explicit generic | 已通过 |
| API-153 | 批量／fast／lazy／batchFast／debug 契约：empty batches are noops and short values skip missing positions with a warning | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant db > empty batches are noops and short values skip missing positions with a warning | 已通过 |
| API-154 | 批量／fast／lazy／batchFast／debug 契约：fast lazy and batchFast forward get set remove and protect __proto__ | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant db > fast lazy and batchFast forward get set remove and protect __proto__ | 已通过 |
| API-155 | 批量／fast／lazy／batchFast／debug 契约：debug snapshot preserves namespace and own __proto__ without adding storage keys | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant db > debug snapshot preserves namespace and own __proto__ without adding storage keys | 已通过 |
| API-156 | 批量／fast／lazy／batchFast／debug 契约：mixed memo hits backend reads and missing defaults compose in one batch | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ls(memory) > mixed memo hits backend reads and missing defaults compose in one batch | 已通过 |
| API-157 | 批量／fast／lazy／batchFast／debug 契约：batch tuples use position defaults including missing defaults and explicit generic | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ls(memory) > batch tuples use position defaults including missing defaults and explicit generic | 已通过 |
| API-158 | 批量／fast／lazy／batchFast／debug 契约：empty batches are noops and short values skip missing positions with a warning | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ls(memory) > empty batches are noops and short values skip missing positions with a warning | 已通过 |
| API-159 | 批量／fast／lazy／batchFast／debug 契约：fast lazy and batchFast forward get set remove and protect __proto__ | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ls(memory) > fast lazy and batchFast forward get set remove and protect __proto__ | 已通过 |
| API-160 | 批量／fast／lazy／batchFast／debug 契约：debug snapshot preserves namespace and own __proto__ without adding storage keys | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant ls(memory) > debug snapshot preserves namespace and own __proto__ without adding storage keys | 已通过 |
| API-161 | 批量／fast／lazy／batchFast／debug 契约：mixed memo hits backend reads and missing defaults compose in one batch | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant db(memory) > mixed memo hits backend reads and missing defaults compose in one batch | 已通过 |
| API-162 | 批量／fast／lazy／batchFast／debug 契约：batch tuples use position defaults including missing defaults and explicit generic | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant db(memory) > batch tuples use position defaults including missing defaults and explicit generic | 已通过 |
| API-163 | 批量／fast／lazy／batchFast／debug 契约：empty batches are noops and short values skip missing positions with a warning | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant db(memory) > empty batches are noops and short values skip missing positions with a warning | 已通过 |
| API-164 | 批量／fast／lazy／batchFast／debug 契约：fast lazy and batchFast forward get set remove and protect __proto__ | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant db(memory) > fast lazy and batchFast forward get set remove and protect __proto__ | 已通过 |
| API-165 | 批量／fast／lazy／batchFast／debug 契约：debug snapshot preserves namespace and own __proto__ without adding storage keys | test/matrix-batch-fast.browser.test.ts :: Batch and accessor invariant db(memory) > debug snapshot preserves namespace and own __proto__ without adding storage keys | 已通过 |
| API-166 | onError／默认值契约：type mismatch 0 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > type mismatch 0 returns fallback and preserves stored value | 已通过 |
| API-167 | onError／默认值契约：type mismatch 1 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > type mismatch 1 returns fallback and preserves stored value | 已通过 |
| API-168 | onError／默认值契约：type mismatch 2 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > type mismatch 2 returns fallback and preserves stored value | 已通过 |
| API-169 | onError／默认值契约：type mismatch 3 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > type mismatch 3 returns fallback and preserves stored value | 已通过 |
| API-170 | onError／默认值契约：backend QuotaExceededError reports original error and force false never retries | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > backend QuotaExceededError reports original error and force false never retries | 已通过 |
| API-171 | onError／默认值契约：backend AbortError reports original error and force false never retries | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > backend AbortError reports original error and force false never retries | 已通过 |
| API-172 | onError／默认值契约：serialization errors preserve original error and suppress console logging | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > serialization errors preserve original error and suppress console logging | 已通过 |
| API-173 | onError／默认值契约：user callback exception for serialize propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > user callback exception for serialize propagates unchanged exactly once | 已通过 |
| API-174 | onError／默认值契约：user callback exception for type propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > user callback exception for type propagates unchanged exactly once | 已通过 |
| API-175 | onError／默认值契约：user callback exception for corrupt propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > user callback exception for corrupt propagates unchanged exactly once | 已通过 |
| API-176 | onError／默认值契约：user callback exception for write propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > user callback exception for write propagates unchanged exactly once | 已通过 |
| API-177 | onError／默认值契约：user callback exception for abort propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls > user callback exception for abort propagates unchanged exactly once | 已通过 |
| API-178 | onError／默认值契约：type mismatch 0 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > type mismatch 0 returns fallback and preserves stored value | 已通过 |
| API-179 | onError／默认值契约：type mismatch 1 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > type mismatch 1 returns fallback and preserves stored value | 已通过 |
| API-180 | onError／默认值契约：type mismatch 2 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > type mismatch 2 returns fallback and preserves stored value | 已通过 |
| API-181 | onError／默认值契约：type mismatch 3 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > type mismatch 3 returns fallback and preserves stored value | 已通过 |
| API-182 | onError／默认值契约：backend QuotaExceededError reports original error and force false never retries | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > backend QuotaExceededError reports original error and force false never retries | 已通过 |
| API-183 | onError／默认值契约：backend AbortError reports original error and force false never retries | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > backend AbortError reports original error and force false never retries | 已通过 |
| API-184 | onError／默认值契约：serialization errors preserve original error and suppress console logging | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > serialization errors preserve original error and suppress console logging | 已通过 |
| API-185 | onError／默认值契约：user callback exception for serialize propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > user callback exception for serialize propagates unchanged exactly once | 已通过 |
| API-186 | onError／默认值契约：user callback exception for type propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > user callback exception for type propagates unchanged exactly once | 已通过 |
| API-187 | onError／默认值契约：user callback exception for corrupt propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > user callback exception for corrupt propagates unchanged exactly once | 已通过 |
| API-188 | onError／默认值契约：user callback exception for write propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > user callback exception for write propagates unchanged exactly once | 已通过 |
| API-189 | onError／默认值契约：user callback exception for abort propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ss > user callback exception for abort propagates unchanged exactly once | 已通过 |
| API-190 | onError／默认值契约：type mismatch 0 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > type mismatch 0 returns fallback and preserves stored value | 已通过 |
| API-191 | onError／默认值契约：type mismatch 1 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > type mismatch 1 returns fallback and preserves stored value | 已通过 |
| API-192 | onError／默认值契约：type mismatch 2 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > type mismatch 2 returns fallback and preserves stored value | 已通过 |
| API-193 | onError／默认值契约：type mismatch 3 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > type mismatch 3 returns fallback and preserves stored value | 已通过 |
| API-194 | onError／默认值契约：backend QuotaExceededError reports original error and force false never retries | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > backend QuotaExceededError reports original error and force false never retries | 已通过 |
| API-195 | onError／默认值契约：backend AbortError reports original error and force false never retries | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > backend AbortError reports original error and force false never retries | 已通过 |
| API-196 | onError／默认值契约：serialization errors preserve original error and suppress console logging | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > serialization errors preserve original error and suppress console logging | 已通过 |
| API-197 | onError／默认值契约：user callback exception for serialize propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > user callback exception for serialize propagates unchanged exactly once | 已通过 |
| API-198 | onError／默认值契约：user callback exception for type propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > user callback exception for type propagates unchanged exactly once | 已通过 |
| API-199 | onError／默认值契约：user callback exception for corrupt propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > user callback exception for corrupt propagates unchanged exactly once | 已通过 |
| API-200 | onError／默认值契约：user callback exception for write propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > user callback exception for write propagates unchanged exactly once | 已通过 |
| API-201 | onError／默认值契约：user callback exception for abort propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db > user callback exception for abort propagates unchanged exactly once | 已通过 |
| API-202 | onError／默认值契约：type mismatch 0 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > type mismatch 0 returns fallback and preserves stored value | 已通过 |
| API-203 | onError／默认值契约：type mismatch 1 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > type mismatch 1 returns fallback and preserves stored value | 已通过 |
| API-204 | onError／默认值契约：type mismatch 2 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > type mismatch 2 returns fallback and preserves stored value | 已通过 |
| API-205 | onError／默认值契约：type mismatch 3 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > type mismatch 3 returns fallback and preserves stored value | 已通过 |
| API-206 | onError／默认值契约：backend QuotaExceededError reports original error and force false never retries | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > backend QuotaExceededError reports original error and force false never retries | 已通过 |
| API-207 | onError／默认值契约：backend AbortError reports original error and force false never retries | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > backend AbortError reports original error and force false never retries | 已通过 |
| API-208 | onError／默认值契约：serialization errors preserve original error and suppress console logging | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > serialization errors preserve original error and suppress console logging | 已通过 |
| API-209 | onError／默认值契约：user callback exception for serialize propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > user callback exception for serialize propagates unchanged exactly once | 已通过 |
| API-210 | onError／默认值契约：user callback exception for type propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > user callback exception for type propagates unchanged exactly once | 已通过 |
| API-211 | onError／默认值契约：user callback exception for corrupt propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > user callback exception for corrupt propagates unchanged exactly once | 已通过 |
| API-212 | onError／默认值契约：user callback exception for write propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > user callback exception for write propagates unchanged exactly once | 已通过 |
| API-213 | onError／默认值契约：user callback exception for abort propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant ls(memory) > user callback exception for abort propagates unchanged exactly once | 已通过 |
| API-214 | onError／默认值契约：type mismatch 0 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > type mismatch 0 returns fallback and preserves stored value | 已通过 |
| API-215 | onError／默认值契约：type mismatch 1 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > type mismatch 1 returns fallback and preserves stored value | 已通过 |
| API-216 | onError／默认值契约：type mismatch 2 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > type mismatch 2 returns fallback and preserves stored value | 已通过 |
| API-217 | onError／默认值契约：type mismatch 3 returns fallback and preserves stored value | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > type mismatch 3 returns fallback and preserves stored value | 已通过 |
| API-218 | onError／默认值契约：backend QuotaExceededError reports original error and force false never retries | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > backend QuotaExceededError reports original error and force false never retries | 已通过 |
| API-219 | onError／默认值契约：backend AbortError reports original error and force false never retries | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > backend AbortError reports original error and force false never retries | 已通过 |
| API-220 | onError／默认值契约：serialization errors preserve original error and suppress console logging | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > serialization errors preserve original error and suppress console logging | 已通过 |
| API-221 | onError／默认值契约：user callback exception for serialize propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > user callback exception for serialize propagates unchanged exactly once | 已通过 |
| API-222 | onError／默认值契约：user callback exception for type propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > user callback exception for type propagates unchanged exactly once | 已通过 |
| API-223 | onError／默认值契约：user callback exception for corrupt propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > user callback exception for corrupt propagates unchanged exactly once | 已通过 |
| API-224 | onError／默认值契约：user callback exception for write propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > user callback exception for write propagates unchanged exactly once | 已通过 |
| API-225 | onError／默认值契约：user callback exception for abort propagates unchanged exactly once | test/matrix-error-reporting.browser.test.ts :: Error reporting invariant db(memory) > user callback exception for abort propagates unchanged exactly once | 已通过 |
| API-226 | memoized／cloned／destroy／broadcast 契约：instance memo=false per-call memo=false obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls > instance memo=false per-call memo=false obeys override and invalidation | 已通过 |
| API-227 | memoized／cloned／destroy／broadcast 契约：instance memo=false per-call memo=true obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls > instance memo=false per-call memo=true obeys override and invalidation | 已通过 |
| API-228 | memoized／cloned／destroy／broadcast 契约：instance memo=true per-call memo=false obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls > instance memo=true per-call memo=false obeys override and invalidation | 已通过 |
| API-229 | memoized／cloned／destroy／broadcast 契约：instance memo=true per-call memo=true obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls > instance memo=true per-call memo=true obeys override and invalidation | 已通过 |
| API-230 | memoized／cloned／destroy／broadcast 契约：another factory invalidates cached reads writer memo=false | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls > another factory invalidates cached reads writer memo=false | 已通过 |
| API-231 | memoized／cloned／destroy／broadcast 契约：another factory invalidates cached reads writer memo=true | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls > another factory invalidates cached reads writer memo=true | 已通过 |
| API-232 | memoized／cloned／destroy／broadcast 契约：cloned=false controls nested object and JSONX collection isolation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls > cloned=false controls nested object and JSONX collection isolation | 已通过 |
| API-233 | memoized／cloned／destroy／broadcast 契约：cloned=true controls nested object and JSONX collection isolation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls > cloned=true controls nested object and JSONX collection isolation | 已通过 |
| API-234 | memoized／cloned／destroy／broadcast 契约：destroy drops cached data preserves storage and permits subsequent operations | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls > destroy drops cached data preserves storage and permits subsequent operations | 已通过 |
| API-235 | memoized／cloned／destroy／broadcast 契约：local factories invalidate peer memo | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls > local factories invalidate peer memo | 已通过 |
| API-237 | memoized／cloned／destroy／broadcast 契约：instance memo=false per-call memo=false obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ss > instance memo=false per-call memo=false obeys override and invalidation | 已通过 |
| API-238 | memoized／cloned／destroy／broadcast 契约：instance memo=false per-call memo=true obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ss > instance memo=false per-call memo=true obeys override and invalidation | 已通过 |
| API-239 | memoized／cloned／destroy／broadcast 契约：instance memo=true per-call memo=false obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ss > instance memo=true per-call memo=false obeys override and invalidation | 已通过 |
| API-240 | memoized／cloned／destroy／broadcast 契约：instance memo=true per-call memo=true obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ss > instance memo=true per-call memo=true obeys override and invalidation | 已通过 |
| API-241 | memoized／cloned／destroy／broadcast 契约：another factory invalidates cached reads writer memo=false | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ss > another factory invalidates cached reads writer memo=false | 已通过 |
| API-242 | memoized／cloned／destroy／broadcast 契约：another factory invalidates cached reads writer memo=true | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ss > another factory invalidates cached reads writer memo=true | 已通过 |
| API-243 | memoized／cloned／destroy／broadcast 契约：cloned=false controls nested object and JSONX collection isolation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ss > cloned=false controls nested object and JSONX collection isolation | 已通过 |
| API-244 | memoized／cloned／destroy／broadcast 契约：cloned=true controls nested object and JSONX collection isolation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ss > cloned=true controls nested object and JSONX collection isolation | 已通过 |
| API-245 | memoized／cloned／destroy／broadcast 契约：destroy drops cached data preserves storage and permits subsequent operations | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ss > destroy drops cached data preserves storage and permits subsequent operations | 已通过 |
| API-246 | memoized／cloned／destroy／broadcast 契约：local factories invalidate peer memo | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ss > local factories invalidate peer memo | 已通过 |
| API-248 | memoized／cloned／destroy／broadcast 契约：instance memo=false per-call memo=false obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db > instance memo=false per-call memo=false obeys override and invalidation | 已通过 |
| API-249 | memoized／cloned／destroy／broadcast 契约：instance memo=false per-call memo=true obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db > instance memo=false per-call memo=true obeys override and invalidation | 已通过 |
| API-250 | memoized／cloned／destroy／broadcast 契约：instance memo=true per-call memo=false obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db > instance memo=true per-call memo=false obeys override and invalidation | 已通过 |
| API-251 | memoized／cloned／destroy／broadcast 契约：instance memo=true per-call memo=true obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db > instance memo=true per-call memo=true obeys override and invalidation | 已通过 |
| API-252 | memoized／cloned／destroy／broadcast 契约：another factory invalidates cached reads writer memo=false | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db > another factory invalidates cached reads writer memo=false | 已通过 |
| API-253 | memoized／cloned／destroy／broadcast 契约：another factory invalidates cached reads writer memo=true | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db > another factory invalidates cached reads writer memo=true | 已通过 |
| API-254 | memoized／cloned／destroy／broadcast 契约：cloned=false controls nested object and JSONX collection isolation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db > cloned=false controls nested object and JSONX collection isolation | 已通过 |
| API-255 | memoized／cloned／destroy／broadcast 契约：cloned=true controls nested object and JSONX collection isolation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db > cloned=true controls nested object and JSONX collection isolation | 已通过 |
| API-256 | memoized／cloned／destroy／broadcast 契约：destroy drops cached data preserves storage and permits subsequent operations | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db > destroy drops cached data preserves storage and permits subsequent operations | 已通过 |
| API-257 | memoized／cloned／destroy／broadcast 契约：local factories invalidate peer memo | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db > local factories invalidate peer memo | 已通过 |
| API-259 | memoized／cloned／destroy／broadcast 契约：instance memo=false per-call memo=false obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls(memory) > instance memo=false per-call memo=false obeys override and invalidation | 已通过 |
| API-260 | memoized／cloned／destroy／broadcast 契约：instance memo=false per-call memo=true obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls(memory) > instance memo=false per-call memo=true obeys override and invalidation | 已通过 |
| API-261 | memoized／cloned／destroy／broadcast 契约：instance memo=true per-call memo=false obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls(memory) > instance memo=true per-call memo=false obeys override and invalidation | 已通过 |
| API-262 | memoized／cloned／destroy／broadcast 契约：instance memo=true per-call memo=true obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls(memory) > instance memo=true per-call memo=true obeys override and invalidation | 已通过 |
| API-263 | memoized／cloned／destroy／broadcast 契约：another factory invalidates cached reads writer memo=false | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls(memory) > another factory invalidates cached reads writer memo=false | 已通过 |
| API-264 | memoized／cloned／destroy／broadcast 契约：another factory invalidates cached reads writer memo=true | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls(memory) > another factory invalidates cached reads writer memo=true | 已通过 |
| API-265 | memoized／cloned／destroy／broadcast 契约：cloned=false controls nested object and JSONX collection isolation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls(memory) > cloned=false controls nested object and JSONX collection isolation | 已通过 |
| API-266 | memoized／cloned／destroy／broadcast 契约：cloned=true controls nested object and JSONX collection isolation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls(memory) > cloned=true controls nested object and JSONX collection isolation | 已通过 |
| API-267 | memoized／cloned／destroy／broadcast 契约：destroy drops cached data preserves storage and permits subsequent operations | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls(memory) > destroy drops cached data preserves storage and permits subsequent operations | 已通过 |
| API-268 | memoized／cloned／destroy／broadcast 契约：local factories invalidate peer memo | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant ls(memory) > local factories invalidate peer memo | 已通过 |
| API-270 | memoized／cloned／destroy／broadcast 契约：instance memo=false per-call memo=false obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db(memory) > instance memo=false per-call memo=false obeys override and invalidation | 已通过 |
| API-271 | memoized／cloned／destroy／broadcast 契约：instance memo=false per-call memo=true obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db(memory) > instance memo=false per-call memo=true obeys override and invalidation | 已通过 |
| API-272 | memoized／cloned／destroy／broadcast 契约：instance memo=true per-call memo=false obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db(memory) > instance memo=true per-call memo=false obeys override and invalidation | 已通过 |
| API-273 | memoized／cloned／destroy／broadcast 契约：instance memo=true per-call memo=true obeys override and invalidation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db(memory) > instance memo=true per-call memo=true obeys override and invalidation | 已通过 |
| API-274 | memoized／cloned／destroy／broadcast 契约：another factory invalidates cached reads writer memo=false | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db(memory) > another factory invalidates cached reads writer memo=false | 已通过 |
| API-275 | memoized／cloned／destroy／broadcast 契约：another factory invalidates cached reads writer memo=true | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db(memory) > another factory invalidates cached reads writer memo=true | 已通过 |
| API-276 | memoized／cloned／destroy／broadcast 契约：cloned=false controls nested object and JSONX collection isolation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db(memory) > cloned=false controls nested object and JSONX collection isolation | 已通过 |
| API-277 | memoized／cloned／destroy／broadcast 契约：cloned=true controls nested object and JSONX collection isolation | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db(memory) > cloned=true controls nested object and JSONX collection isolation | 已通过 |
| API-278 | memoized／cloned／destroy／broadcast 契约：destroy drops cached data preserves storage and permits subsequent operations | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db(memory) > destroy drops cached data preserves storage and permits subsequent operations | 已通过 |
| API-279 | memoized／cloned／destroy／broadcast 契约：local factories invalidate peer memo | test/matrix-memo-consistency.browser.test.ts :: Memo and lifecycle invariant db(memory) > local factories invalidate peer memo | 已通过 |
| API-281 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：set get remove clear keys length and deprecated key enumerate logical keys | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant ls > set get remove clear keys length and deprecated key enumerate logical keys | 已通过 |
| API-282 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：namespace boundaries escaping and switching with encoding=false | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant ls > namespace boundaries escaping and switching with encoding=false | 已通过 |
| API-283 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：namespace boundaries escaping and switching with encoding=true | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant ls > namespace boundaries escaping and switching with encoding=true | 已通过 |
| API-284 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：set get remove clear keys length and deprecated key enumerate logical keys | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant ss > set get remove clear keys length and deprecated key enumerate logical keys | 已通过 |
| API-285 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：namespace boundaries escaping and switching with encoding=false | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant ss > namespace boundaries escaping and switching with encoding=false | 已通过 |
| API-286 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：namespace boundaries escaping and switching with encoding=true | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant ss > namespace boundaries escaping and switching with encoding=true | 已通过 |
| API-287 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：set get remove clear keys length and deprecated key enumerate logical keys | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant db > set get remove clear keys length and deprecated key enumerate logical keys | 已通过 |
| API-288 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：namespace boundaries escaping and switching with encoding=false | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant db > namespace boundaries escaping and switching with encoding=false | 已通过 |
| API-289 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：namespace boundaries escaping and switching with encoding=true | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant db > namespace boundaries escaping and switching with encoding=true | 已通过 |
| API-290 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：set get remove clear keys length and deprecated key enumerate logical keys | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant ls(memory) > set get remove clear keys length and deprecated key enumerate logical keys | 已通过 |
| API-291 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：namespace boundaries escaping and switching with encoding=false | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant ls(memory) > namespace boundaries escaping and switching with encoding=false | 已通过 |
| API-292 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：namespace boundaries escaping and switching with encoding=true | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant ls(memory) > namespace boundaries escaping and switching with encoding=true | 已通过 |
| API-293 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：set get remove clear keys length and deprecated key enumerate logical keys | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant db(memory) > set get remove clear keys length and deprecated key enumerate logical keys | 已通过 |
| API-294 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：namespace boundaries escaping and switching with encoding=false | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant db(memory) > namespace boundaries escaping and switching with encoding=false | 已通过 |
| API-295 | ls/ss/db get/set/remove/clear/keys/length/key/setNamespace 契约：namespace boundaries escaping and switching with encoding=true | test/matrix-namespace-keys.browser.test.ts :: Keyspace invariant db(memory) > namespace boundaries escaping and switching with encoding=true | 已通过 |
| API-296 | 内部不变量与平台／夹具契约：force retry reclaims exactly dead entries and preserves live and foreign payloads | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant ls > force retry reclaims exactly dead entries and preserves live and foreign payloads | 已通过 |
| API-297 | 内部不变量与平台／夹具契约：permanent write failures report once per batch key and do not fill memo | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant ls > permanent write failures report once per batch key and do not fill memo | 已通过 |
| API-298 | 内部不变量与平台／夹具契约：force retry reclaims exactly dead entries and preserves live and foreign payloads | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant ss > force retry reclaims exactly dead entries and preserves live and foreign payloads | 已通过 |
| API-299 | 内部不变量与平台／夹具契约：permanent write failures report once per batch key and do not fill memo | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant ss > permanent write failures report once per batch key and do not fill memo | 已通过 |
| API-300 | 内部不变量与平台／夹具契约：force retry reclaims exactly dead entries and preserves live and foreign payloads | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant db > force retry reclaims exactly dead entries and preserves live and foreign payloads | 已通过 |
| API-301 | 内部不变量与平台／夹具契约：permanent write failures report once per batch key and do not fill memo | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant db > permanent write failures report once per batch key and do not fill memo | 已通过 |
| API-302 | 内部不变量与平台／夹具契约：force retry reclaims exactly dead entries and preserves live and foreign payloads | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant ls(memory) > force retry reclaims exactly dead entries and preserves live and foreign payloads | 已通过 |
| API-303 | 内部不变量与平台／夹具契约：permanent write failures report once per batch key and do not fill memo | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant ls(memory) > permanent write failures report once per batch key and do not fill memo | 已通过 |
| API-304 | 内部不变量与平台／夹具契约：force retry reclaims exactly dead entries and preserves live and foreign payloads | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant db(memory) > force retry reclaims exactly dead entries and preserves live and foreign payloads | 已通过 |
| API-305 | 内部不变量与平台／夹具契约：permanent write failures report once per batch key and do not fill memo | test/matrix-purge-quota.browser.test.ts :: Quota recovery invariant db(memory) > permanent write failures report once per batch key and do not fill memo | 已通过 |
| API-306 | 内部不变量与平台／夹具契约：B1 delayed purge cannot overwrite a newer set | test/matrix-races.browser.test.ts :: Additional race invariant IDB > B1 delayed purge cannot overwrite a newer set | 已通过 |
| API-307 | 内部不变量与平台／夹具契约：B1 delayed purge cannot overwrite a newer remove | test/matrix-races.browser.test.ts :: Additional race invariant IDB > B1 delayed purge cannot overwrite a newer remove | 已通过 |
| API-308 | 内部不变量与平台／夹具契约：B1 pending renew read cannot recreate data after clear | test/matrix-races.browser.test.ts :: Additional race invariant IDB > B1 pending renew read cannot recreate data after clear | 已通过 |
| API-309 | 内部不变量与平台／夹具契约：B1 pending expired read cannot recreate data after clear | test/matrix-races.browser.test.ts :: Additional race invariant IDB > B1 pending expired read cannot recreate data after clear | 已通过 |
| API-310 | 内部不变量与平台／夹具契约：B1 pending corrupt read cannot recreate data after clear | test/matrix-races.browser.test.ts :: Additional race invariant IDB > B1 pending corrupt read cannot recreate data after clear | 已通过 |
| API-311 | 内部不变量与平台／夹具契约：B1 delayed purge cannot overwrite a newer set | test/matrix-races.browser.test.ts :: Additional race invariant FIFO > B1 delayed purge cannot overwrite a newer set | 已通过 |
| API-312 | 内部不变量与平台／夹具契约：B1 delayed purge cannot overwrite a newer remove | test/matrix-races.browser.test.ts :: Additional race invariant FIFO > B1 delayed purge cannot overwrite a newer remove | 已通过 |
| API-313 | 内部不变量与平台／夹具契约：B1 pending renew read cannot recreate data after clear | test/matrix-races.browser.test.ts :: Additional race invariant FIFO > B1 pending renew read cannot recreate data after clear | 已通过 |
| API-314 | 内部不变量与平台／夹具契约：B1 pending expired read cannot recreate data after clear | test/matrix-races.browser.test.ts :: Additional race invariant FIFO > B1 pending expired read cannot recreate data after clear | 已通过 |
| API-315 | 内部不变量与平台／夹具契约：B1 pending corrupt read cannot recreate data after clear | test/matrix-races.browser.test.ts :: Additional race invariant FIFO > B1 pending corrupt read cannot recreate data after clear | 已通过 |
| API-316 | readonly 写入契约：writes only absent or expired values and treats stored null as present | test/matrix-readonly-write.browser.test.ts :: Readonly invariant ls > writes only absent or expired values and treats stored null as present | 已通过 |
| API-317 | readonly 写入契约：concurrent readonly calls commit the first value exactly once | test/matrix-readonly-write.browser.test.ts :: Readonly invariant ls > concurrent readonly calls commit the first value exactly once | 已通过 |
| API-318 | readonly 写入契约：writes only absent or expired values and treats stored null as present | test/matrix-readonly-write.browser.test.ts :: Readonly invariant ss > writes only absent or expired values and treats stored null as present | 已通过 |
| API-319 | readonly 写入契约：concurrent readonly calls commit the first value exactly once | test/matrix-readonly-write.browser.test.ts :: Readonly invariant ss > concurrent readonly calls commit the first value exactly once | 已通过 |
| API-320 | readonly 写入契约：writes only absent or expired values and treats stored null as present | test/matrix-readonly-write.browser.test.ts :: Readonly invariant db > writes only absent or expired values and treats stored null as present | 已通过 |
| API-321 | readonly 写入契约：concurrent readonly calls commit the first value exactly once | test/matrix-readonly-write.browser.test.ts :: Readonly invariant db > concurrent readonly calls commit the first value exactly once | 已通过 |
| API-322 | readonly 写入契约：writes only absent or expired values and treats stored null as present | test/matrix-readonly-write.browser.test.ts :: Readonly invariant ls(memory) > writes only absent or expired values and treats stored null as present | 已通过 |
| API-323 | readonly 写入契约：concurrent readonly calls commit the first value exactly once | test/matrix-readonly-write.browser.test.ts :: Readonly invariant ls(memory) > concurrent readonly calls commit the first value exactly once | 已通过 |
| API-324 | readonly 写入契约：writes only absent or expired values and treats stored null as present | test/matrix-readonly-write.browser.test.ts :: Readonly invariant db(memory) > writes only absent or expired values and treats stored null as present | 已通过 |
| API-325 | readonly 写入契约：concurrent readonly calls commit the first value exactly once | test/matrix-readonly-write.browser.test.ts :: Readonly invariant db(memory) > concurrent readonly calls commit the first value exactly once | 已通过 |
| API-326 | JSON/JSONX／codec／raw 与损坏值契约：codeable obscures physical values and a changed codec self heals old data | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > codeable obscures physical values and a changed codec self heals old data | 已通过 |
| API-327 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value null | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > preserves JSON value null | 已通过 |
| API-328 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value false | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > preserves JSON value false | 已通过 |
| API-329 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value 0 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > preserves JSON value 0 | 已通过 |
| API-330 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value "" | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > preserves JSON value "" | 已通过 |
| API-331 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value {"nested":[1,false,null]} | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > preserves JSON value {"nested":[1,false,null]} | 已通过 |
| API-332 | JSON/JSONX／codec／raw 与损坏值契约：undefined becomes a missing-value corrupt envelope and self heals | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > undefined becomes a missing-value corrupt envelope and self heals | 已通过 |
| API-333 | JSON/JSONX／codec／raw 与损坏值契约：JSONX preserves bigint Date Map Set and escaped tag-shaped objects | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > JSONX preserves bigint Date Map Set and escaped tag-shaped objects | 已通过 |
| API-334 | JSON/JSONX／codec／raw 与损坏值契约：JSON Date uses its ISO string representation | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > JSON Date uses its ISO string representation | 已通过 |
| API-335 | JSON/JSONX／codec／raw 与损坏值契约：circular and native JSON bigint failures report serialize without writing | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > circular and native JSON bigint failures report serialize without writing | 已通过 |
| API-336 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload { and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > rejects malformed external payload { and deletes it only once | 已通过 |
| API-337 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > rejects malformed external payload {} and deletes it only once | 已通过 |
| API-338 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"foo":1} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > rejects malformed external payload {"foo":1} and deletes it only once | 已通过 |
| API-339 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload [] and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > rejects malformed external payload [] and deletes it only once | 已通过 |
| API-340 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload null and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > rejects malformed external payload null and deletes it only once | 已通过 |
| API-341 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload 1 and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > rejects malformed external payload 1 and deletes it only once | 已通过 |
| API-342 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"ttl":"10"} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > rejects malformed external payload {"value":1,"ttl":"10"} and deletes it only once | 已通过 |
| API-343 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"createdAt":false} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > rejects malformed external payload {"value":1,"createdAt":false} and deletes it only once | 已通过 |
| API-344 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"expireAt":{}} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > rejects malformed external payload {"value":1,"expireAt":{}} and deletes it only once | 已通过 |
| API-345 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 0 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > encodes values and logical keys with codec variant 0 | 已通过 |
| API-346 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 1 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > encodes values and logical keys with codec variant 1 | 已通过 |
| API-347 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 2 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > encodes values and logical keys with codec variant 2 | 已通过 |
| API-348 | JSON/JSONX／codec／raw 与损坏值契约：warns for enckey without codec and retains plain behavior | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > warns for enckey without codec and retains plain behavior | 已通过 |
| API-349 | JSON/JSONX／codec／raw 与损坏值契约：warns for codeable without codec and retains plain behavior | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > warns for codeable without codec and retains plain behavior | 已通过 |
| API-350 | JSON/JSONX／codec／raw 与损坏值契约：corrupt encoded values report and self heal | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls > corrupt encoded values report and self heal | 已通过 |
| API-351 | JSON/JSONX／codec／raw 与损坏值契约：codeable obscures physical values and a changed codec self heals old data | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > codeable obscures physical values and a changed codec self heals old data | 已通过 |
| API-352 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value null | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > preserves JSON value null | 已通过 |
| API-353 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value false | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > preserves JSON value false | 已通过 |
| API-354 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value 0 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > preserves JSON value 0 | 已通过 |
| API-355 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value "" | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > preserves JSON value "" | 已通过 |
| API-356 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value {"nested":[1,false,null]} | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > preserves JSON value {"nested":[1,false,null]} | 已通过 |
| API-357 | JSON/JSONX／codec／raw 与损坏值契约：undefined becomes a missing-value corrupt envelope and self heals | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > undefined becomes a missing-value corrupt envelope and self heals | 已通过 |
| API-358 | JSON/JSONX／codec／raw 与损坏值契约：JSONX preserves bigint Date Map Set and escaped tag-shaped objects | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > JSONX preserves bigint Date Map Set and escaped tag-shaped objects | 已通过 |
| API-359 | JSON/JSONX／codec／raw 与损坏值契约：JSON Date uses its ISO string representation | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > JSON Date uses its ISO string representation | 已通过 |
| API-360 | JSON/JSONX／codec／raw 与损坏值契约：circular and native JSON bigint failures report serialize without writing | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > circular and native JSON bigint failures report serialize without writing | 已通过 |
| API-361 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload { and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > rejects malformed external payload { and deletes it only once | 已通过 |
| API-362 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > rejects malformed external payload {} and deletes it only once | 已通过 |
| API-363 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"foo":1} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > rejects malformed external payload {"foo":1} and deletes it only once | 已通过 |
| API-364 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload [] and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > rejects malformed external payload [] and deletes it only once | 已通过 |
| API-365 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload null and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > rejects malformed external payload null and deletes it only once | 已通过 |
| API-366 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload 1 and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > rejects malformed external payload 1 and deletes it only once | 已通过 |
| API-367 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"ttl":"10"} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > rejects malformed external payload {"value":1,"ttl":"10"} and deletes it only once | 已通过 |
| API-368 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"createdAt":false} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > rejects malformed external payload {"value":1,"createdAt":false} and deletes it only once | 已通过 |
| API-369 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"expireAt":{}} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > rejects malformed external payload {"value":1,"expireAt":{}} and deletes it only once | 已通过 |
| API-370 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 0 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > encodes values and logical keys with codec variant 0 | 已通过 |
| API-371 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 1 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > encodes values and logical keys with codec variant 1 | 已通过 |
| API-372 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 2 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > encodes values and logical keys with codec variant 2 | 已通过 |
| API-373 | JSON/JSONX／codec／raw 与损坏值契约：warns for enckey without codec and retains plain behavior | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > warns for enckey without codec and retains plain behavior | 已通过 |
| API-374 | JSON/JSONX／codec／raw 与损坏值契约：warns for codeable without codec and retains plain behavior | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > warns for codeable without codec and retains plain behavior | 已通过 |
| API-375 | JSON/JSONX／codec／raw 与损坏值契约：corrupt encoded values report and self heal | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ss > corrupt encoded values report and self heal | 已通过 |
| API-376 | JSON/JSONX／codec／raw 与损坏值契约：codeable obscures physical values and a changed codec self heals old data | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > codeable obscures physical values and a changed codec self heals old data | 已通过 |
| API-377 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value null | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > preserves JSON value null | 已通过 |
| API-378 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value false | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > preserves JSON value false | 已通过 |
| API-379 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value 0 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > preserves JSON value 0 | 已通过 |
| API-380 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value "" | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > preserves JSON value "" | 已通过 |
| API-381 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value {"nested":[1,false,null]} | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > preserves JSON value {"nested":[1,false,null]} | 已通过 |
| API-382 | JSON/JSONX／codec／raw 与损坏值契约：undefined becomes a missing-value corrupt envelope and self heals | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > undefined becomes a missing-value corrupt envelope and self heals | 已通过 |
| API-383 | JSON/JSONX／codec／raw 与损坏值契约：JSONX preserves bigint Date Map Set and escaped tag-shaped objects | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > JSONX preserves bigint Date Map Set and escaped tag-shaped objects | 已通过 |
| API-384 | JSON/JSONX／codec／raw 与损坏值契约：JSON Date uses its ISO string representation | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > JSON Date uses its ISO string representation | 已通过 |
| API-385 | JSON/JSONX／codec／raw 与损坏值契约：circular and native JSON bigint failures report serialize without writing | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > circular and native JSON bigint failures report serialize without writing | 已通过 |
| API-386 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload { and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > rejects malformed external payload { and deletes it only once | 已通过 |
| API-387 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > rejects malformed external payload {} and deletes it only once | 已通过 |
| API-388 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"foo":1} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > rejects malformed external payload {"foo":1} and deletes it only once | 已通过 |
| API-389 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload [] and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > rejects malformed external payload [] and deletes it only once | 已通过 |
| API-390 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload null and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > rejects malformed external payload null and deletes it only once | 已通过 |
| API-391 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload 1 and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > rejects malformed external payload 1 and deletes it only once | 已通过 |
| API-392 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"ttl":"10"} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > rejects malformed external payload {"value":1,"ttl":"10"} and deletes it only once | 已通过 |
| API-393 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"createdAt":false} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > rejects malformed external payload {"value":1,"createdAt":false} and deletes it only once | 已通过 |
| API-394 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"expireAt":{}} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > rejects malformed external payload {"value":1,"expireAt":{}} and deletes it only once | 已通过 |
| API-395 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 0 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > encodes values and logical keys with codec variant 0 | 已通过 |
| API-396 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 1 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > encodes values and logical keys with codec variant 1 | 已通过 |
| API-397 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 2 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > encodes values and logical keys with codec variant 2 | 已通过 |
| API-398 | JSON/JSONX／codec／raw 与损坏值契约：warns for enckey without codec and retains plain behavior | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > warns for enckey without codec and retains plain behavior | 已通过 |
| API-399 | JSON/JSONX／codec／raw 与损坏值契约：warns for codeable without codec and retains plain behavior | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > warns for codeable without codec and retains plain behavior | 已通过 |
| API-400 | JSON/JSONX／codec／raw 与损坏值契约：corrupt encoded values report and self heal | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db > corrupt encoded values report and self heal | 已通过 |
| API-401 | JSON/JSONX／codec／raw 与损坏值契约：codeable obscures physical values and a changed codec self heals old data | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > codeable obscures physical values and a changed codec self heals old data | 已通过 |
| API-402 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value null | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > preserves JSON value null | 已通过 |
| API-403 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value false | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > preserves JSON value false | 已通过 |
| API-404 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value 0 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > preserves JSON value 0 | 已通过 |
| API-405 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value "" | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > preserves JSON value "" | 已通过 |
| API-406 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value {"nested":[1,false,null]} | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > preserves JSON value {"nested":[1,false,null]} | 已通过 |
| API-407 | JSON/JSONX／codec／raw 与损坏值契约：undefined becomes a missing-value corrupt envelope and self heals | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > undefined becomes a missing-value corrupt envelope and self heals | 已通过 |
| API-408 | JSON/JSONX／codec／raw 与损坏值契约：JSONX preserves bigint Date Map Set and escaped tag-shaped objects | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > JSONX preserves bigint Date Map Set and escaped tag-shaped objects | 已通过 |
| API-409 | JSON/JSONX／codec／raw 与损坏值契约：JSON Date uses its ISO string representation | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > JSON Date uses its ISO string representation | 已通过 |
| API-410 | JSON/JSONX／codec／raw 与损坏值契约：circular and native JSON bigint failures report serialize without writing | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > circular and native JSON bigint failures report serialize without writing | 已通过 |
| API-411 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload { and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > rejects malformed external payload { and deletes it only once | 已通过 |
| API-412 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > rejects malformed external payload {} and deletes it only once | 已通过 |
| API-413 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"foo":1} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > rejects malformed external payload {"foo":1} and deletes it only once | 已通过 |
| API-414 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload [] and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > rejects malformed external payload [] and deletes it only once | 已通过 |
| API-415 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload null and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > rejects malformed external payload null and deletes it only once | 已通过 |
| API-416 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload 1 and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > rejects malformed external payload 1 and deletes it only once | 已通过 |
| API-417 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"ttl":"10"} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > rejects malformed external payload {"value":1,"ttl":"10"} and deletes it only once | 已通过 |
| API-418 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"createdAt":false} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > rejects malformed external payload {"value":1,"createdAt":false} and deletes it only once | 已通过 |
| API-419 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"expireAt":{}} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > rejects malformed external payload {"value":1,"expireAt":{}} and deletes it only once | 已通过 |
| API-420 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 0 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > encodes values and logical keys with codec variant 0 | 已通过 |
| API-421 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 1 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > encodes values and logical keys with codec variant 1 | 已通过 |
| API-422 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 2 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > encodes values and logical keys with codec variant 2 | 已通过 |
| API-423 | JSON/JSONX／codec／raw 与损坏值契约：warns for enckey without codec and retains plain behavior | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > warns for enckey without codec and retains plain behavior | 已通过 |
| API-424 | JSON/JSONX／codec／raw 与损坏值契约：warns for codeable without codec and retains plain behavior | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > warns for codeable without codec and retains plain behavior | 已通过 |
| API-425 | JSON/JSONX／codec／raw 与损坏值契约：corrupt encoded values report and self heal | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant ls(memory) > corrupt encoded values report and self heal | 已通过 |
| API-426 | JSON/JSONX／codec／raw 与损坏值契约：codeable obscures physical values and a changed codec self heals old data | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > codeable obscures physical values and a changed codec self heals old data | 已通过 |
| API-427 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value null | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > preserves JSON value null | 已通过 |
| API-428 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value false | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > preserves JSON value false | 已通过 |
| API-429 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value 0 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > preserves JSON value 0 | 已通过 |
| API-430 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value "" | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > preserves JSON value "" | 已通过 |
| API-431 | JSON/JSONX／codec／raw 与损坏值契约：preserves JSON value {"nested":[1,false,null]} | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > preserves JSON value {"nested":[1,false,null]} | 已通过 |
| API-432 | JSON/JSONX／codec／raw 与损坏值契约：undefined becomes a missing-value corrupt envelope and self heals | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > undefined becomes a missing-value corrupt envelope and self heals | 已通过 |
| API-433 | JSON/JSONX／codec／raw 与损坏值契约：JSONX preserves bigint Date Map Set and escaped tag-shaped objects | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > JSONX preserves bigint Date Map Set and escaped tag-shaped objects | 已通过 |
| API-434 | JSON/JSONX／codec／raw 与损坏值契约：JSON Date uses its ISO string representation | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > JSON Date uses its ISO string representation | 已通过 |
| API-435 | JSON/JSONX／codec／raw 与损坏值契约：circular and native JSON bigint failures report serialize without writing | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > circular and native JSON bigint failures report serialize without writing | 已通过 |
| API-436 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload { and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > rejects malformed external payload { and deletes it only once | 已通过 |
| API-437 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > rejects malformed external payload {} and deletes it only once | 已通过 |
| API-438 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"foo":1} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > rejects malformed external payload {"foo":1} and deletes it only once | 已通过 |
| API-439 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload [] and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > rejects malformed external payload [] and deletes it only once | 已通过 |
| API-440 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload null and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > rejects malformed external payload null and deletes it only once | 已通过 |
| API-441 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload 1 and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > rejects malformed external payload 1 and deletes it only once | 已通过 |
| API-442 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"ttl":"10"} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > rejects malformed external payload {"value":1,"ttl":"10"} and deletes it only once | 已通过 |
| API-443 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"createdAt":false} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > rejects malformed external payload {"value":1,"createdAt":false} and deletes it only once | 已通过 |
| API-444 | JSON/JSONX／codec／raw 与损坏值契约：rejects malformed external payload {"value":1,"expireAt":{}} and deletes it only once | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > rejects malformed external payload {"value":1,"expireAt":{}} and deletes it only once | 已通过 |
| API-445 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 0 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > encodes values and logical keys with codec variant 0 | 已通过 |
| API-446 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 1 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > encodes values and logical keys with codec variant 1 | 已通过 |
| API-447 | JSON/JSONX／codec／raw 与损坏值契约：encodes values and logical keys with codec variant 2 | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > encodes values and logical keys with codec variant 2 | 已通过 |
| API-448 | JSON/JSONX／codec／raw 与损坏值契约：warns for enckey without codec and retains plain behavior | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > warns for enckey without codec and retains plain behavior | 已通过 |
| API-449 | JSON/JSONX／codec／raw 与损坏值契约：warns for codeable without codec and retains plain behavior | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > warns for codeable without codec and retains plain behavior | 已通过 |
| API-450 | JSON/JSONX／codec／raw 与损坏值契约：corrupt encoded values report and self heal | test/matrix-serialization-codec.browser.test.ts :: Serialization invariant db(memory) > corrupt encoded values report and self heal | 已通过 |
| API-451 | ttl/expireAt/sliding/purge 契约：expires exactly at expireAt and deletes the physical entry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > expires exactly at expireAt and deletes the physical entry | 已通过 |
| API-452 | ttl/expireAt/sliding/purge 契约：renews at exactly ninety percent remaining and not one millisecond earlier | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > renews at exactly ninety percent remaining and not one millisecond earlier | 已通过 |
| API-453 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl 0 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > ignores invalid ttl 0 and persists without expiry | 已通过 |
| API-454 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -1 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > ignores invalid ttl -1 and persists without expiry | 已通过 |
| API-455 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -1000 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > ignores invalid ttl -1000 and persists without expiry | 已通过 |
| API-456 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl NaN and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > ignores invalid ttl NaN and persists without expiry | 已通过 |
| API-457 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl Infinity and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > ignores invalid ttl Infinity and persists without expiry | 已通过 |
| API-458 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -Infinity and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > ignores invalid ttl -Infinity and persists without expiry | 已通过 |
| API-459 | ttl/expireAt/sliding/purge 契约：absolute expireAt takes precedence over ttl | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > absolute expireAt takes precedence over ttl | 已通过 |
| API-460 | ttl/expireAt/sliding/purge 契约：external entity without createdAt neither expires nor renews | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > external entity without createdAt neither expires nor renews | 已通过 |
| API-461 | ttl/expireAt/sliding/purge 契约：purge removes unread expired entries and preserves live and external entries | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls > purge removes unread expired entries and preserves live and external entries | 已通过 |
| API-462 | ttl/expireAt/sliding/purge 契约：expires exactly at expireAt and deletes the physical entry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ss > expires exactly at expireAt and deletes the physical entry | 已通过 |
| API-463 | ttl/expireAt/sliding/purge 契约：renews at exactly ninety percent remaining and not one millisecond earlier | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ss > renews at exactly ninety percent remaining and not one millisecond earlier | 已通过 |
| API-464 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl 0 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ss > ignores invalid ttl 0 and persists without expiry | 已通过 |
| API-465 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -1 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ss > ignores invalid ttl -1 and persists without expiry | 已通过 |
| API-466 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -1000 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ss > ignores invalid ttl -1000 and persists without expiry | 已通过 |
| API-467 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl NaN and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ss > ignores invalid ttl NaN and persists without expiry | 已通过 |
| API-468 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl Infinity and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ss > ignores invalid ttl Infinity and persists without expiry | 已通过 |
| API-469 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -Infinity and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ss > ignores invalid ttl -Infinity and persists without expiry | 已通过 |
| API-470 | ttl/expireAt/sliding/purge 契约：absolute expireAt takes precedence over ttl | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ss > absolute expireAt takes precedence over ttl | 已通过 |
| API-471 | ttl/expireAt/sliding/purge 契约：external entity without createdAt neither expires nor renews | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ss > external entity without createdAt neither expires nor renews | 已通过 |
| API-472 | ttl/expireAt/sliding/purge 契约：purge removes unread expired entries and preserves live and external entries | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ss > purge removes unread expired entries and preserves live and external entries | 已通过 |
| API-473 | ttl/expireAt/sliding/purge 契约：expires exactly at expireAt and deletes the physical entry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db > expires exactly at expireAt and deletes the physical entry | 已通过 |
| API-474 | ttl/expireAt/sliding/purge 契约：renews at exactly ninety percent remaining and not one millisecond earlier | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db > renews at exactly ninety percent remaining and not one millisecond earlier | 已通过 |
| API-475 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl 0 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db > ignores invalid ttl 0 and persists without expiry | 已通过 |
| API-476 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -1 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db > ignores invalid ttl -1 and persists without expiry | 已通过 |
| API-477 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -1000 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db > ignores invalid ttl -1000 and persists without expiry | 已通过 |
| API-478 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl NaN and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db > ignores invalid ttl NaN and persists without expiry | 已通过 |
| API-479 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl Infinity and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db > ignores invalid ttl Infinity and persists without expiry | 已通过 |
| API-480 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -Infinity and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db > ignores invalid ttl -Infinity and persists without expiry | 已通过 |
| API-481 | ttl/expireAt/sliding/purge 契约：absolute expireAt takes precedence over ttl | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db > absolute expireAt takes precedence over ttl | 已通过 |
| API-482 | ttl/expireAt/sliding/purge 契约：external entity without createdAt neither expires nor renews | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db > external entity without createdAt neither expires nor renews | 已通过 |
| API-483 | ttl/expireAt/sliding/purge 契约：purge removes unread expired entries and preserves live and external entries | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db > purge removes unread expired entries and preserves live and external entries | 已通过 |
| API-484 | ttl/expireAt/sliding/purge 契约：expires exactly at expireAt and deletes the physical entry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls(memory) > expires exactly at expireAt and deletes the physical entry | 已通过 |
| API-485 | ttl/expireAt/sliding/purge 契约：renews at exactly ninety percent remaining and not one millisecond earlier | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls(memory) > renews at exactly ninety percent remaining and not one millisecond earlier | 已通过 |
| API-486 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl 0 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls(memory) > ignores invalid ttl 0 and persists without expiry | 已通过 |
| API-487 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -1 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls(memory) > ignores invalid ttl -1 and persists without expiry | 已通过 |
| API-488 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -1000 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls(memory) > ignores invalid ttl -1000 and persists without expiry | 已通过 |
| API-489 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl NaN and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls(memory) > ignores invalid ttl NaN and persists without expiry | 已通过 |
| API-490 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl Infinity and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls(memory) > ignores invalid ttl Infinity and persists without expiry | 已通过 |
| API-491 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -Infinity and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls(memory) > ignores invalid ttl -Infinity and persists without expiry | 已通过 |
| API-492 | ttl/expireAt/sliding/purge 契约：absolute expireAt takes precedence over ttl | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls(memory) > absolute expireAt takes precedence over ttl | 已通过 |
| API-493 | ttl/expireAt/sliding/purge 契约：external entity without createdAt neither expires nor renews | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls(memory) > external entity without createdAt neither expires nor renews | 已通过 |
| API-494 | ttl/expireAt/sliding/purge 契约：purge removes unread expired entries and preserves live and external entries | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant ls(memory) > purge removes unread expired entries and preserves live and external entries | 已通过 |
| API-495 | ttl/expireAt/sliding/purge 契约：expires exactly at expireAt and deletes the physical entry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db(memory) > expires exactly at expireAt and deletes the physical entry | 已通过 |
| API-496 | ttl/expireAt/sliding/purge 契约：renews at exactly ninety percent remaining and not one millisecond earlier | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db(memory) > renews at exactly ninety percent remaining and not one millisecond earlier | 已通过 |
| API-497 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl 0 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db(memory) > ignores invalid ttl 0 and persists without expiry | 已通过 |
| API-498 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -1 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db(memory) > ignores invalid ttl -1 and persists without expiry | 已通过 |
| API-499 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -1000 and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db(memory) > ignores invalid ttl -1000 and persists without expiry | 已通过 |
| API-500 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl NaN and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db(memory) > ignores invalid ttl NaN and persists without expiry | 已通过 |
| API-501 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl Infinity and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db(memory) > ignores invalid ttl Infinity and persists without expiry | 已通过 |
| API-502 | ttl/expireAt/sliding/purge 契约：ignores invalid ttl -Infinity and persists without expiry | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db(memory) > ignores invalid ttl -Infinity and persists without expiry | 已通过 |
| API-503 | ttl/expireAt/sliding/purge 契约：absolute expireAt takes precedence over ttl | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db(memory) > absolute expireAt takes precedence over ttl | 已通过 |
| API-504 | ttl/expireAt/sliding/purge 契约：external entity without createdAt neither expires nor renews | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db(memory) > external entity without createdAt neither expires nor renews | 已通过 |
| API-505 | ttl/expireAt/sliding/purge 契约：purge removes unread expired entries and preserves live and external entries | test/matrix-ttl-sliding.browser.test.ts :: TTL and sliding invariant db(memory) > purge removes unread expired entries and preserves live and external entries | 已通过 |
| API-506 | 内部不变量与平台／夹具契约：indexedDB getter 抛错仍可导入并使用真实 localStorage | test/platform-helper.browser.test.ts :: platform 浏览器探测 > indexedDB getter 抛错仍可导入并使用真实 localStorage | 已通过 |
| API-507 | Idb update/连接/退避/后端 kind 契约：两个独立 factory 的 readonly 使用事务条件写 | test/platform-idb.browser.test.ts :: platform IDB 原子更新 > 两个独立 factory 的 readonly 使用事务条件写 | 已通过 |
| API-508 | Idb update/连接/退避/后端 kind 契约：两个连接并发条件写只有一个成功，旧读条件删除不覆盖新值 | test/platform-idb.browser.test.ts :: platform IDB 原子更新 > 两个连接并发条件写只有一个成功，旧读条件删除不覆盖新值 | 已通过 |
| API-509 | Idb update/连接/退避/后端 kind 契约：fn 抛错回滚，显式 abort 以 AbortError 拒绝 | test/platform-idb.browser.test.ts :: platform IDB 原子更新 > fn 抛错回滚，显式 abort 以 AbortError 拒绝 | 已通过 |
| API-510 | Idb update/连接/退避/后端 kind 契约：打开失败不污染全局能力或其他实例，退避后可重试 | test/platform-idb.browser.test.ts :: platform IDB 原子更新 > 打开失败不污染全局能力或其他实例，退避后可重试 | 已通过 |
| API-511 | Idb update/连接/退避/后端 kind 契约：请求错误与同步操作错误保留原异常 | test/platform-idb.browser.test.ts :: platform IDB 原子更新 > 请求错误与同步操作错误保留原异常 | 已通过 |
| API-512 | Idb update/连接/退避/后端 kind 契约：连接关闭和版本变更后重新打开，下标越界与缺键返回 null | test/platform-idb.browser.test.ts :: platform IDB 原子更新 > 连接关闭和版本变更后重新打开，下标越界与缺键返回 null | 已通过 |
| API-513 | Idb update/连接/退避/后端 kind 契约：异步打开失败、destroy 在途与指数退避上限 | test/platform-idb.browser.test.ts :: platform IDB 原子更新 > 异步打开失败、destroy 在途与指数退避上限 | 已通过 |
| API-514 | JSONX/Memory/共享兜底浏览器契约：带标签对象的 toJSON 仍遵循 JSON 语义 | test/platform-logic.browser.test.ts :: platform JSONX > 带标签对象的 toJSON 仍遵循 JSON 语义 | 已通过 |
| API-515 | JSONX/Memory/共享兜底浏览器契约：普通 Date 标签往返仍为对象 | test/platform-logic.browser.test.ts :: platform JSONX > 普通 Date 标签往返仍为对象 | 已通过 |
| API-516 | JSONX/Memory/共享兜底浏览器契约：普通 Map 标签往返仍为对象 | test/platform-logic.browser.test.ts :: platform JSONX > 普通 Map 标签往返仍为对象 | 已通过 |
| API-517 | JSONX/Memory/共享兜底浏览器契约：普通 Set 标签往返仍为对象 | test/platform-logic.browser.test.ts :: platform JSONX > 普通 Set 标签往返仍为对象 | 已通过 |
| API-518 | JSONX/Memory/共享兜底浏览器契约：普通 bigint 标签往返仍为对象 | test/platform-logic.browser.test.ts :: platform JSONX > 普通 bigint 标签往返仍为对象 | 已通过 |
| API-519 | JSONX/Memory/共享兜底浏览器契约：普通 Object 标签往返仍为对象 | test/platform-logic.browser.test.ts :: platform JSONX > 普通 Object 标签往返仍为对象 | 已通过 |
| API-520 | JSONX/Memory/共享兜底浏览器契约：普通 unknown 标签往返仍为对象 | test/platform-logic.browser.test.ts :: platform JSONX > 普通 unknown 标签往返仍为对象 | 已通过 |
| API-521 | JSONX/Memory/共享兜底浏览器契约：递归转义外壳、特殊类型和 __proto__ | test/platform-logic.browser.test.ts :: platform JSONX > 递归转义外壳、特殊类型和 __proto__ | 已通过 |
| API-522 | JSONX/Memory/共享兜底浏览器契约：旧标签可读，非法 bigint 仍抛错 | test/platform-logic.browser.test.ts :: platform JSONX > 旧标签可读，非法 bigint 仍抛错 | 已通过 |
| API-523 | JSONX/Memory/共享兜底浏览器契约：unsigned long 下标 NaN | test/platform-logic.browser.test.ts :: platform Memory > unsigned long 下标 NaN | 已通过 |
| API-524 | JSONX/Memory/共享兜底浏览器契约：unsigned long 下标 Infinity | test/platform-logic.browser.test.ts :: platform Memory > unsigned long 下标 Infinity | 已通过 |
| API-525 | JSONX/Memory/共享兜底浏览器契约：unsigned long 下标 -Infinity | test/platform-logic.browser.test.ts :: platform Memory > unsigned long 下标 -Infinity | 已通过 |
| API-526 | JSONX/Memory/共享兜底浏览器契约：unsigned long 下标 4294967296 | test/platform-logic.browser.test.ts :: platform Memory > unsigned long 下标 4294967296 | 已通过 |
| API-527 | JSONX/Memory/共享兜底浏览器契约：unsigned long 下标 -4294967296 | test/platform-logic.browser.test.ts :: platform Memory > unsigned long 下标 -4294967296 | 已通过 |
| API-528 | JSONX/Memory/共享兜底浏览器契约：unsigned long 下标 -0.5 | test/platform-logic.browser.test.ts :: platform Memory > unsigned long 下标 -0.5 | 已通过 |
| API-529 | JSONX/Memory/共享兜底浏览器契约：向零取整、负数回绕、越界与基础方法 | test/platform-logic.browser.test.ts :: platform Memory > 向零取整、负数回绕、越界与基础方法 | 已通过 |
| API-530 | JSONX/Memory/共享兜底浏览器契约：共享 ls/ss 兜底保留数据，memo 与两种后端互相隔离 | test/platform-logic.browser.test.ts :: platform 浏览器兜底 > 共享 ls/ss 兜底保留数据，memo 与两种后端互相隔离 | 已通过 |
| API-531 | JSONX/Memory/共享兜底浏览器契约：Memory.key 与真实 Storage 的 unsigned long 转换一致 | test/platform-logic.browser.test.ts :: platform 浏览器兜底 > Memory.key 与真实 Storage 的 unsigned long 转换一致 | 已通过 |
| API-532 | fast/lazy/batchFast/debug 公开插件契约：fast(ls,key) get/set/remove | test/plugins.browser.test.ts :: fast / lazy — 绑定 key 快捷器 > fast(ls,key) get/set/remove | 已通过 |
| API-533 | fast/lazy/batchFast/debug 公开插件契约：lazy 首次调用才建、之后复用同一实例 | test/plugins.browser.test.ts :: fast / lazy — 绑定 key 快捷器 > lazy 首次调用才建、之后复用同一实例 | 已通过 |
| API-534 | fast/lazy/batchFast/debug 公开插件契约：返回按 key 命名的访问器对象 | test/plugins.browser.test.ts :: batchFast — 批量绑定 > 返回按 key 命名的访问器对象 | 已通过 |
| API-535 | fast/lazy/batchFast/debug 公开插件契约：debug 返回保留命名空间的明文快照（加密场景） | test/plugins.browser.test.ts :: debug — 解密快照 > debug 返回保留命名空间的明文快照（加密场景） | 已通过 |
| API-536 | fast/lazy/batchFast/debug 公开插件契约：debug 分别作用于 ls / ss / db | test/plugins.browser.test.ts :: debug — 解密快照 > debug 分别作用于 ls / ss / db | 已通过 |
| API-537 | fast/lazy/batchFast/debug 公开插件契约：debug 不写入调试键，不增加 keys()/length | test/plugins.browser.test.ts :: debug — 解密快照 > debug 不写入调试键，不增加 keys()/length | 已通过 |
| API-538 | crossTab v2 契约：按实际后端启用，原生 local、idb、无 BroadcastChannel 均 no-op | test/sync-crosstab.browser.test.ts :: crossTab v2 > 按实际后端启用，原生 local、idb、无 BroadcastChannel 均 no-op | 已通过 |
| API-539 | crossTab v2 契约：session 原生与内存均拒绝同步，每个 handler 只警告一次 | test/sync-crosstab.browser.test.ts :: crossTab v2 > session 原生与内存均拒绝同步，每个 handler 只警告一次 | 已通过 |
| API-540 | crossTab v2 契约：set/batch/remove/clear 同步落盘串并清除接收端旧 memo | test/sync-crosstab.browser.test.ts :: crossTab v2 > set/batch/remove/clear 同步落盘串并清除接收端旧 memo | 已通过 |
| API-541 | crossTab v2 契约：加密键和自定义 codec 直写，raw 空串有效且不二次提交 | test/sync-crosstab.browser.test.ts :: crossTab v2 > 加密键和自定义 codec 直写，raw 空串有效且不二次提交 | 已通过 |
| API-542 | crossTab v2 契约：sliding 真实续期也广播，绝对到期时间保持不变 | test/sync-crosstab.browser.test.ts :: crossTab v2 > sliding 真实续期也广播，绝对到期时间保持不变 | 已通过 |
| API-543 | crossTab v2 契约：LWW 拒绝乱序和重复消息，相同 ts 按 from 排序 | test/sync-crosstab.browser.test.ts :: crossTab v2 > LWW 拒绝乱序和重复消息，相同 ts 按 from 排序 | 已通过 |
| API-544 | crossTab v2 契约：clear 屏障防复活并保留较新的键，空 clear 也建立屏障 | test/sync-crosstab.browser.test.ts :: crossTab v2 > clear 屏障防复活并保留较新的键，空 clear 也建立屏障 | 已通过 |
| API-545 | crossTab v2 契约：过期 SET 按带戳 REMOVE 回放，永不重建 TTL | test/sync-crosstab.browser.test.ts :: crossTab v2 > 过期 SET 按带戳 REMOVE 回放，永不重建 TTL | 已通过 |
| API-546 | crossTab v2 契约：畸形、v1、未知操作和回声消息全部忽略 | test/sync-crosstab.browser.test.ts :: crossTab v2 > 畸形、v1、未知操作和回声消息全部忽略 | 已通过 |
| API-547 | crossTab v2 契约：接收端后端异常被捕获，后续消息仍可处理 | test/sync-crosstab.browser.test.ts :: crossTab v2 > 接收端后端异常被捕获，后续消息仍可处理 | 已通过 |
| API-548 | crossTab v2 契约：namespace 隔离，切换后独立维护版本 | test/sync-crosstab.browser.test.ts :: crossTab v2 > namespace 隔离，切换后独立维护版本 | 已通过 |
| API-549 | crossTab v2 契约：重复挂载 no-op，stop 幂等，方法引用不变且可重新挂载 | test/sync-crosstab.browser.test.ts :: crossTab v2 > 重复挂载 no-op，stop 幂等，方法引用不变且可重新挂载 | 已通过 |
| API-550 | crossTab v2 契约：冲突告警保留所有 owners，最后停止后释放通道 | test/sync-crosstab.browser.test.ts :: crossTab v2 > 冲突告警保留所有 owners，最后停止后释放通道 | 已通过 |
| API-551 | crossTab v2 契约：广播克隆失败只警告，本地提交保持成功 | test/sync-crosstab.browser.test.ts :: crossTab v2 > 广播克隆失败只警告，本地提交保持成功 | 已通过 |
| API-552 | crossTab v2 契约：未提交的写入不会广播，订阅停止后不再广播 | test/sync-crosstab.browser.test.ts :: crossTab v2 > 未提交的写入不会广播，订阅停止后不再广播 | 已通过 |
| API-553 | crossTab v2 契约：不依赖全局 supported.storage 开关 | test/sync-crosstab.browser.test.ts :: crossTab v2 > 不依赖全局 supported.storage 开关 | 已通过 |
| API-554 | factory 后端身份/命名空间/生命周期契约：适配器保留实际种类与原生 area 身份 | test/sync-kind.browser.test.ts :: sync 原生后端标记 > 适配器保留实际种类与原生 area 身份 | 已通过 |
| API-555 | factory 后端身份/命名空间/生命周期契约：切换三层命名空间并释放显式 db，缺省 db 仍按原契约报错 | test/sync-kind.browser.test.ts :: sync 原生后端标记 > 切换三层命名空间并释放显式 db，缺省 db 仍按原契约报错 | 已通过 |
| API-556 | factory 后端身份/命名空间/生命周期契约：enckey 加密存储键，get 仍可读 | test/sync-kind.browser.test.ts :: enckey — 键加密 > enckey 加密存储键，get 仍可读 | 已通过 |
| API-557 | factory 后端身份/命名空间/生命周期契约：sessionStorage 访问抛 SecurityError 时 session=false，localStorage 不受影响，factory 不崩 | test/sync-kind.browser.test.ts :: supported — 存储探测相互独立 > sessionStorage 访问抛 SecurityError 时 session=false，localStorage 不受影响，factory 不崩 | 已通过 |
| API-558 | ls/ss 公开方法与选项兼容契约：set + get 字符串 | test/sync.browser.test.ts :: ls — 基础同步读写 > set + get 字符串 | 已通过 |
| API-559 | ls/ss 公开方法与选项兼容契约：set + get 对象（自动 JSON 序列化） | test/sync.browser.test.ts :: ls — 基础同步读写 > set + get 对象（自动 JSON 序列化） | 已通过 |
| API-560 | ls/ss 公开方法与选项兼容契约：get 缺失键 → null | test/sync.browser.test.ts :: ls — 基础同步读写 > get 缺失键 → null | 已通过 |
| API-561 | ls/ss 公开方法与选项兼容契约：get 默认值（缺失时返回默认） | test/sync.browser.test.ts :: ls — 基础同步读写 > get 默认值（缺失时返回默认） | 已通过 |
| API-562 | ls/ss 公开方法与选项兼容契约：get 存在则忽略默认值 | test/sync.browser.test.ts :: ls — 基础同步读写 > get 存在则忽略默认值 | 已通过 |
| API-563 | ls/ss 公开方法与选项兼容契约：remove | test/sync.browser.test.ts :: ls — 基础同步读写 > remove | 已通过 |
| API-564 | ls/ss 公开方法与选项兼容契约：length 反映条目数 | test/sync.browser.test.ts :: ls — 基础同步读写 > length 反映条目数 | 已通过 |
| API-565 | ls/ss 公开方法与选项兼容契约：clear 清空 | test/sync.browser.test.ts :: ls — 基础同步读写 > clear 清空 | 已通过 |
| API-566 | ls/ss 公开方法与选项兼容契约：存取假值（空串/0/false）不被吞成 null | test/sync.browser.test.ts :: ls — 基础同步读写 > 存取假值（空串/0/false）不被吞成 null | 已通过 |
| API-567 | ls/ss 公开方法与选项兼容契约：ttl 未到期可读 | test/sync.browser.test.ts :: 过期 — ttl / expireAt > ttl 未到期可读 | 已通过 |
| API-568 | ls/ss 公开方法与选项兼容契约：ttl 到期后返回 null 并被清除 | test/sync.browser.test.ts :: 过期 — ttl / expireAt > ttl 到期后返回 null 并被清除 | 已通过 |
| API-569 | ls/ss 公开方法与选项兼容契约：expireAt 未来时间（Date）可读 | test/sync.browser.test.ts :: 过期 — ttl / expireAt > expireAt 未来时间（Date）可读 | 已通过 |
| API-570 | ls/ss 公开方法与选项兼容契约：expireAt 过去时间 → 放弃写入（非滑动） | test/sync.browser.test.ts :: 过期 — ttl / expireAt > expireAt 过去时间 → 放弃写入（非滑动） | 已通过 |
| API-571 | ls/ss 公开方法与选项兼容契约：expireAt 接受日期字符串 | test/sync.browser.test.ts :: 过期 — ttl / expireAt > expireAt 接受日期字符串 | 已通过 |
| API-572 | ls/ss 公开方法与选项兼容契约：每次读命中按 ttl 续期 | test/sync.browser.test.ts :: sliding — 滑动续期 > 每次读命中按 ttl 续期 | 已通过 |
| API-573 | ls/ss 公开方法与选项兼容契约：续期有阈值：剩余寿命 >90% 时跳过回写 | test/sync.browser.test.ts :: sliding — 滑动续期 > 续期有阈值：剩余寿命 >90% 时跳过回写 | 已通过 |
| API-574 | ls/ss 公开方法与选项兼容契约：剩余寿命 <90% 时正常续期回写 | test/sync.browser.test.ts :: sliding — 滑动续期 > 剩余寿命 <90% 时正常续期回写 | 已通过 |
| API-575 | ls/ss 公开方法与选项兼容契约：sliding 但无 ttl 时，过去的 expireAt 拒绝写入（不落盘死条目） | test/sync.browser.test.ts :: sliding — 滑动续期 > sliding 但无 ttl 时，过去的 expireAt 拒绝写入（不落盘死条目） | 已通过 |
| API-576 | ls/ss 公开方法与选项兼容契约：sliding + ttl 时，过去的 expireAt 改为从现在按 ttl 续期 | test/sync.browser.test.ts :: sliding — 滑动续期 > sliding + ttl 时，过去的 expireAt 改为从现在按 ttl 续期 | 已通过 |
| API-577 | ls/ss 公开方法与选项兼容契约：实例未开 memoized、条目经 per-call memoized 进 memo：续期后 memo 的 expireAt 同步更新 | test/sync.browser.test.ts :: sliding — memo 续期同步 > 实例未开 memoized、条目经 per-call memoized 进 memo：续期后 memo 的 expireAt 同步更新 | 已通过 |
| API-578 | ls/ss 公开方法与选项兼容契约：不同命名空间同名 key 互不干扰 | test/sync.browser.test.ts :: namespace — 命名空间隔离 > 不同命名空间同名 key 互不干扰 | 已通过 |
| API-579 | ls/ss 公开方法与选项兼容契约：setNamespace 原地切换前缀，已持有引用自动生效（切账号） | test/sync.browser.test.ts :: namespace — 命名空间隔离 > setNamespace 原地切换前缀，已持有引用自动生效（切账号） | 已通过 |
| API-580 | ls/ss 公开方法与选项兼容契约：namespace 实例 clear 只清自己的键，不波及他人 | test/sync.browser.test.ts :: clear — 命名空间/enckey 作用域 > namespace 实例 clear 只清自己的键，不波及他人 | 已通过 |
| API-581 | ls/ss 公开方法与选项兼容契约：enckey 实例 clear 只清能解开的键 | test/sync.browser.test.ts :: clear — 命名空间/enckey 作用域 > enckey 实例 clear 只清能解开的键 | 已通过 |
| API-582 | ls/ss 公开方法与选项兼容契约：无命名空间且未加密键时 clear 整库清空（保持旧语义） | test/sync.browser.test.ts :: clear — 命名空间/enckey 作用域 > 无命名空间且未加密键时 clear 整库清空（保持旧语义） | 已通过 |
| API-583 | ls/ss 公开方法与选项兼容契约：raw 直接存原始字符串（无 entity 信封） | test/sync.browser.test.ts :: raw — 裸存模式 > raw 直接存原始字符串（无 entity 信封） | 已通过 |
| API-584 | ls/ss 公开方法与选项兼容契约：memoized 命中缓存（绕过底层变更） | test/sync.browser.test.ts :: memoized — 读缓存 > memoized 命中缓存（绕过底层变更） | 已通过 |
| API-585 | ls/ss 公开方法与选项兼容契约：JSONX.stringify/parse 往返 Date/Map/Set/bigint | test/sync.browser.test.ts :: serialize — JSONX 富类型 > JSONX.stringify/parse 往返 Date/Map/Set/bigint | 已通过 |
| API-586 | ls/ss 公开方法与选项兼容契约：JSONX 往返无效 Date（不变成 1970 年） | test/sync.browser.test.ts :: serialize — JSONX 富类型 > JSONX 往返无效 Date（不变成 1970 年） | 已通过 |
| API-587 | ls/ss 公开方法与选项兼容契约：storage 配 JSONX 存取富类型 | test/sync.browser.test.ts :: serialize — JSONX 富类型 > storage 配 JSONX 存取富类型 | 已通过 |
| API-588 | ls/ss 公开方法与选项兼容契约：memoized 写入后再用非 memoized 覆盖：不再读到旧缓存（entity） | test/sync.browser.test.ts :: memoized — 写入与旧缓存 > memoized 写入后再用非 memoized 覆盖：不再读到旧缓存（entity） | 已通过 |
| API-589 | ls/ss 公开方法与选项兼容契约：同上（raw 模式） | test/sync.browser.test.ts :: memoized — 写入与旧缓存 > 同上（raw 模式） | 已通过 |
| API-590 | ls/ss 公开方法与选项兼容契约：数字/数组/布尔：返回默认值并清除该键 | test/sync.browser.test.ts :: 脏数据 — 合法 JSON 但非 entity > 数字/数组/布尔：返回默认值并清除该键 | 已通过 |
| API-591 | ls/ss 公开方法与选项兼容契约：非空时丢弃写入，空时才写 | test/sync.browser.test.ts :: readonly — 只写一次 > 非空时丢弃写入，空时才写 | 已通过 |
| API-592 | ls/ss 公开方法与选项兼容契约：已过期视为空，允许写入 | test/sync.browser.test.ts :: readonly — 只写一次 > 已过期视为空，允许写入 | 已通过 |
| API-593 | ls/ss 公开方法与选项兼容契约：ss 基础读写 | test/sync.browser.test.ts :: ss — sessionStorage > ss 基础读写 | 已通过 |
| API-594 | ls/ss 公开方法与选项兼容契约：ls 批量 set/get/remove，默认值逐位生效 | test/sync.browser.test.ts :: 批量 — 数组 keys > ls 批量 set/get/remove，默认值逐位生效 | 已通过 |
| API-595 | ls/ss 公开方法与选项兼容契约：批量 set：values 短于 keys 时缺位键跳过（不写入 undefined） | test/sync.browser.test.ts :: 批量 — 数组 keys > 批量 set：values 短于 keys 时缺位键跳过（不写入 undefined） | 已通过 |
| API-596 | ls/ss 公开方法与选项兼容契约：有命名空间时 key(1.5)/key(NaN) 按向零取整/0 处理，不抛错 | test/sync.browser.test.ts :: key(index) — 下标归一化 > 有命名空间时 key(1.5)/key(NaN) 按向零取整/0 处理，不抛错 | 已通过 |
| API-597 | ls/ss 公开方法与选项兼容契约：keys() 仅返回本命名空间逻辑键，不混入外部数据 | test/sync.browser.test.ts :: keys / purge — 枚举与主动清理 > keys() 仅返回本命名空间逻辑键，不混入外部数据 | 已通过 |
| API-598 | ls/ss 公开方法与选项兼容契约：keys() enckey 场景返回解密后的逻辑键 | test/sync.browser.test.ts :: keys / purge — 枚举与主动清理 > keys() enckey 场景返回解密后的逻辑键 | 已通过 |
| API-599 | ls/ss 公开方法与选项兼容契约：raw 模式下 purge() 不处理裸字符串（即使形如过期 entity） | test/sync.browser.test.ts :: keys / purge — 枚举与主动清理 > raw 模式下 purge() 不处理裸字符串（即使形如过期 entity） | 已通过 |
| API-600 | ls/ss 公开方法与选项兼容契约：purge() 主动回收过期但从未被读取的条目 | test/sync.browser.test.ts :: keys / purge — 枚举与主动清理 > purge() 主动回收过期但从未被读取的条目 | 已通过 |
| API-601 | ls/ss 公开方法与选项兼容契约：cloned: true 时修改返回值不污染缓存 | test/sync.browser.test.ts :: cloned — memo 副本隔离 > cloned: true 时修改返回值不污染缓存 | 已通过 |
| API-602 | ls/ss 公开方法与选项兼容契约：默认共享引用（零开销路径行为不变） | test/sync.browser.test.ts :: cloned — memo 副本隔离 > 默认共享引用（零开销路径行为不变） | 已通过 |
| API-603 | ls/ss 公开方法与选项兼容契约：非 raw 实例不把 raw 字符串误读为 entity（不再返回 undefined） | test/sync.browser.test.ts :: raw 混用 — 共享 memo 守卫 > 非 raw 实例不把 raw 字符串误读为 entity（不再返回 undefined） | 已通过 |
| API-604 | 内部不变量与平台／夹具契约：统一 await 读写并清理后端 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 ls > 统一 await 读写并清理后端 | 已通过 |
| API-605 | 内部不变量与平台／夹具契约：仅 fake Date 时 TTL 精确到期且真实异步完成 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 ls > 仅 fake Date 时 TTL 精确到期且真实异步完成 | 已通过 |
| API-606 | 内部不变量与平台／夹具契约：保留父 realm 的 Date/Map/Set 序列化语义 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 ls > 保留父 realm 的 Date/Map/Set 序列化语义 | 已通过 |
| API-607 | 内部不变量与平台／夹具契约：统一 await 读写并清理后端 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 ss > 统一 await 读写并清理后端 | 已通过 |
| API-608 | 内部不变量与平台／夹具契约：仅 fake Date 时 TTL 精确到期且真实异步完成 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 ss > 仅 fake Date 时 TTL 精确到期且真实异步完成 | 已通过 |
| API-609 | 内部不变量与平台／夹具契约：保留父 realm 的 Date/Map/Set 序列化语义 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 ss > 保留父 realm 的 Date/Map/Set 序列化语义 | 已通过 |
| API-610 | 内部不变量与平台／夹具契约：统一 await 读写并清理后端 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 db > 统一 await 读写并清理后端 | 已通过 |
| API-611 | 内部不变量与平台／夹具契约：仅 fake Date 时 TTL 精确到期且真实异步完成 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 db > 仅 fake Date 时 TTL 精确到期且真实异步完成 | 已通过 |
| API-612 | 内部不变量与平台／夹具契约：保留父 realm 的 Date/Map/Set 序列化语义 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 db > 保留父 realm 的 Date/Map/Set 序列化语义 | 已通过 |
| API-613 | 内部不变量与平台／夹具契约：统一 await 读写并清理后端 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 ls(memory) > 统一 await 读写并清理后端 | 已通过 |
| API-614 | 内部不变量与平台／夹具契约：仅 fake Date 时 TTL 精确到期且真实异步完成 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 ls(memory) > 仅 fake Date 时 TTL 精确到期且真实异步完成 | 已通过 |
| API-615 | 内部不变量与平台／夹具契约：保留父 realm 的 Date/Map/Set 序列化语义 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 ls(memory) > 保留父 realm 的 Date/Map/Set 序列化语义 | 已通过 |
| API-616 | 内部不变量与平台／夹具契约：统一 await 读写并清理后端 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 db(memory) > 统一 await 读写并清理后端 | 已通过 |
| API-617 | 内部不变量与平台／夹具契约：仅 fake Date 时 TTL 精确到期且真实异步完成 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 db(memory) > 仅 fake Date 时 TTL 精确到期且真实异步完成 | 已通过 |
| API-618 | 内部不变量与平台／夹具契约：保留父 realm 的 Date/Map/Set 序列化语义 | test/helpers/d-fixtures.browser.test.ts :: D 共享夹具 db(memory) > 保留父 realm 的 Date/Map/Set 序列化语义 | 已通过 |
| API-619 | 内部不变量与平台／夹具契约：构造选项抛错时仍移除兜底 iframe | test/helpers/d-fixtures.browser.test.ts :: D 夹具资源隔离 > 构造选项抛错时仍移除兜底 iframe | 已通过 |
| API-620 | 内部不变量与平台／夹具契约：随机数据库互不污染且清理后删除真实库 | test/helpers/d-fixtures.browser.test.ts :: D 夹具资源隔离 > 随机数据库互不污染且清理后删除真实库 | 已通过 |
| API-621 | 内部不变量与平台／夹具契约：构造兜底后恢复原生 window 属性 | test/helpers/d-fixtures.browser.test.ts :: D 夹具资源隔离 > 构造兜底后恢复原生 window 属性 | 已通过 |

## 豁免清单

无。已扫描 src，v8 ignore 共 0 条。任何新增豁免必须逐行登记且说明原因；0/0、无记录、缺失或漂移登记仍判失败。

| 源码位置 | 原因 |
| --- | --- |

| API-H2-001 | 第五波回归：F1 pending write survives destroy in its original namespace | test/core-x1.browser.test.ts :: X1 FIFO > F1 pending write survives destroy in its original namespace | 已通过 |
| API-H2-002 | 第五波回归：F1 pending write survives namespace in its original namespace | test/core-x1.browser.test.ts :: X1 FIFO > F1 pending write survives namespace in its original namespace | 已通过 |
| API-H2-003 | 第五波回归：F1 pending write survives hub in its original namespace | test/core-x1.browser.test.ts :: X1 FIFO > F1 pending write survives hub in its original namespace | 已通过 |
| API-H2-004 | 第五波回归：F2 clear before get waits for removal namespace= | test/core-x1.browser.test.ts :: X1 FIFO > F2 clear before get waits for removal namespace= | 已通过 |
| API-H2-005 | 第五波回归：F2 clear before get waits for removal namespace=ns | test/core-x1.browser.test.ts :: X1 FIFO > F2 clear before get waits for removal namespace=ns | 已通过 |
| API-H2-006 | 第五波回归：F1 pending write survives destroy in its original namespace | test/core-x1.browser.test.ts :: X1 IDB > F1 pending write survives destroy in its original namespace | 已通过 |
| API-H2-007 | 第五波回归：F1 pending write survives namespace in its original namespace | test/core-x1.browser.test.ts :: X1 IDB > F1 pending write survives namespace in its original namespace | 已通过 |
| API-H2-008 | 第五波回归：F1 pending write survives hub in its original namespace | test/core-x1.browser.test.ts :: X1 IDB > F1 pending write survives hub in its original namespace | 已通过 |
| API-H2-009 | 第五波回归：F2 clear before get waits for removal namespace= | test/core-x1.browser.test.ts :: X1 IDB > F2 clear before get waits for removal namespace= | 已通过 |
| API-H2-010 | 第五波回归：F2 clear before get waits for removal namespace=ns | test/core-x1.browser.test.ts :: X1 IDB > F2 clear before get waits for removal namespace=ns | 已通过 |
| API-H2-011 | 第五波回归：F2 synchronous clear before get returns default | test/core-x1.browser.test.ts :: F2 synchronous clear before get returns default | 已通过 |
| API-H2-012 | 第五波回归：F3 historical envelopes preserve null metadata without corrupt reports | test/core-x1.browser.test.ts :: F3 historical envelopes preserve null metadata without corrupt reports | 已通过 |
| API-H2-013 | 第五波回归：F5 stored null silently uses primitive defaults and preserves data | test/core-x1.browser.test.ts :: F5 stored null silently uses primitive defaults and preserves data | 已通过 |
| API-H2-014 | 第五波回归：F9 readonly force retries after purging expired data | test/core-x1.browser.test.ts :: F9 readonly force retries after purging expired data | 已通过 |
| API-H2-015 | 第五波回归：F4 crossTab mounts without crypto.randomUUID | test/core-x1.browser.test.ts :: F4 crossTab mounts without crypto.randomUUID | 已通过 |
| API-H2-016 | 第五波回归：F10 real BroadcastChannel replays expired SET as stamped REMOVE | test/core-x1.browser.test.ts :: F10 real BroadcastChannel replays expired SET as stamped REMOVE | 已通过 |
| API-H2-017 | 第五波回归：F11 sliding write errors identify get operation | test/core-x1.browser.test.ts :: F11 sliding write errors identify get operation | 已通过 |
| API-H2-018 | 第五波回归：F13 memo broadcast opens once until destroy | test/core-x1.browser.test.ts :: F13 memo broadcast opens once until destroy | 已通过 |
| API-H2-019 | 第五波回归：F13 destroy closes a channel opened by a pending async write | test/core-x1.browser.test.ts :: F13 destroy closes a channel opened by a pending async write | 已通过 |
| API-H2-020 | 第五波回归：clear fast path failures report once and preserve backend data | test/core-x1.browser.test.ts :: clear fast path failures report once and preserve backend data | 已通过 |
| API-H2-021 | 第五波回归：overlapping clear scans release versions and allow subsequent writes | test/core-x1.browser.test.ts :: overlapping clear scans release versions and allow subsequent writes | 已通过 |
| API-H2-022 | 第五波回归：F14 same-name Idb instances invalidate each other memo | test/core-x1.browser.test.ts :: F14 same-name Idb instances invalidate each other memo | 已通过 |
| API-H2-023 | 第五波回归：F15 untransformed key and length bypass enumeration | test/core-x1.browser.test.ts :: F15 untransformed key and length bypass enumeration | 已通过 |
| API-H2-024 | 第五波回归：F15 real IDB key and count bypass full key enumeration | test/core-x1.browser.test.ts :: F15 real IDB key and count bypass full key enumeration | 已通过 |
| API-H2-025 | 第五波回归：F3 HEAD mkEntity outputs remain readable and nonfinite decoded metadata stays corrupt | test/core-x1.browser.test.ts :: F3 HEAD mkEntity outputs remain readable and nonfinite decoded metadata stays corrupt | 已通过 |
| API-H2-026 | 第五波回归：F12 clear emits one COMMIT and one broadcast namespace= | test/core-x1.browser.test.ts :: F12 clear emits one COMMIT and one broadcast namespace= | 已通过 |
| API-H2-027 | 第五波回归：clear preserves writes started during scanning namespace= | test/core-x1.browser.test.ts :: clear preserves writes started during scanning namespace= | 已通过 |
| API-H2-028 | 第五波回归：F12 clear emits one COMMIT and one broadcast namespace=ns | test/core-x1.browser.test.ts :: F12 clear emits one COMMIT and one broadcast namespace=ns | 已通过 |
| API-H2-029 | 第五波回归：clear preserves writes started during scanning namespace=ns | test/core-x1.browser.test.ts :: clear preserves writes started during scanning namespace=ns | 已通过 |
| API-H2-030 | 第五波回归：F3 historical compatibility 0.0.x omitted ttl | test/core-x1.browser.test.ts :: F3 historical compatibility 0.0.x omitted ttl | 已通过 |
| API-H2-031 | 第五波回归：F3 historical compatibility 0.0.x finite ttl | test/core-x1.browser.test.ts :: F3 historical compatibility 0.0.x finite ttl | 已通过 |
| API-H2-032 | 第五波回归：F3 historical compatibility 0.0.x zero ttl | test/core-x1.browser.test.ts :: F3 historical compatibility 0.0.x zero ttl | 已通过 |
| API-H2-033 | 第五波回归：F3 historical compatibility 0.0.x negative ttl | test/core-x1.browser.test.ts :: F3 historical compatibility 0.0.x negative ttl | 已通过 |
| API-H2-034 | 第五波回归：F3 historical compatibility 0.0.x Infinity ttl | test/core-x1.browser.test.ts :: F3 historical compatibility 0.0.x Infinity ttl | 已通过 |
| API-H2-035 | 第五波回归：F3 historical compatibility 0.0.x NaN ttl | test/core-x1.browser.test.ts :: F3 historical compatibility 0.0.x NaN ttl | 已通过 |
| API-H2-036 | 第五波回归：F3 historical compatibility 0.0.x negative Infinity ttl | test/core-x1.browser.test.ts :: F3 historical compatibility 0.0.x negative Infinity ttl | 已通过 |
| API-H2-037 | 第五波回归：F3 historical compatibility 0.0.x nonfinite ttl plus finite absolute expiry | test/core-x1.browser.test.ts :: F3 historical compatibility 0.0.x nonfinite ttl plus finite absolute expiry | 已通过 |
| API-H2-038 | 第五波回归：F3 historical compatibility 0.0.x absolute Infinity | test/core-x1.browser.test.ts :: F3 historical compatibility 0.0.x absolute Infinity | 已通过 |
| API-H2-039 | 第五波回归：F3 historical compatibility absolute expiry only | test/core-x1.browser.test.ts :: F3 historical compatibility absolute expiry only | 已通过 |
| API-H2-040 | 第五波回归：F3 historical compatibility absolute expiry overrides ttl | test/core-x1.browser.test.ts :: F3 historical compatibility absolute expiry overrides ttl | 已通过 |
| API-H2-041 | 第五波回归：F3 historical compatibility sliding past absolute expiry | test/core-x1.browser.test.ts :: F3 historical compatibility sliding past absolute expiry | 已通过 |
| API-H2-042 | 第五波回归：F3 historical compatibility sliding past expiry without ttl | test/core-x1.browser.test.ts :: F3 historical compatibility sliding past expiry without ttl | 已通过 |
| API-H2-043 | 第五波回归：F3 historical compatibility renewed envelope | test/core-x1.browser.test.ts :: F3 historical compatibility renewed envelope | 已通过 |
| API-H2-044 | 第五波回归：S2 codec value encode preserves exception identity async=false | test/core-x1.browser.test.ts :: S2 codec value encode preserves exception identity async=false | 已通过 |
| API-H2-045 | 第五波回归：S2 codec value encode preserves exception identity async=true | test/core-x1.browser.test.ts :: S2 codec value encode preserves exception identity async=true | 已通过 |
| API-H2-046 | 第五波回归：F2 clear before get cannot return the old token | test/matrix-races.browser.test.ts :: Additional race invariant FIFO > F2 clear before get cannot return the old token | 已通过 |
| API-H2-047 | 第五波回归：F2 clear before get cannot return the old token | test/matrix-races.browser.test.ts :: Additional race invariant IDB > F2 clear before get cannot return the old token | 已通过 |
| API-H2-048 | 第五波回归：clear 忽略无关 key 与 payload 字段 | test/sync-crosstab.browser.test.ts :: crossTab v2 > clear 忽略无关 key 与 payload 字段 | 已通过 |

| API-X2-001 | 第六波回归：X2 FIFO > G1 read own writes memo=false | test/core-x2.browser.test.ts :: X2 FIFO > G1 read own writes memo=false | 已通过（定向实测） |
| API-X2-002 | 第六波回归：X2 FIFO > G1 read own writes memo=true | test/core-x2.browser.test.ts :: X2 FIFO > G1 read own writes memo=true | 已通过（定向实测） |
| API-X2-003 | 第六波回归：X2 FIFO > G3 peer eviction preserves a write waiting for clear | test/core-x2.browser.test.ts :: X2 FIFO > G3 peer eviction preserves a write waiting for clear | 已通过（定向实测） |
| API-X2-004 | 第六波回归：X2 FIFO > G5 clear gates enumeration and purge | test/core-x2.browser.test.ts :: X2 FIFO > G5 clear gates enumeration and purge | 已通过（定向实测） |
| API-X2-005 | 第六波回归：X2 IDB > G1 read own writes memo=false | test/core-x2.browser.test.ts :: X2 IDB > G1 read own writes memo=false | 已通过（定向实测） |
| API-X2-006 | 第六波回归：X2 IDB > G1 read own writes memo=true | test/core-x2.browser.test.ts :: X2 IDB > G1 read own writes memo=true | 已通过（定向实测） |
| API-X2-007 | 第六波回归：X2 IDB > G3 peer eviction preserves a write waiting for clear | test/core-x2.browser.test.ts :: X2 IDB > G3 peer eviction preserves a write waiting for clear | 已通过（定向实测） |
| API-X2-008 | 第六波回归：X2 IDB > G5 clear gates enumeration and purge | test/core-x2.browser.test.ts :: X2 IDB > G5 clear gates enumeration and purge | 已通过（定向实测） |
| API-X2-009 | 第六波回归：G2 clear removes old value before skipped or failed set readonly | test/core-x2.browser.test.ts :: G2 clear removes old value before skipped or failed set readonly | 已通过（定向实测） |
| API-X2-010 | 第六波回归：G2 clear removes old value before skipped or failed set write | test/core-x2.browser.test.ts :: G2 clear removes old value before skipped or failed set write | 已通过（定向实测） |
| API-X2-011 | 第六波回归：G2 clear removes old value before skipped or failed set serialize | test/core-x2.browser.test.ts :: G2 clear removes old value before skipped or failed set serialize | 已通过（定向实测） |
| API-X2-012 | 第六波回归：G2 clear removes old value before skipped or failed set expiry | test/core-x2.browser.test.ts :: G2 clear removes old value before skipped or failed set expiry | 已通过（定向实测） |
| API-X2-013 | 第六波回归：G4 failed clear does not reject queued reads and writes | test/core-x2.browser.test.ts :: G4 failed clear does not reject queued reads and writes | 已通过（定向实测） |
| API-X2-014 | 第六波回归：G5 synchronous queries preserve their return types | test/core-x2.browser.test.ts :: G5 synchronous queries preserve their return types | 已通过（定向实测） |
| API-X2-015 | 第六波回归：G9 plain clear blocks backend dispatch until the barrier settles | test/core-x2.browser.test.ts :: G9 plain clear blocks backend dispatch until the barrier settles | 已通过（定向实测） |
| API-X2-016 | 第六波回归：G6 partial clear suppresses COMMIT and invalidates peer memo | test/core-x2.browser.test.ts :: G6 partial clear suppresses COMMIT and invalidates peer memo | 已通过（定向实测） |
| API-X2-017 | 第六波回归：G7 primitive default for stored null still renews sliding expiry | test/core-x2.browser.test.ts :: G7 primitive default for stored null still renews sliding expiry | 已通过（定向实测） |

| BUG-G1 | P1：恢复立即派发、入口 memo 失效及同键逐次落盘 | test/core-x2.browser.test.ts :: X2 IDB > G1 read own writes memo=false | 已修复（定向实测） |
| BUG-G2 | P2：不跳过排队后写键，复用令牌，readonly/失败后写不遗留旧值 | test/core-x2.browser.test.ts :: G2 clear removes old value before skipped or failed set readonly | 已修复（定向实测） |
| BUG-G2-write | 后端失败后旧值已删除 | test/core-x2.browser.test.ts :: G2 clear removes old value before skipped or failed set write | 已修复（定向实测） |
| BUG-G2-serialize | 序列化失败后旧值已删除 | test/core-x2.browser.test.ts :: G2 clear removes old value before skipped or failed set serialize | 已修复（定向实测） |
| BUG-G2-expiry | 非法 expireAt 后旧值已删除 | test/core-x2.browser.test.ts :: G2 clear removes old value before skipped or failed set expiry | 已修复（定向实测） |
| BUG-G3 | P2：单键 Hub 失效保留在途写令牌（真实 IDB） | test/core-x2.browser.test.ts :: X2 IDB > G3 peer eviction preserves a write waiting for clear | 已修复（定向实测） |
| BUG-G3-FIFO | FIFO 对等处理器失效不取消后写 | test/core-x2.browser.test.ts :: X2 FIFO > G3 peer eviction preserves a write waiting for clear | 已修复（定向实测） |
| BUG-G4 | clear 回调抛错不污染后发读写 | test/core-x2.browser.test.ts :: G4 failed clear does not reject queued reads and writes | 已修复（定向实测） |
| BUG-G5 | 枚举/purge 等待 clear 完成（真实 IDB） | test/core-x2.browser.test.ts :: X2 IDB > G5 clear gates enumeration and purge | 已修复（定向实测） |
| BUG-G5-sync | 同步后端保持同步值与返回类型 | test/core-x2.browser.test.ts :: G5 synchronous queries preserve their return types | 已修复（定向实测） |
| BUG-G6 | 部分失败不发 clear COMMIT，Hub memo 仍失效 | test/core-x2.browser.test.ts :: G6 partial clear suppresses COMMIT and invalidates peer memo | 已修复（定向实测） |
| BUG-G7 | null 原始默认值仍滑动续期 | test/core-x2.browser.test.ts :: G7 primitive default for stored null still renews sliding expiry | 已修复（定向实测） |
| BUG-G9 | 空 namespace 屏障直接断言后端尚未派发 | test/core-x2.browser.test.ts :: G9 plain clear blocks backend dispatch until the barrier settles | 已修复（定向实测） |
| BUG-G8 | 注释/README/架构/CHANGELOG 与运行时对齐；非 memo clone 按源码确认，体积实测 | CHANGELOG.md :: 0.2.0 (unreleased) | 文档核对：已更新；无独立文档行为回归 |

## 豁免/未映射

无。新增 X2 17 条真实展开用例已精确登记，白名单 0 行；全量计数待主会话重新验收。禁止全局通配，动态标题报错。

| ID | 描述及临时未映射理由 | 测试位置（文件 :: describe > it） | 状态 |
| --- | --- | --- | --- |

## 运行摘要

第六波 X2（2026-11-06，Asia/Shanghai）。遵守续跑内存约束，以下均为定向实测，未跑全量 browser/node、test:cov、gate 或 accept。全量门槛仍为 lines 100%、branches ≥95%，不得用定向覆盖率替代全量验收。

| 命令 | 本轮结果 |
| --- | --- |
| pnpm test --run test/core-x2.browser.test.ts（旧实现） | 14 失败、2 通过，覆盖 G1–G7 的复现；随后新增 G9 门控例 |
| 撤修 G1/G2/G3/G5，分别运行 core-x2 -t G* | 分别 4/4/2/2 条失败；恢复后全部通过；G3 加门控后 FIFO/IDB 均失败 |
| pnpm test --run test/core-x2.browser.test.ts test/core-x1.browser.test.ts test/core-contracts.browser.test.ts test/core-regressions.browser.test.ts test/core-options.browser.test.ts test/core-pure.browser.test.ts | 6 文件，155/155 |
| pnpm test:node test/core-pure.node.test.ts test/core-types.node.test.ts | 2 文件，5/5 |
| node scripts/run-coverage.mjs（上述 8 文件过滤，--coverage.reportsDirectory=coverage-x2） | 160/160；proxy lines 139/139=100%，branches 327/330=99.09%；全 src 定向 lines 403/523、branches 522/615，非全量门禁结果；产物已清理 |
| pnpm test:infra | 27/27 |
| pnpm lint --format json | exit 0；0 errors、139 warnings |
| pnpm build | exit 0；min 17,240 B / gzip-9 6,843 B（Node 实测；0.1.2：11,192 / 4,537） |
| fr/v.mts～v6.mts | 原脚本只读重跑，G1–G7 输出正确；v6h 默认历史 HEAD 的 memo+旧值组合返回 0；临时加载器只重定向 proxy 到新源码后全部返回 1，原脚本未修改 |
| 全量 browser/node/cov/gate/accept | 未重跑，留主会话统一验收；旧基线 632+32=664，lines 520/520、branches 598/600 仅供历史比较 |

新增 INV-42～45、BUG-G1～G9 与 API-X2-001～017；INV-35 收窄为成功后写保留。contracts 同键写标题已改为按调用顺序全部落盘；X1 扫描删除计数改为 2。F2 原空空间及同步用例保留为冒烟，G9 增加撤掉屏障必失败的后端派发断言，G5-sync 确认同步类型与值。没有新增依赖、v8 ignore 或放宽门槛。

- `pnpm test` 保持只跑 Chromium 浏览器套件；`pnpm test:node` 只跑 Node 套件。
- `pnpm test:cov` 用 scripts/vitest.all.config.ts 的两个 projects 在单次运行中由 Vitest 合并覆盖率，
  仅统计 src/\*\*，产出 coverage/coverage-summary.json 和 coverage/coverage-final.json。
  不平均两份百分比，不累加重复行。开始前删除旧 coverage，测试失败仍尽可能生成报告。
- `node scripts/coverage-gate.mjs [summary路径]` 检查 lines 100%、branches ≥95%，
  空报告、0/0、缺失源码记录及未登记 v8 ignore 一律失败；阈值按未四舍五入比例比较。
- `pnpm accept` 重新跑 browser/node，JSON reporter 写入 coverage/acceptance-results.json；
  `node scripts/check-acceptance.mjs --report 路径` 可核对已有报告，调用方须保证报告新鲜。
  使用 JSON 的 ancestorTitles + title，避免词法抽取误展开 describe.each / it.each。
  标题须为静态字符串（含无插值反引号）；动态计算标题直接失败。
  标题含竖线时在 Markdown 单元格写成 `\|`；`>` 是层级分隔符，标题自身不要使用它。
  each 使用 %s / $name 等占位符，矩阵逐行登记实际展开后的完整标题；不使用未展开模板。
  每个用例行同时覆盖其所有 describe 祖先；空 suite、空报告、悬空引用均失败。
  测试声明使用直接导入的 describe/it/test，不使用别名或包装生成声明。
- `pnpm gate` 依次运行覆盖率、门禁和验收校验，任一失败退出非零。
- `pnpm test:infra` 用 Node 自带 test runner 测试门禁及校验脚本，不需要新依赖。
- BACKENDS 与 `await make(backend, opts)` 提供五种后端；统一 `await handler.set/get`。
  在 finally 中 `await cleanup()`；默认随机 namespace，真实 IDB 每例随机库名并关闭/删库。
  兜底通过独立同源 iframe 临时禁止 window 属性并加载公开入口构造，随后恢复属性；
  cleanup 移除 iframe。原生 ESM 的 vi.resetModules 不可靠，因此不依赖其重置能力缓存。
  每个兜底 fixture 有独立模块 realm；验证模块级兜底共享须在同一 realm 内调用多个 factory。
- clock 只 fake Date，不替换 setTimeout、performance 或微任务；finally 中 restore。
  Chromium 中五种后端的精确到期与真实异步已验证；真实 IDB 事务不受 fake Date 干扰。
- test/types.check.ts 是仅编译的类型契约样例，不进入运行时测试。
  推荐 `pnpm exec vp lint -c oxlint.config.ts test/types.check.ts`，当前样例零诊断。
  `node scripts/check-type-chain.mjs` 实测 TS2578、expectTypeOf 错配及有效抑制均可用。
  无需运行 tsgo；本任务未执行 tsgo / vue-tsc / typecheck。
- 版本：Vite Plus 0.1.22 的包内 devDependencies 标明 Vitest 4.1.6，本项目 browser、
  browser-playwright、coverage-v8 均对齐 4.1.6；catalog 中覆盖率已经是 4.1.6。
  两个浏览器插件采用本项目精确版本，避免修改其他项目共用的 catalog 条目。
  运行器自身 version 仍为 0.1.22，因此仍提示混版警告；覆盖率采集可实际完成，
  不能通过强行覆盖版本号消除提示。相关上游记录：
  https://github.com/voidzero-dev/vite-plus/issues/1825 。
