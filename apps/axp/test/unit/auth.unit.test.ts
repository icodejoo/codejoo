import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    $normalize,
    $compileMethods,
    $compileUrlPatterns,
    $pathnameOf,
    $patternToRegex,
    authFailureFactory,
    AuthFailureAction,
    AuthFailureAction as Action,
} from '../../src/plugins/auth';
import type { ITokenManager } from '../../src/objects/TokenManager';

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

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('$normalize — 必填校验与缺省', () => {
  const base = { tokenManager: makeTM(), onRefresh: () => true, onAccessExpired: () => { } };
  it('[auth.fn.$normalize][auth.cb.onRefresh][auth.cb.onAccessExpired][auth.opt.tokenManager] 缺 tokenManager / onRefresh / onAccessExpired → 抛错', () => {
    expect(() => $normalize({} as any)).toThrow(/tokenManager/);
    expect(() => $normalize({ tokenManager: makeTM() } as any)).toThrow(/onRefresh/);
    expect(() => $normalize({ tokenManager: makeTM(), onRefresh: () => 1 } as any)).toThrow(/onAccessExpired/);
  });
  it('[auth.fn.$normalize][auth.cb.onAccessDenied][auth.cb.onFailure][auth.cb.ready] onAccessDenied 缺省回退 onAccessExpired；默认 onFailure / ready 填充', () => {
    const cfg = $normalize(base as any);
    expect(cfg.onAccessDenied).toBe(cfg.onAccessExpired);
    expect(typeof cfg.onFailure).toBe('function');
    expect(typeof cfg.ready).toBe('function');
    expect(cfg.accessDeniedCode).toBe('ACCESS_DENIED');
  });
});

describe('$compileMethods', () => {
  it("[auth.fn.$compileMethods][auth.opt.methods] '*' → 恒真；'post' → 仅 post；数组 → 任一命中；空 → 恒假", () => {
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
  it("[auth.fn.$compileUrlPatterns][auth.opt.urlPattern] '*' 恒真；'/user/*' 前缀；':id' 单段；'!' 否定", () => {
    expect($compileUrlPatterns('*')('/anything')).toBe(true);
    const p = $compileUrlPatterns(['/user/*']);
    expect(p('/user/1')).toBe(true);
    expect(p('/admin/1')).toBe(false);
    const neg = $compileUrlPatterns(['/user/*', '!/user/login']);
    expect(neg('/user/1')).toBe(true);
    expect(neg('/user/login')).toBe(false);
  });
  it('[auth.fn.$patternToRegex] $patternToRegex：:name 单段、* 任意', () => {
    expect($patternToRegex('/u/:id')!.test('/u/5')).toBe(true);
    expect($patternToRegex('/u/:id')!.test('/u/5/x')).toBe(false);
    expect($patternToRegex('/u/*')!.test('/u/a/b')).toBe(true);
  });
});

describe('authFailureFactory（默认 onFailure）', () => {
  const f = authFailureFactory();
  it('[auth.fn.authFailureFactory][auth.const.AuthFailureAction.Others] 非 401/403 → Others', () => {
    expect(f({ accessToken: 'Bearer x' }, { status: 200 })).toBe(AuthFailureAction.Others);
  });
  it('[auth.fn.authFailureFactory][auth.const.AuthFailureAction.Expired][auth.const.AuthFailureAction.Deny] 无 token：401 → Expired，403 → Deny', () => {
    expect(f({ accessToken: undefined }, { status: 401 })).toBe(AuthFailureAction.Expired);
    expect(f({ accessToken: undefined }, { status: 403 })).toBe(AuthFailureAction.Deny);
  });
  it('[auth.fn.authFailureFactory][auth.const.AuthFailureAction.Replay] 未携带 token → Replay', () => {
    expect(f({ accessToken: 'Bearer x' }, { status: 401, config: { headers: {} } })).toBe(AuthFailureAction.Replay);
  });
  it('[auth.fn.authFailureFactory][auth.const.AuthFailureAction.Refresh][auth.const.AuthFailureAction.Replay] 携带与当前一致 → Refresh；不一致 → Replay', () => {
    expect(f({ accessToken: 'Bearer x' }, { status: 401, config: { headers: { Authorization: 'Bearer x' } } })).toBe(AuthFailureAction.Refresh);
    expect(f({ accessToken: 'Bearer x' }, { status: 401, config: { headers: { Authorization: 'Bearer old' } } })).toBe(AuthFailureAction.Replay);
  });
});

describe('auth — enable / 元信息', () => {
  it('[auth.const.AuthFailureAction] 公开动作同时可作为值和类型使用', () => {
    const action: AuthFailureAction = AuthFailureAction.Refresh;
    expect(action).toBe('refresh');
  });
});

describe('$pathnameOf — 取 URL 的 pathname', () => {
  it('[auth.fn.$pathnameOf] 相对路径原样；去掉查询串与 hash', () => {
    expect($pathnameOf('/me')).toBe('/me');
    expect($pathnameOf('/me?x=1')).toBe('/me');
    expect($pathnameOf('/me#top')).toBe('/me');
    expect($pathnameOf('/a/b?x=/y#z')).toBe('/a/b');
  });
  it('[auth.fn.$pathnameOf] 绝对 URL 去掉 scheme://host(:port)；协议相对 URL 同理', () => {
    expect($pathnameOf('https://x.com/me')).toBe('/me');
    expect($pathnameOf('http://x.com:8080/a/b?q=1')).toBe('/a/b');
    expect($pathnameOf('//cdn.x.com/f.js')).toBe('/f.js');
  });
  it('[auth.fn.$pathnameOf] 结果为空 → "/"', () => {
    expect($pathnameOf('')).toBe('/');
    expect($pathnameOf('https://x.com')).toBe('/');
    expect($pathnameOf('https://x.com?x=1')).toBe('/');
    expect($pathnameOf('?x=1')).toBe('/');
  });
});

describe('auth — URLPattern 原生与回退路径', () => {
    it('[auth.fn.$compileUrlPatterns][auth.opt.urlPattern] 仅排除列表默认放行其他路径，空模式忽略', () => {
        vi.stubGlobal('URLPattern', undefined);
        const match = $compileUrlPatterns(['', '!/public/*']);
        expect(match('/public/a')).toBe(false);
        expect(match('/private/a')).toBe(true);
        expect($compileUrlPatterns([''])('/')).toBe(false);
    });
    it('[auth.fn.$compileUrlPatterns] 原生 URLPattern.test 抛错时返回 false', () => {
        /** 模拟构造成功但匹配时抛错的浏览器实现。 */
        class BrokenPattern {
            /** 模拟原生匹配异常。 */
            test() { throw new Error('test'); }
        }
        vi.stubGlobal('URLPattern', BrokenPattern);
        expect($compileUrlPatterns('/a')('/a')).toBe(false);
    });
    it('[auth.fn.$patternToRegex][auth.fn.$compileUrlPatterns] 原生 URLPattern 构造失败回退正则，转义标点并支持单段参数', () => {
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
    it('[auth.fn.authFailureFactory][auth.fn.authFailureFactory.headerName] 自定义凭证头名可从普通小写头读取', () => {
        expect(authFailureFactory('X-Token')({ accessToken: 't' }, {
            status: 401, config: { headers: { 'x-token': 't' } },
        })).toBe(Action.Refresh);
    });
});
