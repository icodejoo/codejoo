# @codejoo/stomp

> English: [README.md](./README.md)

对 [`@stomp/stompjs`](https://github.com/stomp-js/stompjs) 的**框架无关**二次封装，补齐它不提供的“产品层”能力。顶层类为 `Stompsocket`。

`@stomp/stompjs` 是 **peer 依赖**，需自行安装：

```bash
pnpm add @codejoo/stomp @stomp/stompjs
```

> 关键认知：`@stomp/stompjs` **只重连传输、不恢复订阅**。本封装在连接建立后自动重放本地订阅，并在其上提供函数队列共享解析、三种取消、离线发送缓冲、自动/手动确认、token 刷新、连接状态可观测等能力。

- [特性](#特性)
- [快速上手](#快速上手)
- [API 详解](#api-详解)
  - [构造参数 `StompsocketOptions`](#构造参数-stompsocketoptions)
  - [方法](#方法)
  - [订阅与取消](#订阅与取消)
  - [发送](#发送)
  - [连接状态观测](#连接状态观测)
  - [确认（ACK/NACK）](#确认acknack)
  - [类型与枚举](#类型与枚举)
- [行为与语义说明](#行为与语义说明)
- [与 Dart 版差异](#与-dart-版差异)

## 特性

- **函数队列共享解析**：相同 `id` 的多个回调共用**一份**解析后的数据（只解析一次再分发），不重复 SUBSCRIBE。
- **三种取消**：句柄 `.unsubscribe()`（引用计数）、`unsubscribe({ id | destination })`、`clear()`。
- **断线后自动重新订阅**：连接建立/重连后重放本地订阅。
- **离线发送缓冲**：未连接时 `send()` 入缓冲，连上后按序补发。
- **确认模式** `AckMode { auto, smart, manual }`。
- **可注入二进制解码器**（`content-type: application/octet-stream` 时使用）。
- **token 刷新**：`beforeConnect` 每次（重）连前返回新的 CONNECT 头。
- **连接状态可观测**：`state` / `onState(listener)` / `onStateChanged`（框架无关；Vue 几行桥接成 `ref`）。
- **回前台/网络恢复强制重连** `resumeOnForeground`：`visibilitychange`/`online` 时立即重连，规避 Chromium 后台标签页定时器节流导致的心跳失联（stompjs #335/#669）。
- **`copyWith`** 与 `@stomp/stompjs` 原生参数透传。

## 快速上手

```ts
import { Stompsocket, AckMode } from "@codejoo/stomp";

const client = new Stompsocket({
  brokerURL: "wss://example.com/ws",
  beforeConnect: async () => ({ Authorization: `Bearer ${await getToken()}` }),
  onConnected: () => resyncSnapshot(), // 每次（重）连后重拉快照
});

client.activate();

const sub = client.subscribe("/topic/quote", (json) => render(json));
sub.unsubscribe();

client.send("/app/order", { body: { sku: "A", qty: 2 } }); // object → JSON

await client.dispose();
```

## API 详解

### 构造参数 `StompsocketOptions`

`new Stompsocket(options: StompsocketOptions)`

| 参数                                                             | 类型                                                                            | 默认     | 说明                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `brokerURL`                                                      | `string`                                                                        | **必填** | WebSocket 地址（`ws://` 或 `wss://`）。                                                                     |
| `connectHeaders`                                                 | `Record<string,string>`                                                         | —        | 静态 CONNECT 头（鉴权等）。                                                                                 |
| `beforeConnect`                                                  | `() => Promise<Record<string,string> \| void> \| Record<string,string> \| void` | —        | 每次（重）连前调用；返回非空则覆盖 CONNECT 头，用于**异步 token 刷新**。内部吞异常。                        |
| `heartbeatIncoming`                                              | `number`(ms)                                                                    | `10000`  | 入向心跳。                                                                                                  |
| `heartbeatOutgoing`                                              | `number`(ms)                                                                    | `10000`  | 出向心跳。                                                                                                  |
| `connectionTimeout`                                              | `number`(ms)                                                                    | `0`      | 连接超时（0=不超时）。                                                                                      |
| `reconnectDelay`                                                 | `number`(ms)                                                                    | `5000`   | 固定间隔自动重连；`0` 关闭自动重连。                                                                        |
| `binaryDecoder`                                                  | `(bytes: Uint8Array) => JsonMessage`                                            | —        | `content-type: application/octet-stream` 帧的解码器；返回对象，失败抛异常。未提供则这类消息按解析失败处理。 |
| `queueWhileDisconnected`                                         | `boolean`                                                                       | `true`   | 未连接时是否缓冲出站消息。                                                                                  |
| `maxQueuedMessages`                                              | `number`                                                                        | `100`    | 出站缓冲上限，超出丢最旧。                                                                                  |
| `resumeOnForeground`                                             | `boolean`                                                                       | `true`   | 回前台/网络恢复时若未连接则立即重连（非浏览器环境自动跳过）。                                               |
| `debug`                                                          | `boolean`                                                                       | `false`  | 日志主开关；关闭时完全静默。                                                                                |
| `onLog`                                                          | `(message: string, error?: unknown) => void`                                    | —        | 自定义日志；未提供且 `debug=true` 时回退 `console`。                                                        |
| `onConnected`                                                    | `(frame: IFrame) => void`                                                       | —        | 每次（重）连成功、**重放订阅之后**触发。                                                                    |
| `onDisconnected`                                                 | `(frame: IFrame) => void`                                                       | —        | STOMP DISCONNECT 后触发。                                                                                   |
| `onStateChanged`                                                 | `(state: ConnectionState) => void`                                              | —        | 连接状态每次变化触发。                                                                                      |
| `onStompError`                                                   | `(frame: IFrame) => void`                                                       | —        | 服务端 ERROR 帧。                                                                                           |
| `onWebSocketError`                                               | `(event: Event) => void`                                                        | —        | WebSocket 层错误。                                                                                          |
| `onWebSocketClose`                                               | `(event: CloseEvent) => void`                                                   | —        | WebSocket 关闭。                                                                                            |
| `onDebugMessage`                                                 | `(message: string) => void`                                                     | —        | 原样透传 stompjs 帧级流水。                                                                                 |
| `onUnhandledMessage` / `onUnhandledReceipt` / `onUnhandledFrame` | 见类型                                                                          | —        | 未匹配的帧。                                                                                                |

### 方法

| 方法                                                             | 说明                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `activate(): void`                                               | 启动（或 dispose 后重启）连接。                                                   |
| `dispose(keepSubscriptions = false): Promise<void>`              | 可逆停止；dispose 后仍可再次 `activate`。`true` 保留订阅，重连后自动恢复。        |
| `forceReconnect(): void`                                         | 立即重连（跳过 `reconnectDelay`），仅在“期望连接但当前未连接”时生效。             |
| `copyWith(overrides?: Partial<StompsocketOptions>): Stompsocket` | 复制新实例：提供的覆盖、未提供的继承。返回**全新未连接**实例，需自行 `activate`。 |
| `get connected(): boolean`                                       | 是否已连接。                                                                      |
| `get state(): ConnectionState`                                   | 当前连接状态。                                                                    |
| `onState(listener): () => void`                                  | 订阅状态变化，返回取消函数（可多路订阅）。                                        |

### 订阅与取消

```ts
subscribe(
  destination: string,
  callback: JsonCallback,             // (json, ack) => void
  options?: { id?: string; ack?: AckMode; onParseError?: ParseFailureAck },
): StompSub;                          // { id, unsubscribe() }
```

| 选项           | 说明                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------- |
| `id`           | 传相同 id → 回调加入同一订阅队列，多回调共用一份解析数据、不重复 SUBSCRIBE；不传 → 独立订阅。 |
| `ack`          | 见[确认](#确认acknack)。                                                                      |
| `onParseError` | 解析失败时 `nack`（默认，重投）或 `ack`（丢弃）。                                             |

`StompSub.unsubscribe()`：引用计数取消（该 id 最后一个回调取消时才 UNSUBSCRIBE），幂等。

```ts
unsubscribe(options: { id?: string; destination?: string }): number; // 按 id / 按 topic，返回取消数
clear(): void;                                                       // 取消全部
```

> Web 端 `JSON.parse` 同步、stompjs 按序投递，天然有序，故**无** Dart 版的 `ordered` 参数与解析线程分流。

### 发送

```ts
send(destination: string, options?: { body?: string | Uint8Array | object; headers?: Record<string,string> }): void;
```

`body`：`string`（原样）、`object`（自动 `JSON.stringify` + `content-type: application/json`）、`Uint8Array`（二进制）、`undefined`（无 body）。未连接时按 `queueWhileDisconnected` 缓冲。

### 连接状态观测

```ts
// 框架无关
const off = client.onState((s) => console.log(s));
client.state; // 当前值

// Vue 桥接成响应式 ref
import { ref } from "vue";
const state = ref(client.state);
client.onState((s) => (state.value = s));
```

`ConnectionState`：`idle` / `connecting` / `connected` / `reconnecting` / `disconnected`。

### 确认（ACK/NACK）

`AckMode`（`subscribe` 的 `ack` 选项）：

| 值             | STOMP                   | 行为                                                                                  |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `auto`（默认） | `ack:auto`              | 服务端自动确认，本封装**不发**任何 ACK/NACK。                                         |
| `smart`        | `ack:client-individual` | 按处理结果**自动** ACK（回调全成功）/ NACK（任一抛异常）。解析失败按 `onParseError`。 |
| `manual`       | `ack:client-individual` | **不自动应答**，回调第二参给 `AckControl` 手动 ack/nack。                             |

回调签名：`type JsonCallback = (json: JsonMessage, ack: AckControl) => void;`（非 manual 下 `ack` 为 no-op，可写 `(json) => ...`）。

**手动确认（可在回调外调用）**：`AckControl` 可存起来，异步完成后再 ack：

```ts
const pending = new Map<string, AckControl>();

client.subscribe(
  "/queue/tasks",
  (json, ack) => {
    pending.set(json.taskId as string, ack); // 存起来
  },
  { ack: AckMode.manual },
);

// 别处、异步完成后：
function onTaskDone(taskId: string) {
  pending.get(taskId)?.ack(); // 外部 ack
  pending.delete(taskId);
}
```

`AckControl` 绑定“会话代次”，**重连后旧句柄自动失效（no-op）**，重复调用幂等。

### 类型与枚举

```ts
type JsonMessage = Record<string, unknown>;
type JsonCallback = (json: JsonMessage, ack: AckControl) => void;
interface AckControl {
  ack: () => void;
  nack: () => void;
}
interface StompSub {
  readonly id: string;
  unsubscribe: () => void;
}

// 均为 as const 对象（仓库 erasableSyntaxOnly 禁用 enum）
const AckMode = { auto, smart, manual } as const;
const ParseFailureAck = { nack, ack } as const;
const ConnectionState = { idle, connecting, connected, reconnecting, disconnected } as const;
```

## 行为与语义说明

- **重连不会内存膨胀**：订阅表以 id 为键，重连只重放不新增；出站缓冲有上限；manual 的 `AckControl` 由调用方持有、本封装不留存。
- **重连 vs 重订阅**：传输重连由 `reconnectDelay` 交给 stompjs；重连后重新订阅由本封装完成，业务可在 `onConnected` 里重拉快照。
- **`isBinaryBody` 不可靠**：stompjs 对收到的帧几乎总置 `isBinaryBody=true`，本封装改按 `content-type: application/octet-stream` 判定二进制。

## 与 Dart 版差异

对等实现另有 Dart 版 `flutter_stompsocket`（顶层类同为 `Stompsocket`）。差异：Dart 版因用 isolate 解析，额外有 `ordered` 有序队列与解析线程分流；状态观测用 `ValueListenable`。Web 版同步解析、天然有序，无这些。

## License

MIT
