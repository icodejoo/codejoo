import { describe, it, expect, vi } from 'vitest';
import auth, {
  $normalize,
  $compileMethods,
  $compileUrlPatterns,
  $patternToRegex,
  authFailureFactory,
  AuthFailureAction,
} from '../src/plugins/auth';
import type { ITokenManager } from '../src/objects/TokenManager';


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

function makeMockCtx(axiosRequest?: any) {
  const reqHandlers: Array<(c: any) => any> = [];
  const resHandlers: Array<{ f?: (r: any) => any; r?: (e: any) => any }> = [];
  const ax: any = { request: axiosRequest ?? vi.fn(), defaults: {} };
  const ctx: any = {
    axios: ax,
    name: 'auth',
    logger: { log: () => { }, warn: () => { }, error: () => { } },
    request: (f: any) => reqHandlers.push(f),
    response: (f: any, r: any) => resHandlers.push({ f, r }),
    adapter: () => { }, transformRequest: () => { }, transformResponse: () => { }, cleanup: () => { },
  };
  return { ctx, ax, reqHandlers, resHandlers };
}


describe('$normalize — 必填校验与缺省', () => {
  const base = { tokenManager: makeTM(), onRefresh: () => true, onAccessExpired: () => { } };
  it('缺 tokenManager / onRefresh / onAccessExpired → 抛错', () => {
    expect(() => $normalize({} as any)).toThrow(/tokenManager/);
    expect(() => $normalize({ tokenManager: makeTM() } as any)).toThrow(/onRefresh/);
    expect(() => $normalize({ tokenManager: makeTM(), onRefresh: () => 1 } as any)).toThrow(/onAccessExpired/);
  });
  it('onAccessDenied 缺省回退 onAccessExpired；默认 onFailure / ready 填充', () => {
    const cfg = $normalize(base as any);
    expect(cfg.onAccessDenied).toBe(cfg.onAccessExpired);
    expect(typeof cfg.onFailure).toBe('function');
    expect(typeof cfg.ready).toBe('function');
    expect(cfg.accessDeniedCode).toBe('ACCESS_DENIED');
  });
});


describe('$compileMethods', () => {
  it("'*' → 恒真；'post' → 仅 post；数组 → 任一命中；空 → 恒假", () => {
    expect($compileMethods('*')('get')).toBe(true);
    expect($compileMethods('post')('post')).toBe(true);
    expect($compileMethods('post')('get')).toBe(false);
    const set = $compileMethods(['get', 'POST']);
    expect(set('get')).toBe(true);
    expect(set('post')).toBe(true);
    expect(set('put')).toBe(false);
    expect($compileMethods([])('get')).toBe(false);
    expect($compileMethods(undefined)('get')).toBe(false);
  });
});


describe('$compileUrlPatterns / $patternToRegex', () => {
  it("'*' 恒真；'/user/*' 前缀；':id' 单段；'!' 否定", () => {
    expect($compileUrlPatterns('*')('/anything')).toBe(true);
    const p = $compileUrlPatterns(['/user/*']);
    expect(p('/user/1')).toBe(true);
    expect(p('/admin/1')).toBe(false);
    const neg = $compileUrlPatterns(['/user/*', '!/user/login']);
    expect(neg('/user/1')).toBe(true);
    expect(neg('/user/login')).toBe(false);
  });
  it('$patternToRegex：:name 单段、* 任意', () => {
    expect($patternToRegex('/u/:id')!.test('/u/5')).toBe(true);
    expect($patternToRegex('/u/:id')!.test('/u/5/x')).toBe(false);
    expect($patternToRegex('/u/*')!.test('/u/a/b')).toBe(true);
  });
});


describe('authFailureFactory（默认 onFailure）', () => {
  const f = authFailureFactory();
  it('非 401/403 → Others', () => {
    expect(f({ accessToken: 'Bearer x' }, { status: 200 })).toBe(AuthFailureAction.Others);
  });
  it('无 token：401 → Expired，403 → Deny', () => {
    expect(f({ accessToken: undefined }, { status: 401 })).toBe(AuthFailureAction.Expired);
    expect(f({ accessToken: undefined }, { status: 403 })).toBe(AuthFailureAction.Deny);
  });
  it('未携带 token → Replay', () => {
    expect(f({ accessToken: 'Bearer x' }, { status: 401, config: { headers: {} } })).toBe(AuthFailureAction.Replay);
  });
  it('携带与当前一致 → Refresh；不一致 → Replay', () => {
    expect(f({ accessToken: 'Bearer x' }, { status: 401, config: { headers: { Authorization: 'Bearer x' } } })).toBe(AuthFailureAction.Refresh);
    expect(f({ accessToken: 'Bearer x' }, { status: 401, config: { headers: { Authorization: 'Bearer old' } } })).toBe(AuthFailureAction.Replay);
  });
});


describe('auth 集成 — 请求侧', () => {
  it('受保护 + 有 token → 默认 ready 注入 Authorization 头', async () => {
    const tm = makeTM('x');
    const { ctx, reqHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { } }).install(ctx);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](config);
    expect(config.headers.Authorization).toBe('Bearer x');
  });

  it('受保护 + 无 token → onAccessDenied 调用并抛错', async () => {
    const tm = makeTM();  // 无 token
    const onAccessDenied = vi.fn();
    const { ctx, reqHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { }, onAccessDenied }).install(ctx);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await expect(reqHandlers[0](config)).rejects.toThrow(/access denied/);
    expect(onAccessDenied).toHaveBeenCalledTimes(1);
  });

  it('config.protected=false → 不受保护，直接放行（不注入）', async () => {
    const tm = makeTM('x');
    const { ctx, reqHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { } }).install(ctx);
    const config: any = { url: '/api', method: 'get', headers: {}, protected: false };
    await reqHandlers[0](config);
    expect(config.headers.Authorization).toBeUndefined();
  });
});


describe('auth 集成 — 响应侧路由', () => {
  it('业务成功 → 原样透传', async () => {
    const tm = makeTM('x');
    const { ctx, reqHandlers, resHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { } }).install(ctx);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](config);
    const response = { status: 200, data: { code: 0 }, config };
    expect(await resHandlers[0].f!(response)).toBe(response);
  });

  it('401 + token 一致 → Refresh：onRefresh 调一次 + 用同 config 重发', async () => {
    const tm = makeTM('x');
    const reissued = { status: 200, data: { code: 0 } };
    const axiosRequest = vi.fn().mockResolvedValue(reissued);
    const onRefresh = vi.fn(async () => { tm.set('y'); return true; });
    const { ctx, reqHandlers, resHandlers } = makeMockCtx(axiosRequest);
    auth({ tokenManager: tm, onRefresh, onAccessExpired: () => { } }).install(ctx);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](config);
    const error: any = { config, response: { status: 401, config: { headers: { Authorization: 'Bearer x' } } } };
    const out = await resHandlers[0].r!(error);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(axiosRequest).toHaveBeenCalledTimes(1);
    expect(out).toBe(reissued);
  });

  it('Refresh 失败 → expired：tm.clear + onAccessExpired，原 error 透传', async () => {
    const tm = makeTM('x');
    const onAccessExpired = vi.fn();
    const onRefresh = vi.fn(async () => false);  // 刷新失败
    const { ctx, reqHandlers, resHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh, onAccessExpired }).install(ctx);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](config);
    const error: any = { config, response: { status: 401, config: { headers: { Authorization: 'Bearer x' } } } };
    await expect(resHandlers[0].r!(error)).rejects.toBe(error);
    expect(onAccessExpired).toHaveBeenCalledTimes(1);
    expect(tm.accessToken).toBeUndefined();
  });

  it('已重放过一次仍失败 → 兜底 expired（防回环）', async () => {
    const tm = makeTM('x');
    const onAccessExpired = vi.fn();
    const onRefresh = vi.fn(async () => true);
    const { ctx, reqHandlers, resHandlers } = makeMockCtx(vi.fn().mockResolvedValue({ status: 200, data: { code: 0 } }));
    auth({ tokenManager: tm, onRefresh, onAccessExpired }).install(ctx);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](config);
    config.__auth_refreshed = true;  // 模拟已重放
    const error: any = { config, response: { status: 401, config: { headers: { Authorization: 'Bearer x' } } } };
    await expect(resHandlers[0].r!(error)).rejects.toBe(error);
    expect(onAccessExpired).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('并发刷新单飞：两个失败请求只触发一次 onRefresh', async () => {
    const tm = makeTM('x');
    // 预先建 deferred，resolveRefresh 同步可用；refreshPromise 保持 pending 直到两者都入队
    let resolveRefresh!: (v: boolean) => void;
    const refreshPromise = new Promise<boolean>((res) => { resolveRefresh = res; });
    const onRefresh = vi.fn(() => refreshPromise);
    const axiosRequest = vi.fn().mockResolvedValue({ status: 200, data: { code: 0 } });
    const { ctx, reqHandlers, resHandlers } = makeMockCtx(axiosRequest);
    auth({ tokenManager: tm, onRefresh, onAccessExpired: () => { } }).install(ctx);

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


describe('auth — enable / 元信息', () => {
  it('enable:false → 不安装拦截器', () => {
    const { ctx, reqHandlers, resHandlers } = makeMockCtx();
    auth({ tokenManager: makeTM(), onRefresh: () => true, onAccessExpired: () => { }, enable: false }).install(ctx);
    expect(reqHandlers).toHaveLength(0);
    expect(resHandlers).toHaveLength(0);
  });
  it("工厂 .name === 'auth'（支持 eject(auth)）", () => {
    expect(auth.name).toBe('auth');
  });
});
