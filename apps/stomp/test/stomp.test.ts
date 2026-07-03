import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AckControl, AckMode, ConnectionState, ParseFailureAck, type JsonMessage, type SocketClientOptions, SocketClient } from "../src/index.ts";
import { StompTestBroker } from "./broker.ts";

let broker: StompTestBroker;
const clients: SocketClient[] = [];

function make(opts: Partial<SocketClientOptions> = {}): SocketClient {
  const c = new SocketClient({
    brokerURL: `ws://127.0.0.1:${broker.port}`,
    reconnectDelay: 80,
    resumeOnForeground: false, // node 无 document，避免噪音
    ...opts,
  });
  clients.push(c);
  return c;
}

async function pump(cond: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(async () => {
  broker = new StompTestBroker();
  await broker.start();
});

afterEach(async () => {
  await Promise.all(clients.map((c) => c.dispose().catch(() => {})));
  clients.length = 0;
  await broker.stop();
});

describe("@codejoo/stomp SocketClient", () => {
  it("subscribe：收到并解析 JSON 消息", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);

    const got: JsonMessage[] = [];
    c.subscribe("/topic/a", (j) => got.push(j));
    await pump(() => broker.subscriptionCount === 1);

    broker.sendMessage("/topic/a", '{"v":1}');
    await pump(() => got.length > 0);
    expect(got[0].v).toBe(1);
  });

  it("subscribe：相同 id 多回调共享一份解析数据，且只订阅一次", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);

    let a: JsonMessage | undefined;
    let b: JsonMessage | undefined;
    c.subscribe("/topic/a", (j) => (a = j), { id: "S" });
    c.subscribe("/topic/a", (j) => (b = j), { id: "S" });
    await pump(() => broker.subscriptionCount === 1);

    expect(broker.subscribeCountFor("S")).toBe(1);
    broker.sendMessage("/topic/a", '{"v":2}');
    await pump(() => a !== undefined && b !== undefined);
    expect(a).toBe(b); // 同一对象引用
  });

  it("unsubscribe：按 id 取消", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    const sub = c.subscribe("/topic/a", () => {});
    await pump(() => broker.subscriptionCount === 1);

    expect(c.unsubscribe({ id: sub.id })).toBe(1);
    await pump(() => broker.subscriptionCount === 0);
    expect(broker.framesOf("UNSUBSCRIBE")[0].headers.id).toBe(sub.id);
  });

  it("unsubscribe：按 destination 批量取消", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    c.subscribe("/topic/a", () => {}, { id: "a1" });
    c.subscribe("/topic/a", () => {}, { id: "a2" });
    c.subscribe("/topic/b", () => {}, { id: "b1" });
    await pump(() => broker.subscriptionCount === 3);

    expect(c.unsubscribe({ destination: "/topic/a" })).toBe(2);
    await pump(() => broker.subscriptionCount === 1);
  });

  it("clear：取消所有订阅", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    c.subscribe("/topic/a", () => {}, { id: "a1" });
    c.subscribe("/topic/b", () => {}, { id: "b1" });
    await pump(() => broker.subscriptionCount === 2);

    c.clear();
    await pump(() => broker.subscriptionCount === 0);
  });

  it("未连接时订阅，连接后自动重放", async () => {
    const c = make();
    const got: JsonMessage[] = [];
    c.subscribe("/topic/a", (j) => got.push(j)); // activate 前
    c.activate();

    await pump(() => broker.subscriptionCount === 1);
    broker.sendMessage("/topic/a", '{"v":9}');
    await pump(() => got.length > 0);
    expect(got[0].v).toBe(9);
  });

  it("断线重连后自动重新订阅", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    const got: JsonMessage[] = [];
    c.subscribe("/topic/a", (j) => got.push(j));
    await pump(() => broker.subscriptionCount === 1);

    await broker.dropConnections();
    await pump(() => !c.connected, 5000);
    await pump(() => c.connected, 5000);
    await pump(() => broker.subscriptionCount === 1);

    broker.sendMessage("/topic/a", '{"v":7}');
    await pump(() => got.length > 0);
    expect(got[0].v).toBe(7);
  });

  it("smart：处理成功发 ACK", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    c.subscribe("/topic/a", () => {}, { ack: AckMode.smart });
    await pump(() => broker.subscriptionCount === 1);
    expect(broker.framesOf("SUBSCRIBE").at(-1)?.headers.ack).toBe("client-individual");

    broker.sendMessage("/topic/a", '{"v":1}', { withAck: true });
    await pump(() => broker.framesOf("ACK").length > 0);
    expect(broker.framesOf("NACK").length).toBe(0);
  });

  it("auto-ack：回调抛异常发 NACK", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    c.subscribe(
      "/topic/a",
      () => {
        throw new Error("boom");
      },
      { ack: AckMode.smart },
    );
    await pump(() => broker.subscriptionCount === 1);

    broker.sendMessage("/topic/a", '{"v":1}', { withAck: true });
    await pump(() => broker.framesOf("NACK").length > 0);
    expect(broker.framesOf("ACK").length).toBe(0);
  });

  it("auto-ack：解析失败默认 NACK；onParseError=ack 时 ACK", async () => {
    const c1 = make();
    c1.activate();
    await pump(() => c1.connected);
    c1.subscribe("/topic/nack", () => {}, { ack: AckMode.smart });
    await pump(() => broker.subscriptionCount === 1);
    broker.sendMessage("/topic/nack", "not-json", { withAck: true });
    await pump(() => broker.framesOf("NACK").length > 0);

    const c2 = make();
    c2.activate();
    await pump(() => c2.connected);
    c2.subscribe("/topic/ack", () => {}, { ack: AckMode.smart, onParseError: ParseFailureAck.ack });
    await pump(() => broker.subscriptionCount === 2);
    broker.sendMessage("/topic/ack", "not-json", { withAck: true });
    await pump(() => broker.framesOf("ACK").length > 0);
  });

  it("auto（默认）：不发送任何 ACK/NACK", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    c.subscribe("/topic/a", () => {}); // 默认 AckMode.auto
    await pump(() => broker.subscriptionCount === 1);
    expect(broker.framesOf("SUBSCRIBE").at(-1)?.headers.ack).toBeUndefined();

    broker.sendMessage("/topic/a", '{"v":1}', { withAck: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(broker.framesOf("ACK").length).toBe(0);
    expect(broker.framesOf("NACK").length).toBe(0);
  });

  it("manual：通过 ctrl 手动 ACK（可在回调外调用），且幂等", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);

    let saved: AckControl | undefined;
    let got: JsonMessage | undefined;
    c.subscribe(
      "/topic/m",
      (j, ack) => {
        got = j;
        saved = ack;
      },
      { ack: AckMode.manual },
    );
    await pump(() => broker.subscriptionCount === 1);
    expect(broker.framesOf("SUBSCRIBE").at(-1)?.headers.ack).toBe("client-individual");

    broker.sendMessage("/topic/m", '{"v":1}', { withAck: true });
    await pump(() => saved !== undefined);
    expect(got?.v).toBe(1);

    await new Promise((r) => setTimeout(r, 50));
    expect(broker.framesOf("ACK").length).toBe(0); // manual 下不自动应答

    saved!.ack(); // 回调外手动 ack
    await pump(() => broker.framesOf("ACK").length > 0);
    saved!.ack(); // 幂等
    expect(broker.framesOf("ACK").length).toBe(1);
  });

  it("manual：重连后旧 ctrl 失效（no-op）", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    let saved: AckControl | undefined;
    c.subscribe("/topic/m", (_j, ack) => (saved = ack), { ack: AckMode.manual });
    await pump(() => broker.subscriptionCount === 1);
    broker.sendMessage("/topic/m", '{"v":1}', { withAck: true });
    await pump(() => saved !== undefined);

    await broker.dropConnections();
    await pump(() => !c.connected, 5000);
    await pump(() => c.connected, 5000);

    saved!.ack(); // 旧会话句柄，应为 no-op
    await new Promise((r) => setTimeout(r, 50));
    expect(broker.framesOf("ACK").length).toBe(0);
  });

  it("send：已连接时 object 自动 JSON 编码发出 SEND", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    c.send("/app/order", { body: { sku: "A", qty: 2 } });
    await pump(() => broker.framesOf("SEND").length > 0);

    const f = broker.framesOf("SEND")[0];
    expect(f.headers.destination).toBe("/app/order");
    expect(f.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(f.body)).toEqual({ sku: "A", qty: 2 });
  });

  it("send：未连接时缓冲，连接后按序补发", async () => {
    const c = make();
    c.send("/app/x", { body: "first" });
    c.send("/app/x", { body: "second" });
    c.activate();
    await pump(() => broker.framesOf("SEND").length === 2, 5000);
    expect(broker.framesOf("SEND").map((f) => f.body)).toEqual(["first", "second"]);
  });

  it("状态：idle → connecting → connected，onState 通知，dispose→disconnected", async () => {
    const c = make();
    expect(c.state).toBe(ConnectionState.idle);

    const seen: ConnectionState[] = [];
    c.onState((s) => seen.push(s));

    c.activate();
    expect(c.state).toBe(ConnectionState.connecting);
    await pump(() => c.connected);
    expect(c.state).toBe(ConnectionState.connected);
    expect(seen).toContain(ConnectionState.connecting);
    expect(seen).toContain(ConnectionState.connected);

    await c.dispose();
    expect(c.state).toBe(ConnectionState.disconnected);
  });

  it("beforeConnect：连接前刷新 token 并带入 CONNECT 头", async () => {
    let calls = 0;
    const c = make({
      beforeConnect: () => {
        calls++;
        return { Authorization: `Bearer token-${calls}` };
      },
    });
    c.activate();
    await pump(() => c.connected);
    expect(broker.framesOf("CONNECT")[0].headers.Authorization).toBe("Bearer token-1");
  });

  it("断线重连时重新执行 beforeConnect（token 可刷新）", async () => {
    let calls = 0;
    const c = make({
      beforeConnect: () => {
        calls++;
        return { Authorization: `Bearer token-${calls}` };
      },
    });
    c.activate();
    await pump(() => c.connected);
    await broker.dropConnections();
    await pump(() => !c.connected, 5000);
    await pump(() => c.connected, 5000);

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(broker.framesOf("CONNECT").at(-1)?.headers.Authorization).toBe(`Bearer token-${calls}`);
  });

  it("binaryDecoder：自定义二进制解码", async () => {
    const c = make({
      binaryDecoder: (bytes) => JSON.parse(new TextDecoder().decode(bytes)) as JsonMessage,
    });
    c.activate();
    await pump(() => c.connected);
    let got: JsonMessage | undefined;
    c.subscribe("/topic/bin", (j) => (got = j));
    await pump(() => broker.subscriptionCount === 1);

    broker.sendMessage("/topic/bin", '{"b":true}', { contentType: "application/octet-stream", binary: true });
    await pump(() => got !== undefined);
    expect(got?.b).toBe(true);
  });

  it("未配置 binaryDecoder：二进制消息按解析失败处理（NACK）", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    c.subscribe("/topic/bin", () => {}, { ack: AckMode.smart });
    await pump(() => broker.subscriptionCount === 1);
    broker.sendMessage("/topic/bin", "anything", { contentType: "application/octet-stream", binary: true, withAck: true });
    await pump(() => broker.framesOf("NACK").length > 0);
  });

  it("onStompError：服务端 ERROR 帧回调", async () => {
    let msg: string | undefined;
    const c = make({ onStompError: (f) => (msg = f.headers.message) });
    c.activate();
    await pump(() => c.connected);
    broker.sendError("bad-destination");
    await pump(() => msg !== undefined);
    expect(msg).toBe("bad-destination");
  });

  it("引用计数：同 id 两回调，取消一个仍在线，取消最后一个才 UNSUBSCRIBE", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    const got1: JsonMessage[] = [];
    const got2: JsonMessage[] = [];
    const s1 = c.subscribe("/topic/a", (j) => got1.push(j), { id: "S" });
    const s2 = c.subscribe("/topic/a", (j) => got2.push(j), { id: "S" });
    await pump(() => broker.subscriptionCount === 1);

    s1.unsubscribe();
    broker.sendMessage("/topic/a", '{"v":1}');
    await pump(() => got2.length > 0);
    expect(got1.length).toBe(0);
    expect(broker.subscriptionCount).toBe(1);
    expect(broker.framesOf("UNSUBSCRIBE").length).toBe(0);

    s2.unsubscribe();
    await pump(() => broker.subscriptionCount === 0);
    expect(broker.framesOf("UNSUBSCRIBE")[0].headers.id).toBe("S");
  });

  it("forceReconnect：跳过 reconnectDelay 立即重连", async () => {
    const c = make({ reconnectDelay: 30000 });
    c.activate();
    await pump(() => c.connected);
    await broker.dropConnections();
    await pump(() => !c.connected, 5000);

    c.forceReconnect();
    await pump(() => c.connected, 5000);
  });

  it("copyWith：覆盖提供的参数，未提供的继承，且是独立可用的新实例", async () => {
    const base = make({ maxQueuedMessages: 7 });
    const derived = base.copyWith({ maxQueuedMessages: 99 });
    clients.push(derived);
    expect(derived).not.toBe(base);

    derived.activate();
    await pump(() => derived.connected);
    const got: JsonMessage[] = [];
    derived.subscribe("/topic/copy", (j) => got.push(j));
    await pump(() => broker.subscriptionCount === 1);
    broker.sendMessage("/topic/copy", '{"v":1}');
    await pump(() => got.length > 0);
    expect(got[0].v).toBe(1);
  });

  it("dispose 后可再次 activate 复用；keepSubscriptions 保留订阅", async () => {
    const c = make();
    c.activate();
    await pump(() => c.connected);
    const got: JsonMessage[] = [];
    c.subscribe("/topic/a", (j) => got.push(j));
    await pump(() => broker.subscriptionCount === 1);

    await c.dispose(true); // 保留订阅
    await pump(() => !c.connected);
    c.activate();
    await pump(() => broker.subscriptionCount === 1, 5000);

    broker.sendMessage("/topic/a", '{"v":42}');
    await pump(() => got.length > 0);
    expect(got.at(-1)?.v).toBe(42);
  });
});
