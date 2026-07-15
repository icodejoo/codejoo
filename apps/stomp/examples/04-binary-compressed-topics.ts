/**
 * 对接 api-ws-demo 的 5 个静态压缩测试 topic（gzip/zstd 压缩的 JSON，以及 msgpack）。
 *
 * 关键点：这些 topic 的 content-type 是 `application/json` / `application/msgpack`——
 * **不是** `application/octet-stream`。本封装从 0.2.1 起，二进制识别不再只认
 * `application/octet-stream`：非该类型的帧会先做严格 UTF-8 解码，解码失败（gzip/zstd/msgpack
 * 这类二进制数据几乎必然如此）就照样路由到 binaryDecoder，而不是被误当成文本 JSON.parse
 * 抛异常/NACK 掉。这个例子就是验证这条路径在真实服务端下确实生效。
 *
 * binaryDecoder 本身拿到的只有原始字节（没有 headers），所以这里按"依次尝试解压/解码方式"
 * 实现，而不是精确按 content-encoding 分流——足以覆盖这 5 种组合。
 *
 * 运行：node examples/04-binary-compressed-topics.ts
 */
import zlib from "node:zlib";

import { decode as msgpackDecode } from "@msgpack/msgpack";
import { Stompsocket, type JsonMessage } from "@codejoo/stomp";

import { WS_BASE } from "./config.ts";

function decodeCompressed(bytes: Uint8Array): JsonMessage {
  const buf = Buffer.from(bytes);
  const candidates: Buffer[] = [buf];
  try {
    candidates.push(zlib.gunzipSync(buf));
  } catch {
    /* 不是 gzip，试下一种 */
  }
  try {
    candidates.push(zlib.zstdDecompressSync(buf));
  } catch {
    /* 不是 zstd，试下一种 */
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.toString("utf8")) as JsonMessage;
    } catch {
      /* 不是 JSON 文本 */
    }
    try {
      return msgpackDecode(candidate) as JsonMessage;
    } catch {
      /* 不是 msgpack */
    }
  }
  throw new Error("解码失败：既不是 gzip/zstd 压缩的 JSON，也不是 msgpack");
}

const TOPICS = ["/topic/compressed", "/topic/compressed-zstd", "/topic/compressed-mp", "/topic/compressed-mp-gzip", "/topic/compressed-mp-zstd"];

const client = new Stompsocket({
  brokerURL: `${WS_BASE}/stomp`,
  binaryDecoder: decodeCompressed,
  debug: true,
});

let received = 0;
for (const topic of TOPICS) {
  client.subscribe(topic, (json) => {
    received++;
    console.log(`[${topic}] 解码结果:`, json);
    if (received === TOPICS.length) {
      console.log(`\n全部 ${TOPICS.length} 个压缩 topic 均解码成功`);
      void client.dispose().then(() => process.exit(0));
    }
  });
}

client.activate();

setTimeout(() => {
  // 发送内容会被服务端忽略——这几个 topic 一律广播固定的静态压缩数据
  for (const topic of TOPICS) client.send(topic, { body: "x" });
}, 1000);

setTimeout(() => {
  console.error(`超时：只收到 ${received}/${TOPICS.length} 个压缩 topic 的响应`);
  process.exit(1);
}, 8000);
