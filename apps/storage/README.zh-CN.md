# @codejoo/storage

[English](./README.md) | 简体中文

对 `localStorage` / `sessionStorage` / `IndexedDB` 的轻量、类型安全封装，统一一套 API：TTL 与绝对过期、滑动续期、命名空间、可插拔序列化（含 `Date` / `Map` / `Set` / `bigint`）、可选混淆 codec、按需开启的内存缓存，以及绑定 key 的快捷访问器。同步后端返回值，异步的 IndexedDB 后端返回 Promise —— **由泛型区分，一套实现**。

- 零依赖 · ESM · `sideEffects: false` · 附带按模块拆分、可 tree-shake 的产物（`dist/esm/`）。
- 原生 API 不可用时（隐私模式、沙箱 iframe 等）自动回退到内存存储。

## 安装

```sh
pnpm add @codejoo/storage
```

## 快速开始

```ts
import { factory } from "@codejoo/storage";

const { ls, ss } = factory();

ls.set("token", "abc");           // localStorage
ls.get("token");                  // "abc"
ls.get("missing", "default");     // "default"
ls.set("session", 1, 60_000);     // 60s 后过期（ttl 毫秒）
ls.remove("token");
ls.clear();
ls.length;                        // 条目数
```

使用 IndexedDB（异步、容量大）。`IdbStorage` **默认不打包**，需自行导入：

```ts
import { factory, IdbStorage } from "@codejoo/storage";

const { db } = factory({ db: new IdbStorage() });

await db.set("user", { id: 1 });  // Promise<void>
await db.get("user");             // Promise<{ id: 1 }>
```

## API

### `factory(options?)`

返回 `{ ls, ss, db, destroy, setNamespace }`，分别是对 `localStorage`、`sessionStorage` 和传入的 IndexedDB 实例的处理器。`ls`/`ss` 为**同步**，`db` 为**异步**（返回 Promise）。三者共享同一套选项行为。`destroy()` 一次性释放所有层（清空各层 memo 读缓存并断开 `db` 的 IndexedDB 连接），返回 `Promise`；**不删除已落盘数据**。`setNamespace(username?)` **原地**切换三层前缀（适合按账号隔离、登入/登出时调用）——已持有的引用自动生效；它只做隔离，**不会清除**上个命名空间的落盘数据。

| 参数      | 类型                 | 必填 | 默认 | 说明                       |
| --------- | -------------------- | ---- | ---- | -------------------------- |
| `options` | `BaseStorageOptions` | 否   | `{}` | 实例级配置，应用于所有层。 |

#### `BaseStorageOptions`

| 选项          | 类型                                | 必填 | 默认             | 说明                                                                                          |
| ------------- | ----------------------------------- | ---- | ---------------- | --------------------------------------------------------------------------------------------- |
| `memoized`    | `boolean`                           | 否   | `false`          | 启用内存读缓存：写入双写、读取缓存优先、删除双删。按需开启（非全量镜像），内存随使用增长。     |
| `serialize`   | `(entity: StorageEntity) => string` | 否   | `JSON.stringify` | 自定义 entity → 字符串序列化。                                                                 |
| `deserialize` | `(raw: string) => StorageEntity`    | 否   | `JSON.parse`     | 自定义字符串 → entity 反序列化（需与 `serialize` 配对）。                                      |
| `codeable`    | `boolean`                           | 否   | `false`          | 是否调用 `codec`。便于按环境（开发/生产）开关编解码。                                          |
| `codec`       | `Codec`                             | 否   | —                | 对序列化字符串做编解码（混淆/压缩）。仅 `codeable` 为 true 时生效。                            |
| `sliding`     | `boolean`                           | 否   | `false`          | 滑动过期：每次读命中按原始 `ttl` 续期（适合会话/登录态）。                                     |
| `namespace`   | `string`                            | 否   | `""`             | key 前缀（`namespace:key`），隔离同源下不同应用/模块。                                         |
| `raw`         | `boolean`                           | 否   | `false`          | 直接存原始值，跳过 entity 信封（无 ttl/codec）。用于与外部数据互通。                           |
| `force`       | `boolean`                           | 否   | `true`           | 容量不足时清理过期项后重试写入，否则记录日志并放弃。**仅同步后端生效。**                       |
| `readonly`    | `boolean`                           | 否   | `false`          | 只写一次：仅当键为空（不存在/已过期）才写入，否则丢弃本次写入。                                |
| `enckey`      | `boolean`                           | 否   | `false`          | 是否对**键**也加密：配置了 `codec` 时，存储键经 codec 确定性加密（隐藏明文键名）。            |
| `db`          | `AsyncStorage`                      | 否   | —                | IndexedDB 实例（如 `new IdbStorage()`），暴露为 `factory().db`。未传却使用 `db` 会抛错提示。 |

### 处理器方法（`ls` / `ss` / `db`）

`R<T>` 在同步后端（`ls`/`ss`）为 `T`，在异步后端（`db`）为 `Promise<T>`。

| 方法                         | 返回           | 说明                                                  |
| ---------------------------- | -------------- | ----------------------------------------------------- |
| `get<T>(key)`                | `R<T \| null>` | 读取；不存在 → `null`。                               |
| `get(key, defaultValue)`     | `R<T>`         | 读取；不存在/已过期/解不开 → `defaultValue`。         |
| `set(key, value, ttl?)`      | `R<void>`      | 写入；`ttl` 毫秒。                                    |
| `set(key, value, memoized?)` | `R<void>`      | 写入；`boolean` 按次切换是否写缓存。                  |
| `set(key, value, options?)`  | `R<void>`        | 写入；`StorageOptions`（ttl / expireAt / memoized）。 |
| `remove(key)`                | `R<void>`        | 删除（缓存 + 后端）。                                 |
| `clear()`                    | `R<void>`        | 清空全部。                                            |
| `destroy()`                  | `R<void>`        | 释放资源：清空 memo 读缓存并断开可关闭后端（IndexedDB 连接）。**保留已落盘数据。** |
| `key(index)`                 | `R<string\|null>`| 第 index 个逻辑键（已解密、去命名空间前缀）。         |
| `length`                     | `R<number>`      | 条目数（getter）。                                    |
| `namespace`                  | `string`         | 命名空间前缀（形如 `"ns:"`，无则为 `""`）。           |
| `setNamespace(ns?)`          | `void`           | 原地切换前缀（如按 username 隔离账号）；清空 memo 读缓存，已持有的引用自动生效。 |

#### `StorageOptions`（`set` 的按次选项）

继承 `BaseStorageOptions`（除 `db`），并新增：

| 选项       | 类型                       | 必填 | 默认 | 说明                                                                            |
| ---------- | -------------------------- | ---- | ---- | ------------------------------------------------------------------------------- |
| `ttl`      | `number`                   | 否   | —    | 存活时间（毫秒，相对）。设置 `expireAt = now + ttl`。                            |
| `expireAt` | `number \| string \| Date` | 否   | —    | 绝对过期（时间戳/日期字符串/`Date`）。若早于当前且非 `sliding`，告警并放弃写入。 |

### `fast(target, key)`

绑定一个处理器和一个 key，返回 `{ get, set, remove }`，免去反复写 key。同步/异步返回类型跟随 `target`。值类型在 `fast<V>(...)` 指定一次即可。

| 参数     | 类型                      | 必填 | 默认 | 说明                            |
| -------- | ------------------------- | ---- | ---- | ------------------------------- |
| `target` | `ls` / `ss` / `db` 处理器 | 是   | —    | `factory()` 返回的处理器。 |
| `key`    | `string`                  | 是   | —    | 要绑定的键。                    |

```ts
const token = fast<string>(ls, "token");
token.set("abc");      // 值必须是 string
token.get();           // string | null
token.get("def");      // string
token.remove();
```

访问器形态 —— `SyncAccessor<V>`（同步）/ `AsyncAccessor<V>`（异步）：

| 方法                   | 返回           | 说明                                  |
| ---------------------- | -------------- | ------------------------------------- |
| `get()`                | `R<V \| null>` | 读取。                                |
| `get(defaultValue)`    | `R<V>`         | 带默认值读取。                        |
| `set(value, options?)` | `R<void>`      | 写入；`options` = ttl/memoized/选项。 |
| `remove()`             | `R<void>`      | 删除。                                |

### `lazy(target, key)`

与 `fast` 类似，但返回一个 **getter**：首次调用才创建访问器并缓存。配合 `/*#__PURE__*/` 注释，未使用的导出会被 tree-shake —— 适合在集中式 `cache.ts` 里登记大量 key。

```ts
export const token = /*#__PURE__*/ lazy<string>(ls, "token");
token().get();   // 首次使用才创建，之后复用
```

### `batchFast(target, keys)`

一次绑定多个 key；返回以各 key 为属性名的对象，每个属性是对应 key 的快捷访问器（键名通过 `const` 泛型保留；值类型 `V` 对所有 key 统一，默认 `unknown`）。

```ts
const { token, user } = batchFast(ls, ["token", "user"]);
token.set("abc");
user.get();
```

### `JSONX`

与 `JSON` 同名 API，额外可逆地支持 `bigint` / `Date` / `Map` / `Set`。方法不依赖 `this`，可直接作为 `serialize`/`deserialize` 传入。

| 方法                             | 返回     | 说明                   |
| -------------------------------- | -------- | ---------------------- |
| `JSONX.stringify(value, space?)` | `string` | 序列化，保留富类型。   |
| `JSONX.parse(text)`              | `any`    | 反序列化，还原富类型。 |

```ts
const { ls } = factory({ serialize: JSONX.stringify, deserialize: JSONX.parse });
ls.set("x", { when: new Date(), ids: new Set([1n, 2n]) }); // 完整还原
```

> 不支持循环引用（沿用 `JSON.stringify` 行为 —— 会抛错）。

### `buildCodec(password?)`

构造一个轻量**混淆** codec（重复密钥 XOR + 自定义字母表 base64）。目的是避免明文直接暴露在 devtools —— **不是强加密**（key 随包发布）。配合 `{ codeable: true, codec }` 使用。

| 参数       | 类型     | 必填 | 默认         | 说明                                                                                      |
| ---------- | -------- | ---- | ------------ | ----------------------------------------------------------------------------------------- |
| `password` | `string` | 否   | 内置默认 key | XOR 密钥。改动后旧数据无法解出（无迁移）；此时 `decode` 返回 `null`，读取时清除陈旧条目。 |

`Codec` 形态：

| 方法            | 返回             | 说明                                         |
| --------------- | ---------------- | -------------------------------------------- |
| `encode(value)` | `string`         | 混淆字符串。                                 |
| `decode(value)` | `string \| null` | 还原；密钥不符/损坏时返回 `null`（不抛错）。 |

### `IdbStorage(name?)`

基于 IndexedDB 的**异步** `Storage` 风格后端。不维护全量内存镜像（内存恒定、利于 GC）。传给 `factory({ db })`。IndexedDB 不可用或运行时 `open()` 失败时自动回退内存。

| 参数   | 类型     | 必填 | 默认                 | 说明                 |
| ------ | -------- | ---- | -------------------- | -------------------- |
| `name` | `string` | 否   | `"@codejoo/storage"` | IndexedDB 数据库名。 |

方法（均返回 Promise）：`get(key)`、`set(key, value)`、`remove(key)`、`clear()`、`key(index)`、`length()`、`destroy()`（关闭连接；保留数据）。

### `debug(handler)`

独立辅助函数（**需显式导入**——不属于核心 proxy，未用到即被 tree-shake）。读出 handler 全部条目的**解密后**明文，返回 `{ "命名空间:键": 值 }` 快照（**保留命名空间**），并暂存到 `"_$debug"`。用于查看以 `codeable`/`enckey` 写入的数据。

```ts
import { factory, buildCodec, debug } from "@codejoo/storage";

const { ls, db } = factory({ codeable: true, codec: buildCodec("pw"), enckey: true });
debug(ls);        // 同步 → { "key": value, ... }
await debug(db);  // 异步后端 → Promise
```

## 说明

- **同步 vs 异步** 由后端类型经泛型决定：`ls.get(k)` 返回值，`db.get(k)` 返回 `Promise`。一套 proxy 实现同时服务两者。
- **`db` 的特性**：`ttl` / `expireAt` / `codec` / `namespace` / `sliding` / `memoized` 对 `db` 同样生效（只是要 `await`）。`force` 容量清理目前仅对同步后端生效。
- **Tree-shaking**：包的 `import` 指向 `dist/esm/`（每模块一个文件）。配合 `sideEffects: false`，未用到的模块/导出会被打包器删除。

## 构建产物

| 路径                | 格式              | 用途                           |
| ------------------- | ----------------- | ------------------------------ |
| `dist/esm/*.mjs`    | 按模块 ESM        | 默认 `import`，可 tree-shake。 |
| `dist/index.mjs`    | 单文件 ESM bundle | 整体引入。                     |
| `dist/index.min.js` | 压缩 ESM          | `./min` 子路径。               |

## 测试

[`test/`](./test/) 下有一个独立的浏览器测试页。启动 dev server 后打开：

```sh
pnpm dev          # 然后打开输出的 URL + /test/
```

它直接加载源码（Vite 即时转译 TS），逐项渲染每个 API 的通过/失败。

## 许可

MIT
