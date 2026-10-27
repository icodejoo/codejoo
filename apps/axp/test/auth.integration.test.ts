import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { Axp } from '../src';
import auth from '../src/plugins/auth';
import type { ITokenManager } from '../src/objects/TokenManager';
import { makeNetwork } from './helpers/network';
import { use } from './helpers/install';
import cancel, { cancelAll } from '../src/plugins/cancel';
import retry from '../src/plugins/retry';
import notify from '../src/plugins/notify';
import mock from '../src/plugins/mock';
import share from '../src/plugins/share';
import cache from '../src/plugins/cache';

import { sleep } from './helpers/sleep';
const lat = (ms: number) => ({ latency: ms } as any);

describe('review — auth 重放的逻辑请求边界', () => {
  const path = '/review-auth';
  const initialToken = 'old';
  const refreshedToken = 'fresh';

  it.each([true, false])('刷新期间 cancelAll 后不再重放，刷新结果 %s 均以 CanceledError 结束', async (refreshed) => {
    const net = makeNetwork().on('GET', path, () => ({ status: 401 }));
    const ax = axios.create({ adapter: net.adapter });
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const tm = makeTM(initialToken);
    Axp.install(ax, {
      auth: auth({ tokenManager: tm, onAccessExpired: vi.fn(), onRefresh: async () => {
        entered();
        await new Promise<void>((resolve) => { finish = resolve; });
        tm.set(refreshedToken);
        return refreshed;
      } }),
      cancel: cancel(),
    });
    const result = ax.get(path).catch((error) => error);
    await started;
    expect(cancelAll(ax)).toBe(1);
    finish();
    expect(await result).toMatchObject({ name: 'CanceledError', code: 'ERR_CANCELED' });
    expect(net.totalStarted).toBe(1);
    expect(cancelAll(ax)).toBe(0);
  });

  it.each([200, 500])('重放返回 %i 时只通知一次、预算只用一次，controller 全部释放', async (status) => {
    const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit === 1 ? 401 : status }));
    const ax = axios.create({ adapter: net.adapter });
    const tm = makeTM(initialToken);
    const showNotice = vi.fn();
    Axp.install(ax, {
      auth: auth({ tokenManager: tm, onRefresh: () => { tm.set(refreshedToken); return true; }, onAccessExpired: vi.fn() }),
      retry: retry({ max: 1, delay: 0 }), cancel: cancel(),
      notify: notify({ notify: showNotice, stringify: () => 'done' }),
    });
    await ax.get(path).catch(() => undefined);
    expect(net.totalStarted).toBe(status === 200 ? 2 : 3);
    expect(showNotice).toHaveBeenCalledTimes(1);
    expect(cancelAll(ax)).toBe(0);
  });

  it('auth 重放保留 mock:false 与 share:false', async () => {
    const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit <= 2 ? 401 : 200 }));
    const ax = axios.create({ adapter: net.adapter });
    const tm = makeTM(initialToken);
    Axp.install(ax, {
      auth: auth({ tokenManager: tm, onRefresh: async () => { await sleep(5); tm.set(refreshedToken); return true; }, onAccessExpired: vi.fn() }),
      mock: mock({ enable: true, mock: true, mockUrl: 'http://mock' }), share: share(),
    });
    await Promise.all(Array.from({ length: 2 }, () => ax.get(path, { key: 'review', mock: false, share: false })));
    expect(net.log.map((record) => record.url)).toEqual([path, path, path, path]);
  });

  it('canRefresh=false 时不刷新；失败后保持禁止，登录方显式重置后才恢复', async () => {
    const net = makeNetwork().on('GET', path, () => ({ status: 401 }));
    const tm = makeTM(initialToken);
    tm.canRefresh = false;
    const onRefresh = vi.fn(() => false);
    const onAccessExpired = vi.fn();
    const ax = axios.create({ adapter: net.adapter });
    Axp.install(ax, { auth: auth({ tokenManager: tm, onRefresh, onAccessExpired }) });
    await expect(ax.get(path)).rejects.toMatchObject({ status: 401 });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onAccessExpired).toHaveBeenCalledOnce();
    tm.set('login');
    expect(tm.canRefresh).toBe(false);
    tm.canRefresh = true;
    await expect(ax.get(path)).rejects.toMatchObject({ status: 401 });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(tm.canRefresh).toBe(false);
  });
});

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
    const api = Axp.create(axios.create({ adapter: net.adapter }));

    const onRefresh = vi.fn(async (TM: ITokenManager) => {
      const r: any = await api.post('/refresh')(undefined, { protected: false, ...lat(15) });
      TM.set(r.token);   // 采用服务端有效 token
      return true;
    });
    const onAccessExpired = vi.fn();
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired }));

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
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(async () => { await sleep(15); return false; });  // 刷新失败
    const onAccessExpired = vi.fn();
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired }));

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => api.get('/me')(undefined, lat(8))),
    );
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onAccessExpired).toHaveBeenCalledTimes(1);   // 一轮失败只通知一次，不随并发数放大
    expect(tm.accessToken).toBeUndefined();   // tm.clear() 执行过
  });

  it('无法刷新（canRefresh=false）时并发 N 个请求 → onAccessExpired 只触发 1 次，全部仍 reject', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    tm.canRefresh = false;
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(() => true);
    const onAccessExpired = vi.fn();
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired }));

    const results = await Promise.allSettled(Array.from({ length: 8 }, () => api.get('/me')(undefined, lat(5))));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onAccessExpired).toHaveBeenCalledTimes(1);
    // 回调只一次，但每个因过期失败的请求自身都带 authExpired 标记
    for (const r of results) expect((r as PromiseRejectedResult).reason?.config?.authExpired).toBe(true);
  });

  it('[auth.req.authExpired] 成功（刷新后重放）的请求不带 authExpired 标记', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const inst = axios.create({ adapter: net.adapter });
    let seen: unknown = 'unset';
    const api = Axp.create(inst);
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh: () => { tm.set('srv-1'); return true; }, onAccessExpired: vi.fn() }));
    inst.interceptors.response.use((res) => { seen = res.config?.authExpired; return res; });
    await api.get('/me')(undefined, lat(5));
    expect(seen).toBeUndefined();
  });

  it('恢复（重新登录）后再次过期 → 会再次通知，每轮各一次', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(async () => false);
    const onAccessExpired = vi.fn();
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired }));

    await Promise.allSettled(Array.from({ length: 5 }, () => api.get('/me')(undefined, lat(5))));
    expect(onAccessExpired).toHaveBeenCalledTimes(1);

    tm.set('srv-1');                 // 重新登录：新一轮开始
    tm.canRefresh = true;
    const ok: any = await api.get('/me')(undefined, lat(5));
    expect(ok.user).toBe('u');
    expect(onAccessExpired).toHaveBeenCalledTimes(1);

    tm.set('stale');                 // 令牌再次失效
    await Promise.allSettled(Array.from({ length: 5 }, () => api.get('/me')(undefined, lat(5))));
    expect(onAccessExpired).toHaveBeenCalledTimes(2);   // 第二轮照常通知，且只通知一次
  });
});


describe('auth 集成 — 刷新重放 + cache', () => {
  it('401 → 刷新 → 重放成功的那次写入缓存，后续相同 key 请求命中缓存', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const ax = axios.create({ adapter: net.adapter });
    Axp.install(ax, {
      auth: auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh: () => { tm.set('srv-1'); return true; }, onAccessExpired: () => { } }),
      cache: cache(),
    });

    const r1 = await ax.get('/me', { cache: { key: 'auth-cache' } });
    expect(r1.status).toBe(200);
    expect(net.calls('GET', '/me')).toBe(2);   // 401 + 重放
    const r2 = await ax.get('/me', { cache: { key: 'auth-cache' } });
    expect(r2.status).toBe(200);
    expect(net.calls('GET', '/me')).toBe(2);   // 命中缓存，没有新请求
  });
});


describe('auth 集成 — 刷新窗口内新请求', () => {
  it('刷新进行中到达的新受保护请求 → 等待刷新完成后用新 token 成功（不再触发二次刷新）', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(async (TM: ITokenManager) => { await sleep(40); TM.set('srv-1'); return true; });
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { } }));

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
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(async (TM: ITokenManager) => { await sleep(10); TM.set('srv-1'); return true; });
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { } }));

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
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    let refreshCalls = 0;
    const onRefresh = vi.fn(async (TM: ITokenManager) => {
      refreshCalls++;
      await sleep(40);                                  // 刷新窗口
      const r: any = await api.post('/refresh')(undefined, { protected: false, ...lat(5) });
      TM.set(r.token);
      return true;
    });
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { } }));

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
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    let refreshCalls = 0, expired = 0;
    const onRefresh = vi.fn(async () => { refreshCalls++; await sleep(30); return false; });
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { expired++; } }));

    const protectedReqs = Array.from({ length: 6 }, (_, i) =>
      api.get('/me')(undefined, lat(i * 10)).then(() => 'ok', () => 'rej'));
    const lateProtected = sleep(15).then(() => api.get('/me')(undefined, lat(2)).then(() => 'ok', () => 'rej'));
    const pub = api.get('/public')(undefined, { protected: false, ...lat(8) }).then((r: any) => r.pub);

    const [prot, late, pubOk] = await Promise.all([Promise.all(protectedReqs), lateProtected, pub]);

    expect(refreshCalls).toBe(1);                       // 仅一次刷新尝试
    expect((prot as string[]).every((r) => r === 'rej')).toBe(true);  // 受保护全部失败
    expect(late).toBe('rej');                           // 窗口内挂起的也失败（不重放）
    expect(expired).toBe(1);                            // 同一轮失败只通知一次
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
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    let refreshCalls = 0, expired = 0;
    const onRefresh = vi.fn(async (TM: ITokenManager) => {
      refreshCalls++;
      const r: any = await api.post('/refresh')(undefined, { protected: false, ...lat(5) });
      TM.set(r.token);                                    // 刷新「成功」但换来的 token 仍被拒
      return true;
    });
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { expired++; } }));

    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => api.get('/me')(undefined, lat(10))));

    expect(settled.every((s) => s.status === 'rejected')).toBe(true);  // 全部失败
    expect(refreshCalls).toBe(1);            // 单飞 + 有界：carried===cur 也只刷新一次，绝不无限刷新
    expect(expired).toBe(1);                 // 10 个请求「重放仍失败」都判过期，但同一轮只通知一次
    expect(net.calls('GET', '/me')).toBe(20); // 每请求恰好 2 次（首发 + 一次重放），无更多
  });
});


describe('auth 集成 — 重放后仍失败防回环', () => {
  it('刷新成功但服务端仍拒绝 → 重发一次后判过期，不无限重发', async () => {
    // 服务端 token 与客户端刷新后采用的不一致：刷新"成功"但重发仍 401
    const net = makeNetwork();
    net.on('GET', '/me', (c) => authHeader(c) === 'Bearer real' ? { data: { code: 0, data: 'ok' } } : { status: 401 });
    const tm = makeTM('stale');
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(async (TM: ITokenManager) => { TM.set('still-wrong'); return true; });  // 刷成错的
    const onAccessExpired = vi.fn();
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired }));

    await expect(api.get('/me')(undefined, lat(5))).rejects.toBeTruthy();
    expect(onRefresh).toHaveBeenCalledTimes(1);     // 只刷新一次
    expect(net.calls('GET', '/me')).toBe(2);        // 首发 + 重发一次（无回环）
    expect(onAccessExpired).toHaveBeenCalledTimes(1);
  });
});


describe('auth 集成 — onRefresh 同步抛错不会永久锁死', () => {
  it('onRefresh 同步 throw → 本次过期；换上有效 token 后的下一次受保护请求正常发出', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn((): boolean => { throw new Error('refresh boom'); });  // 非 async，同步抛
    const onAccessExpired = vi.fn();
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired }));

    await expect(api.get('/me')(undefined, lat(5))).rejects.toBeTruthy();
    expect(onAccessExpired).toHaveBeenCalledTimes(1);
    expect(tm.accessToken).toBeUndefined();

    tm.set('srv-1');   // 用户重新登录
    const r: any = await api.get('/me')(undefined, lat(5));
    expect(r.user).toBe('u');
    expect(onRefresh).toHaveBeenCalledTimes(1);   // 没有被"已 resolve(false) 的旧 promise"拦下
  });
});


describe('auth 集成 — 刷新后重放遇到无关错误不登出', () => {
  it('刷新成功后重放得到 500 → tm 不清、onAccessExpired 不调，500 原样传播', async () => {
    const net = makeNetwork();
    net.on('GET', '/me', (c) => authHeader(c) === 'Bearer fresh' ? { status: 500, data: { code: 'BOOM' } } : { status: 401 });
    const tm = makeTM('stale');
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(async (TM: ITokenManager) => { TM.set('fresh'); return true; });
    const onAccessExpired = vi.fn();
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired }));

    await expect(api.get('/me')(undefined, lat(5))).rejects.toMatchObject({ response: { status: 500 } });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(net.calls('GET', '/me')).toBe(2);           // 首发 401 + 重放 500
    expect(onAccessExpired).not.toHaveBeenCalled();
    expect(tm.accessToken).toBe('Bearer fresh');       // token 没被清掉
  });

  it('刷新后重放仍 401 → 仍判过期（兜底不变）', async () => {
    const net = makeNetwork();
    net.on('GET', '/me', () => ({ status: 401 }));
    const tm = makeTM('stale');
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    const onRefresh = vi.fn(async (TM: ITokenManager) => { TM.set('fresh'); return true; });
    const onAccessExpired = vi.fn();
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired }));

    await expect(api.get('/me')(undefined, lat(5))).rejects.toBeTruthy();
    expect(onAccessExpired).toHaveBeenCalledTimes(1);
    expect(tm.accessToken).toBeUndefined();
  });
});


describe('auth 集成 — handle 重排不丢在途刷新', () => {
  it('刷新进行中 prepend 触发整体重装 → 窗口内新请求仍复用同一次刷新，onRefresh 只调一次', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const ax = axios.create({ adapter: net.adapter });
    const onRefresh = vi.fn(async (TM: ITokenManager) => { await sleep(60); TM.set('srv-1'); return true; });
    const handle = Axp.install(ax, { auth: auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { } }) });

    const p1 = ax.get('/me', lat(5));          // 401 → 触发刷新
    await sleep(30);                           // 刷新进行中
    handle.prepend({ name: 'noop', install: () => undefined });   // 整体拆卸 + 重装 auth
    const p2 = ax.get('/me', lat(5));          // 重装后到达的请求应加入同一刷新窗口
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('刷新进行中 dispose 后换另一个 tokenManager 重装 → 新请求不等旧刷新，旧刷新失败也不影响', async () => {
    const net = authBackend('srv-1');
    const ax = axios.create({ adapter: net.adapter });
    const oldTm = makeTM('stale');
    let resolveOld!: (v: boolean) => void;
    const oldRefresh = vi.fn(() => new Promise<boolean>((r) => { resolveOld = r; }));
    const h1 = Axp.install(ax, { auth: auth({ tokenManager: oldTm, urlPattern: ['/me'], onRefresh: oldRefresh, onAccessExpired: () => { } }) });

    const p1 = ax.get('/me', lat(5)).catch((e) => e);   // 401 → 旧会话刷新挂起
    await sleep(30);
    expect(oldRefresh).toHaveBeenCalledTimes(1);
    h1.dispose();

    const newTm = makeTM('srv-1');                       // 新会话持有有效 token
    const newRefresh = vi.fn(async () => true);
    Axp.install(ax, { auth: auth({ tokenManager: newTm, urlPattern: ['/me'], onRefresh: newRefresh, onAccessExpired: () => { } }) });

    const p2 = ax.get('/me', lat(5));
    await sleep(20);
    resolveOld(false);                                   // 旧刷新失败
    const r2 = await p2;
    await p1;

    expect(r2.status).toBe(200);
    expect(newRefresh).not.toHaveBeenCalled();
  });
});


describe('auth 集成 — urlPattern 按 pathname 匹配', () => {
  it("urlPattern:'/me' 命中绝对 URL 与带查询串的 URL，不命中其它路径", async () => {
    const net = makeNetwork();
    const seen: Record<string, string | undefined> = {};
    net.fallback((c) => { seen[c.url!] = authHeader(c); return { data: { code: 0, data: null } }; });
    const tm = makeTM('t1');
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    use(api, auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh: () => true, onAccessExpired: () => { } }));

    await api.get('/me')();
    await api.get('/me?x=1')();
    await api.get('https://x.com/me')();
    await api.get('https://x.com/me?x=1#h')();
    await api.get('/other')();
    expect(seen['/me']).toBe('Bearer t1');
    expect(seen['/me?x=1']).toBe('Bearer t1');
    expect(seen['https://x.com/me']).toBe('Bearer t1');
    expect(seen['https://x.com/me?x=1#h']).toBe('Bearer t1');
    expect(seen['/other']).toBeUndefined();
  });
});
