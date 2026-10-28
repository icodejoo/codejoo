import { describe, it, expect, vi, afterEach } from 'vitest';
import auth, { AuthFailureAction as Action } from '../../src/plugins/auth';
import type { ITokenManager } from '../../src/objects/TokenManager';
import axios, { AxiosError } from 'axios';
import TokenManager from '../../src/objects/TokenManager';

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
