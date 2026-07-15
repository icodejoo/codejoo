/**
 * ack: smart 模式对接 api-ws-demo 的 ack:client-individual —— 每条 MESSAGE 都带一个
 * ack id，回调正常处理完就自动 ACK、抛异常就自动 NACK。api-ws-demo 收到 ACK/NACK 后会回一条
 * RECEIPT，body 是 {"status":"ok"}（这里通过 debug 日志能看到这条 RECEIPT 帧）。
 *
 * 运行：node examples/03-ack-nack.ts
 */
import { AckMode, Stompsocket } from "@codejoo/stomp";

import { WS_BASE } from "./config.ts";

const client = new Stompsocket({
  brokerURL: `${WS_BASE}/stomp`,
  debug: true,
});

let processed = 0;
client.subscribe(
  "/topic/public/tasks",
  (json) => {
    processed++;
    console.log("处理任务:", json);
    // 正常返回 → 本封装自动发 ACK，服务端回 RECEIPT {"status":"ok"}（看下面的 debug 日志）
  },
  { ack: AckMode.smart },
);

client.activate();

setTimeout(() => {
  console.log("发送任务...");
  client.send("/topic/public/tasks", { body: "task-1" });
}, 1000);

setTimeout(async () => {
  console.log(`共处理 ${processed} 条任务`);
  await client.dispose();
  process.exit(0);
}, 3000);
