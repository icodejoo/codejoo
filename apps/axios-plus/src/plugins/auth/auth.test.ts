import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { create } from '../../core';
import ApiResponse from '../../objects/ApiResponse';
import type { HttpResponse } from '../../core/types';
import type { ITokenManager } from '../../objects/TokenManager';
import normalize from '../normalize';
import auth, {
    $compileMethods,
    $compileUrlPatterns,
    $normalize,
} from './auth';
import retry from '../retry';
import {
    AuthFailureAction,
    DEFAULT_ON_AUTH_FAILURE,
    authFailureFactory,
} from '../../helper';
import type { IAuthOptions } from './types';


// ───────────────────────────────────────────────────────────────────────────
//  fakes
// ───────────────────────────────────────────────────────────────────────────

/** TokenManager 桩 —— 实现 ITokenManager，避免 jsdom 之外构造真实 TokenManager 触发 localStorage */
function makeFakeTM(initial?: { access?: string; refresh?: string; canRefresh?: boolean }): ITokenManager {
    const state = {
        access: initial?.access,
        refresh: initial?.refresh,
        canRefresh: initial?.canRefresh ?? true,
    };
    return {
        get accessToken() { return state.access; },
        get refreshToken() { return state.refresh; },
        get canRefresh() { return state.canRefresh; },
        set canRefresh(v: boolean) { state.canRefresh = v; },
        set(access?: string, refresh?: string) { state.access = access; state.refresh = refresh; },
        clear() { state.access = undefined; state.refresh = undefined; },
        toHeaders() {
            return state.access ? { Authorization: state.access } : undefined;
        },
    };
}


function mkBaseOpts(over: Partial<IAuthOptions> = {}): IAuthOptions {
    return {
        tokenManager: makeFakeTM(),
        onRefresh: vi.fn(async () => true),
        onAccessExpired: vi.fn(),
        ...over,
    };
}


/** 构造一个最小的 HttpResponse，方便单测默认判定函数 */
function mkResp(status: number, headers: Record<string, unknown> = {}): HttpResponse {
    return {
        data: new ApiResponse(status, '', null, null, false),
        status, statusText: '',
        headers: {} as any,
        config: { headers: headers as any } as any,
    } as HttpResponse;
}


// ───────────────────────────────────────────────────────────────────────────
//  $compileMethods —— method 白名单编译
// ───────────────────────────────────────────────────────────────────────────

describe('auth — $compileMethods', () => {
    it('undefined / null / 空字符串 / 空数组 → 全 false', () => {
        expect($compileMethods(undefined)('get')).toBe(false);
        expect($compileMethods(null as any)('get')).toBe(false);
        expect($compileMethods('')('get')).toBe(false);
        expect($compileMethods([])('get')).toBe(false);
    });

    it("字符串 '*' → 全 true（fast-path）", () => {
        const p = $compileMethods('*');
        expect(p('get')).toBe(true);
        expect(p('any-string')).toBe(true);
    });

    it("数组含 '*' → 全 true（fast-path）", () => {
        const p = $compileMethods(['*', 'post']);
        expect(p('get')).toBe(true);
        expect(p('delete')).toBe(true);
    });

    it('单字符串：等价于单元素数组（lowered 比较）', () => {
        const p = $compileMethods('POST');
        expect(p('post')).toBe(true);
        expect(p('get')).toBe(false);
    });

    it('普通数组：精确匹配 lowered method', () => {
        const p = $compileMethods(['GET', 'Post']);
        expect(p('get')).toBe(true);
        expect(p('post')).toBe(true);
        expect(p('put')).toBe(false);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $compileUrlPatterns —— URLPattern + ! 否定 + fast-path
// ───────────────────────────────────────────────────────────────────────────

describe('auth — $compileUrlPatterns', () => {
    it('undefined / null / 空数组 → 全 false', () => {
        expect($compileUrlPatterns(undefined)('/x')).toBe(false);
        expect($compileUrlPatterns(null as any)('/x')).toBe(false);
        expect($compileUrlPatterns([])('/x')).toBe(false);
    });

    it("'*' / ['*'] → 全 true（fast-path）", () => {
        expect($compileUrlPatterns('*')('/anything')).toBe(true);
        expect($compileUrlPatterns(['*'])('/anything')).toBe(true);
    });

    it('字符串单值：等价于单元素数组', () => {
        const p = $compileUrlPatterns('/api/user');
        expect(p('/api/user')).toBe(true);
        expect(p('/api/userx')).toBe(false);
    });

    it('字面量精确匹配', () => {
        const p = $compileUrlPatterns(['/api/user']);
        expect(p('/api/user')).toBe(true);
        expect(p('/api/userx')).toBe(false);
    });

    it("`*` 通配符匹配任意（含 /）", () => {
        const p = $compileUrlPatterns(['/user/*']);
        expect(p('/user/profile')).toBe(true);
        expect(p('/user/a/b/c')).toBe(true);
        expect(p('/admin/x')).toBe(false);
    });

    it('`:name` 命名参数', () => {
        const p = $compileUrlPatterns(['/users/:id']);
        expect(p('/users/42')).toBe(true);
        expect(p('/users/')).toBe(false);
    });

    it('多 include 取并集', () => {
        const p = $compileUrlPatterns(['/user/*', '/admin/*']);
        expect(p('/user/me')).toBe(true);
        expect(p('/admin/x')).toBe(true);
        expect(p('/public/x')).toBe(false);
    });

    it('`!` 前缀作为否定排除（gitignore 风格）', () => {
        const p = $compileUrlPatterns(['/user/*', '!/user/login']);
        expect(p('/user/me')).toBe(true);
        expect(p('/user/login')).toBe(false);
    });

    it('全是否定项 → 视为全 include 后再排除', () => {
        const p = $compileUrlPatterns(['!/public/*']);
        expect(p('/anything')).toBe(true);
        expect(p('/public/health')).toBe(false);
    });

    it('多个否定项叠加排除', () => {
        const p = $compileUrlPatterns(['/user/*', '!/user/login', '!/user/register']);
        expect(p('/user/me')).toBe(true);
        expect(p('/user/login')).toBe(false);
        expect(p('/user/register')).toBe(false);
    });

    it('空字符串 / 非字符串项被忽略', () => {
        const p = $compileUrlPatterns(['', '/user/*', null as any]);
        expect(p('/user/me')).toBe(true);
        expect(p('/x')).toBe(false);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $normalize —— 参数校验 + 默认值 + onAccessExpired fallback
// ───────────────────────────────────────────────────────────────────────────

describe('auth — $normalize', () => {
    it('缺少 tokenManager → 抛错', () => {
        expect(() => $normalize({} as any)).toThrow(/tokenManager/);
    });

    it('缺少 onRefresh → 抛错', () => {
        expect(() => $normalize({ tokenManager: makeFakeTM() } as any)).toThrow(/onRefresh/);
    });

    it('缺少 onAccessExpired → 抛错', () => {
        expect(() => $normalize({
            tokenManager: makeFakeTM(),
            onRefresh: async () => true,
        } as any)).toThrow(/onAccessExpired/);
    });

    it('全部默认值', () => {
        const cfg = $normalize(mkBaseOpts());
        expect(cfg.enable).toBe(true);
        expect(typeof cfg.onFailure).toBe('function');
        expect(cfg.onFailure).toBe(DEFAULT_ON_AUTH_FAILURE);
        expect(cfg.ready).toBeUndefined();
        // 默认 methods/urlPattern 都是 '*' fast-path → 同一恒真单例
        expect(cfg.matchMethod).toBe(cfg.matchUrl); // 都是 TRUE 单例
        expect(cfg.matchUrl('/anything')).toBe(true);
        expect(cfg.matchMethod('get')).toBe(true);
    });

    it("methods + urlPattern 编译为 cfg.matchMethod / cfg.matchUrl", () => {
        const cfg = $normalize(mkBaseOpts({ methods: ['get'], urlPattern: ['/secure/*'] }));
        expect(cfg.matchMethod('get')).toBe(true);
        expect(cfg.matchMethod('post')).toBe(false);
        expect(cfg.matchUrl('/secure/x')).toBe(true);
        expect(cfg.matchUrl('/public')).toBe(false);
    });

    it("默认 onFailure 落到 helper 的 DEFAULT_ON_AUTH_FAILURE 单例", () => {
        const cfg = $normalize(mkBaseOpts());
        expect(cfg.onFailure).toBe(DEFAULT_ON_AUTH_FAILURE);
    });

    it("用户显式传 onFailure → 完全覆盖 default", () => {
        const myOnFailure = vi.fn(() => AuthFailureAction.Others);
        const cfg = $normalize(mkBaseOpts({ onFailure: myOnFailure }));
        expect(cfg.onFailure).toBe(myOnFailure);
    });

    it("用户传 authFailureFactory('X-Token') → 拿到换 header 名的 onFailure", () => {
        const onFailure = authFailureFactory('X-Token');
        const cfg = $normalize(mkBaseOpts({ onFailure }));
        expect(cfg.onFailure).toBe(onFailure);
        expect(cfg.onFailure).not.toBe(DEFAULT_ON_AUTH_FAILURE);
    });

    it('未传 onAccessDenied → 自动 alias 到 onAccessExpired', () => {
        const expired = vi.fn();
        const cfg = $normalize(mkBaseOpts({ onAccessExpired: expired }));
        expect(cfg.onAccessDenied).toBe(expired);
    });

    it('显式传 onAccessDenied → 不被覆盖', () => {
        const denied = vi.fn();
        const expired = vi.fn();
        const cfg = $normalize(mkBaseOpts({
            onAccessDenied: denied,
            onAccessExpired: expired,
        }));
        expect(cfg.onAccessExpired).toBe(expired);
        expect(cfg.onAccessDenied).toBe(denied);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  install lifecycle
// ───────────────────────────────────────────────────────────────────────────

describe('auth — install', () => {
    it('当 normalize 未先安装时抛错', () => {
        const ax = axios.create();
        const api = create(ax);
        expect(() => api.use(auth(mkBaseOpts()))).toThrow(/requires "normalize"/);
    });

    it('enable:false → 不注册任何拦截器', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({ enable: false }))]);
        const snap = api.plugins().find(p => p.name === 'auth');
        expect(snap?.requestInterceptors).toBe(0);
        expect(snap?.responseInterceptors).toBe(0);
    });

    it('启用时注册一个 request + 一个 response 拦截器', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts())]);
        const snap = api.plugins().find(p => p.name === 'auth');
        expect(snap?.requestInterceptors).toBe(1);
        expect(snap?.responseInterceptors).toBe(1);
    });

    it('eject 删除拦截器', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts())]);
        api.eject('auth');
        expect(api.plugins().find(p => p.name === 'auth')).toBeUndefined();
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  请求级 protected 覆盖语义（boolean / 函数 / 回退）
// ───────────────────────────────────────────────────────────────────────────

describe('auth — request-level `protected` 覆盖', () => {
    /** adapter 仅捕获是否进入受保护流程：通过观察 onAccessDenied 是否触发 */
    function makeAx(captured: { sent?: boolean }) {
        const ax = axios.create();
        ax.defaults.adapter = async (config) => {
            captured.sent = true;
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        };
        return ax;
    }

    it('请求级 boolean=true 覆盖插件级关闭 → 走受保护流程（无 token 时被 deny）', async () => {
        const tm = makeFakeTM();
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: [], onAccessDenied,
        }))]);
        await ax.get('/x', { protected: true });
        expect(onAccessDenied).toHaveBeenCalledTimes(1);
        expect(captured.sent).toBeUndefined();
    });

    it('请求级 boolean=false 覆盖插件级开启 → 跳过受保护流程', async () => {
        const tm = makeFakeTM();
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*', onAccessDenied,
        }))]);
        await ax.get('/x', { protected: false });
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(captured.sent).toBe(true);
    });

    it('请求级函数返回 boolean → 用其值', async () => {
        const tm = makeFakeTM();
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*', onAccessDenied,
        }))]);
        await ax.get('/x', { protected: () => false });
        expect(onAccessDenied).not.toHaveBeenCalled();
    });

    it('请求级函数返回 null/void → 回落到插件级判定', async () => {
        const tm = makeFakeTM();
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: ['/secure/*'], onAccessDenied,
        }))]);
        // /secure/x 命中插件级 → 受保护
        await ax.get('/secure/x', { protected: () => null });
        expect(onAccessDenied).toHaveBeenCalledTimes(1);
        // /public 不命中插件级 → 不保护
        onAccessDenied.mockClear();
        await ax.get('/public', { protected: () => undefined });
        expect(onAccessDenied).not.toHaveBeenCalled();
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  重发场景：isProtected 决策缓存（_auth_decision）跨重发存活
// ───────────────────────────────────────────────────────────────────────────

describe('auth — _auth_decision 缓存', () => {
    function makeAx(captured: { sent?: boolean }) {
        const ax = axios.create();
        ax.defaults.adapter = async (config) => {
            captured.sent = true;
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        };
        return ax;
    }

    it('首发 protected:false → bag 缓存 false → 重发（config.protected 已删）仍判为不保护', async () => {
        // 模拟"重发"：首发后清掉 .protected，再用同一 config 经过请求拦截器
        const tm = makeFakeTM({ access: 'Bearer T' });
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const ready = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm,
            urlPattern: '*',          // plugin 级"全保护"
            onAccessDenied, ready,
        }))]);

        // 首发 protected:false → 不走 ready
        await ax.get('/x', { protected: false });
        expect(ready).not.toHaveBeenCalled();
        expect(onAccessDenied).not.toHaveBeenCalled();
    });

    it('bag 上 _auth_decision=true → 即使 protected 字段缺失也认定为受保护', async () => {
        const tm = makeFakeTM(); // 无 token
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm,
            urlPattern: [],            // plugin 级关闭
            onAccessDenied,
        }))]);

        // 模拟"auth 重发"：config 上 _auth_decision=true（首发已决策）
        await ax.get('/x', { _auth_decision: true } as any);
        // 决策被复用 → 视为受保护 → 无 token → onAccessDenied
        expect(onAccessDenied).toHaveBeenCalledTimes(1);
        expect(captured.sent).toBeUndefined(); // 请求侧拦截，未真正发出
    });

    it('bag 上 _auth_decision=false → 即使 plugin 级 url 命中也跳过 auth', async () => {
        const tm = makeFakeTM(); // 无 token
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const ready = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm,
            urlPattern: '*',           // plugin 级"全保护"
            onAccessDenied, ready,
        }))]);

        // 模拟"retry 重发"：config.protected 已被首发删除，但 _auth_decision=false 持久化
        await ax.get('/x', { _auth_decision: false } as any);
        // 决策被复用 → 不保护 → 不触发 onAccessDenied
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(ready).not.toHaveBeenCalled();
        expect(captured.sent).toBe(true);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  请求侧：未登录拦截 + ready
// ───────────────────────────────────────────────────────────────────────────

describe('auth — request side', () => {
    /** adapter 捕获最终 config（headers / _protected 等） */
    function makeCapturingAx(captured: { sent?: boolean; headers?: any; protected?: boolean; hasFlag?: boolean }) {
        const ax = axios.create();
        ax.defaults.adapter = async (config) => {
            captured.sent = true;
            captured.headers = { ...(config.headers as any) };
            captured.protected = (config as any).protected;
            captured.hasFlag = '_protected' in (config as any);
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        };
        return ax;
    }

    it('插件不会自动附 Authorization 头（完全交给 ready）', async () => {
        const tm = makeFakeTM({ access: 'Bearer T1' });
        const captured: any = {};
        const ax = makeCapturingAx(captured);

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({ tokenManager: tm, urlPattern: '*' }))]);

        await ax.get('/secure');
        expect(captured.headers.Authorization).toBeUndefined();
    });

    it('ready 内可读 tokenManager 并写 config.headers', async () => {
        const tm = makeFakeTM({ access: 'Bearer T1' });
        const captured: any = {};
        const ax = makeCapturingAx(captured);

        const ready = vi.fn((tm: ITokenManager, config: any) => {
            if (tm.accessToken) config.headers.Authorization = tm.accessToken;
            config.headers['X-Trace-Id'] = 'tx-1';
        });

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*', ready,
        }))]);

        await ax.get('/secure');
        expect(ready).toHaveBeenCalledTimes(1);
        expect(captured.headers.Authorization).toBe('Bearer T1');
        expect(captured.headers['X-Trace-Id']).toBe('tx-1');
    });

    it('ready 仅对受保护请求触发', async () => {
        const tm = makeFakeTM({ access: 'Bearer T' });
        const captured: any = {};
        const ax = makeCapturingAx(captured);

        const ready = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: [], ready,
        }))]);

        await ax.get('/public');
        expect(ready).not.toHaveBeenCalled();
    });

    it('ready 抛错被吞 + 请求继续', async () => {
        const tm = makeFakeTM({ access: 'Bearer T' });
        const captured: any = {};
        const ax = makeCapturingAx(captured);

        const ready = vi.fn(() => { throw new Error('boom'); });
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*', ready,
        }))]);

        await ax.get('/secure');
        expect(ready).toHaveBeenCalledTimes(1);
        expect(captured.sent).toBe(true);
    });

    it('config.protected 消费后即从 config 删除', async () => {
        const tm = makeFakeTM({ access: 'Bearer T' });
        const captured: any = {};
        const ax = makeCapturingAx(captured);

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({ tokenManager: tm, urlPattern: [] }))]);

        await ax.get('/x', { protected: true });
        expect(captured.protected).toBeUndefined();
        expect(captured.hasFlag).toBe(true);
    });

    // ─── 未登录拦截 ──────────────────────────────────────────────

    it('受保护 + 无 accessToken → onAccessDenied(syntheticResp) + 请求被终止 + ready 不执行', async () => {
        const tm = makeFakeTM({ access: undefined });
        const captured: any = {};
        const ax = makeCapturingAx(captured);

        const onAccessDenied = vi.fn();
        const ready = vi.fn();

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*', onAccessDenied, ready,
        }))]);

        const r = await ax.get('/secure');
        expect(onAccessDenied).toHaveBeenCalledTimes(1);
        const synth = onAccessDenied.mock.calls[0][1] as HttpResponse;
        expect(synth.data).toBeInstanceOf(ApiResponse);
        expect(synth.data.code).toBe('ACCESS_DENIED');
        expect(synth.data.success).toBe(false);
        expect(ready).not.toHaveBeenCalled();
        expect(captured.sent).toBeUndefined();
        expect((r.data as ApiResponse).success).toBe(false);
    });

    it('受保护 + 有 accessToken → 不触发 onAccessDenied，ready 正常执行', async () => {
        const tm = makeFakeTM({ access: 'Bearer T' });
        const captured: any = {};
        const ax = makeCapturingAx(captured);

        const onAccessDenied = vi.fn();
        const ready = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*', onAccessDenied, ready,
        }))]);

        await ax.get('/secure');
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(ready).toHaveBeenCalledTimes(1);
        expect(captured.sent).toBe(true);
    });

    it('未受保护 + 无 accessToken → 不拦截', async () => {
        const tm = makeFakeTM({ access: undefined });
        const captured: any = {};
        const ax = makeCapturingAx(captured);

        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: [], onAccessDenied,
        }))]);

        await ax.get('/public');
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(captured.sent).toBe(true);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  methods + urlPattern 交集判定
// ───────────────────────────────────────────────────────────────────────────

describe('auth — methods ∩ urlPattern', () => {
    function makeAx(captured: { sent?: boolean }) {
        const ax = axios.create();
        ax.defaults.adapter = async (config) => {
            captured.sent = true;
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        };
        return ax;
    }

    it('method 不命中 → 不视为受保护（即使 url 命中）', async () => {
        const tm = makeFakeTM(); // 无 token
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, methods: ['post'], urlPattern: '*', onAccessDenied,
        }))]);
        await ax.get('/secure');
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(captured.sent).toBe(true);
    });

    it('url 不命中 → 不视为受保护（即使 method 命中）', async () => {
        const tm = makeFakeTM();
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, methods: ['get'], urlPattern: ['/secure/*'], onAccessDenied,
        }))]);
        await ax.get('/public');
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(captured.sent).toBe(true);
    });

    it('method ∧ url 同时命中 → 受保护', async () => {
        const tm = makeFakeTM();
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, methods: ['get'], urlPattern: ['/secure/*'], onAccessDenied,
        }))]);
        await ax.get('/secure/x');
        expect(onAccessDenied).toHaveBeenCalledTimes(1);
        expect(captured.sent).toBeUndefined();
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  DEFAULT_ON_AUTH_FAILURE —— 5 种路由 + headerName
// ───────────────────────────────────────────────────────────────────────────

describe('auth — DEFAULT_ON_AUTH_FAILURE 路由表', () => {
    function mkRespWithAuth(status: number, authHeader?: string): HttpResponse {
        return {
            data: new ApiResponse(status, '', null, null, false),
            status, statusText: '',
            headers: {} as any,
            config: { headers: authHeader ? { Authorization: authHeader } : {} } as any,
        } as HttpResponse;
    }

    it('非 401/403（如 500） → Others（路由表第 1 步短路）', () => {
        const tm = makeFakeTM({ access: 'Bearer T' });
        expect(DEFAULT_ON_AUTH_FAILURE(tm, mkRespWithAuth(500, 'Bearer T'))).toBe(AuthFailureAction.Others);
        expect(DEFAULT_ON_AUTH_FAILURE(tm, mkRespWithAuth(200, 'Bearer T'))).toBe(AuthFailureAction.Others);
    });

    it('tm 无 token + 401 → Expired（未登录视为过期）', () => {
        const tm = makeFakeTM();   // access undefined
        expect(DEFAULT_ON_AUTH_FAILURE(tm, mkRespWithAuth(401, 'anything'))).toBe(AuthFailureAction.Expired);
        expect(DEFAULT_ON_AUTH_FAILURE(tm, mkRespWithAuth(401))).toBe(AuthFailureAction.Expired);
    });

    it('tm 无 token + 403 → Deny', () => {
        const tm = makeFakeTM();
        expect(DEFAULT_ON_AUTH_FAILURE(tm, mkRespWithAuth(403))).toBe(AuthFailureAction.Deny);
    });

    it('tm 有 token + 请求未携带 token → Replay（用 tm 当前 token 重发）', () => {
        const tm = makeFakeTM({ access: 'Bearer T' });
        expect(DEFAULT_ON_AUTH_FAILURE(tm, mkRespWithAuth(401))).toBe(AuthFailureAction.Replay);
        expect(DEFAULT_ON_AUTH_FAILURE(tm, mkRespWithAuth(403))).toBe(AuthFailureAction.Replay);
    });

    it('tm 有 token + 携带与当前一致 → Refresh（401/403 共用）', () => {
        const tm = makeFakeTM({ access: 'Bearer T' });
        expect(DEFAULT_ON_AUTH_FAILURE(tm, mkRespWithAuth(401, 'Bearer T'))).toBe(AuthFailureAction.Refresh);
        expect(DEFAULT_ON_AUTH_FAILURE(tm, mkRespWithAuth(403, 'Bearer T'))).toBe(AuthFailureAction.Refresh);
    });

    it('tm 有 token + 携带与当前不一致（stale） → Replay', () => {
        const tm = makeFakeTM({ access: 'Bearer NEW' });
        expect(DEFAULT_ON_AUTH_FAILURE(tm, mkRespWithAuth(401, 'Bearer OLD'))).toBe(AuthFailureAction.Replay);
        expect(DEFAULT_ON_AUTH_FAILURE(tm, mkRespWithAuth(403, 'Bearer OLD'))).toBe(AuthFailureAction.Replay);
    });
});


describe('auth — authFailureFactory 换 header 名（X-Token）', () => {
    function makeAx(handler: (config: any, n: number) => Promise<any>) {
        const ax = axios.create();
        let n = 0;
        ax.defaults.adapter = async (config) => handler(config, ++n);
        return ax;
    }

    it("用 authFailureFactory('X-Token') → 401 + X-Token → Refresh + onRefresh + 重发", async () => {
        const tm = makeFakeTM({ access: 'OLD' });
        const onRefresh = vi.fn(async () => { tm.set('NEW', 'R2'); return true; });
        const onAccessExpired = vi.fn();

        const ax = makeAx(async (config, _n) => {
            const sent = (config.headers as any)['X-Token'] as string | undefined;
            if (sent === 'OLD') return { data: { code: 'X' }, status: 401, statusText: '', headers: {}, config } as any;
            return { data: { code: '0000', data: 1 }, status: 200, statusText: 'OK', headers: {}, config } as any;
        });

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*',
            onFailure: authFailureFactory('X-Token'),
            ready: (tm, config) => {
                if (tm.accessToken) (config.headers as any)['X-Token'] = tm.accessToken;
            },
            onRefresh, onAccessExpired,
        })]);

        const r = await ax.get('/secure');
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect((r.data as ApiResponse).success).toBe(true);
        expect(tm.accessToken).toBe('NEW');
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  插件级 isProtected 钩子（C）+ accessDeniedCode（B）
// ───────────────────────────────────────────────────────────────────────────

describe('auth — isProtected hook + accessDeniedCode', () => {
    function makeAx(captured: { sent?: boolean }) {
        const ax = axios.create();
        ax.defaults.adapter = async (config) => {
            captured.sent = true;
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        };
        return ax;
    }

    it('isProtected 返回 true → 受保护（覆盖 methods/urlPattern 全关）', async () => {
        const tm = makeFakeTM(); // 无 token
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: [], methods: '',
            isProtected: (config) => (config as any).meta?.requiresAuth === true,
            onAccessDenied,
        }))]);
        await ax.get('/anywhere', { meta: { requiresAuth: true } } as any);
        expect(onAccessDenied).toHaveBeenCalledTimes(1);
        expect(captured.sent).toBeUndefined();
    });

    it('isProtected 返回 false → 不受保护（覆盖 methods+urlPattern 全开）', async () => {
        const tm = makeFakeTM();
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*',
            isProtected: () => false,
            onAccessDenied,
        }))]);
        await ax.get('/secure');
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(captured.sent).toBe(true);
    });

    it('isProtected 返回 null/void → 落到 methods+urlPattern', async () => {
        const tm = makeFakeTM();
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: ['/secure/*'],
            isProtected: () => null,
            onAccessDenied,
        }))]);
        await ax.get('/secure/x');
        expect(onAccessDenied).toHaveBeenCalledTimes(1);
        onAccessDenied.mockClear();
        captured.sent = undefined;
        await ax.get('/public');
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(captured.sent).toBe(true);
    });

    it('请求级 protected 优先于 isProtected', async () => {
        const tm = makeFakeTM();
        const captured: any = {};
        const ax = makeAx(captured);
        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*',
            isProtected: () => true,  // 插件级总是 protected
            onAccessDenied,
        }))]);
        // 请求级 protected:false 强制覆盖
        await ax.get('/x', { protected: false });
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(captured.sent).toBe(true);
    });

    it('accessDeniedCode 自定义 → 合成响应的 code 用之', async () => {
        const tm = makeFakeTM({ access: undefined });
        const ax = axios.create();
        ax.defaults.adapter = async (config) => ({
            data: { code: '0000', message: 'ok', data: 1 },
            status: 200, statusText: 'OK', headers: {}, config,
        } as any);

        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*',
            accessDeniedCode: 'NO_LOGIN',
            onAccessDenied,
        }))]);

        await ax.get('/secure');
        const synth = onAccessDenied.mock.calls[0][1] as HttpResponse;
        expect(synth.data.code).toBe('NO_LOGIN');
    });

    it('accessDeniedCode 默认 → ACCESS_DENIED', async () => {
        const tm = makeFakeTM({ access: undefined });
        const ax = axios.create();
        ax.defaults.adapter = async (config) => ({
            data: { code: '0000', message: 'ok', data: 1 },
            status: 200, statusText: 'OK', headers: {}, config,
        } as any);

        const onAccessDenied = vi.fn();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*', onAccessDenied,
        }))]);

        await ax.get('/secure');
        const synth = onAccessDenied.mock.calls[0][1] as HttpResponse;
        expect(synth.data.code).toBe('ACCESS_DENIED');
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  响应侧：refresh / deny / expired 路由
// ───────────────────────────────────────────────────────────────────────────

describe('auth — response side', () => {
    function makeAx(handler: (config: any, callCount: number) => Promise<any>) {
        const ax = axios.create();
        let n = 0;
        ax.defaults.adapter = async (config) => handler(config, ++n);
        return ax;
    }

    it('default onFailure → Refresh + onRefresh true → 重发最终成功；不调 onAccessExpired', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R1' });
        const onRefresh = vi.fn(async () => { tm.set('Bearer NEW', 'R2'); return true; });
        const onAccessDenied = vi.fn();
        const onAccessExpired = vi.fn();
        const ax = makeAx(async (config, n) => {
            if (n === 1) {
                return {
                    data: { code: 'X', message: 'expired' },
                    status: 401, statusText: 'Unauthorized', headers: {}, config,
                } as any;
            }
            return {
                data: { code: '0000', message: 'ok', data: { ok: 1 } },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        });

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*',
            ready: (tm, config) => { config.headers!.Authorization = tm.accessToken!; },
            onRefresh, onAccessDenied, onAccessExpired,
        })]);

        const r = await ax.get('/secure');
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect((r.data as ApiResponse).success).toBe(true);
        expect(tm.accessToken).toBe('Bearer NEW');
    });

    it('default onFailure → Refresh + onRefresh false → tokenManager.clear + onAccessExpired', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R1' });
        const onRefresh = vi.fn(async () => false);
        const onAccessDenied = vi.fn();
        const onAccessExpired = vi.fn();
        const ax = makeAx(async (config) => ({
            data: { code: 'X', message: 'expired' },
            status: 401, statusText: 'Unauthorized', headers: {}, config,
        } as any));

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*',
            ready: (tm, config) => { config.headers!.Authorization = tm.accessToken!; },
            onRefresh, onAccessDenied, onAccessExpired,
        })]);

        await ax.get('/secure');
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(tm.accessToken).toBeUndefined();
    });

    it('未传 onAccessDenied → deny 路径回退调 onAccessExpired', async () => {
        const tm = makeFakeTM({ access: 'Bearer T', refresh: 'R' });
        const onAccessExpired = vi.fn();
        const ax = makeAx(async (config) => ({
            data: { code: 'X' }, status: 403, statusText: 'X', headers: {}, config,
        } as any));

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*',
            // 自定义 onFailure 强制走 Deny，验证 onAccessDenied 未传时的 alias 行为
            onFailure: () => AuthFailureAction.Deny,
            onRefresh: async () => true,
            onAccessExpired,
        })]);

        await ax.get('/secure');
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        expect(tm.accessToken).toBe('Bearer T');
    });

    it('onRefresh 抛错 → 视为 false → onAccessExpired', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R1' });
        const onRefresh = vi.fn(async () => { throw new Error('boom'); });
        const onAccessExpired = vi.fn();
        const ax = makeAx(async (config) => ({
            data: { code: 'X' }, status: 401, statusText: 'Unauthorized', headers: {}, config,
        } as any));

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*',
            ready: (tm, config) => { config.headers!.Authorization = tm.accessToken!; },
            onRefresh, onAccessExpired,
        }))]);

        await ax.get('/secure');
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        expect(tm.accessToken).toBeUndefined();
    });

    it('default onFailure: tm 有 token + 401 + 未带 token → Replay 重发，仍失败兜底 expired', async () => {
        const tm = makeFakeTM({ access: 'Bearer T', refresh: 'R' });
        const onAccessDenied = vi.fn();
        const onAccessExpired = vi.fn();
        // 不写 ready → 请求永远不带 Authorization；adapter 永远返 401
        const ax = makeAx(async (config) => ({
            data: { code: 'X' }, status: 401, statusText: 'X', headers: {}, config,
        } as any));

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*',
            onAccessDenied, onAccessExpired,
        }))]);

        await ax.get('/secure');
        // 第一次 401 → Replay 重发；第二次 401 → _refreshed 已 true → expired 兜底
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(tm.accessToken).toBeUndefined();
    });

    it('未受保护请求的 401 不触发 auth 流程', async () => {
        const tm = makeFakeTM({ access: 'Bearer T', refresh: 'R' });
        const onRefresh = vi.fn(async () => true);
        const onAccessDenied = vi.fn();
        const onAccessExpired = vi.fn();
        const ax = makeAx(async (config) => ({
            data: { code: 'X' }, status: 401, statusText: 'X', headers: {}, config,
        } as any));

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: [],
            onRefresh, onAccessDenied, onAccessExpired,
        })]);

        await ax.get('/public');
        expect(onRefresh).not.toHaveBeenCalled();
        expect(onAccessDenied).not.toHaveBeenCalled();
        expect(onAccessExpired).not.toHaveBeenCalled();
    });

    it('请求阶段已 deny（无 token 拦截）→ 响应侧不再二次触发 onAccessDenied', async () => {
        const tm = makeFakeTM({ access: undefined });
        const onAccessDenied = vi.fn();

        const ax = axios.create();
        ax.defaults.adapter = async (config) => ({
            data: { code: 'X' }, status: 401, statusText: 'X', headers: {}, config,
        } as any);

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*', onAccessDenied,
        }))]);

        await ax.get('/secure');
        expect(onAccessDenied).toHaveBeenCalledTimes(1);
    });

    it('刷新成功后重发仍失败 → 走 onAccessExpired，不再二次刷新', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R1' });
        const onRefresh = vi.fn(async () => { tm.set('Bearer NEW', 'R2'); return true; });
        const onAccessExpired = vi.fn();
        const ax = makeAx(async (config) => ({
            data: { code: 'X' }, status: 401, statusText: 'X', headers: {}, config,
        } as any));

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*',
            ready: (tm, config) => { config.headers!.Authorization = tm.accessToken!; },
            onRefresh, onAccessExpired,
        }))]);

        await ax.get('/secure');
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        expect(tm.accessToken).toBeUndefined();
    });

    it('并发触发刷新 → 共享同一 promise，onRefresh 只调一次', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const onRefresh = vi.fn(async () => {
            await new Promise(r => setTimeout(r, 10));
            tm.set('Bearer NEW', 'R2');
            return true;
        });
        const ax = makeAx(async (config, n) => {
            if (n <= 3) {
                return {
                    data: { code: 'X' }, status: 401, statusText: 'X', headers: {}, config,
                } as any;
            }
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        });

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*', onRefresh,
            ready: (tm, config) => { config.headers!.Authorization = tm.accessToken!; },
        }))]);

        const [r1, r2, r3] = await Promise.all([
            ax.get('/a'), ax.get('/b'), ax.get('/c'),
        ]);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect((r1.data as ApiResponse).success).toBe(true);
        expect((r2.data as ApiResponse).success).toBe(true);
        expect((r3.data as ApiResponse).success).toBe(true);
    });

    it('自定义 onFailure —— 业务码（response.data.code）路由 Refresh', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const onRefresh = vi.fn(async () => { tm.set('Bearer NEW', 'R2'); return true; });
        const ax = makeAx(async (config, n) => {
            if (n === 1) {
                return {
                    data: { code: 'TOKEN_EXPIRED', message: 'biz expired' },
                    status: 200, statusText: 'OK', headers: {}, config,
                } as any;
            }
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        });

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth(mkBaseOpts({
            tokenManager: tm, urlPattern: '*',
            onFailure: (_, resp) =>
                resp.data.code === 'TOKEN_EXPIRED'
                    ? AuthFailureAction.Refresh
                    : AuthFailureAction.Others,
            onRefresh,
        }))]);

        const r = await ax.get('/secure');
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect((r.data as ApiResponse).success).toBe(true);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  refresh 流程详细：shouldRefresh → onRefresh → false → onAccessExpired
// ───────────────────────────────────────────────────────────────────────────

describe('auth — refresh flow detail', () => {
    function makeAx(handler: (config: any, callCount: number) => Promise<any>) {
        const ax = axios.create();
        let n = 0;
        ax.defaults.adapter = async (config) => handler(config, ++n);
        return ax;
    }

    function fail401() {
        return async (config: any) => ({
            data: { code: 'X', message: 'expired' },
            status: 401, statusText: 'Unauthorized', headers: {}, config,
        } as any);
    }

    const ready: NonNullable<IAuthOptions['ready']> = (tm, config) => {
        if (tm.accessToken) {
            config.headers = config.headers ?? ({} as any);
            (config.headers as any).Authorization = tm.accessToken;
        }
    };

    function makeAxByToken(failToken: string) {
        return makeAx(async (config) => {
            const auth = (config.headers as any).Authorization;
            if (auth === failToken) {
                return { data: { code: 'X' }, status: 401, statusText: '', headers: {}, config } as any;
            }
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        });
    }

    it('调用顺序：onFailure → onRefresh → onAccessExpired（onRefresh 返回 false）', async () => {
        const order: string[] = [];
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const onFailure = vi.fn(() => { order.push('onFailure'); return AuthFailureAction.Refresh; });
        const onRefresh = vi.fn(async () => { order.push('onRefresh'); return false; });
        const onAccessExpired = vi.fn(() => {
            order.push('onAccessExpired');
            expect(tm.accessToken).toBeUndefined();
        });
        const ax = makeAx(fail401());

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onFailure, onRefresh, onAccessExpired,
        })]);

        await ax.get('/secure');
        expect(order).toEqual(['onFailure', 'onRefresh', 'onAccessExpired']);
    });

    it('调用次数：onRefresh 失败 → onFailure 1 / onRefresh 1 / onAccessExpired 1', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const onFailure = vi.fn(() => AuthFailureAction.Refresh);
        const onRefresh = vi.fn(async () => false);
        const onAccessDenied = vi.fn();
        const onAccessExpired = vi.fn();
        const ax = makeAx(fail401());

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onFailure, onRefresh,
            onAccessDenied, onAccessExpired,
        })]);

        await ax.get('/secure');
        expect(onFailure).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        expect(onAccessDenied).not.toHaveBeenCalled();
    });

    it('参数：onFailure / onRefresh / onAccessExpired 收到的 (tm, response) 是同一对，response.status===401', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const onFailure = vi.fn(() => AuthFailureAction.Refresh);
        const onRefresh = vi.fn(async () => false);
        const onAccessExpired = vi.fn();
        const ax = makeAx(fail401());

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onFailure, onRefresh, onAccessExpired,
        })]);

        await ax.get('/secure');
        type Call = [ITokenManager, HttpResponse];
        const argFailure = onFailure.mock.calls[0] as unknown as Call;
        const argRefresh = onRefresh.mock.calls[0] as unknown as Call;
        const argExpired = onAccessExpired.mock.calls[0] as unknown as Call;
        expect(argFailure[0]).toBe(tm);
        expect(argRefresh[0]).toBe(tm);
        expect(argExpired[0]).toBe(tm);
        expect(argFailure[1].status).toBe(401);
        expect(argFailure[1]).toBe(argRefresh[1]);
        expect(argFailure[1]).toBe(argExpired[1]);
        expect(argFailure[1].data).toBeInstanceOf(ApiResponse);
    });

    it('onFailure 返回 Others → onRefresh 不调用 → 原样传播（无 expired）', async () => {
        const tm = makeFakeTM({ access: 'Bearer T' });
        const onFailure = vi.fn(() => AuthFailureAction.Others);
        const onRefresh = vi.fn(async () => true);
        const onAccessExpired = vi.fn();
        const ax = makeAx(async (config) => ({
            data: { code: 'X' }, status: 401, statusText: '', headers: {}, config,
        } as any));

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*',
            onFailure, onRefresh, onAccessExpired,
        })]);

        await ax.get('/secure');
        expect(onFailure).toHaveBeenCalledTimes(1);
        expect(onRefresh).not.toHaveBeenCalled();
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect(tm.accessToken).toBe('Bearer T');
    });

    it('onFailure 返回 null / undefined / void → 等同 Others（兜底）', async () => {
        const tm = makeFakeTM({ access: 'Bearer T' });
        const onRefresh = vi.fn(async () => true);
        const onAccessExpired = vi.fn();
        const ax = makeAx(async (config) => ({
            data: { code: 'X' }, status: 401, statusText: '', headers: {}, config,
        } as any));

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*',
            onFailure: () => null,           // 等同 Others
            onRefresh, onAccessExpired,
        })]);

        await ax.get('/secure');
        expect(onRefresh).not.toHaveBeenCalled();
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect(tm.accessToken).toBe('Bearer T');
    });

    it('onFailure 抛错 → safe 吞掉视为 Others → 兜底分支（不刷新 / 不清 token）', async () => {
        const tm = makeFakeTM({ access: 'Bearer T' });
        const onFailure = vi.fn(() => { throw new Error('boom'); });
        const onRefresh = vi.fn(async () => true);
        const onAccessExpired = vi.fn();
        const ax = makeAx(async (config) => ({
            data: { code: 'X' }, status: 401, statusText: '', headers: {}, config,
        } as any));

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*',
            onFailure, onRefresh, onAccessExpired,
        })]);

        await ax.get('/secure');
        expect(onRefresh).not.toHaveBeenCalled();
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect(tm.accessToken).toBe('Bearer T');
    });

    it('refresh 成功 + 重发 success → 不调 onAccessExpired；onFailure 仅触发一次（重发响应是 success）', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const onFailure = vi.fn(() => AuthFailureAction.Refresh);
        const onRefresh = vi.fn(async () => { tm.set('Bearer NEW', 'R2'); return true; });
        const onAccessExpired = vi.fn();
        const ax = makeAxByToken('Bearer OLD');

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onFailure, onRefresh, onAccessExpired,
        })]);

        const r = await ax.get('/secure');
        expect(onFailure).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect((r.data as ApiResponse).success).toBe(true);
        expect(tm.accessToken).toBe('Bearer NEW');
    });

    it('refresh 成功 + 重发仍失败 → onAccessExpired，第二次响应**不再询问** onFailure / onRefresh', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const onFailure = vi.fn(() => AuthFailureAction.Refresh);
        const onRefresh = vi.fn(async () => { tm.set('Bearer NEW', 'R2'); return true; });
        const onAccessExpired = vi.fn();
        const ax = makeAx(fail401());

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onFailure, onRefresh, onAccessExpired,
        })]);

        await ax.get('/secure');
        expect(onFailure).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        expect(tm.accessToken).toBeUndefined();
    });

    it('onRefresh 抛错 → 等价 false → onAccessExpired', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const onRefresh = vi.fn(async () => { throw new Error('network down'); });
        const onAccessExpired = vi.fn();
        const ax = makeAx(fail401());

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onRefresh, onAccessExpired,
        })]);

        await ax.get('/secure');
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        expect(tm.accessToken).toBeUndefined();
    });

    it('onRefresh 返回 truthy 非 true（对象 / undefined）→ 视为成功（"!== false"）→ 重发', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        // 副作用风格：用户在函数内 tm.set，未显式 return
        const onRefresh = vi.fn(async () => { tm.set('Bearer NEW', 'R2'); /* return undefined */ });
        const onAccessExpired = vi.fn();
        const ax = makeAxByToken('Bearer OLD');

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onRefresh, onAccessExpired,
        })]);

        const r = await ax.get('/secure');
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect((r.data as ApiResponse).success).toBe(true);
        expect(tm.accessToken).toBe('Bearer NEW');
    });

    it('onRefresh 显式 return false → 视为失败 → onAccessExpired', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const onRefresh = vi.fn(async () => false);
        const onAccessExpired = vi.fn();
        const ax = makeAx(fail401());

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onRefresh, onAccessExpired,
        })]);

        await ax.get('/secure');
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        expect(tm.accessToken).toBeUndefined();
    });

    it('refresh 失败后 refreshing 被清空 —— 后续请求触发新一轮刷新（不复用旧的失败 promise）', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        let refreshAttempt = 0;
        const onRefresh = vi.fn(async () => {
            refreshAttempt++;
            if (refreshAttempt === 1) return false;
            tm.set('Bearer NEW', 'R2'); return true;
        });
        const onAccessExpired = vi.fn(() => {
            tm.set('Bearer RE-LOGIN', 'R3');
        });
        const ax = makeAxByToken('Bearer OLD');
        ax.defaults.adapter = async (config) => {
            const auth = (config.headers as any).Authorization;
            if (auth === 'Bearer NEW') {
                return {
                    data: { code: '0000', message: 'ok', data: 1 },
                    status: 200, statusText: 'OK', headers: {}, config,
                } as any;
            }
            return { data: { code: 'X' }, status: 401, statusText: '', headers: {}, config } as any;
        };

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onRefresh, onAccessExpired,
        })]);

        await ax.get('/secure');
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        expect(tm.accessToken).toBe('Bearer RE-LOGIN');

        const r = await ax.get('/secure');
        expect(onRefresh).toHaveBeenCalledTimes(2);
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('并发 refresh：3 请求并发 401 → onRefresh 仅触发一次，全部重发后成功', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const onRefresh = vi.fn(async () => {
            await new Promise(r => setTimeout(r, 10));
            tm.set('Bearer NEW', 'R2');
            return true;
        });
        const onAccessExpired = vi.fn();
        const ax = makeAxByToken('Bearer OLD');

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onRefresh, onAccessExpired,
        })]);

        const [r1, r2, r3] = await Promise.all([
            ax.get('/a'), ax.get('/b'), ax.get('/c'),
        ]);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect((r1.data as ApiResponse).success).toBe(true);
        expect((r2.data as ApiResponse).success).toBe(true);
        expect((r3.data as ApiResponse).success).toBe(true);
    });

    it('并发 refresh 全部失败：onRefresh 1 次，但 3 个请求各自走一次 expired', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const onRefresh = vi.fn(async () => {
            await new Promise(r => setTimeout(r, 10));
            return false;
        });
        const onAccessExpired = vi.fn();
        const ax = makeAx(fail401());

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onRefresh, onAccessExpired,
        })]);

        await Promise.all([ax.get('/a'), ax.get('/b'), ax.get('/c')]);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).toHaveBeenCalledTimes(3);
        expect(tm.accessToken).toBeUndefined();
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  并发协议：refreshing 与请求拦截器协作（场景 2/4/6）
// ───────────────────────────────────────────────────────────────────────────

describe('auth — refresh concurrency protocol', () => {
    const ready: NonNullable<IAuthOptions['ready']> = (tm, config) => {
        if (tm.accessToken) {
            config.headers = config.headers ?? ({} as any);
            (config.headers as any).Authorization = tm.accessToken;
        }
    };

    it('场景 2/3：refreshing 进行中时新请求 await refreshing，完成后用新 token 发出', async () => {
        const tm = makeFakeTM({ access: 'OLD', refresh: 'R' });
        const onRefresh = vi.fn(async () => {
            await new Promise(r => setTimeout(r, 30));
            tm.set('NEW', 'R2');
            return true;
        });
        const onAccessExpired = vi.fn();

        const sentTokens: string[] = [];
        const ax = axios.create();
        ax.defaults.adapter = async (config) => {
            const sent = (config.headers as any).Authorization as string;
            sentTokens.push(sent);
            if (sent === 'OLD') {
                return { data: { code: 'X' }, status: 401, statusText: '', headers: {}, config } as any;
            }
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        };

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onRefresh, onAccessExpired,
        })]);

        const p1 = ax.get('/a');
        await new Promise(r => setTimeout(r, 5));
        const p2 = ax.get('/b');

        const [r1, r2] = await Promise.all([p1, p2]);

        expect(sentTokens).toEqual(['OLD', 'NEW', 'NEW']);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect((r1.data as ApiResponse).success).toBe(true);
        expect((r2.data as ApiResponse).success).toBe(true);
    });

    it('refresh 失败时 await refreshing 的新请求被中断（不调 onAccessExpired）', async () => {
        const tm = makeFakeTM({ access: 'OLD', refresh: 'R' });
        const onRefresh = vi.fn(async () => {
            await new Promise(r => setTimeout(r, 30));
            return false;
        });
        const onAccessExpired = vi.fn();

        const adapterCount = vi.fn();
        const ax = axios.create();
        ax.defaults.adapter = async (config) => {
            adapterCount();
            return { data: { code: 'X' }, status: 401, statusText: '', headers: {}, config } as any;
        };

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onRefresh, onAccessExpired,
        })]);

        const p1 = ax.get('/a');
        await new Promise(r => setTimeout(r, 5));
        const p2 = ax.get('/b');

        const [r1, r2] = await Promise.all([p1, p2]);

        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(adapterCount).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        expect((r1.data as ApiResponse).success).toBe(false);
        expect((r2.data as ApiResponse).success).toBe(false);
    });

    it('场景 6：refresh 完成后才返回的旧请求 → token 不一致 → 直接重放，**不再触发 onRefresh**', async () => {
        const tm = makeFakeTM({ access: 'OLD', refresh: 'R' });
        const onRefresh = vi.fn(async () => {
            await new Promise(r => setTimeout(r, 5));
            tm.set('NEW', 'R2');
            return true;
        });
        const onAccessExpired = vi.fn();

        const adapterCalls: { url: string; sent: string }[] = [];
        const ax = axios.create();
        ax.defaults.adapter = async (config) => {
            const url = config.url!;
            const sent = (config.headers as any).Authorization as string;
            adapterCalls.push({ url, sent });
            if (sent === 'OLD' && url === '/a') {
                return { data: { code: 'X' }, status: 401, statusText: '', headers: {}, config } as any;
            }
            if (sent === 'OLD' && url === '/c') {
                await new Promise(r => setTimeout(r, 30));
                return { data: { code: 'X' }, status: 401, statusText: '', headers: {}, config } as any;
            }
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        };

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: '*', ready,
            onRefresh, onAccessExpired,
        })]);

        const [ra, rc] = await Promise.all([ax.get('/a'), ax.get('/c')]);

        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect((ra.data as ApiResponse).success).toBe(true);
        expect((rc.data as ApiResponse).success).toBe(true);
        expect(adapterCalls).toHaveLength(4);
        expect(adapterCalls.filter(c => c.sent === 'OLD')).toHaveLength(2);
        expect(adapterCalls.filter(c => c.sent === 'NEW')).toHaveLength(2);
    });

    it('未受保护的请求不受 refreshing 影响，正常并发发出', async () => {
        const tm = makeFakeTM({ access: 'OLD', refresh: 'R' });
        const onRefresh = vi.fn(async () => {
            await new Promise(r => setTimeout(r, 50));
            tm.set('NEW', 'R2');
            return true;
        });
        const onAccessExpired = vi.fn();

        const ax = axios.create();
        ax.defaults.adapter = async (config) => {
            const auth = (config.headers as any).Authorization as string | undefined;
            if (auth === 'OLD') {
                return { data: { code: 'X' }, status: 401, statusText: '', headers: {}, config } as any;
            }
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        };

        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), auth({
            tokenManager: tm, urlPattern: ['/secure/*'], ready,
            onRefresh, onAccessExpired,
        })]);

        const pSecure = ax.get('/secure/x');
        await new Promise(r => setTimeout(r, 5));
        const startPub = Date.now();
        const rPub = await ax.get('/public');
        const pubElapsed = Date.now() - startPub;

        await pSecure;

        expect(pubElapsed).toBeLessThan(30);
        expect((rPub.data as ApiResponse).success).toBe(true);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  retry × auth 联动：避免重试预算被叠加 / cancel intent 跨重发存活
// ───────────────────────────────────────────────────────────────────────────

describe('auth — retry 联动（_refreshed 防叠加）', () => {
    function makeAxByToken(failToken: string, calls: { url: string; sent: string | undefined }[]) {
        const ax = axios.create();
        ax.defaults.adapter = async (config) => {
            const sent = (config.headers as any).Authorization as string | undefined;
            calls.push({ url: config.url ?? '', sent });
            if (sent === failToken || !sent) {
                return { data: { code: 'X' }, status: 401, statusText: '', headers: {}, config } as any;
            }
            return {
                data: { code: '0000', message: 'ok', data: 1 },
                status: 200, statusText: 'OK', headers: {}, config,
            } as any;
        };
        return ax;
    }

    const ready: NonNullable<IAuthOptions['ready']> = (tm, config) => {
        if (tm.accessToken) {
            config.headers = config.headers ?? ({} as any);
            (config.headers as any).Authorization = tm.accessToken;
        }
    };

    it('retry: max=2 + 401 + onRefresh ok → 总请求 = 1 首发 + 2 retry + 1 refresh 重发 = 4（retry 不在 refresh 重发上叠加）', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const calls: { url: string; sent: string | undefined }[] = [];
        const onRefresh = vi.fn(async () => { tm.set('Bearer NEW', 'R2'); return true; });
        const onAccessExpired = vi.fn();
        const ax = makeAxByToken('Bearer OLD', calls);

        const api = create(ax);
        // 顺序：normalize → retry（先注册响应 hook，先看响应）→ auth
        api.use([
            normalize({ success: (a: any) => a.code === '0000' }),
            retry({ max: 2, delay: 0, status: [401] }),
            auth(mkBaseOpts({
                tokenManager: tm, urlPattern: '*', ready,
                onRefresh, onAccessExpired,
            })),
        ]);

        const r = await ax.get('/secure');

        // 4 次精确：
        //   1) /secure OLD → 401（首发）
        //   2) /secure OLD → 401（retry-1）
        //   3) /secure OLD → 401（retry-2，retry 用尽）
        //   4) /secure NEW → 200（auth refresh 后重发；retry 看到 _refreshed=true 短路）
        expect(calls.length).toBe(4);
        expect(calls.filter(c => c.sent === 'Bearer OLD').length).toBe(3);
        expect(calls.filter(c => c.sent === 'Bearer NEW').length).toBe(1);

        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).not.toHaveBeenCalled();
        expect((r.data as ApiResponse).success).toBe(true);
        expect(tm.accessToken).toBe('Bearer NEW');
    });

    it('retry: max=2 + 401 + onRefresh false → retry 用尽 + auth refresh 重发不再叠加 retry，最终 expired', async () => {
        const tm = makeFakeTM({ access: 'Bearer OLD', refresh: 'R' });
        const calls: { url: string; sent: string | undefined }[] = [];
        const onRefresh = vi.fn(async () => false);
        const onAccessExpired = vi.fn();
        // adapter 永远 401
        const ax = axios.create();
        ax.defaults.adapter = async (config) => {
            const sent = (config.headers as any).Authorization as string | undefined;
            calls.push({ url: config.url ?? '', sent });
            return { data: { code: 'X' }, status: 401, statusText: '', headers: {}, config } as any;
        };

        const api = create(ax);
        api.use([
            normalize({ success: (a: any) => a.code === '0000' }),
            retry({ max: 2, delay: 0, status: [401] }),
            auth(mkBaseOpts({
                tokenManager: tm, urlPattern: '*', ready,
                onRefresh, onAccessExpired,
            })),
        ]);

        await ax.get('/secure');

        // refresh 失败：onRefresh 1 次（非多次），onAccessExpired 1 次，retry 不再叠加
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(onAccessExpired).toHaveBeenCalledTimes(1);
        // 总次数：1 首发 + 2 retry = 3（refresh 失败不重发）
        expect(calls.length).toBe(3);
    });
});
