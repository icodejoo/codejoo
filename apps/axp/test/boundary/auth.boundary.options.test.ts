import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import auth, { DEFAULT_ON_AUTH_FAILURE, authFailureFactory, AuthFailureAction as Action } from '../../src/plugins/auth';
import { makeTM, authHeader } from '../helpers/auth';

/** 构造 adapter：始终 200，并记录每次请求的 URL 和 Authorization 头。 */
function okAdapter() {
  const seen: Array<{ url?: string; auth?: string }> = [];
  const adapter = vi.fn(async (config: any) => {
    seen.push({ url: config.url, auth: authHeader(config) });
    return { status: 200, statusText: '', data: { code: 0 }, config, headers: {} };
  });
  return { adapter, seen };
}

/** 构造 adapter：始终返回指定状态（非 2xx 走 axios 拒绝，带 response）。 */
function statusAdapter(status: number) {
  return vi.fn(async (config: any) => {
    const response = { status, statusText: '', data: { code: 'X' }, config, headers: {} };
    const err: any = new Error('http ' + status);
    err.isAxiosError = true; err.config = config; err.response = response;
    throw err;
  });
}

/** 缺省回调集合。 */
const base = () => ({ onRefresh: vi.fn(() => true), onAccessExpired: vi.fn(), onAccessDenied: vi.fn() });

describe('auth — enable / tokenManager 边界', () => {
  it('[auth.opt.enable] enable:false 时无 token 的请求也直通、不触发任何回调；enable:undefined 视为开启', async () => {
    const { adapter, seen } = okAdapter();
    const ax = axios.create({ adapter });
    const cb = base();
    expect(auth({ tokenManager: makeTM(), enable: false, ...cb }).install(ax)).toBeUndefined();
    await ax.get('/me');
    expect(seen[0].auth).toBeUndefined();
    expect(cb.onAccessDenied).not.toHaveBeenCalled();

    const ax2 = axios.create({ adapter });
    const cb2 = base();
    auth({ tokenManager: makeTM(), enable: undefined, ...cb2 }).install(ax2);
    await expect(ax2.get('/me')).rejects.toThrow(/access denied/);
    expect(cb2.onAccessDenied).toHaveBeenCalledOnce();
  });

  it('[auth.opt.tokenManager] tokenManager 为 undefined/null → 创建插件即抛错', () => {
    expect(() => auth({ tokenManager: undefined as any, ...base() })).toThrow(/tokenManager/);
    expect(() => auth({ tokenManager: null as any, ...base() })).toThrow(/tokenManager/);
  });

  it('[auth.opt.tokenManager.accessToken] accessToken 为空串/undefined → 视为未登录：拒绝请求并走 onAccessDenied，不发出', async () => {
    for (const token of ['', undefined]) {
      const { adapter } = okAdapter();
      const ax = axios.create({ adapter });
      const cb = base();
      const tm: any = { canRefresh: true, accessToken: token, refreshToken: undefined, set() { }, clear() { } };
      auth({ tokenManager: tm, ...cb }).install(ax);
      await expect(ax.get('/me')).rejects.toThrow(/access denied/);
      expect(adapter).not.toHaveBeenCalled();
      expect(cb.onAccessDenied).toHaveBeenCalledOnce();
    }
  });

  it('[auth.opt.tokenManager.refreshToken] refreshToken 为 undefined → onRefresh 照常收到 tm，可返回 false 判过期', async () => {
    const ax = axios.create({ adapter: statusAdapter(401) });
    const tm = makeTM('a'); // refreshToken 缺省 undefined
    const seen: unknown[] = [];
    const cb = base();
    auth({ tokenManager: tm, ...cb, onRefresh: (m) => { seen.push(m.refreshToken); return false; } }).install(ax);
    await expect(ax.get('/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(seen).toEqual([undefined]);
    expect(cb.onAccessExpired).toHaveBeenCalledOnce();
    expect(tm.accessToken).toBeUndefined();
  });

  it('[auth.cb.tokenManager.set] onRefresh 内 tm.set 抛错 → 视为刷新失败：过期、原错误透传，不死锁，后续请求按未登录处理', async () => {
    const ax = axios.create({ adapter: statusAdapter(401) });
    const tm = makeTM('a');
    tm.set = () => { throw new Error('storage full'); };
    const cb = base();
    auth({ tokenManager: tm, ...cb, onRefresh: (m) => { m.set('n', 'r'); return true; } }).install(ax);
    vi.spyOn(console, 'error').mockImplementation(() => { });
    await expect(ax.get('/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(cb.onAccessExpired).toHaveBeenCalledOnce();
    await expect(ax.get('/me')).rejects.toThrow(/access denied|refresh failed/);
    vi.restoreAllMocks();
  });

  it('[auth.cb.tokenManager.set] set(undefined) 视同登出：下一次受保护请求被拒绝', async () => {
    const { adapter } = okAdapter();
    const ax = axios.create({ adapter });
    const tm = makeTM('a');
    const cb = base();
    auth({ tokenManager: tm, ...cb }).install(ax);
    await ax.get('/me');
    tm.set(undefined, undefined);
    await expect(ax.get('/me')).rejects.toThrow(/access denied/);
    expect(adapter).toHaveBeenCalledTimes(1);
  });
});

describe('auth — methods / urlPattern 边界', () => {
  /** 对一组 method 发请求，返回哪些带了 Authorization。 */
  async function protectedOf(opts: any, methods = ['get', 'post'], url = '/x') {
    const { adapter, seen } = okAdapter();
    const ax = axios.create({ adapter });
    auth({ tokenManager: makeTM('t'), ...base(), ...opts }).install(ax);
    const out: string[] = [];
    for (const m of methods) {
      const before = seen.length;
      await ax.request({ url, method: m });
      if (seen[before].auth) out.push(m);
    }
    return out;
  }

  it('[auth.opt.methods] 缺省/"*"/含 "*" 的数组 → 全部受保护', async () => {
    expect(await protectedOf({})).toEqual(['get', 'post']);
    expect(await protectedOf({ methods: '*' })).toEqual(['get', 'post']);
    expect(await protectedOf({ methods: ['get', '*'] })).toEqual(['get', 'post']);
  });

  it('[auth.opt.methods] 空数组/空串 → 没有 method 受保护；null 经 ?? 回退为缺省 "*"', async () => {
    expect(await protectedOf({ methods: [] })).toEqual([]);
    expect(await protectedOf({ methods: '' })).toEqual([]);
    expect(await protectedOf({ methods: null })).toEqual(['get', 'post']);
  });

  it('[auth.opt.methods] 大小写不敏感：methods:"POST" 命中 post，不命中 get', async () => {
    expect(await protectedOf({ methods: 'POST' })).toEqual(['post']);
    expect(await protectedOf({ methods: ['Get'] })).toEqual(['get']);
  });

  it('[auth.opt.urlPattern] 空数组/空串项 → 没有 URL 受保护；缺省/null → 全部受保护', async () => {
    expect(await protectedOf({ urlPattern: [] }, ['get'])).toEqual([]);
    expect(await protectedOf({ urlPattern: [''] }, ['get'])).toEqual([]);
    expect(await protectedOf({ urlPattern: null }, ['get'])).toEqual(['get']);
    expect(await protectedOf({ urlPattern: undefined }, ['get'])).toEqual(['get']);
  });

  it('[auth.opt.urlPattern] 仅否定模式 → 其余全部受保护，被否定路径放行；绝对 URL 与查询串按 pathname 匹配', async () => {
    expect(await protectedOf({ urlPattern: ['!/public/*'] }, ['get'], '/public/a')).toEqual([]);
    expect(await protectedOf({ urlPattern: ['!/public/*'] }, ['get'], '/private/a')).toEqual(['get']);
    expect(await protectedOf({ urlPattern: ['!/public/*'] }, ['get'], 'https://h.com/public/a?x=1')).toEqual([]);
  });

  it('[auth.opt.urlPattern] 非字符串项被忽略，不让插件崩', async () => {
    expect(await protectedOf({ urlPattern: [123 as any, '/x'] }, ['get'], '/x')).toEqual(['get']);
    expect(await protectedOf({ urlPattern: [123 as any, '/x'] }, ['get'], '/y')).toEqual([]);
  });
});

describe('auth — 回调抛错与 accessDeniedCode 边界', () => {
  it('[auth.cb.onAccessDenied] onAccessDenied 同步抛错/返回 rejected Promise → 吞掉回调错误，请求仍以 access denied 拒绝', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => { });
    for (const onAccessDenied of [() => { throw new Error('cb1'); }, () => Promise.reject(new Error('cb2'))]) {
      const { adapter } = okAdapter();
      const ax = axios.create({ adapter });
      auth({ tokenManager: makeTM(), ...base(), onAccessDenied }).install(ax);
      await expect(ax.get('/me')).rejects.toThrow(/access denied/);
      expect(adapter).not.toHaveBeenCalled();
    }
    vi.restoreAllMocks();
  });

  it('[auth.cb.onAccessDenied] 有 token 的正常请求不触发 onAccessDenied', async () => {
    const { adapter } = okAdapter();
    const ax = axios.create({ adapter });
    const cb = base();
    auth({ tokenManager: makeTM('t'), ...cb }).install(ax);
    await ax.get('/me');
    expect(cb.onAccessDenied).not.toHaveBeenCalled();
  });

  it('[auth.opt.accessDeniedCode] 空串 → 原样用作 code（不回退默认）；undefined → 默认 ACCESS_DENIED', async () => {
    const codes: unknown[] = [];
    for (const accessDeniedCode of ['', undefined]) {
      const ax = axios.create({ adapter: okAdapter().adapter });
      auth({
        tokenManager: makeTM(), accessDeniedCode, ...base(),
        onAccessDenied: (_t, r) => { codes.push((r.data as any).code); },
      }).install(ax);
      await expect(ax.get('/me')).rejects.toThrow(/access denied/);
    }
    expect(codes).toEqual(['', 'ACCESS_DENIED']);
  });
});

describe('auth — AuthFailureAction 路由边界', () => {
  /** 以固定 onFailure 返回值装插件，请求返回指定状态。 */
  function route(action: unknown, status = 401) {
    const ax = axios.create({ adapter: statusAdapter(status) });
    const cb = base();
    const tm = makeTM('a');
    auth({ tokenManager: tm, ...cb, onFailure: () => action as any }).install(ax);
    return { ax, cb, tm };
  }

  it('[auth.const.AuthFailureAction][auth.const.AuthFailureAction.Others] onFailure 返回 null/undefined/未知值 → 当 Others：原错误透传，不刷新不登出', async () => {
    for (const action of [null, undefined, 'nope', 0]) {
      const { ax, cb, tm } = route(action);
      await expect(ax.get('/me')).rejects.toMatchObject({ response: { status: 401 } });
      expect(cb.onRefresh).not.toHaveBeenCalled();
      expect(cb.onAccessExpired).not.toHaveBeenCalled();
      expect(tm.accessToken).toBe('Bearer a');
    }
  });

  it('[auth.const.AuthFailureAction.Deny] Deny 且未配置 onAccessDenied → 回退调用 onAccessExpired，但不清 token', async () => {
    const onAccessExpired = vi.fn();
    const ax = axios.create({ adapter: statusAdapter(403) });
    const tm = makeTM('a');
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired, onFailure: () => Action.Deny }).install(ax);
    await expect(ax.get('/me')).rejects.toMatchObject({ response: { status: 403 } });
    expect(onAccessExpired).toHaveBeenCalledOnce();
    expect(tm.accessToken).toBe('Bearer a');
  });

  it('[auth.const.AuthFailureAction.Expired] 连续多个 Expired 失败 → 清 token、onAccessExpired 只通知一次', async () => {
    const { ax, cb, tm } = route(Action.Expired);
    await Promise.allSettled([ax.get('/a'), ax.get('/b'), ax.get('/c')]);
    expect(cb.onAccessExpired).toHaveBeenCalledOnce();
    expect(tm.accessToken).toBeUndefined();
    expect(tm.canRefresh).toBe(false);
  });

  it('[auth.const.AuthFailureAction.Refresh] Refresh 但 canRefresh=false → 不调 onRefresh，直接判过期', async () => {
    const { ax, cb, tm } = route(Action.Refresh);
    tm.canRefresh = false;
    await expect(ax.get('/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(cb.onRefresh).not.toHaveBeenCalled();
    expect(cb.onAccessExpired).toHaveBeenCalledOnce();
  });
});

describe('auth — authFailureFactory 边界', () => {
  const tm = { accessToken: 'Bearer cur' };

  it('[auth.fn.authFailureFactory][auth.const.AuthFailureAction.Others] 状态码 0/NaN/负数/非数字 → Others', () => {
    for (const status of [0, NaN, -1, undefined as any, '401' as any]) {
      expect(authFailureFactory()(tm, { status })).toBe(Action.Others);
    }
  });

  it('[auth.fn.authFailureFactory][auth.const.AuthFailureAction.Replay] resp.config 缺失 / headers 缺失 / 头值为空串或非字符串 → 当未携带，Replay', () => {
    const f = authFailureFactory();
    expect(f(tm, { status: 401 })).toBe(Action.Replay);
    expect(f(tm, { status: 401, config: {} })).toBe(Action.Replay);
    expect(f(tm, { status: 401, config: { headers: null } })).toBe(Action.Replay);
    expect(f(tm, { status: 401, config: { headers: { Authorization: '' } } })).toBe(Action.Replay);
    expect(f(tm, { status: 401, config: { headers: { Authorization: 123 } } })).toBe(Action.Replay);
  });

  it('[auth.fn.authFailureFactory][auth.const.AuthFailureAction.Expired][auth.const.AuthFailureAction.Deny] tm.accessToken 为空串 → 视为无 token（401 Expired / 403 Deny）', () => {
    const f = authFailureFactory();
    expect(f({ accessToken: '' }, { status: 401 })).toBe(Action.Expired);
    expect(f({ accessToken: '' }, { status: 403 })).toBe(Action.Deny);
  });

  it('[auth.fn.authFailureFactory.headerName] headerName 自定义大小写/空串：精确名优先、小写兜底；空串名取不到值 → Replay', () => {
    const f = authFailureFactory('X-Auth');
    expect(f(tm, { status: 401, config: { headers: { 'X-Auth': 'Bearer cur' } } })).toBe(Action.Refresh);
    expect(f(tm, { status: 401, config: { headers: { 'x-auth': 'Bearer cur' } } })).toBe(Action.Refresh);
    expect(f(tm, { status: 401, config: { headers: { Authorization: 'Bearer cur' } } })).toBe(Action.Replay);
    expect(authFailureFactory('')(tm, { status: 401, config: { headers: { Authorization: 'Bearer cur' } } })).toBe(Action.Replay);
  });

  it('[auth.const.DEFAULT_ON_AUTH_FAILURE] 默认单例无状态：连续用不同 tm 判定互不影响', () => {
    const a = DEFAULT_ON_AUTH_FAILURE({ accessToken: 'A' }, { status: 401, config: { headers: { Authorization: 'A' } } });
    const b = DEFAULT_ON_AUTH_FAILURE({ accessToken: undefined }, { status: 401 });
    const c = DEFAULT_ON_AUTH_FAILURE({ accessToken: 'A' }, { status: 401, config: { headers: { Authorization: 'A' } } });
    expect([a, b, c]).toEqual([Action.Refresh, Action.Expired, Action.Refresh]);
  });
});

describe('auth — install / cleanup 边界', () => {
  it('[auth.method.install] 同一实例重复 install 不抛错；Authorization 取同一 tm 的 token', async () => {
    const { adapter, seen } = okAdapter();
    const ax = axios.create({ adapter });
    const opts = { tokenManager: makeTM('t'), ...base() };
    auth(opts).install(ax);
    auth(opts).install(ax);
    await ax.get('/me');
    expect(seen[0].auth).toBe('Bearer t');
  });

  it('[auth.method.cleanup] 重复 cleanup 不抛错', () => {
    const ax = axios.create({ adapter: okAdapter().adapter });
    const off = auth({ tokenManager: makeTM('t'), ...base() }).install(ax) as () => void;
    off();
    expect(() => off()).not.toThrow();
  });
});
