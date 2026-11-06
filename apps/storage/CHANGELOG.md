# Changelog

## 0.2.0 (unreleased)

本轮只发布 0.2.0；package.json 的 version 由用户发版时处理，当前保持 0.1.2。体积：`dist/index.min.js` 17,240 B（0.1.2 基线 11,192 B，+54%），gzip -9 6,843 B（基线 4,537 B，+51%）；增量来自每键竞态防护、结构化错误、Hub、crossTab v2、Idb 原子 update 与退避重试。

### Breaking

- **BREAKING — 命名空间转义**：仅 namespace 内的 `%` / `:` 依次变为 `%25` / `%3A`；逻辑键不转义，不含特殊字符的空间保持原键。含冒号的常见空间（如 `"user:42"`）升级后将读不到旧数据；不会自动迁移。下面片段**仅适用于非 enckey 场景**。迁移时停写、显式列出逻辑键，原样复制信封以保留期限；不要扫描歧义旧前缀：

  ```ts
  const ns = "user:42%";
  const next = ns.replaceAll("%", "%25").replaceAll(":", "%3A") + ":";
  for (const key of ["token", "profile"]) {
    const from = ns + ":" + key;
    const to = next + key;
    const payload = localStorage.getItem(from);
    if (payload !== null && localStorage.getItem(to) === null) {
      localStorage.setItem(to, payload);
      if (localStorage.getItem(to) === payload) localStorage.removeItem(from);
    }
  }
  ```

  enckey 不能直接使用上述片段，需另用相同 codec 编码完整的新旧物理键；Idb 通过后端逐次 await。外部迁移后重建缓存处理器。

- **BREAKING — onError 签名**：回调现在接收结构化 `StorageErrorInfo`，读损坏、类型不符和序列化也可能上报；不再假定 op 只能是 set。迁移：

  ```ts
  import { factory, type StorageErrorInfo } from "@codejoo/storage";
  const onError = ({ kind, op, key, error }: StorageErrorInfo): void => {
    console.error(kind, op, key, error);
  };
  const { ls } = factory({ onError });
  ```

  回调异常原样传播。未配置回调时普通报告走 console.error；序列化异常仍同步抛出/异步 reject。

- **BREAKING — 默认值类型不符**：原始类型/数组默认值与落盘值不符时返回默认值、上报 type、保留数据；普通对象不做 schema 校验。**存 null 配原始类型默认值时静默返回默认值，不上报 type**；不传默认值或配普通对象默认值时仍可读出 null；数组默认值仍报告 type。迁移为匹配类型的默认值，或不传默认值自行校验：

  ```ts
  ls.set("count", "12");
  ls.get("count", "0"); // string；传数字 0 将返回 0 并上报 type
  const value = ls.get<unknown>("count"); // 不做默认值驱动的检查
  ls.set("empty", null);
  ls.get("empty", 0); // 0，不上报 type；ls.get("empty") 仍为 null
  ```

- **BREAKING — force:false**：不清理、不重试，后端写失败走 onError/console.error，不再抛出该后端错误。迁移为回调感知失败；序列化器/回调自身异常仍可能传播：

  ```ts
  const { ls } = factory({ force: false, onError: info => {
    console.error(info.kind, info.key, info.error);
  } });
  ls.set("key", "value");
  ```

- **BREAKING — remove()/clear() 后端失败**：处理器默认走 onError / console.error，不再因被包装的后端删除/清空失败而 reject 或抛出。不能再靠 await 成功或 try/catch 判断删除成功；用户回调自身异常仍传播，扫描/枚举失败也可能传播。迁移为结构化错误回调（直接调用 Idb 后端方法仍会 reject）：

  ```ts
  import { factory, Idb } from "@codejoo/storage";
  const { db } = factory({ db: new Idb(), onError: info => {
    if (info.op === "remove" || info.op === "clear") console.error(info.error);
  } });
  await db.remove("token");
  await db.clear();
  ```

- **BREAKING — readonly null**：有效信封存的 null 算存在，不再允许 readonly 覆盖。跨实例原子保证依赖 update。需要替换 null 时显式删除：

  ```ts
  const { ls } = factory({ readonly: true });
  ls.remove("key");
  ls.set("key", "replacement");
  ```

- **BREAKING — 损坏信封形状**：必须有自有 value，时间字段存在时必须为有限 number（历史 ttl/expireAt 为 null 时视为缺失，createdAt:null 仍为损坏）；普通 JSON 对象不再被误当信封。默认 JSON 的 `set(k, undefined)` 读回默认值并按损坏清理。迁移空值为 null、删除为 remove：

  ```ts
  ls.set("empty", null);
  ls.remove("obsolete");
  ```

- **BREAKING — crossTab v2**：仅 local 内存兜底参与，ss 告警并跳过；按真实后端而非全局能力标记判断。通过内部成功提交发送 `{ v:2, op, ns, key, payload, expireAt, ts, from }`（部分字段可选），直接回放最终串及绝对期限，涵盖滑动续期。按 `(ts, from)` 逐键 LWW，clear 保留更新的键；畸形消息忽略；已过期 SET 按保留原 `(ts, from)` 的 REMOVE 回放，删除更旧值并记录版本戳。身份生成不依赖 randomUUID，缺少该方法时使用随机数/时间回退。不保证强一致或所有竞态下收敛。旧数组协议与 v2 互不识别。迁移时让所有参与标签更新/重载，ss 继续保持标签隔离：

  ```ts
  import { factory, crossTab } from "@codejoo/storage";
  const { ls } = factory();
  const stop = crossTab(ls, "my-app-cache");
  // 退出时显式停止通道
  stop();
  ```

- **BREAKING — batchFast 泛型（D12）**：显式 V 时必须同时给 K；默认 K 改为 readonly never[]，防止键约束丢失。返回无原型对象，不能依赖继承的方法。迁移：

  ```ts
  import { factory, batchFast } from "@codejoo/storage";
  const { ls } = factory();
  const keys = ["a", "b"] as const;
  const accessors = batchFast<number, typeof keys>(ls, keys);
  accessors.a.set(1);
  ```

- **BREAKING — undefined 默认值返回类型（A9）**：get/fast 对 undefined 默认值包含 null；迁移时处理缺失分支：

  ```ts
  const value = ls.get<number | undefined>("count", undefined);
  const count = value ?? 0;
  ```

- **BREAKING — 共享内存兜底**：同一模块 realm 的多个 factory 共享同类后端数据（ls/ss 各自独立，Idb 按库名/仓库隔离），memo 仍独立。迁移为显式 namespace，不再依赖每个 factory 的隐式隔离：

  ```ts
  const a = factory({ namespace: "a" });
  const b = factory({ namespace: "b" });
  ```

- **BREAKING — Idb 按库名共享 area**：同一模块/realm 内不同 Idb 实例只要库名相同，就共享 Hub 身份，同标签 memo 自动互相失效，无需 broadcast。连接仍独立；跨标签仍须 `broadcast:true`。迁移为明确的库名/命名空间隔离：

  ```ts
  import { factory, Idb } from "@codejoo/storage";
  const a = factory({ db: new Idb("cache"), namespace: "a" });
  const b = factory({ db: new Idb("cache"), namespace: "b" });
  ```

- **BREAKING — cloned 非 memo 读**：`cloned:true` 对普通模式的所有对象读取也做 structuredClone，包括未命中/未开启 memo 的读取；自定义反序列化返回的不可克隆对象可能抛错。迁移为可克隆数据，或显式关闭：

  ```ts
  const { ls } = factory({ cloned: false });
  ```

### Added

- `StorageErrorInfo` 判别联合：`kind: "write" | "serialize" | "corrupt" | "type" | "abort"`，保留原始 `error`；`StorageOperation` 扩展到 get/set/remove/clear/purge。
- memo Hub：成功写入通知同后端身份的同标签处理器；缓存订阅原生 storage 事件。Idb 跨标签失效通过 `broadcast:true` 显式开启，默认关闭。自定义后端可用 `area` 表达共享身份。
- `AsyncStorage.update?` 可选原子条件更新，Idb 在单个 readwrite 事务中实现；用于 readonly、续期与过期/损坏清理。同步纯函数返回 string 写入、null 删除、undefined 保持，提交后返回最终落盘串；禁止 await/IO。批量操作仍不是整体事务。
- 能力字段独立惰性探测，导入不访问浏览器存储；Node 无 window 可导入并使用内存兜底。
- Node 测试、五后端夹具、Date-only 时钟、类型契约测试、browser/Node 合并覆盖率与门禁、双向验收矩阵校验。命令：`pnpm test`、`pnpm test:node`、`pnpm test:cov`、`pnpm test:infra`、`pnpm gate`、`pnpm accept`。矩阵/门禁实际通过状态以验收报告为准。

### Changed

- 无命名空间且无有效键 codec 时，clear 直接调用后端整库 clear，length/key 直接查询后端，**与 0.1.x 一致**；有命名空间/键编码时仍扫描自有键，不是整批事务。
- `broadcast` 默认为 false，仅控制异步后端按库名的跨标签 memo 失效；Hub 在首次缓存连接或发布时惰性打开通道，复用至 destroy。它与 crossTab 的值同步用途不同。
- `key(index)` 弃用，请迁移到 `keys()` 后取下标，例如 `ls.keys()[0] ?? null`；异步处理器先 await keys()。

- JSONX 转义新写入的普通 `__jt__` 对象，保留旧富类型标签读取；对象结果的原型安全处理同步用于 debug。
- Idb 打开失败实例级指数退避（1 秒至 30 秒、下次操作触发）；恢复后不迁移内存期间的写入。
- 以真实模块重写架构、双语 README 和项目 SKILL；移除失实架构 SVG。debug 从独立子路径导入，不写回快照，但读取仍可清理/续期。

### Fixed

- destroy/setNamespace 不再丢弃已发起但尚未派发的异步写；写入继续使用原命名空间，destroy 等待在途任务再关闭连接。后续同键变更或 clear 仍可使未派发写失效。
- 异步 set 无闸门时立即按调用顺序派发，移除入口旧 memo，恢复不 await 的读己之写；同键写逐次落盘。Hub 单键失效只将有在途写的令牌标为 stale，不取消后写；存 null 配原始类型默认值仍会滑动续期。
- clear 后紧接的 get/set/keys/length/key/purge（即使未 await clear）均等待同处理器的屏障；扫描删除全部自有旧键并复用后写令牌，后写失败或被跳过也不会残留旧值。clear 的回调异常不会传播到屏障后的操作。
- 兼容历史 JSON 的 `ttl:null` / `expireAt:null`，按字段缺失处理，不误删旧数据；`createdAt:null` 仍判损坏。
- readonly 同步写支持 force 清理/重试；续期后端失败的 op 为 get；续期不再做配额清理/重试。扫描 clear 的内部删除不逐键 publish/COMMIT；仅全部成功时发一个 clear COMMIT，Hub null 失效无条件发送。
- 修复异步旧读续期/清理覆盖新值、在途写/读回填使已删除 memo 复活、clear/debug 在途切空间使用错误前缀。后端副作用发起前检查版本，destroy 使旧读回填失效。
- 异步序列化错误不再从调用入口同步逃逸，转为 Promise reject（0.2.0 有 onError 时按新回调处理）。
- Idb 写入以事务 complete 为成功；显式 abort 在 tx/request 均无 error 时使用 AbortError。连接关闭后可重连；打开失败不再污染全局 supported.indexedDB。
- 安全处理浏览器存储 getter 与临时探测键；sessionStorage 独立探测，配额满不误判不支持。
- 非 memoized 成功写清旧 memo；滑动续期确认落盘成功后更新 memo，且不原地修改共享信封；要求 createdAt，避免外部缺失标记的信封被续期。
- clear 按键归属删除；过期清理仅处理管辖内的有效过期信封，raw 数据不参与 purge；续期保留 90% 阈值。
- key(index) 在命名空间/键编码范围内对小数、NaN 下标归一化。
- batchFast/debug 的 __proto__ 键安全；codecBase64/codecAtob 空口令及 U+FEFF、JSONX 无效 Date 往返修复。

### Internal

- 提取 maybe/keyspace/entity/errors/hub，proxy 保持单份同步/异步编排；写有效性仅检查每键令牌；读副作用/memo 回填检查令牌、全局代数与 cacheable，操作开始时捕获键空间；有界正反向键转换缓存。
- 模块级 Memory/Map/WeakMap 初始化增加 PURE 标注，配合 sideEffects:false 支持 tree-shake；./min 保持全量入口，不拆分。
- 保持 es2022；不升级 codec 格式（口令碰撞/孤立代理限制仍在）、不新增观察者 API、整批事务或 Worker/SSR 持久化。
- 体积：min 17,240 B / gzip -9 6,843 B（0.1.2：11,192 B / 4,537 B）。`./min` 仍是全量单文件，未拆分 Idb/crossTab。

## 0.1.2

全量 code review 后修复的一批真实 bug；均只影响边界场景（原生存储不可用的内存兜底、并发 IndexedDB 打开失败、quota 重试等），常规用法不受影响。无破坏性变更、无新增 API。

### Fixed

- **原生存储不可用时的内存兜底与 memo 缓存不再共用同一个 Map**：此前 `destroy()`/`clear()`/`memoized` 写入会相互污染甚至清空落盘数据（仅在 localStorage/sessionStorage 被禁用或隐私模式等场景触发）。
- **未传入 `db` 时 `factory().destroy()` 不再抛错**：以往任何一次统一 `destroy()` 调用，只要没配置过 `db`，都会因内部占位对象抛错而崩溃。
- **`Idb` 内存兜底模式下 `destroy()` 不再清空数据**：`mem` 在 IndexedDB 不可用时就是数据本身而非可丢弃的缓存/句柄。
- **`Idb` 并发写入触发 `open()` 失败时不再互相顶替内存兜底**：修复前，同时发起的多个写入在回退到内存模式时会各自新建一个 Map，导致先写入的数据被孤立丢失。
- **`key(index)` 在 `namespace`/`enckey` 下按管辖范围取值**：此前直接按后端原始下标读取，可能返回外部数据或未加密的原始键，与 `keys()`/`length`/`clear()` 的作用域口径不一致。
- **滑动续期（`sliding`）写入 memo 前先确认落盘成功**：此前即使后端写入失败，memo 仍会记录续期后的 `expireAt`，与实际持久层不一致。
- **过期判定口径统一**：`purge()` 与惰性过期（读时删除）此前用了两套略有差异的判定，现共用同一条规则（须带本库写入标志 `createdAt`），避免读路径比清理路径更容易误删外部数据。
- `debug()` 文档修正：其内部走正常 `get()` 读路径，惰性过期删除、滑动续期回写等副作用依旧会触发，并非绝对无副作用（此前文档描述过于绝对）。

### Internal

- 去除 5 处 `Promise.all` 前多余的 `Promise.resolve()` 包装（`Promise.all` 本就接受非 Promise 元素），零行为变化。

## 0.1.1

相对 0.0.3 的完整变更（0.1.0 未正式发布，其变更并入本版）。**包含多项破坏性变更**，升级前请阅读「Breaking」一节。

### Breaking

- **codec 数据格式不兼容**：默认 `codec` 重写为 UTF-16 码元 10 位 XOR（零分支、零膨胀，输出 = 原文 + 1 码元）。0.0.3 及中间版本写入的加密数据在读取时按损坏清除并回退默认值（与改 password 的既有语义一致）。
- **`clear()` 改为命名空间作用域**：配置 `namespace` 或 `enckey` 时仅清本实例管辖的键，不再清空整个后端（防误伤同源其他应用/命名空间）；无命名空间时保持整库清空。
- **`StorageOptions`（per-call set 选项）收窄**为 `{ ttl, expireAt, memoized }` 三项——此前类型上允许但实际被忽略的 `codeable`/`sliding`/`raw` 等不再出现在类型里。
- **构建 target 提升至 es2022**（移除全部降级 helper）；`tsconfig` lib 提升至 ESNext。
- 批量 `set` 的 `values` 短于 `keys` 时，缺位键**跳过并告警**（此前会写入 `value: undefined`）。
- **`debug` 移出主入口**：改为子路径导入 `import { debug } from "@codejoo/storage/debug"`——单文件产物（`dist/index.mjs` / `index.min.js`）不再包含 debug 代码。
- **`set` 移除 boolean（memoized）位置重载**：第三参不再接受 `boolean`，仅 `set(key, value, ttl?: number)` 与 `set(key, value, options?: StorageOptions)`；按次开启 memo 改用对象形式 `set(k, v, { memoized: true })`。

### Added

- **批量 API**：`get`/`set`/`remove` 支持数组 keys；批量 `get` 的默认值元组逐位联动返回类型（`get(["a","b"],[1,false])` → `[number, boolean]`，`as const` 保留字面量）。批量操作经**循环实现**：在键数组上逐键复用单键逻辑（异步后端逐键一事务），不依赖批量原语。
- **`keys()`**：返回本实例管辖范围内的逻辑键（已解密、去命名空间前缀）；`debug()` 改用它，命名空间下不再混入外部键。
- **`purge()`**：主动清理过期条目（仅管辖内、本库写入的数据）；逐键复用单键删除逻辑（含 memo 双删）。
- **`onError` 选项**：写入失败（配额超限、`force` 重试仍失败）回调 `{ op, key, error }`，取代默认 `console.error`，使调用方可感知失败（`set` 返回 `void`，失败本不可见）；批量 `set` 下每个失败键各回调一次。
- **`cloned` 选项**（默认 false）：与 memo 共享的对象按 `structuredClone` 副本返回，隔离调用方修改。
- **`crossTab(handler)` 插件**（独立导入、可 tree-shake）：纯内存模式下经 BroadcastChannel 跨标签同步 set/remove/clear。
- **codec 三变体**：`codec`（XOR，默认）、`codecBase64`（原生 toBase64 + atob/btoa 回退）、`codecAtob`（全程 atob/btoa，与 codecBase64 同格式互解）。
- `SyncStore`/`AsyncStorage` 可选契约：`keys()`，自定义后端提供即让枚举类操作（clear/keys/purge）走快路径。

### Changed

- **非法 `ttl`（`0` / 负数 / `NaN` / `Infinity`）告警并忽略**：数据照常持久化，不会"写入即被删"或变永不过期。
- **`length` 改为命名空间作用域**：配置 `namespace` 或 `enckey` 时只数本实例管辖的键（与 `keys()`/`clear()` 一致）；否则返回后端全局条目数。
- **memo 按 `factory()` 实例隔离**：不同 `factory()` 调用各自独立的内存读缓存，互不共享（此前为模块级共享）。
- **`debug()` 改为纯读取、无副作用**：返回 `{ "命名空间:键": 值 }` 快照，不再写回 `_$debug`，不污染 `keys()`/`length`。
- **运行时错误/告警信息英文化**。

### Fixed

- 容量清理（quota 重试）不再可能误删同源外部数据（按管辖范围 + `createdAt` 标志双重过滤）。
- `Idb` 连接被外部关闭（其他标签升级版本、存储驱逐）后自动重连，不再永久 `InvalidStateError`。
- `Idb.key(index)` 不再为取单键拉回全量键集；枚举类操作（clear/keys/purge/debug）免 O(n²)。
- raw 与非 raw 实例混用同键时，非 raw 读取不再静默返回 `undefined`。
- 滑动续期增加 90% 剩余寿命阈值，高频读不再产生写放大。
- localStorage 配额已满不再被误判为"不支持"而整体退回内存。
- enckey 键加密结果缓存（上限 1024，防动态键名场景无限增长）。

### Performance

- min 产物 10.25KB → ~9.4KB（gzip ~3.9KB），且为新增全部特性后的体积。
- 默认 codec：编码 1.5M ops/s @40B；中文负载全尺寸超过原生 base64 路线；中文存储配额占用为 base64 方案的 1/3。
