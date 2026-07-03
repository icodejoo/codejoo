import { Client, type IFrame, type IMessage, type StompSubscription } from "@stomp/stompjs";

/** 解析后的 JSON 消息（约定顶层为对象）。 */
export type JsonMessage = Record<string, unknown>;

/**
 * 订阅回调。第二参 [ack] 恒有值：仅在 [AckMode.manual] 下用于手动 ACK/NACK，
 * 其余模式为 no-op（可安全忽略，`(json) => ...` 或 `(json, ack) => ...` 均可）。
 */
export type JsonCallback = (json: JsonMessage, ack: AckControl) => void;

/** 手动确认句柄，随每条消息传入回调（见 [AckMode.manual]）。可存起来在回调外任意时刻调用；
 * 仅同一连接内有效，重连后旧句柄自动失效（no-op），重复调用幂等。 */
export interface AckControl {
  ack: () => void;
  nack: () => void;
}

/**
 * 订阅的确认模式（单一字段，覆盖“不应答/自动应答/手动应答”三态）。
 * 用 `as const` 对象而非 enum：仓库开启了 `erasableSyntaxOnly`，enum 不可用。
 */
export const AckMode = {
  /** 默认：STOMP ack:auto，服务端自动确认，本封装不发任何 ACK/NACK */
  auto: "auto",
  /** STOMP ack:client-individual，本封装按处理结果自动 ACK（成功）/NACK（失败） */
  smart: "smart",
  /** STOMP ack:client-individual，本封装不自动应答，通过回调的 AckControl 手动 ack/nack */
  manual: "manual",
} as const;
export type AckMode = (typeof AckMode)[keyof typeof AckMode];

/** 传给非 manual 回调的空确认句柄（本封装已负责应答或无需应答）。 */
const NOOP_ACK: AckControl = { ack: () => {}, nack: () => {} };

/**
 * 消息体解析失败时的自动确认动作（仅在 [AckMode] 非 auto 时生效）。
 * - nack：通常触发重投（毒消息会反复重投，依赖 broker 死信/上限兜底）
 * - ack：确认并丢弃坏消息，避免死循环
 */
export const ParseFailureAck = {
  nack: "nack",
  ack: "ack",
} as const;
export type ParseFailureAck = (typeof ParseFailureAck)[keyof typeof ParseFailureAck];

/** 连接状态。 */
export const ConnectionState = {
  /** 未启动或已 dispose */
  idle: "idle",
  /** 正在建立首次连接 */
  connecting: "connecting",
  /** 已连接 */
  connected: "connected",
  /** 已断开，等待自动重连 */
  reconnecting: "reconnecting",
  /** 已停止（主动 dispose，或未开启重连时断开） */
  disconnected: "disconnected",
} as const;
export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState];

/** 连接状态监听器。 */
export type StateListener = (state: ConnectionState) => void;

/** [Stompsocket.subscribe] 的返回句柄。 */
export interface StompSub {
  /** 订阅 id，可用于 [Stompsocket.unsubscribe]。 */
  readonly id: string;
  /**
   * 取消本次注册的回调（引用计数）：当该 id 的最后一个回调被取消时，
   * 才向服务端发送 UNSUBSCRIBE。重复调用安全（幂等）。
   */
  unsubscribe: () => void;
}

export interface StompsocketOptions {
  /** WebSocket 地址（ws:// 或 wss://）。 */
  brokerURL: string;
  /** 入向心跳（ms），默认 10000。 */
  heartbeatIncoming?: number;
  /** 出向心跳（ms），默认 10000。 */
  heartbeatOutgoing?: number;
  /** 连接超时（ms），默认 0（不超时）。 */
  connectionTimeout?: number;
  /** 自动重连间隔（ms），默认 5000；设为 0 关闭自动重连。 */
  reconnectDelay?: number;
  /** 静态 CONNECT 头。 */
  connectHeaders?: Record<string, string>;
  /**
   * 每次连接前（含重连）执行，可做异步 token 刷新；返回的头会覆盖 CONNECT 头。
   * 返回 void 则沿用现有头。
   */
  beforeConnect?: () => Promise<Record<string, string> | void> | Record<string, string> | void;
  /**
   * 二进制消息体解码器：收到 `content-type: application/octet-stream` 的帧时调用，
   * 入参为 `message.binaryBody`，返回解析后的对象，解码失败请抛异常（按解析失败走
   * [ParseFailureAck] 策略）。未提供时这类消息按解析失败处理。
   */
  binaryDecoder?: (bytes: Uint8Array) => JsonMessage;
  /** 未连接时是否缓冲出站消息，连上后按序补发，默认 true。 */
  queueWhileDisconnected?: boolean;
  /** 出站缓冲上限，超出丢弃最旧，默认 100。 */
  maxQueuedMessages?: number;
  /**
   * 回前台（visibilitychange→visible）或网络恢复（online）时，若当前未连接则立即重连
   * （跳过 reconnectDelay 等待），默认 true。
   *
   * 用于规避 Chromium 后台标签页定时器节流导致心跳停摆、连接被静默关闭的问题
   * （stompjs #335/#669）。回前台重连后订阅会自动重放，业务可在 onConnected 里重拉快照。
   * 非浏览器环境（无 document/window）自动跳过。
   */
  resumeOnForeground?: boolean;
  /** 是否输出日志（主开关）。含 stompjs 的帧级 debug 流水。 */
  debug?: boolean;
  /** 日志输出方式；[debug] 为 true 且提供本回调时日志走它，否则回退 console。 */
  onLog?: (message: string, error?: unknown) => void;
  /** 连接成功（含每次重连成功）后触发，重放订阅之后调用。 */
  onConnected?: (frame: IFrame) => void;
  /** 断开连接（STOMP DISCONNECT）后触发。 */
  onDisconnected?: (frame: IFrame) => void;
  /** 连接状态每次变化都会触发（命令式桥接口）。也可用 [Stompsocket.onState] 多路订阅。 */
  onStateChanged?: StateListener;
  /** 服务端 STOMP ERROR 帧回调（鉴权失败、目的地非法等）。 */
  onStompError?: (frame: IFrame) => void;
  /** WebSocket 层错误回调。 */
  onWebSocketError?: (event: Event) => void;
  /** WebSocket 关闭回调。 */
  onWebSocketClose?: (event: CloseEvent) => void;
  /** 帧级流水回调，原样透传 stompjs 的 debug（与 [debug]/[onLog] 独立）。 */
  onDebugMessage?: (message: string) => void;
  /** 未匹配任何订阅的 MESSAGE 帧。 */
  onUnhandledMessage?: (message: IMessage) => void;
  /** 未匹配的 RECEIPT 帧。 */
  onUnhandledReceipt?: (frame: IFrame) => void;
  /** 未识别的帧。 */
  onUnhandledFrame?: (frame: IFrame) => void;
}

/** 单次订阅回调注册。 */
interface CallbackReg {
  cb: JsonCallback;
}

/** 一条待发送的出站消息。 */
interface Outbound {
  destination: string;
  body?: string | Uint8Array | object;
  headers?: Record<string, string>;
}

/** 单个订阅：内部维护一个回调队列，同一订阅收到消息只解析一次再分发给所有回调。 */
interface Subscription {
  readonly id: string;
  readonly destination: string;
  readonly ack: AckMode;
  readonly onParseError: ParseFailureAck;
  readonly callbacks: CallbackReg[];
  /** stompjs 返回的订阅句柄（连接建立后才有值）。 */
  wire?: StompSubscription;
}

const AUTO_ID_PREFIX = "auto#sub-";

/**
 * 对 `@stomp/stompjs` 的框架无关二次封装。
 *
 * 增强能力：函数队列共享解析、三种取消（句柄/id/topic + clear）、断线后自动重订阅、
 * send + 离线缓冲、auto ack/nack + 解析失败策略、二进制解码注入、beforeConnect token 刷新、
 * 连接状态观测、回前台/网络恢复强制重连、原生参数透传、copyWith。
 *
 * 关键点：stompjs 只重连**传输**、不恢复订阅，本类在 onConnect 里重放本地订阅。
 * 状态观测用框架无关的监听器（[state]/[onState]/onStateChanged），Vue 可几行桥接成 ref。
 */
export class Stompsocket {
  private readonly client: Client;
  private readonly opts: Required<Pick<StompsocketOptions, "queueWhileDisconnected" | "maxQueuedMessages" | "debug" | "reconnectDelay" | "resumeOnForeground">> & StompsocketOptions;

  private readonly subscriptions = new Map<string, Subscription>();
  private autoId = 0;
  private readonly outbox: Outbound[] = [];
  private wantConnection = false;
  private connectHeaders: Record<string, string>;

  private stateValue: ConnectionState = ConnectionState.idle;
  /** 会话代次：每次连接成功自增；manual 模式的 AckControl 据此在重连后失效。 */
  private generation = 0;
  private readonly stateListeners = new Set<StateListener>();

  constructor(options: StompsocketOptions) {
    this.opts = {
      queueWhileDisconnected: true,
      maxQueuedMessages: 100,
      debug: false,
      reconnectDelay: 5000,
      resumeOnForeground: true,
      ...options,
    };
    this.connectHeaders = { ...options.connectHeaders };

    this.client = new Client({
      brokerURL: options.brokerURL,
      connectHeaders: this.connectHeaders,
      heartbeatIncoming: options.heartbeatIncoming ?? 10000,
      heartbeatOutgoing: options.heartbeatOutgoing ?? 10000,
      connectionTimeout: options.connectionTimeout ?? 0,
      // 交给库做固定频率自动重连（>0 无限重试；=0 关闭）。我们只负责重连后重订阅。
      reconnectDelay: this.opts.reconnectDelay,
      beforeConnect: this.handleBeforeConnect,
      onConnect: this.handleConnect,
      onDisconnect: this.handleDisconnect,
      onStompError: this.handleStompError,
      onWebSocketError: this.handleWebSocketError,
      onWebSocketClose: this.handleWebSocketClose,
      onUnhandledMessage: options.onUnhandledMessage,
      onUnhandledReceipt: options.onUnhandledReceipt,
      onUnhandledFrame: options.onUnhandledFrame,
      debug: this.handleDebug,
    });
  }

  // ---------------------------------------------------------------------------
  // 状态观测（框架无关）
  // ---------------------------------------------------------------------------

  /** 当前连接状态（同步读取）。 */
  get state(): ConnectionState {
    return this.stateValue;
  }

  get connected(): boolean {
    return this.client.connected;
  }

  /**
   * 订阅连接状态变化，返回取消函数。可多路订阅。
   * Vue 桥接示例：`const s = ref(client.state); client.onState((v) => (s.value = v))`。
   */
  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(s: ConnectionState): void {
    if (this.stateValue === s) return;
    this.stateValue = s;
    this.opts.onStateChanged?.(s);
    for (const l of this.stateListeners) l(s);
  }

  // ---------------------------------------------------------------------------
  // 生命周期
  // ---------------------------------------------------------------------------

  /** 启动（或在 [dispose] 之后重新启动）连接。 */
  activate(): void {
    this.wantConnection = true;
    this.addLifecycleListeners();
    this.setState(ConnectionState.connecting);
    this.client.activate();
  }

  /**
   * 立即重连（跳过 reconnectDelay 等待），仅在"期望连接但当前未连接"时生效。
   * 供回前台/网络恢复自动调用，也可由业务在 connectivity 变化时手动调用。
   */
  forceReconnect(): void {
    if (!this.wantConnection || this.client.connected) return;
    void this.doForceReconnect();
  }

  private async doForceReconnect(): Promise<void> {
    try {
      await this.client.deactivate({ force: true });
      if (this.wantConnection) this.client.activate();
    } catch {
      // deactivate 理论上不会抛，兜底忽略
    }
  }

  private readonly onVisibility = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") this.forceReconnect();
  };

  private readonly onOnline = (): void => {
    this.forceReconnect();
  };

  private addLifecycleListeners(): void {
    if (!this.opts.resumeOnForeground) return;
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
  }

  private removeLifecycleListeners(): void {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
  }

  /**
   * 断开连接（可逆的停止）：dispose 之后仍可再次 [activate] 复用本实例。
   * - keepSubscriptions=false（默认）：清空订阅并释放回调引用；再次 activate 后需重新订阅。
   * - keepSubscriptions=true：保留订阅登记，再次 activate 连上后自动重放（pause/resume）。
   */
  async dispose(keepSubscriptions = false): Promise<void> {
    this.wantConnection = false;
    this.removeLifecycleListeners();
    if (!keepSubscriptions) this.clear();
    await this.client.deactivate();
    this.setState(ConnectionState.disconnected);
  }

  /**
   * 复制一份新实例：[overrides] 中提供的参数覆盖，未提供的继承当前配置。
   * 返回的是全新的、未连接的实例（不克隆订阅与连接状态），需自行 [activate]。
   */
  copyWith(overrides: Partial<StompsocketOptions> = {}): Stompsocket {
    return new Stompsocket({ ...this.opts, ...overrides });
  }

  // ---------------------------------------------------------------------------
  // 发送
  // ---------------------------------------------------------------------------

  /**
   * 发送一条消息到 [destination]。body 支持 string（原样）、object（自动 JSON 编码，
   * content-type=application/json）、Uint8Array（二进制）、undefined（无 body）。
   * 未连接时按 queueWhileDisconnected 缓冲、连上后按序补发。
   */
  send(destination: string, options: { body?: string | Uint8Array | object; headers?: Record<string, string> } = {}): void {
    const out: Outbound = { destination, body: options.body, headers: options.headers };
    if (this.client.connected) {
      this.sendNow(out);
      return;
    }
    if (!this.opts.queueWhileDisconnected) {
      this.log(`未连接，丢弃发往 ${destination} 的消息`);
      return;
    }
    if (this.outbox.length >= this.opts.maxQueuedMessages) {
      this.outbox.shift();
      this.log(`出站缓冲已满(${this.opts.maxQueuedMessages})，丢弃最旧消息`);
    }
    this.outbox.push(out);
  }

  private sendNow(out: Outbound): void {
    const { destination, body, headers } = out;
    if (body instanceof Uint8Array) {
      this.client.publish({ destination, headers, binaryBody: body });
    } else if (typeof body === "string") {
      this.client.publish({ destination, headers, body });
    } else if (body === undefined || body === null) {
      this.client.publish({ destination, headers });
    } else {
      this.client.publish({
        destination,
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    }
  }

  private flushOutbox(): void {
    if (this.outbox.length === 0) return;
    const pending = this.outbox.splice(0, this.outbox.length);
    for (const o of pending) this.sendNow(o);
  }

  // ---------------------------------------------------------------------------
  // 订阅
  // ---------------------------------------------------------------------------

  /**
   * 订阅一个 topic。
   * - 传入相同 id 时，回调追加到同一订阅的队列，多个回调共用一份解析数据，不重复 SUBSCRIBE。
   * - 不传 id 时自动生成唯一 id，作为独立订阅。
   * - ack 非 auto 时，处理成功自动 ACK、任一回调抛异常 NACK；逐条确认建议 clientIndividual。
   * - onParseError 控制解析失败时 NACK（默认，重投）还是 ACK（丢弃）。
   * - ack/onParseError 只在该 id 首次订阅时生效；未连接时先登记、连上后自动重放。
   */
  subscribe(destination: string, callback: JsonCallback, options: { id?: string; ack?: AckMode; onParseError?: ParseFailureAck } = {}): StompSub {
    const id = options.id ?? `${AUTO_ID_PREFIX}${this.autoId++}`;

    let sub = this.subscriptions.get(id);
    if (!sub) {
      sub = {
        id,
        destination,
        ack: options.ack ?? AckMode.auto,
        onParseError: options.onParseError ?? ParseFailureAck.nack,
        callbacks: [],
      };
      this.subscriptions.set(id, sub);
      if (this.client.connected) this.openOnWire(sub);
    }

    const reg: CallbackReg = { cb: callback };
    sub.callbacks.push(reg);

    const owner = sub;
    return { id, unsubscribe: () => this.cancelReg(owner, reg) };
  }

  /** 取消单次回调注册（引用计数）：队列空了才撤销整条订阅。 */
  private cancelReg(sub: Subscription, reg: CallbackReg): void {
    if (this.subscriptions.get(sub.id) !== sub) return;
    const i = sub.callbacks.indexOf(reg);
    if (i >= 0) sub.callbacks.splice(i, 1);
    if (sub.callbacks.length === 0) this.remove(sub);
  }

  /**
   * 取消订阅。传 id 取消单个；传 destination 批量取消该 topic；两者都传优先 id；
   * 都不传无操作。返回被取消的订阅数量。
   */
  unsubscribe(options: { id?: string; destination?: string }): number {
    if (options.id !== undefined) {
      return this.remove(this.subscriptions.get(options.id)) ? 1 : 0;
    }
    if (options.destination !== undefined) {
      const matched = Array.from(this.subscriptions.values()).filter((s) => s.destination === options.destination);
      let count = 0;
      for (const s of matched) if (this.remove(s)) count++;
      return count;
    }
    return 0;
  }

  /** 取消所有订阅。 */
  clear(): void {
    // 快照后再删，避免遍历时改动底层 Map
    for (const s of Array.from(this.subscriptions.values())) this.remove(s);
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  private openOnWire(sub: Subscription): void {
    // 显式用我们的 id 作为 STOMP 订阅 id（否则 stompjs 会自动生成 sub-N，破坏按 id 取消/去重）
    const headers: Record<string, string> = { id: sub.id };
    if (sub.ack !== AckMode.auto) headers.ack = "client-individual"; // smart/manual 都用逐条确认
    sub.wire = this.client.subscribe(sub.destination, this.onIncoming(sub), headers);
  }

  private remove(sub: Subscription | undefined): boolean {
    if (!sub) return false;
    this.subscriptions.delete(sub.id);
    sub.callbacks.length = 0;
    sub.wire?.unsubscribe();
    sub.wire = undefined;
    return true;
  }

  private readonly handleConnect = (frame: IFrame): void => {
    this.generation++; // 新会话：旧的 manual AckControl 句柄据此失效
    // 重连是全新会话，服务端订阅已失效；首连时本地订阅也还没上线 → 统一重放。
    for (const sub of this.subscriptions.values()) this.openOnWire(sub);
    this.flushOutbox();
    this.setState(ConnectionState.connected);
    this.opts.onConnected?.(frame);
  };

  private readonly handleDisconnect = (frame: IFrame): void => {
    this.log("已断开连接");
    this.opts.onDisconnected?.(frame);
  };

  private readonly handleStompError = (frame: IFrame): void => {
    this.log(`STOMP 错误: ${frame.body}`, frame.headers.message);
    this.opts.onStompError?.(frame);
  };

  private readonly handleWebSocketError = (event: Event): void => {
    this.log("WebSocket 错误", event);
    this.opts.onWebSocketError?.(event);
  };

  private readonly handleWebSocketClose = (event: CloseEvent): void => {
    this.opts.onWebSocketClose?.(event);
    // 断开：库会按 reconnectDelay 自动重连（>0 时）。dispose 已置 wantConnection=false，
    // 由 dispose 负责置 disconnected，这里不覆盖。
    if (!this.wantConnection) return;
    this.setState(this.opts.reconnectDelay > 0 ? ConnectionState.reconnecting : ConnectionState.disconnected);
  };

  /** 每次连接前执行用户 beforeConnect（可刷新 token）并更新 CONNECT 头；吞异常避免打断连接。 */
  private readonly handleBeforeConnect = async (): Promise<void> => {
    const before = this.opts.beforeConnect;
    if (!before) return;
    try {
      const headers = await before();
      if (headers) {
        this.connectHeaders = { ...headers };
        this.client.connectHeaders = this.connectHeaders;
      }
    } catch (e) {
      this.log("beforeConnect 失败", e);
    }
  };

  private onIncoming(sub: Subscription): (message: IMessage) => void {
    return (message: IMessage): void => {
      // 该订阅可能已被取消，或被同 id 重新订阅（换了新对象）
      if (this.subscriptions.get(sub.id) !== sub) return;

      let json: JsonMessage | undefined;
      let parseError: string | undefined;
      try {
        json = this.parse(message);
      } catch (e) {
        parseError = `解析失败: ${String(e)}`;
        this.log(parseError);
      }

      switch (sub.ack) {
        case AckMode.auto:
          // 服务端自动确认：不发 ACK/NACK，仅分发成功解析的消息
          if (json !== undefined) this.runCallbacks(sub, json, NOOP_ACK);
          break;
        case AckMode.smart: {
          let handled: boolean;
          if (parseError === undefined) {
            handled = json === undefined ? true : this.runCallbacks(sub, json, NOOP_ACK);
          } else {
            handled = sub.onParseError === ParseFailureAck.ack;
          }
          if (handled) message.ack();
          else message.nack();
          break;
        }
        case AckMode.manual:
          if (parseError === undefined) {
            if (json === undefined) message.ack();
            else this.runCallbacks(sub, json, this.makeAck(message)); // 交给回调手动 ack/nack
          } else if (sub.onParseError === ParseFailureAck.ack) {
            message.ack();
          } else {
            message.nack();
          }
          break;
      }
    };
  }

  /** 分发给所有回调，返回是否全部成功（任一抛异常即 false）。复制队列避免并发修改。 */
  private runCallbacks(sub: Subscription, json: JsonMessage, ack: AckControl): boolean {
    let ok = true;
    for (const reg of sub.callbacks.slice()) {
      try {
        reg.cb(json, ack);
      } catch (e) {
        ok = false;
        this.log(`订阅回调异常 (id=${sub.id})`, e);
      }
    }
    return ok;
  }

  /** manual 模式下构造绑定单条消息的确认句柄：重连后（会话代次变化）自动失效，幂等。 */
  private makeAck(message: IMessage): AckControl {
    const gen = this.generation;
    let used = false;
    const guard = (): boolean => !used && gen === this.generation && this.client.connected;
    return {
      ack: () => {
        if (!guard()) return;
        used = true;
        message.ack();
      },
      nack: () => {
        if (!guard()) return;
        used = true;
        message.nack();
      },
    };
  }

  /**
   * 解析消息体：`content-type: application/octet-stream` 走 binaryDecoder，其余按文本 JSON。
   * 解析失败抛异常，空体返回 undefined。
   *
   * 注意：不能用 `message.isBinaryBody` 判断——stompjs 的解析器对**收到的**帧统一产出字节流，
   * 该标志几乎总为 true（`message.body` 会按 UTF-8 惰性解码字节）。因此以 content-type 为准。
   */
  private parse(message: IMessage): JsonMessage | undefined {
    if (message.headers["content-type"] === "application/octet-stream") {
      const decoder = this.opts.binaryDecoder;
      if (!decoder) throw new Error("收到二进制消息但未配置 binaryDecoder");
      return decoder(message.binaryBody);
    }
    const body = message.body; // stompjs 会把字节按 UTF-8 解码成字符串
    if (!body) return undefined;
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`json 顶层不是对象: ${typeof parsed}`);
    }
    return parsed as JsonMessage;
  }

  /** 帧级流水日志，原样透传给 onDebugMessage，并在 debug 开启时经 log 输出。 */
  private readonly handleDebug = (message: string): void => {
    this.opts.onDebugMessage?.(message);
    if (this.opts.debug) this.log(message);
  };

  private log(message: string, error?: unknown): void {
    if (!this.opts.debug) return;
    const sink = this.opts.onLog;
    if (sink) {
      sink(message, error);
      return;
    }
    if (error === undefined) console.warn(`[stomp] ${message}`);
    else console.warn(`[stomp] ${message}`, error);
  }
}
