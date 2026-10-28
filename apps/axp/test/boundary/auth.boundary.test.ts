import { describe, it, expect, vi, afterEach } from 'vitest';
import auth from '../../src/plugins/auth';
import type { ITokenManager } from '../../src/objects/TokenManager';
import axios, { AxiosError } from 'axios';
import TokenManager from '../../src/objects/TokenManager';
import { Axp } from '../../src';
import { makeNetwork } from '../helpers/network';
import { use } from '../helpers/install';
import { FakeTokenManager } from '../helpers/auth';

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

/** 创建可手动完成的异步步骤，精确控制刷新窗口。 */
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

describe('auth 集成 — 响应侧路由', () => {
  it('[auth.cb.onAccessExpired][auth.const.AuthFailureAction.Replay] 已重放过一次仍失败 → 兜底 expired（防回环）', async () => {
    const tm = makeTM('x');
    const onAccessExpired = vi.fn();
    const onRefresh = vi.fn(async () => true);
    const { ax, reqHandlers, resHandlers } = makeMockCtx(vi.fn().mockResolvedValue({ status: 200, data: { code: 0 } }));
    auth({ tokenManager: tm, onRefresh, onAccessExpired }).install(ax);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](config);
    config['axp:auth:refreshed'] = true;  // 模拟已重放
    const error: any = { config, response: { status: 401, config: { headers: { Authorization: 'Bearer x' } } } };
    await expect(resHandlers[0].r!(error)).rejects.toBe(error);
    expect(onAccessExpired).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('[auth.cb.onRefresh] 并发刷新单飞：两个失败请求只触发一次 onRefresh', async () => {
    const tm = makeTM('x');
    // 预先建 deferred，resolveRefresh 同步可用；refreshPromise 保持 pending 直到两者都入队
    let resolveRefresh!: (v: boolean) => void;
    const refreshPromise = new Promise<boolean>((res) => { resolveRefresh = res; });
    const onRefresh = vi.fn(() => refreshPromise);
    const axiosRequest = vi.fn().mockResolvedValue({ status: 200, data: { code: 0 } });
    const { ax, reqHandlers, resHandlers } = makeMockCtx(axiosRequest);
    auth({ tokenManager: tm, onRefresh, onAccessExpired: () => { } }).install(ax);

    const err = (config: any) => ({ config, response: { status: 401, config: { headers: { Authorization: 'Bearer x' } } } });
    const c1: any = { url: '/api', method: 'get', headers: {} };
    const c2: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](c1);
    await reqHandlers[0](c2);
    const p1 = resHandlers[0].r!(err(c1));
    const p2 = resHandlers[0].r!(err(c2));
    await new Promise((r) => setTimeout(r, 0));  // 刷净微任务：两者都已进入共享的 startRefresh
    resolveRefresh(true);
    await Promise.all([p1, p2]);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('auth — cleanup 保留在途刷新状态', () => {
  it('[auth.method.cleanup][auth.cb.onRefresh] 有在途刷新时 cleanup 不删状态：重装后的新闭包复用同一次刷新', async () => {
    const tm = makeTM('x');
    let resolveRefresh!: (v: boolean) => void;
    const onRefresh = vi.fn(() => new Promise<boolean>((res) => { resolveRefresh = res; }));
    const { ax, reqHandlers, resHandlers } = makeMockCtx(vi.fn().mockResolvedValue({ status: 200, data: { code: 0 } }));
    const cleanup = auth({ tokenManager: tm, onRefresh, onAccessExpired: () => { } }).install(ax) as () => void;

    const c1: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](c1);
    const err = { config: c1, response: { status: 401, config: { headers: { Authorization: 'Bearer x' } } } };
    const p1 = resHandlers[0].r!(err);               // 触发刷新，保持 pending
    await new Promise((r) => setTimeout(r, 0));

    cleanup();                                        // 模拟 handle 重排：先拆
    auth({ tokenManager: tm, onRefresh, onAccessExpired: () => { } }).install(ax);   // 再装，应接上在途刷新
    const c2: any = { url: '/api', method: 'get', headers: {} };
    let waited = true;
    const p2 = reqHandlers[1](c2).then(() => { waited = false; });   // 新请求拦截器应等待同一刷新
    await new Promise((r) => setTimeout(r, 0));
    expect(waited).toBe(true);                        // 刷新未结束前，新请求仍被挂起
    resolveRefresh(true);
    await Promise.all([p1, p2]);
    expect(waited).toBe(false);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('auth — 业务失败的终态标记与原始错误', () => {
    it('[auth.cb.onFailure][auth.cb.ready] onFailure 抛错按 Others 放行，ready 抛错不破坏成功请求', async () => {
        const tm = new TokenManager();
        tm.set('token');
        const onAccessExpired = vi.fn();
        const ax = axios.create({ adapter: async (config) => ({ status: 200, statusText: '', headers: {}, config, data: { code: 1 } }) });
        auth({ tokenManager: tm, onRefresh: vi.fn(), onAccessExpired,
            ready: () => { throw new Error('ready'); },
            onFailure: () => { throw new Error('router'); },
        }).install(ax);
        expect((await ax.get('/')).data.code).toBe(1);
        expect(onAccessExpired).not.toHaveBeenCalled();
    });
    it('[auth.cb.isProtected][auth.req.protected.callback] protected 判定抛错回退 methods/urlPattern，未匹配请求不要求 token', async () => {
        const predicate = vi.fn(() => { throw new Error('predicate'); });
        const ax = axios.create({ adapter: async (config) => ({ status: 200, statusText: '', headers: {}, config, data: 'ok' }) });
        auth({ tokenManager: new TokenManager(), onRefresh: vi.fn(), onAccessExpired: vi.fn(),
            isProtected: predicate, methods: ['post'],
        }).install(ax);
        expect((await ax.get('/')).data).toBe('ok');
        expect(predicate).toHaveBeenCalledOnce();
    });
    it.fails('[auth.cb.onRefresh][auth.cb.onAccessExpired] 刷新窗口内被刷新失败阻断的请求也应标记 authExpired', async () => {
        const tm = new TokenManager();
        tm.set('old');
        const started = deferred<void>();
        const refresh = deferred<boolean>();
        const ax = axios.create({ adapter: async (config) => {
            const response = { status: 401, statusText: '', data: {}, headers: {}, config };
            throw new AxiosError('expired', 'ERR_BAD_RESPONSE', config, undefined, response);
        } });
        const expired = vi.fn();
        auth({ tokenManager: tm, onAccessExpired: expired,
            onRefresh: () => { started.resolve(); return refresh.promise; },
        }).install(ax);
        const first = ax.get('/first').catch((e) => e);
        await started.promise;
        const waiting = ax.get('/waiting').catch((e) => e);
        // 等到等待请求的请求拦截器进入刷新窗口。
        await Promise.resolve(); await Promise.resolve();
        refresh.resolve(false);
        const [a, b] = await Promise.all([first, waiting]);
        expect(a.config.authExpired).toBe(true);
        expect(expired).toHaveBeenCalledOnce();
        expect(b.config.authExpired).toBe(true);
    });
});

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('auth: additional realistic branches', () => {
  it('[auth.cb.onRefresh] a second request arriving while a first request\'s refresh is already in flight awaits the SAME refresh, and is rejected the same way when it fails', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ status: 401, data: { code: 1, data: null } }));
    const tm = new FakeTokenManager('t0');
    let refreshCalls = 0;
    use(api, [auth({
      tokenManager: tm as any,
      onRefresh: async () => { refreshCalls++; await new Promise((r) => setTimeout(r, 20)); throw new Error('refresh failed'); },
      onAccessExpired: async () => {},
    })]);

    const [ra, rb] = await Promise.allSettled([
      api.axios.get('/data'),
      api.axios.get('/data'),
    ]);
    expect(ra.status).toBe('rejected');
    expect(rb.status).toBe('rejected');
    expect(refreshCalls).toBe(1); // single-flight refresh — second caller awaited the same one
  });

  it('[auth.fn.axpAuth] a network-level error with no HTTP response at all is passed through, not misclassified', async () => {
    const { net, api } = mkApi();
    net.fallback(() => { throw new Error('ECONNREFUSED'); });
    const tm = new FakeTokenManager('t0');
    use(api, [auth({ tokenManager: tm as any, onRefresh: async () => {}, onAccessExpired: async () => {} })]);
    await expect(api.axios.get('/data')).rejects.toBeTruthy();
  });

  it('[auth.cb.onRefresh][auth.cb.onAccessExpired][auth.const.AuthFailureAction.Replay] a replay that ALSO fails hits the "already replayed once" guard and gives up immediately rather than refreshing again', async () => {
    // axios's own `.request()` re-merges a fresh config from defaults each
    // top-level call (mergeConfig produces a NEW object) — the REFRESHED
    // bag flag never survives across two SEPARATE `.request()` calls by an
    // external caller. It only persists across the PLUGIN's own internal
    // replay (`ctx.axios.request(config)` reusing the same, already-merged
    // config reference mid-chain), so the guard is only observable within
    // ONE top-level call whose replay also fails.
    const { net, api } = mkApi();
    let attempts = 0;
    net.fallback(() => { attempts++; return { status: 401, data: { code: 1, data: null } }; });
    const tm = new FakeTokenManager('t0');
    let refreshCalls = 0;
    let expiredCalls = 0;
    use(api, [auth({
      tokenManager: tm as any,
      onRefresh: async () => { refreshCalls++; tm.set('t1'); },
      onAccessExpired: async () => { expiredCalls++; },
    })]);

    await expect(api.axios.get('/data')).rejects.toBeTruthy();
    expect(attempts).toBe(2); // original 401 + one replay, both fail
    expect(refreshCalls).toBe(1); // guard skipped a second refresh attempt
    expect(expiredCalls).toBe(1);
  });
});
