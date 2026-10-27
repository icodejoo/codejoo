import { describe, it, expect, vi } from 'vitest';
import auth, {
  $normalize,
  $compileMethods,
  $compileUrlPatterns,
  $pathnameOf,
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
    const { ax, reqHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { } }).install(ax);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await reqHandlers[0](config);
    expect(config.headers.Authorization).toBe('Bearer x');
  });

  it('受保护 + 无 token → onAccessDenied 调用并抛错', async () => {
    const tm = makeTM();  // 无 token
    const onAccessDenied = vi.fn();
    const { ax, reqHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { }, onAccessDenied }).install(ax);
    const config: any = { url: '/api', method: 'get', headers: {} };
    await expect(reqHandlers[0](config)).rejects.toThrow(/access denied/);
    expect(onAccessDenied).toHaveBeenCalledTimes(1);
  });

  it('config.protected=false → 不受保护，直接放行（不注入）', async () => {
    const tm = makeTM('x');
    const { ax, reqHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { } }).install(ax);
    const config: any = { url: '/api', method: 'get', headers: {}, protected: false };
    await reqHandlers[0](config);
    expect(config.headers.Authorization).toBeUndefined();
  });
});


describe('auth 集成 — 响应侧路由', () => {
  it('业务成功 → 原样透传', async () => {
    const tm = makeTM('x');
    const { ax, reqHandlers, resHandlers } = makeMockCtx();
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { } }).install(ax);
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

  it('Refresh 失败 → expired：tm.clear + onAccessExpired，原 error 透传', async () => {
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

  it('已重放过一次仍失败 → 兜底 expired（防回环）', async () => {
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

  it('并发刷新单飞：两个失败请求只触发一次 onRefresh', async () => {
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


describe('auth — enable / 元信息', () => {
  it('公开动作同时可作为值和类型使用', () => {
    const action: AuthFailureAction = AuthFailureAction.Refresh;
    expect(action).toBe('refresh');
  });
  it('enable:false → 不安装拦截器', () => {
    const { ax, reqHandlers, resHandlers } = makeMockCtx();
    auth({ tokenManager: makeTM(), onRefresh: () => true, onAccessExpired: () => { }, enable: false }).install(ax);
    expect(reqHandlers).toHaveLength(0);
    expect(resHandlers).toHaveLength(0);
  });
  it("工厂 .name === 'axp:auth'", () => {
    expect(auth.name).toBe('axp:auth');
  });
});


describe('$pathnameOf — 取 URL 的 pathname', () => {
  it('相对路径原样；去掉查询串与 hash', () => {
    expect($pathnameOf('/me')).toBe('/me');
    expect($pathnameOf('/me?x=1')).toBe('/me');
    expect($pathnameOf('/me#top')).toBe('/me');
    expect($pathnameOf('/a/b?x=/y#z')).toBe('/a/b');
  });
  it('绝对 URL 去掉 scheme://host(:port)；协议相对 URL 同理', () => {
    expect($pathnameOf('https://x.com/me')).toBe('/me');
    expect($pathnameOf('http://x.com:8080/a/b?q=1')).toBe('/a/b');
    expect($pathnameOf('//cdn.x.com/f.js')).toBe('/f.js');
  });
  it('结果为空 → "/"', () => {
    expect($pathnameOf('')).toBe('/');
    expect($pathnameOf('https://x.com')).toBe('/');
    expect($pathnameOf('https://x.com?x=1')).toBe('/');
    expect($pathnameOf('?x=1')).toBe('/');
  });
});


describe('auth — cleanup 保留在途刷新状态', () => {
  it('有在途刷新时 cleanup 不删状态：重装后的新闭包复用同一次刷新', async () => {
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


describe('TokenManager — 存储不可用环境', () => {
  it('set/clear 不重置刷新许可，登录方必须显式恢复', async () => {
    const { default: TM } = await import('../src/objects/TokenManager');
    const tm = new TM();
    tm.canRefresh = false;
    tm.set('login');
    expect(tm.canRefresh).toBe(false);
    tm.clear();
    expect(tm.canRefresh).toBe(false);
    tm.canRefresh = true;
    expect(tm.canRefresh).toBe(true);
  });
  const realDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const restore = () => {
    if (realDesc) Object.defineProperty(globalThis, 'localStorage', realDesc);
    else delete (globalThis as any).localStorage;
    vi.resetModules();
  };

  it('访问 localStorage 抛 SecurityError：模块导入不崩，内存态照常工作', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('denied', 'SecurityError'); },
    });
    vi.resetModules();
    try {
      const { default: TM } = await import('../src/objects/TokenManager');
      const tm = new TM();
      expect(tm.accessToken).toBeUndefined();
      tm.set('a', 'r');
      expect(tm.accessToken).toBe('Bearer a');
      expect(tm.refreshToken).toBe('r');
      tm.clear();
      expect(tm.accessToken).toBeUndefined();
    } finally { restore(); }
  });

  it('getItem/setItem/removeItem 抛错（配额/隐私模式）：构造、写入、清除都不抛，内存态照常更新', async () => {
    const boom = () => { throw new Error('QuotaExceeded'); };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: boom, setItem: boom, removeItem: boom },
    });
    vi.resetModules();
    try {
      const { default: TM } = await import('../src/objects/TokenManager');
      const tm = new TM();
      expect(() => tm.set('a', 'r')).not.toThrow();
      expect(tm.accessToken).toBe('Bearer a');
      expect(() => tm.clear()).not.toThrow();
      expect(tm.accessToken).toBeUndefined();
    } finally { restore(); }
  });
});
