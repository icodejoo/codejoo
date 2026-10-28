import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import auth, { AuthFailureAction as Action, $compileUrlPatterns, authFailureFactory } from '../src/plugins/auth';
import TokenManager from '../src/objects/TokenManager';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

/** 创建可手动完成的异步步骤，精确控制刷新窗口。 */
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

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

describe('auth — 业务失败的终态标记与原始错误', () => {
    it.each([Action.Expired, Action.Refresh, Action.Replay])('%s 终态的已 resolve 业务响应带 authExpired', async (action) => {
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
    it.each([Action.Deny, Action.Others])('%s 不标记会话过期且保留 token', async (action) => {
        const { ax, tm, onAccessExpired, onAccessDenied } = setup(action);
        const response = await ax.get('/private');
        expect(response.config.authExpired).toBeUndefined();
        expect(tm.accessToken).toBe('Bearer old');
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect(onAccessDenied).toHaveBeenCalledTimes(action === Action.Deny ? 1 : 0);
    });
    it('Expired 拒绝路径保留原 AxiosError 和响应，并同时标记两处配置', async () => {
        const { ax, onAccessExpired } = setup(Action.Expired, true);
        const error = await ax.get('/private').catch((error) => error);
        expect(error).toBeInstanceOf(AxiosError);
        expect(error.message).toBe('failure');
        expect(error.config.authExpired).toBe(true);
        expect(error.response.config.authExpired).toBe(true);
        expect(onAccessExpired).toHaveBeenCalledOnce();
    });
    it('onFailure 抛错按 Others 放行，ready 抛错不破坏成功请求', async () => {
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
    it('protected 判定抛错回退 methods/urlPattern，未匹配请求不要求 token', async () => {
        const predicate = vi.fn(() => { throw new Error('predicate'); });
        const ax = axios.create({ adapter: async (config) => ({ status: 200, statusText: '', headers: {}, config, data: 'ok' }) });
        auth({ tokenManager: new TokenManager(), onRefresh: vi.fn(), onAccessExpired: vi.fn(),
            isProtected: predicate, methods: ['post'],
        }).install(ax);
        expect((await ax.get('/')).data).toBe('ok');
        expect(predicate).toHaveBeenCalledOnce();
    });
    it('受保护决策在重放时复用，不重复调用动态 protected', async () => {
        const { ax } = setup(Action.Replay);
        const predicate = vi.fn(() => true);
        await ax.get('/', { protected: predicate });
        expect(predicate).toHaveBeenCalledOnce();
    });
    it.fails('刷新窗口内被刷新失败阻断的请求也应标记 authExpired', async () => {
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

describe('auth — URLPattern 原生与回退路径', () => {
    it('仅排除列表默认放行其他路径，空模式忽略', () => {
        vi.stubGlobal('URLPattern', undefined);
        const match = $compileUrlPatterns(['', '!/public/*']);
        expect(match('/public/a')).toBe(false);
        expect(match('/private/a')).toBe(true);
        expect($compileUrlPatterns([''])('/')).toBe(false);
    });
    it('原生 URLPattern.test 抛错时返回 false', () => {
        /** 模拟构造成功但匹配时抛错的浏览器实现。 */
        class BrokenPattern {
            /** 模拟原生匹配异常。 */
            test() { throw new Error('test'); }
        }
        vi.stubGlobal('URLPattern', BrokenPattern);
        expect($compileUrlPatterns('/a')('/a')).toBe(false);
    });
    it('原生 URLPattern 构造失败回退正则，转义标点并支持单段参数', () => {
        /** 模拟不支持该模式的原生构造器。 */
        class InvalidPattern {
            /** 模拟模式编译异常。 */
            constructor() { throw new Error('pattern'); }
        }
        vi.stubGlobal('URLPattern', InvalidPattern);
        const match = $compileUrlPatterns('/v1.0/:id');
        expect(match('/v1.0/123')).toBe(true);
        expect(match('/v1x0/123')).toBe(false);
        expect(match('/v1.0/a/b')).toBe(false);
    });
    it('自定义凭证头名可从普通小写头读取', () => {
        expect(authFailureFactory('X-Token')({ accessToken: 't' }, {
            status: 401, config: { headers: { 'x-token': 't' } },
        })).toBe(Action.Refresh);
    });
});

describe('TokenManager — 正常持久化路径', () => {
    it('恢复裸 token、写入和空值删除均同步存储，clear 不重置 canRefresh', async () => {
        const values = new Map([['axp:token:access', 'saved'], ['axp:token:refresh', 'refresh']]);
        const storage = {
            getItem: vi.fn((key: string) => values.get(key) ?? null),
            setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
            removeItem: vi.fn((key: string) => { values.delete(key); }),
        };
        vi.stubGlobal('localStorage', storage);
        vi.resetModules();
        const { default: Manager } = await import('../src/objects/TokenManager');
        const tm = new Manager();
        expect(tm.accessToken).toBe('Bearer saved');
        expect(tm.refreshToken).toBe('refresh');
        tm.set('next', 'next-refresh');
        expect(new Manager().accessToken).toBe('Bearer next');
        expect(values.get('axp:token:access')).toBe('next');
        tm.accessToken = '';
        tm.refreshToken = null;
        expect(values.size).toBe(0);
        tm.set('again', 'again-refresh');
        tm.canRefresh = false;
        tm.clear();
        expect(values.size).toBe(0);
        expect(tm.canRefresh).toBe(false);
        expect(tm.accessToken).toBeUndefined();
        expect(tm.refreshToken).toBeUndefined();
    });
});
