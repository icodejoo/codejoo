import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import axios, { AxiosError } from 'axios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkResults, evaluateLocal, checkServer, checkClient, checkGeneric } from '../lib/assertions.ts';
import type { Observed, RequestRecord } from '../lib/assertions.ts';
import { classifyError, errorMatches, errorMatchesAny, PARSE_MARK } from '../lib/classify.ts';
import { AUTH_DENIED_MESSAGE, AUTH_REFRESH_FAILED_MESSAGE } from '../lib/constants.ts';
import type { Expectation } from '../lib/types.ts';

/** 造一个带响应的 axios 错误 */
function respErr(status: number, data: unknown = {}): AxiosError {
  const e = new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, { status, data, statusText: '', headers: {}, config: {} as never });
  return e;
}

describe('classifyError：构造各种错误（合成）', () => {
  it('HTTP 状态码 → http:<n>', () => {
    expect(classifyError(respErr(500))).toBe('http:500');
    expect(classifyError(respErr(401))).toBe('http:401');
  });

  it('axp 的 ApiError（normalize 业务失败）：HTTP 2xx 看 code，≥400 看状态', () => {
    const api = (status: number, code: number) => Object.assign(new Error('x'), { name: 'ApiError', response: { status, code } });
    expect(classifyError(api(200, 1001))).toBe('business:1001');
    expect(classifyError(api(200, -5))).toBe('business:-5');
    expect(classifyError(api(500, 5001))).toBe('http:500');
  });

  it('取消 / 超时 / 网络 / 解析', () => {
    expect(classifyError(new axios.CanceledError('canceled'))).toBe('canceled');
    expect(classifyError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('canceled');
    expect(classifyError(new AxiosError('timeout of 800ms exceeded', 'ETIMEDOUT'))).toBe('timeout');
    expect(classifyError(new AxiosError('timeout of 800ms exceeded', 'ECONNABORTED'))).toBe('timeout');
    expect(classifyError(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe('network');
    expect(classifyError(Object.assign(new AxiosError('connect', 'ECONNREFUSED')))).toBe('network');
    expect(classifyError(Object.assign(new AxiosError('fetch failed', 'ERR_NETWORK'), { cause: { code: 'ENOTFOUND' } }))).toBe('network');
    expect(classifyError(new AxiosError('stream has been aborted', 'ERR_BAD_RESPONSE'))).toBe('network');
    expect(classifyError(Object.assign(new AxiosError('bad json', 'ERR_BAD_RESPONSE'), { [PARSE_MARK]: true }))).toBe('parse');
    expect(classifyError(new SyntaxError('Unexpected token'))).toBe('parse');
  });

  it('auth 插件自身抛出的错误与标签优先', () => {
    expect(classifyError(new Error(`${AUTH_DENIED_MESSAGE}`))).toBe('unauthenticated');
    expect(classifyError(new Error(`${AUTH_REFRESH_FAILED_MESSAGE}; aborting request`))).toBe('expired');
    expect(classifyError(respErr(401), { tags: new Set(['expired']) })).toBe('expired');
    expect(classifyError(respErr(403), { tags: new Set(['denied']) })).toBe('denied');
    expect(classifyError(respErr(401), { tags: new Set(['unauthenticated', 'expired']) })).toBe('expired');
  });

  it('认不出来的错误给 unknown:，不会被当成任何已知类别', () => {
    expect(classifyError(new TypeError('weird'))).toMatch(/^unknown:TypeError:weird/);
    expect(classifyError('string error')).toMatch(/^unknown:/);
  });
});

describe('错误类别匹配：status:<n> 随风格', () => {
  it('http 风格匹配 http:n，business 风格匹配 business:n', () => {
    expect(errorMatches('status:500', 'http:500', 'http')).toBe(true);
    expect(errorMatches('status:500', 'business:500', 'http')).toBe(false);
    expect(errorMatches('status:500', 'business:500', 'business')).toBe(true);
    expect(errorMatches('status:500', 'http:500', 'business')).toBe(false);
  });

  it('http:/business: 只匹配自己；any 匹配任何失败；数组任一即可', () => {
    expect(errorMatches('http:404', 'http:404', 'http')).toBe(true);
    expect(errorMatches('business:1001', 'business:1001', 'business')).toBe(true);
    expect(errorMatches('business:1001', 'http:1001', 'http')).toBe(false);
    expect(errorMatches('any', 'timeout', 'http')).toBe(true);
    expect(errorMatchesAny(['network', 'parse'], 'parse', 'http')).toBe(true);
    expect(errorMatchesAny(['network', 'parse'], 'timeout', 'http')).toBe(false);
  });
});

describe('classifyError：真实 axios 错误（http 与 fetch 两种 adapter）', () => {
  let server: http.Server;
  let port: number;
  const sockets = new Set<net.Socket>();
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/hang') return; // 永不响应
      if (req.url === '/close') return void req.socket.destroy();
      if (req.url === '/500') { res.writeHead(500, { 'content-type': 'application/json' }); return void res.end('{"code":500}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"code":0,"data":{}}');
    });
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });

  /** 得到一个只在 closed 端口上的地址（连接被拒） */
  async function closedPort(): Promise<number> {
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const p = (s.address() as AddressInfo).port;
    await new Promise<void>((r) => s.close(() => r()));
    return p;
  }

  for (const adapter of ['http', 'fetch'] as const) {
    describe(`adapter=${adapter}`, () => {
      const call = (url: string, extra: Record<string, unknown> = {}) => axios.get(url, { adapter, ...extra }).then(() => null, (e: unknown) => e);

      it('HTTP 500 → http:500', async () => {
        expect(classifyError(await call(`http://127.0.0.1:${port}/500`))).toBe('http:500');
      });

      it('连接被拒 → network', async () => {
        expect(classifyError(await call(`http://127.0.0.1:${await closedPort()}/x`))).toBe('network');
      });

      it('DNS 失败（.invalid）→ network', async () => {
        expect(classifyError(await call('http://nonexistent.invalid:8080/x', { timeout: 5000 }))).toBe('network');
      });

      it('服务端直接断开连接 → network', async () => {
        expect(classifyError(await call(`http://127.0.0.1:${port}/close`))).toBe('network');
      });

      it('超时 → timeout', async () => {
        expect(classifyError(await call(`http://127.0.0.1:${port}/hang`, { timeout: 150 }))).toBe('timeout');
      });

      it('主动取消 → canceled', async () => {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 100);
        expect(classifyError(await call(`http://127.0.0.1:${port}/hang`, { signal: ctrl.signal }))).toBe('canceled');
      });
    });
  }
});

/** 构造运行事实 */
function observed(records: RequestRecord[], over: Partial<Observed> = {}): Observed {
  return {
    records: new Map(records.map((r) => [r.id, r])),
    order: records.map((r) => r.id),
    events: { loading: [], notify: [], refresh: 0, expired: 0, denied: 0, unauthenticated: 0 },
    pendingAfter: 0,
    durationMs: 100,
    ...over,
  };
}
const ok = (id: string, data?: unknown, extra: Partial<RequestRecord> = {}): RequestRecord => ({ id, style: 'http', ok: true, data, ...extra });
const bad = (id: string, kind: string, style: 'http' | 'business' = 'http'): RequestRecord => ({ id, style, ok: false, kind });

describe('断言引擎', () => {
  it('results：成败、错误类别（含 status:<n> 随风格）、data 子集、hit', () => {
    const exp: Expectation = {
      results: { a: { ok: true, data: { meta: { auth: 'u1' } }, hit: 2 }, b: { ok: false, error: 'status:401' }, c: { ok: false, error: ['network', 'parse'] } },
    };
    const obs = observed([ok('a', { meta: { auth: 'u1', hit: 2 } }), bad('b', 'business:401', 'business'), bad('c', 'parse')]);
    expect(checkResults(exp, obs)).toEqual([]);
    const wrong = observed([ok('a', { meta: { auth: 'u2', hit: 1 } }), bad('b', 'http:401', 'business'), ok('c')]);
    const fails = checkResults(exp, wrong);
    expect(fails.some((f) => f.startsWith('a.data.meta.auth'))).toBe(true);
    expect(fails.some((f) => f.startsWith('a.hit'))).toBe(true);
    expect(fails.some((f) => f.startsWith('b: 期望错误'))).toBe(true);
    expect(fails.some((f) => f.startsWith('c: 期望错误') || f.startsWith('c: 期望失败'))).toBe(true);
  });

  it('请求没发出、ok 与实际相反都会报', () => {
    expect(checkResults({ results: { z: { ok: true } } }, observed([]))[0]).toMatch(/z: 请求没有发出/);
    expect(checkResults({ results: { a: { ok: true } } }, observed([bad('a', 'timeout')]))[0]).toMatch(/期望成功/);
    expect(checkResults({ results: { a: { ok: false } } }, observed([ok('a')]))[0]).toMatch(/期望失败/);
  });

  it('from_cache 由服务端观测推断：true 要求没到达服务器', () => {
    const exp: Expectation = { results: { r1: { from_cache: false }, r2: { from_cache: true } } };
    expect(checkResults(exp, observed([ok('r1', {}, { reached: true }), ok('r2', {}, { reached: false })]))).toEqual([]);
    expect(checkResults(exp, observed([ok('r1', {}, { reached: true }), ok('r2', {}, { reached: true })]))[0]).toMatch(/r2\.from_cache/);
    expect(checkResults(exp, observed([ok('r1'), ok('r2')]))[0]).toMatch(/无法推断/);
  });

  it('order：只看列出的 id 的相对顺序', () => {
    const obs = observed([ok('a'), ok('x'), ok('b')]);
    expect(evaluateLocal({ order: ['a', 'b'] }, obs)).toEqual([]);
    expect(evaluateLocal({ order: ['b', 'a'] }, obs)[0]).toMatch(/order/);
  });

  it('client：loading 精确序列、各事件区间', () => {
    const obs = observed([], { events: { loading: [true, false], notify: ['m'], refresh: 1, expired: 0, denied: 0, unauthenticated: 0 } });
    expect(checkClient({ client: { loading: [true, false], notify: { eq: 1 }, refresh: { max: 1 }, expired: { eq: 0 } } }, obs)).toEqual([]);
    expect(checkClient({ client: { loading: [true] } }, obs)[0]).toMatch(/client\.loading/);
    expect(checkClient({ client: { notify: { eq: 2 } } }, obs)[0]).toMatch(/client\.notify/);
  });

  it('通用断言：pending_after=0、loading 成对，无论是否声明', () => {
    expect(checkGeneric(observed([], { pendingAfter: 1 }))[0]).toMatch(/pending_after=1/);
    expect(checkGeneric(observed([], { events: { loading: [true], notify: [], refresh: 0, expired: 0, denied: 0, unauthenticated: 0 } }))[0]).toMatch(/loading/);
    expect(evaluateLocal({}, observed([]))).toEqual([]);
  });

  it('server：total / by_key / by_path / peak_inflight / aborted', () => {
    const obs = { total: 3, inflight: 0, peak_inflight: 2, by_key: { 'GET /a': 2 }, by_path: { '/a': 2 }, log: [{ aborted: true }] };
    expect(checkServer({ total: { eq: 3 }, by_key: { 'GET /a': { eq: 2 } }, by_path: { '/missing': { eq: 0 } }, peak_inflight: { min: 2 }, aborted: { min: 1 } }, obs)).toEqual([]);
    expect(checkServer({ by_path: { '/a': { eq: 1 } }, aborted: { eq: 0 } }, obs)).toHaveLength(2);
  });
});
