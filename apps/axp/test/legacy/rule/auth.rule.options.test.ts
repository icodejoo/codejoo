import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import auth, { ACCESS_DENIED_CODE, DEFAULT_ON_AUTH_FAILURE, authFailureFactory, AuthFailureAction as Action, $normalize } from '../../../src/plugins/auth';
import { makeTM, authHeader } from '../../helpers/auth';

/** 构造 adapter：Authorization 等于 ok 时 200，否则 401；并记录每次发出的头。 */
function makeAdapter(ok: string) {
  const seen: Array<string | undefined> = [];
  const adapter = vi.fn(async (config: any) => {
    const h = authHeader(config);
    seen.push(h);
    const status = h === ok ? 200 : 401;
    const response = { status, statusText: '', data: { code: status === 200 ? 0 : 'EXPIRED' }, config, headers: {} };
    if (status === 200) return response;
    const err: any = new Error('http ' + status);
    err.isAxiosError = true; err.config = config; err.response = response;
    throw err;
  });
  return { adapter, seen };
}

describe('auth — 插件契约（install / cleanup）', () => {
  it('[auth.method.install] install 注册请求与响应拦截器并返回 cleanup 函数', () => {
    const ax = axios.create({ adapter: vi.fn() as any });
    const reqUse = vi.spyOn(ax.interceptors.request, 'use');
    const resUse = vi.spyOn(ax.interceptors.response, 'use');
    const off = auth({ tokenManager: makeTM('t'), onRefresh: () => true, onAccessExpired: () => { } }).install(ax);
    expect(reqUse).toHaveBeenCalledOnce();
    expect(resUse).toHaveBeenCalledOnce();
    expect(typeof off).toBe('function');
  });

  it('[auth.method.cleanup] cleanup 后拦截器被撤销：请求不再注入 Authorization，也不再走 401 路由', async () => {
    const { adapter, seen } = makeAdapter('Bearer t');
    const ax = axios.create({ adapter });
    const onRefresh = vi.fn(() => true);
    const off = auth({ tokenManager: makeTM('t'), onRefresh, onAccessExpired: () => { } }).install(ax) as () => void;
    await ax.get('/me');
    expect(seen).toEqual(['Bearer t']);
    off();
    await expect(ax.get('/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(seen).toEqual(['Bearer t', undefined]);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('auth — tokenManager 读写', () => {
  it('[auth.opt.tokenManager.accessToken] 受保护请求带的 Authorization 取自 tm.accessToken（含 Bearer 前缀），token 变更后下一次请求带新值', async () => {
    const { adapter, seen } = makeAdapter('Bearer b');
    const ax = axios.create({ adapter });
    const tm = makeTM('a');
    auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: () => { } }).install(ax);
    await expect(ax.get('/me')).rejects.toBeDefined(); // a 不被认可 → 401（onRefresh 不换 token，重放后兜底过期）
    tm.set('b');
    tm.canRefresh = true;
    await ax.get('/me');
    expect(seen[seen.length - 1]).toBe('Bearer b');
  });

  it('[auth.opt.tokenManager.refreshToken][auth.cb.tokenManager.set] onRefresh 读 tm.refreshToken，用 tm.set 写入新 access/refresh，重放带新 token', async () => {
    const { adapter, seen } = makeAdapter('Bearer new');
    const ax = axios.create({ adapter });
    const tm = makeTM();
    tm.set('old', 'r1');
    const readRefresh = vi.fn();
    auth({
      tokenManager: tm,
      onRefresh: (m) => { readRefresh(m.refreshToken); m.set('new', 'r2'); return true; },
      onAccessExpired: () => { },
    }).install(ax);
    const res = await ax.get('/me');
    expect(res.status).toBe(200);
    expect(readRefresh).toHaveBeenCalledWith('r1');
    expect(tm.refreshToken).toBe('r2');
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
  });
});

describe('auth — accessDeniedCode / 默认常量', () => {
  it('[auth.const.ACCESS_DENIED_CODE] 常量值为 ACCESS_DENIED', () => {
    expect(ACCESS_DENIED_CODE).toBe('ACCESS_DENIED');
  });

  it('[auth.opt.accessDeniedCode][auth.const.ACCESS_DENIED_CODE] 无 token 时合成响应的 data.code：缺省为 ACCESS_DENIED，可自定义', async () => {
    const codes: unknown[] = [];
    for (const accessDeniedCode of [undefined, 'NO_LOGIN']) {
      const ax = axios.create({ adapter: vi.fn() as any });
      auth({
        tokenManager: makeTM(), accessDeniedCode, onRefresh: () => true, onAccessExpired: () => { },
        onAccessDenied: (_tm, resp) => { codes.push((resp.data as any).code); },
      }).install(ax);
      await expect(ax.get('/me')).rejects.toThrow(/access denied/);
    }
    expect(codes).toEqual([ACCESS_DENIED_CODE, 'NO_LOGIN']);
  });

  it('[auth.const.DEFAULT_ON_AUTH_FAILURE] 等价于 authFailureFactory() 且是未传 onFailure 时的默认路由', () => {
    const tm = { accessToken: 'Bearer x' };
    const same = { status: 401, config: { headers: { Authorization: 'Bearer x' } } };
    const stale = { status: 401, config: { headers: { Authorization: 'Bearer y' } } };
    expect(DEFAULT_ON_AUTH_FAILURE(tm, same)).toBe(Action.Refresh);
    expect(DEFAULT_ON_AUTH_FAILURE(tm, stale)).toBe(Action.Replay);
    expect(DEFAULT_ON_AUTH_FAILURE(tm, same)).toBe(authFailureFactory()(tm, same));
    const cfg = $normalize({ tokenManager: makeTM(), onRefresh: () => true, onAccessExpired: () => { } });
    expect(cfg.onFailure).toBe(DEFAULT_ON_AUTH_FAILURE);
  });
});
