import type { InternalAxiosRequestConfig } from 'axios';
import type { ITokenManager } from '../../src/objects/TokenManager';
import { makeNetwork } from './network';

/**
 * 读 Authorization 请求头（AxiosHeaders 用 .get）。
 * @param c 请求配置
 * @returns 头的字符串值；不存在或非字符串返回 undefined
 * @example authHeader(config) // 'Bearer t1'
 */
export function authHeader(c: InternalAxiosRequestConfig): string | undefined {
  const h = c.headers as { get?: (n: string) => unknown } | undefined;
  const v = h?.get ? h.get('Authorization') : (c.headers as any)?.Authorization;
  return typeof v === 'string' ? v : undefined;
}

/**
 * 内存 TokenManager 替身（accessToken getter 加 Bearer 前缀，与真实实现一致）。
 * @param token 初始 access token，缺省表示未登录
 * @returns 可观测的 ITokenManager
 * @example const tm = makeTM('t0'); tm.accessToken // 'Bearer t0'
 */
export function makeTM(token?: string): ITokenManager {
  let access = token, refresh: string | undefined;
  return {
    canRefresh: true,
    get accessToken() { return access ? `Bearer ${access}` : undefined; },
    get refreshToken() { return refresh; },
    set(a?: string, r?: string) { access = a; refresh = r; },
    clear() { access = undefined; refresh = undefined; },
  };
}

/**
 * 有状态鉴权后端：
 *   - GET /me：Authorization 必须等于 `Bearer ${serverToken}`，否则 401
 *   - POST /refresh：颁发当前有效 serverToken（模拟刷新换取有效令牌）
 *   - GET /public：永远 200（不受保护）
 * @param serverToken 服务端当前认可的 token
 * @param latency 默认延迟（毫秒）
 * @returns 装好路由的网络仿真
 * @example const net = authBackend('srv-1');
 */
export function authBackend(serverToken = 'srv-1', latency = 10) {
  const net = makeNetwork();
  net.on('GET', '/me', (c) => {
    const ok = authHeader(c) === `Bearer ${serverToken}`;
    return ok ? { data: { code: 0, data: { user: 'u' } } } : { status: 401, data: { code: 'EXPIRED' } };
  });
  net.on('POST', '/refresh', () => ({ data: { code: 0, data: { token: serverToken } } }));
  net.on('GET', '/public', () => ({ data: { code: 0, data: { pub: true } } }));
  (net as any).defaultLatency = latency;
  return net;
}

/**
 * 极简 TokenManager 替身：accessToken 原样返回（不加 Bearer 前缀），refreshToken 恒为 'refresh'。
 * @example const tm = new FakeTokenManager('t0'); tm.accessToken // 't0'
 */
export class FakeTokenManager {
  /** 是否允许刷新 */
  canRefresh = true;
  #access: string | undefined;
  /** @param access 初始 access token */
  constructor(access: string | undefined) { this.#access = access; }
  /** 当前 access token */
  get accessToken() { return this.#access; }
  /** 固定的 refresh token */
  get refreshToken() { return 'refresh'; }
  /** 写入新的 access token */
  set(access?: string) { this.#access = access; }
  /** 清空 access token */
  clear() { this.#access = undefined; }
}
