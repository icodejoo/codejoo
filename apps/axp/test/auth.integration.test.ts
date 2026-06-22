import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { create } from '../src';
import auth from '../src/plugins/auth';
import type { ITokenManager } from '../src/objects/TokenManager';
import { makeNetwork } from './helpers/network';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lat = (ms: number) => ({ latency: ms } as any);

/** 读 Authorization（AxiosHeaders 用 .get） */
function authHeader(c: InternalAxiosRequestConfig): string | undefined {
  const h = c.headers as { get?: (n: string) => unknown } | undefined;
  const v = h?.get ? h.get('Authorization') : (c.headers as any)?.Authorization;
  return typeof v === 'string' ? v : undefined;
}

/** 内存 TokenManager（accessToken getter 加 Bearer 前缀，与真实实现一致） */
function makeTM(token?: string): ITokenManager {
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
 */
function authBackend(serverToken = 'srv-1', latency = 10) {
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


describe('auth 集成 — 并发刷新单飞', () => {
  it('30 个并发受保护请求过期 → onRefresh 只触发一次，全部用新 token 重发成功', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');  // 客户端持过期 token
    const api = create(axios.create({ adapter: net.adapter }));

    const onRefresh = vi.fn(async (TM: ITokenManager) => {
      const r: any = await api.post('/refresh')(undefined, { protected: false, ...lat(15) });
      TM.set(r.token);   // 采用服务端有效 token
      return true;
    });
    const onAccessExpired = vi.fn();
    api.use(auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired }));

    const reqs = Array.from({ length: 30 }, () => api.get('/me')(undefined, lat(10)));
    const out = await Promise.all(reqs);

    expect(onRefresh).toHaveBeenCalledTimes(1);                 // 单飞：只刷新一次
    expect(net.calls('POST', '/refresh')).toBe(1);
    expect(net.calls('GET', '/me')).toBe(60);                   // 30 次 401 + 30 次重发
    expect(out.every((r: any) => r.user === 'u')).toBe(true);   // 全部成功
    expect(onAccessExpired).not.toHaveBeenCalled();
    expect(tm.accessToken).toBe('Bearer srv-1');                // 已采用新 token
  });
});


describe('auth 集成 — 刷新失败', () => {
  it('onRefresh 失败 → 全部 reject + onAccessExpired + tm 清空', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const api = create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(async () => { await sleep(15); return false; });  // 刷新失败
    const onAccessExpired = vi.fn();
    api.use(auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired }));

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => api.get('/me')(undefined, lat(8))),
    );
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onAccessExpired).toHaveBeenCalled();
    expect(tm.accessToken).toBeUndefined();   // tm.clear() 执行过
  });
});


describe('auth 集成 — 刷新窗口内新请求', () => {
  it('刷新进行中到达的新受保护请求 → 等待刷新完成后用新 token 成功（不再触发二次刷新）', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const api = create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(async (TM: ITokenManager) => { await sleep(40); TM.set('srv-1'); return true; });
    api.use(auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { } }));

    const p1 = api.get('/me')(undefined, lat(5));  // 首发 → 401 → 触发刷新
    await sleep(20);                                // 刷新进行中
    const p2 = api.get('/me')(undefined, lat(5));  // 刷新窗口内到达
    const [r1, r2] = await Promise.all([p1, p2]);

    expect((r1 as any).user).toBe('u');
    expect((r2 as any).user).toBe('u');
    expect(onRefresh).toHaveBeenCalledTimes(1);     // 窗口内请求复用同一次刷新
  });
});


describe('auth 集成 — 受保护/公开混合 + 乱序', () => {
  it('公开请求不受刷新影响，受保护请求并发乱序刷新后成功', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const api = create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(async (TM: ITokenManager) => { await sleep(10); TM.set('srv-1'); return true; });
    api.use(auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { } }));

    const protectedReqs = Array.from({ length: 8 }, (_, i) => api.get('/me')(undefined, lat((i * 3) % 7 + 2)));
    const publicReqs = Array.from({ length: 5 }, (_, i) =>
      api.get('/public')(undefined, { protected: false, ...lat((i * 5) % 11 + 1) }),
    );
    const [prot, pub] = await Promise.all([Promise.all(protectedReqs), Promise.all(publicReqs)]);

    expect(prot.every((r: any) => r.user === 'u')).toBe(true);
    expect(pub.every((r: any) => r.pub === true)).toBe(true);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(net.calls('GET', '/public')).toBe(5);  // 公开请求各发一次，未被重发
  });
});


describe('auth 集成 — 高并发 + 乱序 + 混合（a/b/c/d/e 时序）', () => {
  it('过期突发：401 乱序到达 + 窗口内新请求挂起 + 非鉴权放行 → 单飞刷新一次，受保护全部最终成功', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const api = create(axios.create({ adapter: net.adapter }));
    let refreshCalls = 0;
    const onRefresh = vi.fn(async (TM: ITokenManager) => {
      refreshCalls++;
      await sleep(40);                                  // 刷新窗口
      const r: any = await api.post('/refresh')(undefined, { protected: false, ...lat(5) });
      TM.set(r.token);
      return true;
    });
    api.use(auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { } }));

    // 8 个受保护请求，交错延迟 → 401 在刷新前/中/后乱序返回（前者 join 刷新、后者 token 不一致走 Replay）
    const protectedReqs = Array.from({ length: 8 }, (_, i) => api.get('/me')(undefined, lat(i * 12)));
    // 非鉴权请求穿插（不应被刷新影响）
    const publicReqs = Array.from({ length: 4 }, (_, i) => api.get('/public')(undefined, { protected: false, ...lat(i * 10 + 5) }));
    // 刷新窗口内（~20ms）再发起一个受保护请求 → 请求侧应被挂起，等刷新完成再带新 token 发出
    const lateProtected = sleep(20).then(() => api.get('/me')(undefined, lat(3)));

    const [prot, pub, late] = await Promise.all([
      Promise.all(protectedReqs), Promise.all(publicReqs), lateProtected,
    ]);

    expect(refreshCalls).toBe(1);                                 // 乱序 401 只触发一次刷新
    expect(net.calls('POST', '/refresh')).toBe(1);
    expect((prot as any[]).every((r) => r.user === 'u')).toBe(true);   // 受保护全部最终成功
    expect((late as any).user).toBe('u');                              // 窗口内挂起的也成功
    expect((pub as any[]).every((r) => r.pub === true)).toBe(true);    // 非鉴权全放行
    expect(net.calls('GET', '/public')).toBe(4);                       // 非鉴权未被重发
  });

  it('刷新失败：乱序 401 + 窗口内新请求 → 受保护全部 reject、无重放、过期回调；非鉴权仍放行', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const api = create(axios.create({ adapter: net.adapter }));
    let refreshCalls = 0, expired = 0;
    const onRefresh = vi.fn(async () => { refreshCalls++; await sleep(30); return false; });
    api.use(auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { expired++; } }));

    const protectedReqs = Array.from({ length: 6 }, (_, i) =>
      api.get('/me')(undefined, lat(i * 10)).then(() => 'ok', () => 'rej'));
    const lateProtected = sleep(15).then(() => api.get('/me')(undefined, lat(2)).then(() => 'ok', () => 'rej'));
    const pub = api.get('/public')(undefined, { protected: false, ...lat(8) }).then((r: any) => r.pub);

    const [prot, late, pubOk] = await Promise.all([Promise.all(protectedReqs), lateProtected, pub]);

    expect(refreshCalls).toBe(1);                       // 仅一次刷新尝试
    expect((prot as string[]).every((r) => r === 'rej')).toBe(true);  // 受保护全部失败
    expect(late).toBe('rej');                           // 窗口内挂起的也失败（不重放）
    expect(expired).toBeGreaterThan(0);
    expect(pubOk).toBe(true);                           // 非鉴权放行
    expect(tm.accessToken).toBeUndefined();             // 已清空
  });
});


describe('auth 集成 — 极端：带当前 token 的 401 有界收敛（不死循环、单飞）', () => {
  it('刷新后的 token 仍被服务端拒绝 → 每请求至多「一次刷新 + 一次重放」后判过期；并发只刷新一次', async () => {
    const net = makeNetwork();
    net.on('GET', '/me', () => ({ status: 401 }));        // 服务端始终拒绝（连刷新后的 token 也拒）
    net.on('POST', '/refresh', () => ({ data: { code: 0, data: { token: 'srv-token-2' } } }));
    const tm = makeTM('srv-token');                       // 客户端已持「当前」token（carried===cur 场景）
    const api = create(axios.create({ adapter: net.adapter }));
    let refreshCalls = 0, expired = 0;
    const onRefresh = vi.fn(async (TM: ITokenManager) => {
      refreshCalls++;
      const r: any = await api.post('/refresh')(undefined, { protected: false, ...lat(5) });
      TM.set(r.token);                                    // 刷新「成功」但换来的 token 仍被拒
      return true;
    });
    api.use(auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { expired++; } }));

    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => api.get('/me')(undefined, lat(10))));

    expect(settled.every((s) => s.status === 'rejected')).toBe(true);  // 全部失败
    expect(refreshCalls).toBe(1);            // 单飞 + 有界：carried===cur 也只刷新一次，绝不无限刷新
    expect(expired).toBe(10);                // 每个请求「重放仍失败」后判过期
    expect(net.calls('GET', '/me')).toBe(20); // 每请求恰好 2 次（首发 + 一次重放），无更多
  });
});


describe('auth 集成 — 重放后仍失败防回环', () => {
  it('刷新成功但服务端仍拒绝 → 重发一次后判过期，不无限重发', async () => {
    // 服务端 token 与客户端刷新后采用的不一致：刷新"成功"但重发仍 401
    const net = makeNetwork();
    net.on('GET', '/me', (c) => authHeader(c) === 'Bearer real' ? { data: { code: 0, data: 'ok' } } : { status: 401 });
    const tm = makeTM('stale');
    const api = create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(async (TM: ITokenManager) => { TM.set('still-wrong'); return true; });  // 刷成错的
    const onAccessExpired = vi.fn();
    api.use(auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired }));

    await expect(api.get('/me')(undefined, lat(5))).rejects.toBeTruthy();
    expect(onRefresh).toHaveBeenCalledTimes(1);     // 只刷新一次
    expect(net.calls('GET', '/me')).toBe(2);        // 首发 + 重发一次（无回环）
    expect(onAccessExpired).toHaveBeenCalledTimes(1);
  });
});
