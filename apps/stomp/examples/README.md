# 示例

对接开源测试服务器 [api-ws-demo](https://github.com/icodejoo/api-ws-demo)（线上：
`wss://api-ws-demo-latest.onrender.com`），演示 `@codejoo/stomp` 的几个关键能力，也用作
真实服务端场景下的集成测试用例。

## 准备

```bash
pnpm install
pnpm run build   # 示例从包名 @codejoo/stomp 导入，需要先构建出 dist/
```

默认连接线上部署的 api-ws-demo（`https://api-ws-demo-latest.onrender.com`，Render 免费实例，
闲置会休眠，首次请求可能要等几十秒冷启动；这个实例也可能被其他人同时拿来测试，公共 topic 的
数据会互相影响）。要连自己本地跑的实例（`cargo run`，默认端口 8080），设置环境变量：

```bash
API_WS_DEMO_HTTP=http://localhost:8080 API_WS_DEMO_WS=ws://localhost:8080 node examples/01-basic-pubsub.ts
```

## 示例列表

| 文件 | 演示内容 |
| --- | --- |
| `01-basic-pubsub.ts` | 基本连接/订阅/发送；api-ws-demo 的"订阅 3 秒后必定推送一次"和 SEND 广播的 JSON 包装行为。 |
| `02-auth-secure-topic.ts` | `beforeConnect` token 注入，对照匿名连接 vs 鉴权连接访问 `/topic/secure/*` 的差异。 |
| `03-ack-nack.ts` | `AckMode.smart` 对接 `ack:client-individual`，服务端确认回执。 |
| `04-binary-compressed-topics.ts` | 关键示例：`binaryDecoder` 处理 gzip/zstd 压缩的 JSON 以及 msgpack——即便 content-type 是 `application/json`/`application/msgpack` 而不是 `application/octet-stream`，也能正确路由到二进制解码（见下）。 |

```bash
pnpm run example:basic
pnpm run example:auth
pnpm run example:ack
pnpm run example:binary
```

## 背景：这几个示例验证过的两个真实 bug

写这几个示例的过程中，跑起来对接真实服务端时发现并修复了两个此前没暴露出来的问题（本地用
手写的裸 WebSocket 脚本测试时不会触发，只有接真正的 `@stomp/stompjs` 客户端才会遇到）：

1. **api-ws-demo 没有协商 WebSocket 子协议**：`@stomp/stompjs` 会在握手时请求
   `v12.stomp`/`v11.stomp`/`v10.stomp` 子协议，按 WebSocket 规范，服务端如果不在响应里
   确认其中一个，客户端必须中止连接——之前服务端完全没处理这个，导致任何标准 STOMP.js
   客户端根本连不上（哪怕裸 `new WebSocket(url)` 不带子协议请求是能连上的，掩盖了这个问题）。
2. **本封装未提供 `onUnhandledReceipt`/`onUnhandledMessage`/`onUnhandledFrame` 时会崩溃**：
   stompjs 自己的 `Client` 内部默认这三个是 no-op，但本封装此前把 `undefined` 原样传给
   stompjs 的 `configure()`，而它是用 `Object.assign` 应用配置的——只要 key 存在、哪怕值是
   `undefined` 也会覆盖掉 stompjs 自己的默认值，导致收到一条"未关联的 RECEIPT"（比如
   api-ws-demo 对 ACK/NACK 的确认回执，其 `receipt-id` 是服务端自定的 ack id，并不是
   stompjs 自己用 `receipt` 头请求过的）时直接抛 `TypeError`。现在这三个回调未提供时会
   显式兜底成 no-op。
