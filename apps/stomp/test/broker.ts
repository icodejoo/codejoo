import type { AddressInfo } from "node:net";
import { type WebSocket, WebSocketServer } from "ws";

/** 客户端发来的帧（供断言）。 */
export interface ReceivedFrame {
  command: string;
  headers: Record<string, string>;
  body: string;
}

interface Conn {
  ws: WebSocket;
  subs: Map<string, string>; // subId -> destination
}

/**
 * 极简 STOMP-over-WebSocket 测试 broker（node + ws），仅实现客户端用到的帧子集。
 * 与 Dart 版 stomp_test_broker 等价，用于 @codejoo/stomp 的集成测试。
 */
export class StompTestBroker {
  private server?: WebSocketServer;
  private readonly conns = new Set<Conn>();
  private messageId = 0;
  readonly received: ReceivedFrame[] = [];

  get port(): number {
    return (this.server!.address() as AddressInfo).port;
  }

  get subscriptionCount(): number {
    let n = 0;
    for (const c of this.conns) n += c.subs.size;
    return n;
  }

  framesOf(command: string): ReceivedFrame[] {
    return this.received.filter((f) => f.command === command);
  }

  subscribeCountFor(id: string): number {
    return this.received.filter((f) => f.command === "SUBSCRIBE" && f.headers.id === id).length;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = new WebSocketServer({ port: 0 }, resolve);
      this.server.on("connection", (ws) => {
        const conn: Conn = { ws, subs: new Map() };
        this.conns.add(conn);
        ws.on("message", (data: Buffer) => this.onData(conn, data.toString()));
        ws.on("close", () => this.conns.delete(conn));
        ws.on("error", () => this.conns.delete(conn));
      });
    });
  }

  async stop(): Promise<void> {
    await this.dropConnections();
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = undefined;
  }

  /** 强制关闭当前所有连接（模拟断网，触发客户端重连）。 */
  async dropConnections(): Promise<void> {
    for (const c of Array.from(this.conns)) c.ws.close();
    this.conns.clear();
    await new Promise((r) => setTimeout(r, 20)); // 让 close 传播到客户端
  }

  /** 向订阅了 destination 的所有连接推送一条 MESSAGE，返回投递条数。 */
  sendMessage(destination: string, body: string, opts: { contentType?: string; withAck?: boolean; binary?: boolean } = {}): number {
    let delivered = 0;
    for (const c of this.conns) {
      for (const [subId, dest] of c.subs) {
        if (dest !== destination) continue;
        const mid = `msg-${this.messageId++}`;
        const headers: Record<string, string> = {
          subscription: subId,
          "message-id": mid,
          destination,
          "content-type": opts.contentType ?? "application/json",
        };
        if (opts.withAck) headers.ack = `ack-${mid}`;
        this.sendFrame(c.ws, "MESSAGE", headers, body, opts.binary ?? false);
        delivered++;
      }
    }
    return delivered;
  }

  /** 向所有连接发送一帧 STOMP ERROR。 */
  sendError(message: string, body = ""): void {
    for (const c of this.conns) {
      this.sendFrame(c.ws, "ERROR", { message, "content-type": "text/plain" }, body, false);
    }
  }

  private sendFrame(ws: WebSocket, command: string, headers: Record<string, string>, body: string, binary: boolean): void {
    let s = command;
    for (const [k, v] of Object.entries(headers)) s += `\n${k}:${v}`;
    s += `\n\n${body}\0`;
    try {
      // 以二进制 WS 帧发送时，stompjs 会把 isBinaryBody 置 true
      if (binary) ws.send(Buffer.from(s, "utf8"), { binary: true });
      else ws.send(s);
    } catch {
      // 连接正在关闭，忽略
    }
  }

  private onData(conn: Conn, raw: string): void {
    const frame = this.parse(raw);
    if (!frame) return; // 心跳/空帧
    this.received.push(frame);
    switch (frame.command) {
      case "CONNECT":
      case "STOMP":
        // 不带 heart-beat 头 → 客户端不会启动心跳定时器
        this.sendFrame(conn.ws, "CONNECTED", { version: "1.2" }, "", false);
        break;
      case "SUBSCRIBE":
        conn.subs.set(frame.headers.id, frame.headers.destination);
        break;
      case "UNSUBSCRIBE":
        conn.subs.delete(frame.headers.id);
        break;
      case "DISCONNECT": {
        const r = frame.headers.receipt;
        if (r) this.sendFrame(conn.ws, "RECEIPT", { "receipt-id": r }, "", false);
        // 会话结束：立即从计数移除（socket 由客户端在收到 RECEIPT 后关闭）
        this.conns.delete(conn);
        break;
      }
      default:
        break; // ACK / NACK / SEND：已记入 received
    }
  }

  private parse(raw: string): ReceivedFrame | null {
    let s = raw;
    if (s.endsWith("\0")) s = s.slice(0, -1);
    if (s.trim() === "") return null; // 心跳
    const sep = s.indexOf("\n\n");
    const head = sep >= 0 ? s.slice(0, sep) : s;
    const body = sep >= 0 ? s.slice(sep + 2) : "";
    const lines = head.split("\n");
    const headers: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].indexOf(":");
      if (c > 0) headers[lines[i].slice(0, c)] = lines[i].slice(c + 1);
    }
    return { command: lines[0], headers, body };
  }
}
