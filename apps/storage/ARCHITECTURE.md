# @codejoo/storage 架构

本文以 `src/` 当前实现为准。公共入口为 `src/index.ts`，调试工具从 `@codejoo/storage/debug` 单独导入。`factory()` 创建明确的 `ls`、`ss`、`db` 三个处理器；`db` 必须通过 `db: new Idb()` 或满足 `AsyncStorage` 的后端显式配置。

## 模块与依赖方向

| 模块 | 职责与依赖 |
| --- | --- |
| `interface.ts` | `SyncStore`、`AsyncStorage`、`MemoCache`、`Codec`、`StorageEntity`、实例和单次写入选项；类型依赖 `errors.ts`；后端可选 readonly kind 为 local / session / idb。 |
| `maybe.ts` | `Maybe`、`isPromise`、`chain`、`attempt`、`all`，合并同步值与 Promise 编排，无存储 IO。 |
| `keyspace.ts` | `keyspace()` 捕获不可变命名空间，提供 `prefix`、`plain`、`full`、`owns`、`logical`；正反向转换各有 1024 项有界缓存。 |
| `entity.ts` | `mkEntity`、`parseEntity`、`isExpired`、`renewOf`、`typeMismatch`，负责信封、期限和轻量类型规则。 |
| `errors.ts` | `StorageErrorInfo`、`StorageOperation`、`report`，统一错误分类及回调。 |
| `hub.ts` | `memoHub`、`register`、`invalidate`；按后端身份共享失效通知，管理 storage 事件与可选广播。 |
| `proxy.ts` | `proxy()` 和 `Handlers`，把上述规则编排成统一处理器，管理 memo、每键版本、全局代数与在途操作。内部 COMMIT / SNAPSHOT / STORE / APPLY Symbol 不从公共入口导出；STORE 读取实际后端，APPLY 静默回放物理载荷。 |
| `core.ts` | `factory()`，适配原生 Storage，组装三层处理器、独立 memo 和共享兜底。 |
| `helper.ts` | `supported.storage`、`supported.session`、`supported.indexedDB` 惰性能力探测。 |
| `memory.ts` | `Memory`，Map 后端，同时可作为独立 memo；不是 IDB 全量镜像。 |
| `idb.ts` | `Idb`，按事务访问 IndexedDB，提供原子 `update`、共享内存降级与实例级重试。 |
| `codec.ts` | `codec`、`codecBase64`、`codecAtob`，字符串混淆，键和值可分别开启。 |
| `serialization.ts` | `JSONX`，Date / Map / Set / bigint 标签序列化，转义含 `__jt__` 的普通对象。 |
| `fast.ts` | `fast`、`lazy`、`batchFast`，复用处理器签名。 |
| `debug.ts` | `debug`，通过内部 `SNAPSHOT` 固定键空间，输出明文快照。 |
| `sync.ts` | `crossTab`，纯内存场景的跨标签同步插件；协议状态见下文。 |
| `index.ts` | 公共运行时与类型导出，排除 debug 及 proxy 内部 Symbol。 |

依赖主要从公共入口到 `core` / 插件，再到 `proxy`，最后到规则模块和后端契约。`proxy → maybe / keyspace / entity / errors / hub`；`core → proxy / helper / memory`；`idb → helper / memory`。`hub` 会管理 IO 监听器，不是纯函数模块。`keyspace` 与 `entity` 通过类型契约连接配置，编解码器由调用方注入。

## 处理器与数据流

同步后端以数字属性 `length` 标识；异步后端以 `length()` 标识。`Result<S,T>` 对异步后端返回 `Promise<T>`，同步后端直接返回 `T`。后端统一使用 `get/set/remove`；原生 Storage 的方法在 `core.ts` 内适配。

写入：捕获键空间和单次选项 → 逻辑键转物理键 → 建立每键操作令牌 → 校验 raw / 期限 → `mkEntity` → `serialize`（默认 JSON）→ 可选值编码 → 后端写入 → 成功提交后通知 Hub 与内部 `COMMIT` → 在版本仍有效时回填 memo。单次配置只有 `ttl`、`expireAt`、`memoized`。批量操作基于逐键处理，不构成整批事务；缺少的值跳过并告警。

读取：捕获键空间 → memo 或后端字符串 → raw 直接返回；普通模式解码、反序列化并校验信封 → 判过期 → 根据默认值检查类型 → 必要时续期 → 有效时回填 memo → 返回值。缺失返回默认值，未指定或指定 undefined 时默认 null。`cloned` 对普通模式对象值做 structuredClone，包含非 memo 读取；不可克隆对象可能抛错。默认共享引用。

过期读取返回默认值并条件删除。损坏读取先报告 `corrupt` 再条件删除；若用户回调抛错，后续删除不会执行。类型不符报告 `type`、返回默认值，保留落盘数据。此检查只比较原始类型的 typeof 与数组形状，不验证普通对象内部结构；不传默认值不触发。存 null 配原始类型默认值时静默返回默认值，不上报 type，保留 null；对象默认值仍可返回 null，数组默认值则仍做形状检查。`purge()` 仅扫描当前键空间中的有效过期信封，跳过无法解析的数据；raw 模式不清理。

`force:true` 默认开启：同步 set（含 readonly）失败时，尝试清理本范围过期数据并重试一次；仍失败走 `onError` 或 console.error。`force:false` 不清理、不重试，写失败同样上报且不抛后端错误。异步后端不走这套配额清理重试。序列化异常有回调时报告，无回调时同步抛出 / 异步 reject；用户回调自身异常原样传播，因此不能笼统承诺所有 set 都不抛。

## entity 与期限

`StorageEntity` 为 `{ value, createdAt?, expireAt?, ttl? }`。必须是非数组对象，有自有 `value` 属性；存在的时间字段必须为有限 number；历史 `ttl:null`、`expireAt:null` 视为字段缺失，兼容旧版 Infinity/NaN 经 JSON 落盘的形态。`createdAt:null` 仍为损坏；不能把全部 null 元数据都当成缺失。新写入带 `createdAt`。默认 JSON 会省略 undefined 属性，因此 `set(k, undefined)` 形成缺少 value 的损坏信封，随后读取返回默认值并按损坏处理；它不回填 memo。

正数且有限的 `ttl` 生成绝对 `expireAt`；非法 ttl 告警并忽略。显式 `expireAt` 优先于 ttl；非法日期或已经过去的期限放弃写入，唯 `sliding` 且有有效 ttl 时，过去的期限改用 now + ttl。

过期需同时存在 `createdAt` 与 `expireAt`，且 now >= expireAt。续期还需有效正 ttl，且剩余寿命 <= 原 ttl 的 90%；构造新信封，以 now + ttl 写回，成功后才替换 memo，绝不原地修改共享信封。

续期不做配额清理/重试；存 null 配原始类型默认值只替换返回值，仍执行续期。

`readonly:true` 依据内部存在性检查，存储的 null 也算存在；缺失、过期或无效信封可重写。同一异步处理器按键串行；跨实例原子保证需要后端提供 `update`。

## 版本、代数和键空间快照

每个操作开始时捕获不可变 `keyspace`。异步返回后枚举、清理、续期、写入、通知仍使用这份快照，不能读取已切换的命名空间。debug 也固定开始时的快照。

proxy 按物理键保存版本令牌和在途引用；新写入替换令牌，读可共享当前令牌。写入有效性 `writable` 仅比较令牌身份；读侧副作用与 memo 回填使用 `valid = cacheable && !token._stale && 代数相同 && writable()`。有写在途时启动的读不可回填或续期/删除。令牌在最后一个操作完成且无扫描保护时回收，readonly 队列完成后移除。

`setNamespace()`、`destroy()` 及全范围 Hub 失效推进代数、清 memo，阻止旧读回填/副作用，但不撤销写令牌。异步写无闸门时立即按调用顺序派发，入口先移除旧 memo，同键写逐次落盘；有 clear 屏障时和 get 等同一跳，readonly 队列仍串联。destroy 等待在途任务后关闭后端。单键 evict 遇到在途写只标记 `_stale`，使 valid 失效而 writable 仍有效；没有在途写才删除令牌。

## clear 路径与屏障

clear 捕获键空间、推进代数并清除旧令牌。无前缀且无有效键 codec（`plain`）时，直接调用后端 clear；length/key 也直接查后端，与 0.1.x 一致。原生 Storage 整库 clear 保持原生事件语义，Idb 整库 clear 是一个 readwrite 事务。有前缀/键编码时扫描自有物理键，逐键删除，不构成整范围事务。

扫描 clear 删除全部自有旧键，以非 mutation 操作复用后写令牌，不跳过排队后写的键。同处理器 get/set/keys/length/key/purge 及快照查询均等待 `clearing`；屏障是 `task.then(noop, noop)`，clear 自身仍传播回调异常，屏障后的操作独立执行。仅当前 barrier 可复位 clearing。同步后端没有 Promise 屏障，保持同步返回。此屏障不构成跨实例锁。

扫描内部每键删除不发布 Hub 或 COMMIT；全部成功才发一个 clear COMMIT，整库快路径也仅成功时提交。完成清理无条件发一次 Hub null 失效，包含部分失败与回调抛错。删除失败报告 onError/console.error，用户回调、枚举异常仍可能传播；清除不是整体事务。

## 原子 update 后端契约

`AsyncStorage.update?` 是可选原语：

```ts
update?(key: string,
  fn: (current: string | null) => string | null | undefined
): Promise<string | null>;
```

在单个后端事务内读取最终字符串，调用同步纯函数：返回 string 写入、null 删除、undefined 保持；提交后 resolve 最终串或 null。fn 禁止 await、Promise 和外部 IO，抛错应回滚并 reject。

`Idb.update` 在同一个 readwrite 事务内完成上述过程；proxy 用它比较预期落盘串，用于 readonly、续期、过期 / 损坏清理及 purge 条件更新。没有该原语的自定义异步后端仍可用，但版本防护只约束同一处理器。普通 set、整批操作和扫描 clear 不因此获得跨标签事务；plain clear 使用后端自己的整库语义。

## memo 失效与共享内存兜底

`area ?? store` 是 Hub 的后端身份，以 WeakMap 共享同标签通知。原生适配器的 area 为真实 Storage 对象。开始使用缓存时才注册；非缓存写入仍发布通知。成功 set / remove / clear 及续期通知其他订阅者失效，不把业务数据放进 Hub。

原生 storage 事件以 storageArea 区分 localStorage / sessionStorage，key 为 null 时全部失效。localStorage 覆盖共享该存储区的其他标签；sessionStorage 仍受浏览器同顶层上下文的会话隔离约束，不会因此跨独立标签共享。当前标签直接调用原生 Storage 方法不产生本标签 storage 事件；绕过处理器的写入可能使本标签 memo 陈旧。

Idb 跨标签失效需显式 `broadcast:true`，且依赖 BroadcastChannel 和匹配的数据库名通道；默认关闭。Hub 传输的是物理键或 null，不传值。通道在首次 connect/publish 时惰性打开，非 memo 发布者也持续复用至 destroy，而非每次写新建/关闭。Idb 用模块级 `Map<name, object>` 按库名共享 area，同名不同对象的同标签 memo 自动互相失效，无需 broadcast；连接仍各自管理。area/fallback 注册表在模块生命周期保留，库名大量动态增长会保留相应条目。自定义后端应提供稳定且代表同一存储域的 area；命名通道也需避免碰撞。`destroy()` 注销 Hub、清空 memo、等待在途异步任务并关闭可关闭后端，保留后端数据；后续使用可重新连接。

ls 与 ss 内存兜底是两个模块级单例；Idb 按库名与仓库名共享内存兜底。同一模块 / realm 的多个 factory 可共享兜底数据，每个处理器的 memo 仍各自独立。兜底存落盘串，memo 存解析后信封或 raw 字符串，两者必须是不同实例。关闭处理器、清 memo 或切空间都不能清掉兜底后端。

Idb 打开失败仅影响本实例，不改全局能力标记。按 1 / 2 / 4…秒、最高 30 秒退避，下一次操作触发重试；连接关闭后可重开。恢复 IDB 后不自动迁移内存期间的写入。

## 惰性探测

导入模块不访问 window 存储属性。首次读取 `supported` 对应字段才独立探测并缓存；factory 使用 storage / session，Idb 使用 indexedDB。探测键随机且避开现有键，清理放在 finally 中；属性 getter 抛错被捕获。配额满不等于不支持，保留原生读取能力。无 window 可导入并退回内存；Worker / SSR 持久化不在本轮范围。

## 结构化错误

`onError(info)` 的判别联合包含 `kind`、`op`、逻辑 `key`、原始 `error`。op 为 get / set / remove / clear / purge，整范围操作的 key 可为空串。

| kind | 触发与处理 |
| --- | --- |
| `write` | 后端写入 / 删除失败，上报后放弃；不承诺所有后端读取或枚举异常都包装。 |
| `serialize` | 信封序列化 / 值编码失败；有回调报告，否则抛出或 reject。 |
| `corrupt` | 值解码、解析或信封校验失败；报告后尝试条件删除并返回默认值。 |
| `type` | 默认值可检查且类型不符，报告、返回默认值，保留数据。 |
| `abort` | 被包装的后端事务失败且 error.name 为 AbortError。 |

未提供回调时 report 使用 console.error；用户回调抛出的异常原样传播。Idb 原语直接调用时仍按 Promise reject 契约工作。

## 命名空间与键编码

先将 namespace 的 `%` 替换为 `%25`，再将 `:` 替换为 `%3A`，最后添加 `:` 分隔符。逻辑 key 不转义。空 namespace 无前缀。示例：`a:b%` → `a%3Ab%25:`；`a` 与 `a:b` 不再共享前缀。`namespace` getter 返回转义后的前缀。

`enckey:true` 且提供 codec 时，对前缀与逻辑键整体确定性编码；与值的 `codeable` 开关独立。keys / length / clear / purge 统一按 owns 限定管辖范围；无 namespace / 键编码时覆盖整个后端。历史特殊命名空间须手动迁移，见 README。

## crossTab v2

`crossTab(handler, channel?)` 接受同步处理器并返回幂等停止函数；通过内部 `STORE` 读取真实后端，只对 `kind:"local"` 且为当前模块 `Memory` 实例的兜底启用。原生 localStorage、Idb、其他后端均为空操作；ss 不论原生还是兜底都跳过，并对同一处理器仅告警一次。缺少 BroadcastChannel 或重复挂载也为空操作。同通道不同处理器仅告警，调用方应分配独立通道。

当前消息为 `{ v:2, op, ns, key?, payload?, expireAt?, ts, from }`：op 为 set / remove / clear，ns 为转义前缀，key 是逻辑键（不是计划里的 sk），set 必须有最终落盘串 payload；expireAt 是可选绝对期限。from 是挂载时的随机身份（randomUUID 可选，无该方法则随机数加时间回退），ts 为结合本地时间与已见时间推进的逻辑时间。

通过 `COMMIT` 只广播成功提交，包括滑动续期、读后删除；不包装公开 set 重新计算 ttl。接收端校验 v、op、当前命名空间、键/载荷形状、有限时间及发送方，忽略自身、畸形及旧协议；已过期 SET 转为带原 `(ts, from)` 戳的 REMOVE，按 LWW 删除更旧值并记录戳；通过内部 `APPLY` 静默写落盘串、失效 memo，不产生新的 COMMIT 回环。APPLY 是针对同步回放的内部入口，回放前使读侧有效性失效，保留有在途写的令牌。

按 namespace + key 记录 `(ts, from)`，仅严格更新的消息回放；clear 有命名空间屏障，逐键清除比它旧的值，保留已知更新的键。v2 与旧数组协议标签互相忽略。应用自行协调 setNamespace；仅处理接收时同命名空间消息，无初始全量同步或断线补偿。停止函数注销订阅、关闭通道且可重复调用。LWW 不提供强一致，不保证所有消息交错或时钟条件下收敛。

## 不变量清单

- 同步 / 异步共用 Maybe 编排；异步入口的同步异常转为 reject，不能丢失后端 length() 的 this。
- 操作使用开始时的 keyspace；写仅检查每键令牌，读副作用/memo 回填检查令牌、代数与 cacheable。切空间/destroy 保留在途写；clear/后续同键变更仍可使旧令牌失效。
- 后端成功后才通知与缓存；续期复制信封，失败不得提前污染 memo。
- 除正常过期外，读路径仅 corrupt 会清理数据；type mismatch 保留数据。
- clear 扫描删除全部旧键并复用后写令牌；get/set/keys/length/key/purge 等待 clear，内部删除不发逐键通知，全部成功才发 clear COMMIT，Hub null 总会失效。plain clear/length/key 直达后端；raw 不参与过期清理。
- readonly 保留有效 null；异步同键串行，跨实例条件写依赖可选 update。
- memo 与共享兜底严格分离；destroy 不删持久数据或兜底，未配置 db 时 factory.destroy 跳过它。
- memoized 控制缓存写入；per-call 关闭缓存的成功写入须移除旧 memo，per-call 开启也必须接受失效通知。
- 批量 get 必须显式传递每一位默认值，不能直接 keys.map(get) 导致下标成为默认值；批量操作不是整体原子事务。
- 键转换缓存有界，操作令牌和队列需释放，Hub 最后一个订阅释放全局监听器。
- 历史 ttl/expireAt:null 视为缺失，createdAt:null 不兼容；存 null 配原始类型默认值静默返回默认值，但 readonly 仍视其为存在。
- JSONX 保持旧富类型标签可读，并转义新写入的业务 __jt__ 字段；不支持循环引用。
- batchFast / debug 使用无原型结果对象，`__proto__` 是普通自有键；debug 正常触发过期清理和续期。
- codec.decode 返回 null 表示不可解码，不能保证不同口令严格隔离；空口令不能被默认口令覆盖。
- sessionStorage 的标签隔离不应被同步插件打破；crossTab 排除全部 session 后端，回放不应再次广播。
- es2022 构建目标保持；运行时告警 / 错误使用英文。

## PURE 与 tree-shake

`core.ts` 的模块级 ls/ss Memory、`idb.ts` 的 fallback/area Map，以及 hub/sync 的模块级集合初始化使用 `/*#__PURE__*/` 标注。配合 package.json 的 `sideEffects:false` 与按模块 ESM，供打包器裁剪未用代码；不是对所有操作无副作用的承诺。语法目标保持 es2022，./min 保持全量单文件契约，不拆 Idb/crossTab；实际体积见 CHANGELOG。

## 已知限制

memo 失效是通知机制，范围受 storage 事件、后端身份和 opt-in 广播限制；不同库副本 / realm 的模块级内存不共享。IDB 跨标签通知默认关闭，丢失通知或绕过处理器写入可能留下旧 memo。crossTab v2 不提供强一致，协议 LWW 状态属于挂载实例，不持久化。

codec 为混淆而非安全加密：默认口令派生空间有限，可能口令碰撞；base64 方案也不能保证口令互斥，且用 TextEncoder 编码含孤立代理的键可能丢失码元。D11 的新 codec 格式本轮不做。不要以 codec 作为安全隔离边界。

过期主要是惰性的；枚举可能包含尚未读取的过期键。Idb 故障恢复不迁移兜底写入。扫描 clear 可能部分成功；此时不发 clear COMMIT，Hub 仍失效，应用需通过 onError 处理剩余键。不提供运行时对象 schema、跨标签锁或整批事务。Worker / SSR 仅保证可导入及内存降级，持久化不在范围。

第六波 X2 构建实测：min 17,240 B / gzip-9 6,843 B；0.1.2 基线 11,192 B / 4,537 B。
