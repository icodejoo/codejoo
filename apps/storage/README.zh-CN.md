# @codejoo/storage

[English](./README.md) · [架构](./ARCHITECTURE.md)

为 localStorage、sessionStorage 和显式配置的 IndexedDB 提供类型化 ESM 封装。同一处理器 API 支持 TTL、滑动过期、命名空间、可选 memo 缓存和可插拔序列化。语法目标为 es2022。

## 快速开始

```sh
pnpm add @codejoo/storage
```

```ts
import { factory, Idb } from "@codejoo/storage";

const storage = factory({ namespace: "app", db: new Idb("app-cache") });
const { ls, ss, db } = storage;
ls.set("count", 1, 60_000);
ls.get("count", 0); // number，同步
ss.set("draft", "hello");
await db.set("profile", { name: "Ada" }, { ttl: 60_000 });
await db.get("profile");
storage.setNamespace("u42"); // 切换三层处理器，保留旧数据
await storage.destroy(); // 释放 memo/连接，保留后端数据
```

`ls` 与 `ss` 同步返回，`db` 返回 Promise，须显式传入 `AsyncStorage`，通常是 `new Idb()`。调用未配置的 db 会失败。原生不可用时，ls 与 ss 使用不同的模块级共享内存后端，Idb 按库名/仓库名共享兜底。共享限同一模块实例/realm。各 factory 的 memo 仍各自独立，并与兜底数据严格分离。`destroy()` 不清除兜底数据。

## 处理器 API

| 成员 | 契约 |
| --- | --- |
| `get(key, defaultValue?)` | 缺失/过期/损坏返回默认值；未传或传 undefined 时为 null。 |
| `get(keys, defaults?)` | 元组批量读取，默认值逐位对应。 |
| `set(key, value, ttlOrOptions?)` | 第三参为 TTL 毫秒数或 `StorageOptions`。 |
| `set(keys, values, ttlOrOptions?)` | 逐键写入；缺少的值告警并跳过。 |
| `remove(keyOrKeys)` | 删除单键或键数组。 |
| `keys()` / `length` | 管辖内逻辑键/数量；异步处理器的 length 是 Promise 属性。 |
| `key(index)` | 已弃用，请使用 `keys()`。 |
| `clear()` | 仅删除当前命名空间/键 codec 管辖的键。 |
| `purge()` | 清理范围内有效的过期信封；raw 模式不处理。 |
| `namespace` | 转义后的命名空间前缀（含尾部冒号），或空串。 |
| `setNamespace(namespace?)` | 切换空间并清空 memo，保留旧空间数据。 |
| `destroy()` | 使 memo 失效、释放资源，不删除后端数据。 |

```ts
ls.set(["count", "ready"], [1, true], { ttl: 5_000 });
const pair = ls.get(["count", "ready"], [0, false]); // [number, boolean]
const asserted = ls.get<[number, boolean]>(["count", "ready"]); // 各元素可为 null
ls.remove(["count", "ready"]);
```

原始类型或数组默认值启用轻量运行时检查：`ls.set("n", "text"); ls.get("n", 0)` 返回 0、上报 `kind:"type"`，保留已存字符串。普通对象默认值不校验字段；泛型不等于运行时 schema。默认值为 undefined 时，返回类型包含 null（`V | null`），fast 访问器同样如此。存 null 配原始类型默认值时（如 `ls.set("empty", null); ls.get("empty", 0)`）静默返回 0，不上报 type，落盘 null 保留。不传默认值或配普通对象默认值仍返回 null；配数组默认值则属于类型不符。readonly 将已存的 null 视为存在。

## 选项

`BaseStorageOptions` 由一次 factory 创建的三层处理器共享。

| 选项 | 默认值/行为 |
| --- | --- |
| `namespace` | 无前缀；命名空间内的 `%` 与 `:` 会转义。 |
| `memoized` | false；成功读写后缓存解析信封/raw 字符串。 |
| `cloned` | false；普通模式返回对象值时 structuredClone，含非 memo 读取，隔离外部修改；不可克隆值可能抛错。 |
| `sliding` | false；满足条件的读命中续期。需 createdAt、ttl、expireAt；剩余寿命 <= 原 ttl 的 90% 时续期。 |
| `serialize` / `deserialize` | JSON.stringify / JSON.parse；作用于整个信封。 |
| `codeable` / `codec` | false / 无；使用指定 Codec 编码值。 |
| `enckey` | false；有 codec 时编码命名空间+逻辑键，与 codeable 独立。 |
| `raw` | false；true 直接存字符串，跳过信封序列化/值编码/TTL；非字符串告警并跳过。 |
| `force` | true；同步 set（含 readonly）失败时清理过期项并重试一次。false 不清理、不重试；后端写失败仍走 onError 或 console.error，不抛后端错误。 |
| `readonly` | false；仅缺失/过期/无效时写入，有效信封里的 null 算存在。 |
| `broadcast` | false；显式开启 IndexedDB 的 BroadcastChannel 跨标签 memo 失效通知。 |
| `onError` | 结构化错误回调，见下文。 |
| `db` | 显式异步后端，例如 new Idb()；不隐式创建 IndexedDB。 |

单次 `StorageOptions`：`ttl?: number`、`expireAt?: number | string | Date`、`memoized?: boolean`。其余为实例选项。非正数/非有限 TTL 告警并忽略；显式 expireAt 优先。非法/过去的日期跳过写入，唯 sliding + 有效 ttl 可把过去日期替换为 now + ttl。

默认信封为 `{ value, createdAt, expireAt?, ttl? }`，必须有自有 value 属性，存在的时间元数据必须为有限 number；历史 `ttl:null` / `expireAt:null` 按字段缺失兼容，`createdAt:null` 仍为损坏。过期需有 createdAt、expireAt，且 now >= expireAt。默认 JSON 的 `set(k, undefined)` 会省略 value，随后读取上报损坏、返回默认值并尝试删除。删除请用 `remove(k)`，有意保存空值请用 null。

## 错误与 0.2.0 迁移

`StorageErrorInfo` 是含 `kind`、`op`、逻辑 `key` 和原始 `error` 的判别联合。`StorageOperation` 为 `"get" | "set" | "remove" | "clear" | "purge"`；整范围操作可使用空 key。

| kind | 含义 |
| --- | --- |
| `write` | 被包装的后端写/删操作失败。 |
| `serialize` | 信封序列化或值编码失败。 |
| `corrupt` | 值解码、解析或信封校验失败；先上报，再条件删除。 |
| `type` | 存储值与可检查的默认值类型不符，保留数据。 |
| `abort` | 被包装的事务错误名称为 AbortError。 |

从旧回调形状迁移：增加 kind 分支并处理扩展的 op 联合，继续从 error 获取原始异常。

```ts
import { factory, type StorageErrorInfo } from "@codejoo/storage";

const onError = (info: StorageErrorInfo): void => {
  if (info.kind === "type") {
    console.warn(info.key, info.error);
    return;
  }
  console.error(info.kind, info.op, info.key, info.error);
};
const { ls } = factory({ force: false, onError });
ls.set("count", 1); // 在 onError 感知失败，替代 try/catch
```

未提供回调时，被包装的读/后端修改报告走 console.error。序列化异常在无回调时仍同步抛出/异步 reject。用户回调自身的异常原样传播。并非所有后端读取/枚举异常都会转为回调。`force:false` 控制清理重试，不吞掉回调或序列化器异常。

类型检查迁移：选择与存储类型匹配的默认值，或不传默认值并自行校验。readonly/null 迁移：要覆盖 null，先显式删除旧键。undefined 值迁移：用 null 持久保存空值，或直接删除键。

## 命名空间与旧数据

依次将 namespace 的 `%` → `%25`、`:` → `%3A`，最后附加 `:`。逻辑键不转义。`namespace:"a:b%"` 的前缀为 `a%3Ab%25:`。不含这两个字符的空间保持旧物理键。含冒号的旧命名空间（如 `"user:42"`）升级后读不到旧数据，不会自动迁移；请先执行下述手动迁移。

迁移含特殊字符的旧 localStorage 键时，先停止其他写入者，再明确列出逻辑键。下例**仅适用于非 enckey 场景**，原样复制落盘信封并保留绝对过期时间，验证目标后删除旧键。不要宽泛地扫描旧前缀：旧空间之间可能前缀重叠。

```ts
const oldNamespace = "user:42%";
const oldPrefix = oldNamespace + ":";
const newPrefix = oldNamespace.replaceAll("%", "%25").replaceAll(":", "%3A") + ":";
const logicalKeys = ["token", "profile"]; // 显式的业务自有键白名单
for (const key of logicalKeys) {
  const from = oldPrefix + key;
  const to = newPrefix + key;
  const payload = localStorage.getItem(from);
  if (payload !== null && localStorage.getItem(to) === null) {
    localStorage.setItem(to, payload);
    if (localStorage.getItem(to) === payload) localStorage.removeItem(from);
  }
}
```

编码键需用相同 codec 分别编码完整的新旧键；IndexedDB 需通过配置的后端读写物理串，并逐次 await。更换 codec 或自定义格式须另行迁移。外部迁移完成后重新加载/创建 memoized 处理器。

## memo 与后端一致性

memo 按处理器独立、显式开启，不是后端全量镜像。成功的处理器写入通知同后端 area 的其他处理器；真正使用缓存时才注册。原生 storage 事件使对应键失效（clear 全部失效）。localStorage 可通知其他标签；sessionStorage 保持浏览器会话隔离。同标签直接使用原生 API 不产生该标签的 storage 事件，可能留下旧 memo。

Idb 跨标签失效需在参与的 factory 显式开启：

```ts
const { db } = factory({
  db: new Idb("shared-cache"),
  memoized: true,
  broadcast: true,
});
```

广播传失效通知而非值，依赖 BroadcastChannel 与匹配的数据库名通道。同一模块/realm 内 Idb 按库名共享 area；同库名的不同实例同标签 memo 自动互相失效，无需 broadcast，连接仍各自管理。自定义后端可提供代表同一存储域的稳定 `area?: object`；可选只读 `kind?: "local" | "session" | "idb"` 表达后端类别。漏收通知或绕过处理器写入时，不保证缓存新鲜度。

每个操作在开始时捕获命名空间/键空间。每键版本与全局代数阻止同处理器内旧读回填、旧读续期/删除干扰后续操作。已经发出的后端请求无法取消；跨实例条件写依赖 update 支持。

`setNamespace()` 与 `destroy()` 保留已发起的异步写及其起始命名空间。异步 destroy 等待在途任务再关闭后端。没有 clear 屏障或 readonly 队列时，每次异步 set 在入口移除旧 memo，并按调用顺序立即派发；FIFO 后端（如 IDB）上 `set(k,v); get(k)` 和 `set(k,v); keys()` 能观察到已排队的写。

`clear()` 清当前管辖范围；无命名空间且无有效键 codec 时直接使用后端整库 clear，length/key 也直接查询后端，与 0.1.x 一致。否则枚举并删除全部自有键，复用已排队后写的令牌，不构成整体事务。同处理器后发 get/set/keys/length/key/purge 均等待 clear 屏障，后写随后按序执行；clear 失败不会使这些后续操作一起 reject。全部删除成功才发 clear COMMIT，失败时 Hub 缓存仍失效。这些保证不是跨实例锁。

处理器 remove/clear 的被包装后端失败默认走 onError / console.error，不再 reject/抛出该后端异常；扫描枚举错误或用户回调异常仍可能传播。await 正常完成不代表删除全部成功。直接调用 Idb 后端方法仍按失败 reject 的契约工作。

## 快捷访问与序列化

```ts
import { factory, fast, lazy, batchFast, JSONX } from "@codejoo/storage";

const { ls } = factory({ serialize: JSONX.stringify, deserialize: JSONX.parse });
const count = fast<number>(ls, "count");
count.set(1);
count.get(undefined); // number | null
const token = /*#__PURE__*/ lazy<string>(ls, "token");
token().get(); // 首次调用才创建访问器
const inferred = batchFast(ls, ["token", "user"]); // 值类型 unknown
const keys = ["a", "b"] as const;
const typed = batchFast<number, typeof keys>(ls, keys);
typed.a.set(1);
ls.set("rich", { when: new Date(), ids: new Set([1n, 2n]) });
```

**BREAKING（D12）：** 显式给 batchFast 的值类型 V 时，必须同时给 K（如上）。只给 V 不再接受非空键数组：K 默认 readonly never[]，防止键约束静默丢失。不显式给泛型仍可推断键。batchFast 返回无原型对象。

JSONX 支持 Date / Map / Set / bigint，兼容读取旧富类型标签，转义新写入对象中的普通 `__jt__` 字段。不支持循环引用。

## Codec

`codec(password?)`、`codecBase64(password?)`、`codecAtob(password?)` 实现 `Codec.encode(string): string` 和 `Codec.decode(string): string | null`，提供混淆。值使用 `{ codeable:true, codec:codec("pw") }`，编码键另开 enckey。默认 codec 变换 UTF-16 码元；base64 两种实现采用 UTF-8，格式互通。

口令不构成安全边界：不同口令可能碰撞，base64 系编码含孤立代理的键可能丢失码元。解决这些限制的新 codec 格式（D11）本轮不做。解码失败按损坏处理；更换口令需要迁移策略，并不保证拒绝每一份旧载荷。

## IndexedDB 与自定义后端

`new Idb(name?)` 默认库名为 `"@codejoo/storage"`。公开后端方法均返回 Promise：`get`、`set`、`remove`、`clear`、`key`、`keys`、`length`、`update`、`destroy`。写入在事务提交时 resolve；abort 必要时以 AbortError 兜底 reject。连接关闭后下次操作重连。打开失败仅影响本实例，以 1/2/4…秒、最高 30 秒退避，在下一次操作检查重试。恢复 IndexedDB 后不迁移内存期间的写入。

`db` 选项接受 `AsyncStorage`，可选原子原语为：

```ts
update?(key: string,
  fn: (current: string | null) => string | null | undefined
): Promise<string | null>;
```

在同一后端事务中读并同步调用纯函数 fn：string 写入、null 删除、undefined 保持；提交后 resolve 最终串/null。fn 禁止 await/IO，异常应回滚/reject。Idb 实现该方法；处理器用于 readonly 和读后条件修改（续期/过期或损坏清理/purge）。不实现时仅有同处理器版本防护。批量操作仍是逐键操作，不是整体事务。

## crossTab v2

`crossTab(handler, channel?)` 接受同步处理器，返回幂等停止函数。通过真实后端判断：仅当前模块中 kind 为 local 的 Memory 兜底启用；原生 localStorage、Idb、其他后端或缺少 BroadcastChannel 时为空操作。ss 不论是否兜底都不参与，同处理器只告警一次；重复挂载为空操作。同通道不同处理器会告警，需自行分配独立通道。

v2 消息为 `{ v:2, op, ns, key?, payload?, expireAt?, ts, from }`，key 为逻辑键，set 必须带最终落盘串，expireAt 为绝对期限。发送已提交载荷（含滑动续期），回放不重新授予完整 TTL。接收端校验形状/时间/当前命名空间，忽略畸形与自身消息；已过期 SET 按带原 `(ts, from)` 戳的 REMOVE 回放，删除更旧值并记录戳，防止旧永久值残留；按 namespace+key 的 `(ts, from)` 做 LWW，clear 保留已知更新的键。回放使 memo 失效且不重新广播。身份生成不依赖 randomUUID；无该方法时回退到随机数和时间。

**BREAKING：** 新旧数组协议标签互相忽略，升级时须更新/重载所有参与标签。不保证强一致、所有竞态下收敛、启动快照或离线回放。命名空间切换由应用协调；停止函数应显式调用以释放通道。

```ts
import { factory, crossTab } from "@codejoo/storage";
const { ls } = factory();
const stop = crossTab(ls, "my-app-cache");
stop();
```

## 调试快照

```ts
import { factory, codec, Idb } from "@codejoo/storage";
import { debug } from "@codejoo/storage/debug";

const { ls, db } = factory({
  namespace: "app", db: new Idb(), codeable: true, codec: codec("pw"), enckey: true,
});
debug(ls); // 无原型明文快照，例如 { "app:key": value }
await debug(db);
```

debug 捕获操作开始时的键空间，跳过遗留 `_$debug`。不写回快照，也不新建调试键。正常读取路径会删除过期/损坏项、续期 sliding TTL，因此不是无副作用操作。仅通过 debug 子路径导出。

## 运行环境与产物

导入不探测存储；首次使用内部 supported 字段时独立探测、捕获浏览器 getter 异常、使用随机临时键并缓存结果。支持无 window 导入与内存降级，Worker/SSR 持久化不在范围。过期是惰性的，keys/数量可能包含未清理的过期项。存储配额由浏览器控制。

| 产物 | 用途 |
| --- | --- |
| `dist/esm/*.mjs` | 按模块 ESM，默认 import，可 tree-shake。 |
| `dist/index.mjs` | 单文件 ESM bundle。 |
| `dist/index.min.js` | min 子路径的压缩 ESM。 |

待发版体积：`dist/index.min.js` 17,240 B（0.1.2：11,192 B），gzip -9 6,843 B（0.1.2：4,537 B）。本轮仅发布 0.2.0，迁移见 [CHANGELOG](./CHANGELOG.md)；包版本仅在发版时修改。

## 测试与验收

在本包目录运行：

```sh
pnpm test --run
pnpm test:node
pnpm test:cov
pnpm accept
pnpm gate
pnpm lint
```

`pnpm test` 在真实 Chromium/Playwright 中运行浏览器测试（`test/*.browser.test.ts`），加 --run 单次执行。test:node 跑 `test/*.node.test.ts`。test:cov 在单次 Vitest 中合并 browser 与 Node projects 至 coverage。gate 运行覆盖率，检查 lines 100% / branches >=95%，再校验验收矩阵。accept 双向核对测试与矩阵。命令存在不代表当前分支已通过所有门禁；lint 与 build 独立执行。

`test/backends.ts` 提供五后端夹具，`test/helpers/clock.ts` 控制 Date。INV/BUG/API 映射与豁免规则见 [test/ACCEPTANCE.md](./test/ACCEPTANCE.md)；[test/types.check.ts](./test/types.check.ts) 通过 lint 检查。交互 [playground](./test/manual.html) 用 `pnpm dev` 打开 `/test/manual.html`。

## 许可

MIT
