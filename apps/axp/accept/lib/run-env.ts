import { sleep } from "./http.ts";
import { classifyError } from "./classify.ts";
import type { ClientHandle } from "./client-factory.ts";
import { DNS_FAIL_HOST, EXPIRE_LOCAL_TTL_MS, EXPIRE_LOCAL_WAIT_MS } from "./constants.ts";
import type { Style } from "./constants.ts";
import type { EventLog, PendingTracker } from "./events.ts";
import type { RequestRecord } from "./assertions.ts";
import { reachedServer, serverKeyOf } from "./matchers.ts";
import type { Observation } from "./matchers.ts";
import { swapHost } from "./netem-client.ts";
import type { NetemClient } from "./netem-client.ts";
import type { ServerClient } from "./server-client.ts";
import type { StepEnv } from "./steps.ts";
import type { TokenStore } from "./tokens.ts";
import type { LoginSpec, NetworkValue, RequestSpec, RevokeSpec, SetTokenSpec } from "./types.ts";

/** 通过代理把客户端接到服务器的信息 */
export interface ProxyEndpoint {
  id: string;
  baseURL: string;
}

/** RunEnvironment 的构造参数 */
export interface RunEnvDeps {
  client: ClientHandle;
  server: ServerClient;
  netem: NetemClient;
  tokens: TokenStore;
  events: EventLog;
  tracker: PendingTracker;
  /** 测试服务器地址（dns 切换与 netem upstream 用） */
  serverUrl: string;
  /** 已经建好的代理；dns 网络启动时没有 */
  proxy?: ProxyEndpoint;
  /** 需要探测"是否到达服务器"的请求 id（声明了 from_cache 的） */
  reachIds: ReadonlySet<string>;
  /** 为 dns 起步的运行在切回其它网络时建代理 */
  openProxy: (network: string) => Promise<ProxyEndpoint>;
}

/** 默认的用户名（login 没写 user 时） */
const DEFAULT_USER = "user";

/**
 * step 的具体执行环境：把 StepEnv 的每个动作落到真实的 axp 客户端、旁路服务器客户端与 netem 上，
 * 同时记录每条请求的结果与落定顺序，供断言使用。
 */
export class RunEnvironment implements StepEnv {
  readonly records = new Map<string, RequestRecord>();
  /** 请求落定顺序 */
  readonly order: string[] = [];
  /** 运行被中止（超时）后，不再发起新动作 */
  stopped = false;
  #seq = 0;
  #d: RunEnvDeps;
  #proxy: ProxyEndpoint | undefined;

  constructor(deps: RunEnvDeps) {
    this.#d = deps;
    this.#proxy = deps.proxy;
  }

  /** 当前代理（可能在运行中创建），供清理使用 */
  get proxy(): ProxyEndpoint | undefined {
    return this.#proxy;
  }

  /** 等待指定毫秒（step 编排通过环境接口调用，便于单测替换） */
  sleep(ms: number): Promise<void> {
    return sleep(ms);
  }

  /** 安全地观测服务端：失败返回 undefined（观测本身出问题不应打断场景） */
  async #observe(): Promise<Observation | undefined> {
    try {
      return await this.#d.server.observe();
    } catch {
      return undefined;
    }
  }

  async request(spec: RequestSpec, idSuffix: string): Promise<void> {
    if (this.stopped) return;
    const { client, tracker, events, server } = this.#d;
    const id = `${spec.id}${idSuffix}`;
    const tkReq = `${id}~${++this.#seq}`;
    const style: Style = server.style;
    const probe = this.#d.reachIds.has(id);
    const before = probe ? await this.#observe() : undefined;
    const ctrl = spec.cancel_after_ms !== undefined ? new AbortController() : undefined;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), spec.cancel_after_ms) : undefined;
    const record: RequestRecord = { id, style, ok: false };
    tracker.start();
    try {
      record.data = await client.send(spec, { tkReq, signal: ctrl?.signal });
      record.ok = true;
    } catch (e) {
      record.kind = classifyError(e, { style, tags: events.tagsOf(tkReq) });
      record.message = (e as Error)?.message;
    } finally {
      if (timer) clearTimeout(timer);
    }
    // 业务风格下 auth 在"过期/越权"后会把失败响应原样 resolve，此时以 auth 标签为准判为失败
    const tags = events.tagsOf(tkReq);
    if (record.ok && tags.size > 0) {
      record.ok = false;
      record.data = undefined;
      record.kind = classifyError(undefined, { style, tags });
    }
    tracker.settle();
    this.order.push(id);
    this.records.set(id, record);
    if (probe && before) {
      const after = await this.#observe();
      if (after) record.reached = reachedServer(before, after, serverKeyOf(spec.method ?? "GET", spec.path, spec.query));
    }
  }

  async login(spec: LoginSpec): Promise<void> {
    const { server, tokens } = this.#d;
    const t = await server.login(spec);
    tokens.set(t.accessToken, t.refreshToken);
    tokens.user = spec.user ?? DEFAULT_USER;
    tokens.canRefresh = true;
  }

  setToken(spec: SetTokenSpec): void {
    this.#d.tokens.applySetToken(spec);
  }

  async logout(): Promise<void> {
    const { server, tokens } = this.#d;
    await server.logout(tokens.refreshToken);
    tokens.clear();
    tokens.user = undefined;
  }

  async revoke(spec: RevokeSpec): Promise<void> {
    const { server, tokens } = this.#d;
    await server.revoke(spec.user ?? tokens.user ?? DEFAULT_USER, spec.scope ?? "all");
  }

  async expireLocal(): Promise<void> {
    const { server, tokens } = this.#d;
    if (!tokens.user) throw new Error("expire_local 需要先 login");
    // 向服务器重新登录一个 ttl=1 的会话，只取它的 access，refresh 保持不变
    const t = await server.login({ user: tokens.user, access_ttl_ms: EXPIRE_LOCAL_TTL_MS });
    tokens.setAccessHeader(`Bearer ${t.accessToken}`);
    tokens.canRefresh = true;
    await this.sleep(EXPIRE_LOCAL_WAIT_MS);
  }

  cancelAll(): void {
    this.#d.client.cancelAll();
  }

  clearCache(): void {
    this.#d.client.clearCache();
  }

  async network(value: NetworkValue): Promise<void> {
    const { client, netem, serverUrl } = this.#d;
    if (value === "dns") {
      client.setBaseURL(swapHost(serverUrl, DNS_FAIL_HOST));
      return;
    }
    if (!this.#proxy) this.#proxy = await this.#d.openProxy("normal");
    client.setBaseURL(this.#proxy.baseURL);
    await netem.apply(this.#proxy.id, value);
  }

  style(style: Style): void {
    this.#d.server.setStyle(style);
  }

  async serverReset(): Promise<void> {
    await this.#d.server.reset();
  }
}
