import { HEADER_RUN, HEADER_STYLE } from './constants.ts';
import { rawJson } from './http.ts';
import type { Style } from './constants.ts';
import type { Observation } from './matchers.ts';
import type { LoginSpec } from './types.ts';

/** 信封响应 */
export interface Envelope<T = unknown> { code: number | string; message?: string; data: T }

/** 登录得到的令牌 */
export interface LoginTokens {
  accessToken: string;
  /** no_refresh_ 用户登录没有 refresh */
  refreshToken: string | undefined;
}

/** 旁路调用失败（服务器返回了失败信封，或网络层出错） */
export class BypassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BypassError';
  }
}

/**
 * 直连测试服务器的客户端，**不经过 netem，也不经过被测客户端的插件链**（CONTRACT 附录 B.2）。
 * 负责 login/logout/revoke/server_reset 这些"准备环境"的步骤，以及 `/t/runs/{run}` 观测。
 * 每个实例对应一个 runId（每次运行唯一），自动带上 X-Test-Run 与 X-Test-Style。
 */
export class ServerClient {
  readonly baseUrl: string;
  readonly runId: string;
  #style: Style;

  /**
   * @param baseUrl 测试服务器地址，如 `http://127.0.0.1:47080`
   * @param runId 本次运行的唯一轮次 id
   * @param style 初始响应风格
   */
  constructor(baseUrl: string, runId: string, style: Style) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.runId = runId;
    this.#style = style;
  }

  /** 当前响应风格 */
  get style(): Style { return this.#style; }

  /**
   * 切换响应风格（style step），从下一个请求开始生效。
   * @param style 新风格
   */
  setStyle(style: Style): void { this.#style = style; }

  /** 本次运行要带的公共请求头 */
  headers(): Record<string, string> {
    return { [HEADER_RUN]: this.runId, [HEADER_STYLE]: this.#style };
  }

  /**
   * 发一个直连请求并解析信封。
   * @param method HTTP 方法
   * @param path 路径（含查询串）
   * @param body JSON 请求体，可省略
   * @returns 信封；非 JSON 响应抛 BypassError
   */
  async call<T = unknown>(method: string, path: string, body?: unknown): Promise<Envelope<T>> {
    const { status, text } = await rawJson(
      `${this.baseUrl}${path}`, method, body, this.headers(), (m) => new BypassError(`${method} ${path} ${m}`),
    );
    try {
      return JSON.parse(text) as Envelope<T>;
    } catch {
      throw new BypassError(`${method} ${path} 响应不是 JSON（HTTP ${status}）: ${text.slice(0, 80)}`);
    }
  }

  /** 调用并要求 code=0，否则抛 BypassError */
  async callOk<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const env = await this.call<T>(method, path, body);
    if (env.code !== 0) throw new BypassError(`${method} ${path} 失败: code=${String(env.code)} ${env.message ?? ''}`);
    return env.data;
  }

  /**
   * login step：POST /t/auth/login。
   * @param spec login 参数；缺省 user 为 `user`
   * @returns 新令牌
   */
  async login(spec: LoginSpec): Promise<LoginTokens> {
    const body: Record<string, unknown> = { username: spec.user ?? 'user' };
    if (spec.password !== undefined) body.password = spec.password;
    if (spec.access_ttl_ms !== undefined) body.access_ttl_ms = spec.access_ttl_ms;
    if (spec.refresh_ttl_ms !== undefined) body.refresh_ttl_ms = spec.refresh_ttl_ms;
    if (spec.strict_rotation !== undefined) body.strict_rotation = spec.strict_rotation;
    const data = await this.callOk<{ access_token: string; refresh_token?: string }>('POST', '/t/auth/login', body);
    return { accessToken: data.access_token, refreshToken: data.refresh_token };
  }

  /**
   * logout step：POST /t/auth/logout，吊销给定 refresh 与对应 access。
   * @param refreshToken 要吊销的 refresh；没有就传空串
   */
  async logout(refreshToken: string | undefined): Promise<void> {
    await this.callOk('POST', '/t/auth/logout', { refresh_token: refreshToken ?? '' });
  }

  /**
   * revoke step：POST /t/auth/revoke，服务端强制下线。
   * @param user 用户名
   * @param scope all（默认）或 access
   */
  async revoke(user: string, scope: 'all' | 'access' = 'all'): Promise<void> {
    await this.callOk('POST', '/t/auth/revoke', { username: user, scope });
  }

  /** server_reset step：DELETE /t/runs/{run}，清空本轮状态 */
  async reset(): Promise<void> {
    await this.callOk('DELETE', `/t/runs/${encodeURIComponent(this.runId)}`);
  }

  /**
   * 观测本轮：GET /t/runs/{run}。探针与观测本身不计入业务统计（CONTRACT §4.4 澄清）。
   * @returns 规整后的观测；缺失字段补零
   */
  async observe(): Promise<Observation> {
    const d = await this.callOk<Partial<Observation>>('GET', `/t/runs/${encodeURIComponent(this.runId)}`);
    return {
      total: d.total ?? 0,
      inflight: d.inflight ?? 0,
      peak_inflight: d.peak_inflight ?? 0,
      by_key: d.by_key ?? {},
      by_path: d.by_path ?? {},
      log: d.log ?? [],
    };
  }
}

/**
 * 生成运行轮次 id：会话前缀 + 序号 + 场景 id 的安全化版本，保证 URL 安全且唯一。
 * @param session 本次执行器进程的会话标识
 * @param seq 本次运行的序号
 * @param scenarioId 场景 id，仅用于排查时一眼看出来源
 * @example makeRunId('a1b2', 7, 'auth.deny-403') // 'a1b2-7-auth.deny-403'
 */
export function makeRunId(session: string, seq: number, scenarioId: string): string {
  return `${session}-${seq}-${scenarioId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}
