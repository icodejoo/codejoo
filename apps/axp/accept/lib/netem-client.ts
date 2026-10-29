import { FLAP_SCHEDULE } from "./constants.ts";
import { rawJson } from "./http.ts";
import type { NetworkName } from "./constants.ts";
import type { NetworkValue } from "./types.ts";

/** netem 创建代理后的返回 */
export interface ProxyInfo {
  id: string;
  port: number;
}

/** netem 控制 API 的错误 */
export class NetemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetemError";
  }
}

/** netem 代理统计 */
export interface ProxyStats {
  connections: number;
  active: number;
  bytes_up: number;
  bytes_down: number;
  resets: number;
  refused: number;
}

/**
 * netem 控制 API 客户端（CONTRACT §6）。
 * netem 不用信封，成功直接返回 JSON，参数错误返回 HTTP 400 + `{error}`。
 */
export class NetemClient {
  readonly controlUrl: string;

  /** @param controlUrl 控制地址，如 `http://127.0.0.1:47090` */
  constructor(controlUrl: string) {
    this.controlUrl = controlUrl.replace(/\/+$/, "");
  }

  /** 发控制请求并解析 JSON，非 2xx 抛 NetemError */
  async #call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { ok, status, text } = await rawJson(`${this.controlUrl}${path}`, method, body, {}, (m) => new NetemError(`netem ${method} ${path} ${m}`));
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* 非 JSON 响应交给下面的状态判断 */
    }
    if (!ok) throw new NetemError(`netem ${method} ${path} → HTTP ${status}: ${text.slice(0, 120)}`);
    return json as T;
  }

  /**
   * 创建一个代理。flap 不是直接可用的 profile：先以 normal 创建，再由调用方下发时间表。
   * @param upstream 上游 `host:port`
   * @param profile 预设名或 profile 对象
   */
  createProxy(upstream: string, profile: string | Record<string, unknown>): Promise<ProxyInfo> {
    return this.#call<ProxyInfo>("POST", "/proxies", { upstream, profile });
  }

  /**
   * 立即切换 profile（对已建立与新建的连接都生效）。
   * @param id 代理 id
   * @param profile 预设名或 profile 对象
   */
  async setProfile(id: string, profile: string | Record<string, unknown>): Promise<void> {
    await this.#call("PUT", `/proxies/${encodeURIComponent(id)}`, { profile });
  }

  /**
   * 下发时间表（相对调用时刻切换 profile）。
   * @param id 代理 id
   * @param steps `[{at_ms, profile}]`
   */
  async schedule(id: string, steps: ReadonlyArray<{ at_ms: number; profile: string | Record<string, unknown> }>): Promise<void> {
    await this.#call("POST", `/proxies/${encodeURIComponent(id)}/schedule`, steps);
  }

  /** 读取代理统计 */
  stats(id: string): Promise<ProxyStats> {
    return this.#call<ProxyStats>("GET", `/proxies/${encodeURIComponent(id)}/stats`);
  }

  /** 关闭代理及其上的全部连接 */
  async deleteProxy(id: string): Promise<void> {
    await this.#call("DELETE", `/proxies/${encodeURIComponent(id)}`);
  }

  /**
   * 把代理切到某个网络：预设名走 PUT（flap 走时间表），对象 profile 直接 PUT。
   * `dns` 不经过 netem，调用方应改 baseURL，这里抛错避免误用。
   * @param id 代理 id
   * @param network 预设名或 profile 对象
   */
  async apply(id: string, network: NetworkValue): Promise<void> {
    if (network === "dns") throw new NetemError("dns 不经过 netem，应改写 baseURL 的 host");
    if (network === "flap") {
      await this.setProfile(id, "normal");
      await this.schedule(id, FLAP_SCHEDULE);
      return;
    }
    await this.setProfile(id, network);
  }
}

/**
 * Fetch 规范的受限端口（WHATWG Fetch "bad port"，undici 同款）：fetch 访问这些端口会直接抛
 * `TypeError: bad port`，请求根本不会发出，axios 的 fetch adapter 把它吞成 Network Error。
 * netem 的代理端口由系统随机分配，约千分之一的格子会撞上，所以分到这些端口要换一个。
 */
const FETCH_BLOCKED_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526,
  530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);
/** 为避开受限端口，创建代理最多尝试的次数 */
export const OPEN_PROXY_MAX_TRIES = 20;

/**
 * 判断端口是否在 Fetch 规范的受限名单里。
 * @param port 端口号
 * @returns 受限返回 true
 * @example isFetchBlockedPort(6666) // true
 */
export function isFetchBlockedPort(port: number): boolean {
  return FETCH_BLOCKED_PORTS.has(port);
}

/** 代理出口：客户端实际使用的 baseURL 与代理 id */
export interface ProxyEndpointInfo {
  id: string;
  baseURL: string;
}

/**
 * 把 URL 的 host 换成指定主机，保留端口与协议。
 * @param url 原始地址
 * @param host 新主机名
 * @example swapHost('http://127.0.0.1:47080', 'nonexistent.invalid') // 'http://nonexistent.invalid:47080'
 */
export function swapHost(url: string, host: string): string {
  const u = new URL(url);
  u.hostname = host;
  return u.toString().replace(/\/$/, "");
}

/**
 * 取 URL 的 host:port，作为 netem 的 upstream。
 * @param url 服务器地址
 */
export function upstreamOf(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
}

/**
 * 通过 netem 创建专属代理，并返回客户端应使用的 baseURL。
 * flap 先以 normal 创建再下发时间表；dns 不经过 netem，不要调用本函数。
 * 分到 fetch 受限端口会删掉重建，保证 http 与 fetch 两种 adapter 用的是同一套可用端口。
 * @param netem netem 客户端
 * @param serverUrl 测试服务器地址
 * @param network 初始网络预设（不含 dns）
 */
export async function openProxy(netem: NetemClient, serverUrl: string, network: NetworkName): Promise<ProxyEndpointInfo> {
  let proxy = await netem.createProxy(upstreamOf(serverUrl), network === "flap" ? "normal" : network);
  // 分到 fetch 的受限端口（约千分之一）就删掉换一个，否则 fetch adapter 的格子会在 0ms 内失败且服务端收不到请求
  for (let tries = 1; isFetchBlockedPort(proxy.port); tries++) {
    if (tries >= OPEN_PROXY_MAX_TRIES) throw new NetemError(`netem 连续 ${OPEN_PROXY_MAX_TRIES} 次分到 fetch 受限端口，放弃（最后一次 ${proxy.port}）`);
    await netem.deleteProxy(proxy.id);
    proxy = await netem.createProxy(upstreamOf(serverUrl), network === "flap" ? "normal" : network);
  }
  if (network === "flap") await netem.schedule(proxy.id, FLAP_SCHEDULE);
  const u = new URL(serverUrl);
  return { id: proxy.id, baseURL: `${u.protocol}//${new URL(netem.controlUrl).hostname}:${proxy.port}` };
}
