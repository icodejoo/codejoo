# 示例

对接开源测试服务器 [api-ws-demo](https://github.com/icodejoo/api-ws-demo)（线上：
`wss://api-ws-demo-latest.onrender.com`），演示 `@codejoo/stomp` 的浏览器端用法
（`@codejoo/stomp` 是给客户端/浏览器用的，不是 Node 服务端库——想在本仓库里用真实代码
（未发布的最新构建）交互式试各种功能，看 [`../example/`](../example/)，那边是
`workspace:*` 链接本地构建、走 Vite dev server 的完整版）。

## `05-browser-demo.html`

浏览器可视化 demo：连接状态、订阅 topic、消息日志、输入框发消息。**不需要装依赖/构建/起
dev server**——直接双击用浏览器打开这个 HTML 文件就能跑（通过 CDN 以 ES module 方式加载
`@codejoo/stomp`，只需要联网）。定位是"完全不用 clone 仓库、随手下载这一个文件就能试"，
跟 `../example/` 的本地开发场景是两个不同的用途。

直接在文件管理器里双击打开、或者浏览器里 `Ctrl+O` 选中这个文件即可。

> 这个 HTML demo 用的是 CDN 上已发布的 `@codejoo/stomp@0.2.0`，还没包含仓库里这次改的
> binaryDecoder 健壮性修复和 onUnhandled* 崩溃修复（这两个还没发版）——所以 demo 特意只用
> 默认 `auto` ack 模式的普通 JSON topic，不涉及这两处修复覆盖的场景。等发布新版本后可以
> 把 CDN 地址里的版本号去掉（`@codejoo/stomp` 不带版本号会解析到最新版），并考虑跟
> `../example/` 一样加上压缩 topic 的 binaryDecoder 演示。

## 背景：这个过程中验证过的两个真实 bug

写这个 demo 的过程中，跑起来对接真实服务端时发现并修复了两个此前没暴露出来的问题（本地用
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
