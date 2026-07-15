/**
 * 最基本的连接/订阅/发送，对接 api-ws-demo 的普通（非静态压缩）topic。
 *
 * 演示 api-ws-demo 两个跟本封装配合的行为：
 * 1. SUBSCRIBE 成功后，服务端一定会在 3 秒后主动推一条消息——这个 topic 之前没人发过，
 *    所以推的是 {"response":"ready"}。
 * 2. 之后 SEND 一条消息，服务端会把它广播成 {"response": <发送内容>}（JSON 包一层），
 *    并缓存下来：如果这时候有新订阅者加入，它 3 秒后收到的会是这条缓存内容而不是 "ready"。
 *
 * 运行：node examples/01-basic-pubsub.ts
 */
import { Stompsocket } from "@codejoo/stomp";

import { WS_BASE } from "./config.ts";

const client = new Stompsocket({
  brokerURL: `${WS_BASE}/stomp`,
  debug: true,
});

client.subscribe("/topic/public/room1", (json) => {
  console.log("收到:", json);
});

client.activate();

setTimeout(() => {
  console.log("发送一条消息...");
  client.send("/topic/public/room1", { body: "hello from example" });
}, 4000);

setTimeout(async () => {
  await client.dispose();
  process.exit(0);
}, 6000);
