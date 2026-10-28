import { describe, it, expect, vi, afterEach } from 'vitest';
import auth, { AuthFailureAction as Action } from '../../../src/plugins/auth';
import type { ITokenManager } from '../../../src/objects/TokenManager';
import axios, { AxiosError } from 'axios';
import TokenManager from '../../../src/objects/TokenManager';
import { Axp } from '../../../src';
import { makeNetwork } from '../../helpers/network';
import { use } from '../../helpers/install';
import { FakeTokenManager } from '../../helpers/auth';
import { authBackend, authHeader } from '../../helpers/auth';

/** 极简 TokenManager 替身：accessToken getter 加 Bearer 前缀（与真实实现一致） */
function makeTM(token?: string): ITokenManager {
  let access = token;
  let refresh: string | undefined;
  return {
    canRefresh: true,
    get accessToken() { return access ? `Bearer ${access}` : undefined; },
    get refreshToken() { return refresh; },
    set(a?: string, r?: string) { access = a; refresh = r; },
    clear() { access = undefined; refresh = undefined; },
  };
}

/** 模拟插件注册；可选 adapter 由首发配置携带，使裸实例重放仍可观测。 */
function makeMockCtx(axiosRequest?: any) {
  const reqHandlers: Array<(c: any) => any> = [];
  const resHandlers: Array<{ f?: (r: any) => any; r?: (e: any) => any }> = [];
  const ax: any = {
    request: axiosRequest ?? vi.fn(),
    defaults: {},
    interceptors: {
      request: {
                use: (f: any) => {
                  reqHandlers.push((config) => {
                    if (axiosRequest) config.adapter = axiosRequest;
                    return f(config);
                  });
                  return reqHandlers.length - 1;
                },
        eject: () => { },
      },
      response: {
        use: (f: any, r: any) => { resHandlers.push({ f, r }); return resHandlers.length - 1; },
        eject: () => { },
      },
    },
  };
  return { ax, reqHandlers, resHandlers };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

/** 构造内存会话及可观测鉴权回调。 */
function setup(action: typeof Action[keyof typeof Action], reject = false) {
    const tm = new TokenManager();
    tm.set('old', 'refresh');
    const adapter = vi.fn(async (config) => {
        const response = { status: 200, statusText: 'OK', data: { code: 1 }, config, headers: {} };
        if (reject) throw new AxiosError('failure', 'ERR_BAD_RESPONSE', config, undefined, response);
        return response;
    });
    const ax = axios.create({ adapter });
    const onAccessExpired = vi.fn();
    const onAccessDenied = vi.fn();
    const onRefresh = vi.fn(() => false);
    auth({ tokenManager: tm, onFailure: () => action, onRefresh, onAccessExpired, onAccessDenied }).install(ax);
    return { ax, tm, adapter, onAccessExpired, onAccessDenied, onRefresh };
}

describe('auth 集成 — 请求侧', () => {
  it('[auth.cb.ready][auth.opt.tokenManager] 受保护 + 有 token → 默认 ready 注入 Authorization 头', async () => {
    const tm = makeTM('x');
    const { ax, reqHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { } }).install(ax);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](config);
    expect(config.headers.Authorization).toBe('Bearer x');
  });

  it('[auth.cb.onAccessDenied] 受保护 + 无 token → onAccessDenied 调用并抛错', async () => {
    const tm = makeTM();  // 无 token
    const onAccessDenied = vi.fn();
    const { ax, reqHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { }, onAccessDenied }).install(ax);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await expect(reqHandlers[0](config)).rejects.toThrow(/access denied/);
    expect(onAccessDenied).toHaveBeenCalledTimes(1);
  });

  it('[auth.req.protected] config.protected=false → 不受保护，直接放行（不注入）', async () => {
    const tm = makeTM('x');
    const { ax, reqHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { } }).install(ax);
    const config: any = { url: '/api', method: 'get', headers: {}, protected: false };
    await reqHandlers[0](config);
    expect(config.headers.Authorization).toBeUndefined();
  });
});

describe('auth 集成 — 响应侧路由', () => {
  it('[auth.fn.axpAuth] 业务成功 → 原样透传', async () => {
    const tm = makeTM('x');
    const { ax, reqHandlers, resHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { } }).install(ax);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](config);
    const response = { status: 200, data: { code: 0 }, config };
    expect(await resHandlers[0].f!(response)).toBe(response);
  });

  it('[auth.cb.onRefresh][auth.const.AuthFailureAction.Refresh] 401 + token 一致 → Refresh：onRefresh 调一次 + 用同 config 重发', async () => {
    const tm = makeTM('x');
    const reissued = { status: 200, data: { code: 0 } };
    const axiosRequest = vi.fn().mockResolvedValue(reissued);
    const onRefresh = vi.fn(async () => { tm.set('y'); return true; });
    const { ax, reqHandlers, resHandlers } = makeMockCtx(axiosRequest);
    auth({ tokenManager: tm, onRefresh, onAccessExpired: () => { } }).install(ax);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](config);
    const error: any = { config, response: { status: 401, config: { headers: { Authorization: 'Bearer x' } } } };
    const out = await resHandlers[0].r!(error);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(axiosRequest).toHaveBeenCalledTimes(1);
    expect(out).toBe(reissued);
  });

  it('[auth.cb.onRefresh][auth.cb.onAccessExpired][auth.cb.tokenManager.clear] Refresh 失败 → expired：tm.clear + onAccessExpired，原 error 透传', async () => {
    const tm = makeTM('x');
    const onAccessExpired = vi.fn();
    const onRefresh = vi.fn(async () => false);  // 刷新失败
    const { ax, reqHandlers, resHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh, onAccessExpired }).install(ax);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](config);
    const error: any = { config, response: { status: 401, config: { headers: { Authorization: 'Bearer x' } } } };
    await expect(resHandlers[0].r!(error)).rejects.toBe(error);
    expect(onAccessExpired).toHaveBeenCalledTimes(1);
    expect(tm.accessToken).toBeUndefined();
  });
});

describe('auth — enable / 元信息', () => {
  it('[auth.opt.enable] enable:false → 不安装拦截器', () => {
    const { ax, reqHandlers, resHandlers } = makeMockCtx();
    auth({ tokenManager: makeTM(), onRefresh: () => true, onAccessExpired: () => { }, enable: false }).install(ax);
    expect(reqHandlers).toHaveLength(0);
    expect(resHandlers).toHaveLength(0);
  });
  it("[auth.const.name][auth.prop.name] 工厂 .name === 'axp:auth'", () => {
    expect(auth.name).toBe('axp:auth');
  });
});

describe('auth — 业务失败的终态标记与原始错误', () => {
    it.each([Action.Expired, Action.Refresh, Action.Replay])('[auth.cb.onAccessExpired][auth.cb.onFailure] %s 终态的已 resolve 业务响应带 authExpired', async (action) => {
        const { ax, tm, adapter, onAccessExpired } = setup(action);
        const response = await ax.get('/private');
        expect(response.config.authExpired).toBe(true);
        expect(tm.accessToken).toBeUndefined();
        expect(tm.canRefresh).toBe(false);
        expect(onAccessExpired).toHaveBeenCalledOnce();
        expect(adapter).toHaveBeenCalledTimes(action === Action.Replay ? 2 : 1);
        expect(response.config).not.toHaveProperty('axp:auth:protected');
        expect(response.config).not.toHaveProperty('axp:auth:refreshed');
    });
    it.each([Action.Deny, Action.Others])('[auth.cb.onFailure][auth.cb.tokenManager.clear] %s 不标记会话过期且保留 token', async (action) => {
        const { ax, tm, onAccessExpired, onAccessDenied } = setup(action);
        const response = await ax.get('/private');
        expect(response.config.authExpired).toBeUndefined();
        expect(tm.accessToken).toBe('Bearer old');
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect(onAccessDenied).toHaveBeenCalledTimes(action === Action.Deny ? 1 : 0);
    });
    it('[auth.cb.onAccessExpired] Expired 拒绝路径保留原 AxiosError 和响应，并同时标记两处配置', async () => {
        const { ax, onAccessExpired } = setup(Action.Expired, true);
        const error = await ax.get('/private').catch((error) => error);
        expect(error).toBeInstanceOf(AxiosError);
        expect(error.message).toBe('failure');
        expect(error.config.authExpired).toBe(true);
        expect(error.response.config.authExpired).toBe(true);
        expect(onAccessExpired).toHaveBeenCalledOnce();
    });
    it('[auth.req.protected.callback] 受保护决策在重放时复用，不重复调用动态 protected', async () => {
        const { ax } = setup(Action.Replay);
        const predicate = vi.fn(() => true);
        await ax.get('/', { protected: predicate });
        expect(predicate).toHaveBeenCalledOnce();
    });
});

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('auth: additional realistic branches', () => {
  it('[auth.cb.onAccessDenied][auth.cb.onAccessExpired] a custom onAccessDenied callback is used (instead of falling back to onAccessExpired) when a protected request has no token', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: null } }));
    const tm = new FakeTokenManager(undefined);
    let denied = 0;
    let expired = 0;
    use(api, [auth({
      tokenManager: tm as any,
      onRefresh: async () => {},
      onAccessExpired: async () => { expired++; },
      onAccessDenied: async () => { denied++; },
    })]);

    await expect(api.axios.get('/data')).rejects.toBeTruthy();
    expect(denied).toBe(1);
    expect(expired).toBe(0);
  });

  it('[auth.cb.onFailure][auth.cb.onAccessDenied] a custom onFailure callback can force the deny or expired action directly, regardless of the default classification', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ status: 401, data: { code: 1, data: null } }));
    const tm1 = new FakeTokenManager('t0');
    let denied = 0;
    use(api, [auth({
      tokenManager: tm1 as any,
      onRefresh: async () => {},
      onAccessExpired: async () => {},
      onAccessDenied: async () => { denied++; },
      onFailure: () => Action.Deny,
    })]);
    await expect(api.axios.get('/data')).rejects.toBeTruthy();
    expect(denied).toBe(1);
  });

  it('[auth.cb.isProtected] isProtected decides per-request whether auth applies at all', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: null } }));
    const tm = new FakeTokenManager(undefined);
    use(api, [auth({
      tokenManager: tm as any,
      onRefresh: async () => {},
      onAccessExpired: async () => {},
      isProtected: (config) => config.url?.startsWith('/protected') ?? false,
    })]);

    const r = await api.axios.get('/public');
    expect(r.status).toBe(200);
    await expect(api.axios.get('/protected/x')).rejects.toBeTruthy();
  });
});

/** 给请求加延迟（毫秒），配合 makeNetwork 制造乱序 */
const lat = (ms: number) => ({ latency: ms } as any);

describe('review — auth 重放的逻辑请求边界', () => {
  const path = '/review-auth';
  const initialToken = 'old';

  it('[auth.opt.tokenManager.canRefresh][auth.cb.onRefresh] canRefresh=false 时不刷新；失败后保持禁止，登录方显式重置后才恢复', async () => {
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

describe('auth 集成 — 刷新失败', () => {
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
});

describe('auth 集成 — urlPattern 按 pathname 匹配', () => {
  it("[auth.opt.urlPattern] urlPattern:'/me' 命中绝对 URL 与带查询串的 URL，不命中其它路径", async () => {
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
