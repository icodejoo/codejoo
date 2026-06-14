# Changelog

## 0.1.0（未发布 → 待发布）

相对 0.0.3 的完整变更。**包含多项破坏性变更**，升级前请阅读「Breaking」一节。

### Breaking

- **codec 数据格式不兼容**：默认 `codec` 重写为 UTF-16 码元 10 位 XOR（零分支、零膨胀，输出 = 原文 + 1 码元）。0.0.3 及中间版本写入的加密数据在读取时按损坏清除并回退默认值（与改 password 的既有语义一致）。
- **`clear()` 改为命名空间作用域**：配置 `namespace` 或 `enckey` 时仅清本实例管辖的键，不再清空整个后端（防误伤同源其他应用/命名空间）；无命名空间时保持整库清空。
- **`StorageOptions`（per-call set 选项）收窄**为 `{ ttl, expireAt, memoized }` 三项——此前类型上允许但实际被忽略的 `codeable`/`sliding`/`raw` 等不再出现在类型里。
- **构建 target 提升至 es2022**（移除全部降级 helper）；`tsconfig` lib 提升至 ESNext。
- 批量 `set` 的 `values` 短于 `keys` 时，缺位键**跳过并告警**（此前会写入 `value: undefined`）。
- **`debug` 移出主入口**：改为子路径导入 `import { debug } from "@codejoo/storage/debug"`——单文件产物（`dist/index.mjs` / `index.min.js`）不再包含 debug 代码。

### Added

- **批量 API**：`get`/`set`/`remove` 支持数组 keys；批量 `get` 的默认值元组逐位联动返回类型（`get(["a","b"],[1,false])` → `[number, boolean]`，`as const` 保留字面量）。`db` 上批量操作经 `Idb` 新增的 `getMany/setMany/removeMany` 走**单事务快路径**（50 键实测快约 4 倍）。
- **`keys()`**：返回本实例管辖范围内的逻辑键（已解密、去命名空间前缀）；`debug()` 改用它，命名空间下不再混入外部键。
- **`purge()`**：主动清理过期条目（仅管辖内、本库写入的数据）；db 上为 getMany+removeMany 两事务完成。
- **`cloned` 选项**（默认 false）：与 memo 共享的对象按 `structuredClone` 副本返回，隔离调用方修改。
- **`crossTab(handler)` 插件**（独立导入、可 tree-shake）：纯内存模式下经 BroadcastChannel 跨标签同步 set/remove/clear。
- **codec 三变体**：`codec`（XOR，默认）、`codecBase64`（原生 toBase64 + atob/btoa 回退）、`codecAtob`（全程 atob/btoa，与 codecBase64 同格式互解）。
- `SyncStore`/`AsyncStorage` 可选契约：`keys()` 与批量原语，自定义后端提供即获得快路径。

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
