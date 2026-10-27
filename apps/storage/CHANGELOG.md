# Changelog

## Unreleased

### Fixed

- **`Idb` 写入以事务提交为成功标志**：此前 request 成功即视为写入成功，而 readwrite 事务之后仍可能因配额等原因 abort 回滚，导致调用方以为写入成功、memo 被写入且不触发 `onError`。现在事务 abort 会 reject，走 `onError`/日志。
- **非 memoized 写入会清掉旧缓存**：此前 `set(k, 1, { memoized: true })` 之后再 `set(k, 2)`，后端是 2 而 memo 仍是 1，`get` 读到旧值。
- **sliding 续期同步 memo**：实例未开 `memoized`、但条目经 per-call `{ memoized: true }` 进入 memo 时，续期后 memo 里仍是旧 `expireAt`，旧时间一到会把已续期的数据误删。
- **异步读在途时的写/删/清/切命名空间不再被旧值回填复活**：此前 `db.get` 在途期间发生 `remove`/`set`/`clear`/`setNamespace`，读完成后仍会把旧值写回 memo，之后一直命中旧值。
- **非 entity 的合法 JSON 视为脏数据**：后端为 `"1"`/`"false"`/`"[]"` 等时，`get` 以往返回 `undefined`，现在清除该键并返回默认值。
- **`raw` 模式下 `purge()`/容量清理不再处理裸字符串**：此前会把裸字符串当 entity 解析，形如 `{"expireAt":...}` 的外部数据可能被误删。
- **`key(index)` 在有 `namespace`/`enckey` 时对下标归一化**：`key(1.5)`/`key(NaN)` 此前会抛错，现与原生行为一致（向零取整、NaN 视为 0）。
- **`codec` 空字符串口令**：`codecBase64("")`/`codecAtob("")` 解码此前返回空串；并修复以 U+FEFF 开头的明文被吞掉首字符的问题。
- **sessionStorage 单独探测**：此前 `ss` 复用 localStorage 的探测结果，若 localStorage 可用而访问 `sessionStorage` 抛 SecurityError，`factory()` 会整体崩溃；现各自探测，`ss` 不可用时退回内存兜底。
- **`crossTab` 仅回放同命名空间的消息**：消息携带发送方命名空间，避免 A 标签 userA 的写入/清空被 B 标签 userB 误落地；未知 op 与非数组消息一律忽略（此前未知消息会被当作 clear）；stop 函数幂等。
- **`JSONX` 往返无效 Date**：此前 `new Date(NaN)` 还原成 1970 年，现保持 Invalid Date。

### Internal

- 补充对应单测（共 116 条）；放大 sliding 用例时序余量并删除重复的阈值用例；补全 `src/` 与 `scripts/` 的中文注释（修正 `Memory`/`post-minify` 过时说明、纠正注释错位）；`persist` 的清理重试纳入 `onError` 保护。

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
