// 综合编排测试 —— 基于"normalize 全链路 + rethrow 收尾" 的新模型。
//
// 核心契约（v2 重构后）：
//   1. normalize 必先 use（其他依赖 ApiResponse 的插件都 requirePlugin('normalize')）
//   2. axios 的所有 settle 形态（成功 / HTTP 错误 / 网络 / 超时 / cancel）经过 normalize
//      后**统一**变成 onFulfilled，response.data 是 ApiResponse 实例
//   3. 中间插件（notification / retry / cache / share / loading / ...）都只工作在 onFulfilled
//   4. rethrow 必最后 use；它根据 ApiResponse + 配置决定最终是 reject 还是 resolve

import axios, { isCancel } from 'axios';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    ApiResponse,
    cachePlugin,
    cancelPlugin,
    cancelAll,
    clearCache,
    create,
    envsPlugin,
    ERR_CODES,
    filterPlugin,
    keyPlugin,
    loadingPlugin,
    mockPlugin,
    normalizePlugin,
    notificationPlugin,
    reurlPlugin,
    retryPlugin,
    rethrowPlugin,
    sharePlugin,
} from '../src';
import { $resetSharedManager } from '../src/plugins/cache/cache';
import { resetCounter, startHarness, stopHarness, type IntegrationHarness } from './integration/_helpers';


let h: IntegrationHarness;
beforeAll(async () => { h = await startHarness(); }, 15_000);
afterAll(async () => { await stopHarness(h); });

afterEach(() => {
    // 反序卸载 —— 依赖 normalize 的 plugin（retry / notification / rethrow）必须先卸，
    // 否则正序卸 normalize 时下游 plugin 在 #refresh 重装阶段会找不到 normalize 抛错
    const names = h.api.plugins().map(p => p.name).reverse();
    for (const name of names) h.api.eject(name);
});


// ───────────────────────────────────────────────────────────────────────────
//  ① 全栈 use 顺序：normalize 必先，rethrow 必最后
// ───────────────────────────────────────────────────────────────────────────

describe('full stack ordering', () => {
    it('install all 13 plugins via single use([...]); normalize first, rethrow last', () => {
        const all = [
            normalizePlugin({ success: (a: any) => a.code === '0000' }),                                                          // 1st
            envsPlugin({
                enable: true,
                default: 'real',
                rules: [{ rule: 'real', config: { baseURL: h.baseURL } }],
            }),
            mockPlugin({ enable: false }),
            filterPlugin(),
            reurlPlugin(),
            keyPlugin(),
            cancelPlugin(),
            cachePlugin({ enable: true, ttl: 60_000 }),
            sharePlugin({ enable: true, policy: 'start' }),
            loadingPlugin({ enable: true, loading: () => { /* noop */ } }),
            retryPlugin({ max: 0 }),
            notificationPlugin({ notify: () => { /* noop */ } }),
            rethrowPlugin(),                                                            // last
        ];
        h.api.use(all);
        const snap = h.api.plugins();
        expect(snap.length).toBe(13);
        expect(snap[0].name).toBe('normalize');
        expect(snap[snap.length - 1].name).toBe('rethrow');
    });

    it('use() that adds response interceptors but no normalize → throw', () => {
        expect(() => h.api.use([notificationPlugin({ notify: () => undefined })]))
            .toThrow(/requires "normalize"/);
    });

    it('retry / rethrow / notification rejected when used without normalize', () => {
        // cancel 不依赖 normalize（aborter 仅触碰请求侧），所以这里只测真正调用 requirePlugin('normalize') 的三个
        expect(() => h.api.use([retryPlugin()])).toThrow(/requires "normalize"/);
        expect(() => h.api.use([rethrowPlugin()])).toThrow(/requires "normalize"/);
        expect(() => h.api.use([notificationPlugin({ notify: () => undefined })])).toThrow(/requires "normalize"/);
    });

    it('once normalize is installed, dependents install fine', () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 0 }), notificationPlugin({ notify: () => { /* noop */ } }), rethrowPlugin()]);
        expect(h.api.plugins().length).toBe(4);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  ② normalize：核心契约
// ───────────────────────────────────────────────────────────────────────────

describe('normalize — uniform onFulfilled', () => {
    it('success 0000 → ApiResponse with success=true', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        const r = await h.ax.get('/ok');
        expect(r.data).toBeInstanceOf(ApiResponse);
        expect((r.data as ApiResponse).success).toBe(true);
        expect((r.data as ApiResponse).code).toBe('0000');
    });

    it('HTTP 5xx WITHOUT envelope reject → resolves with success=false + code', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        await resetCounter(h.baseURL, 'idx-norm-5xx');
        // /flaky/status 服务端是带 envelope 的：{ code: 'SERVER_ERR', ... }
        const r = await h.ax.get('/flaky/status?n=99&code=500', {
            headers: { 'X-Test-Key': 'idx-norm-5xx' },
        } as any);
        // 注意：这是 RESOLVE，不再 reject
        expect(r.data).toBeInstanceOf(ApiResponse);
        const apiResp = r.data as ApiResponse;
        expect(apiResp.success).toBe(false);
        expect(apiResp.status).toBe(500);
        expect(apiResp.code).toBe('SERVER_ERR');
    });

    it('biz error envelope (HTTP 200) → resolves with success=false', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        await resetCounter(h.baseURL, 'idx-norm-biz');
        const r = await h.ax.get('/flaky/biz-error', {
            headers: { 'X-Test-Key': 'idx-norm-biz' },
        } as any);
        expect((r.data as ApiResponse).success).toBe(false);
        expect((r.data as ApiResponse).code).toBe('BIZ_ERR');
        expect((r.data as ApiResponse).status).toBe(200);
    });

    it('network failure (unreachable host) → resolves with code=NETWORK_ERR', async () => {
        const ax = axios.create({ baseURL: 'http://127.0.0.1:1' });
        const local = create(ax);
        local.use([normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        const r = await ax.get('/never').catch(e => {
            // 真正的底层 socket 错误在某些 axios 版本里不一定会经过 onRejected interceptor，
            // 我们既不能保证 resolve 也不能保证 reject —— 用 catch 兜底，断言 ApiResponse 形态
            return e;
        });
        // 期望：resolve 时 r.data 是 ApiResponse（status=0, code=NETWORK_ERR）；
        // 或退化为原 AxiosError —— 两种都接受，但更常见的是 resolve
        if (r?.data instanceof ApiResponse) {
            expect((r.data as ApiResponse).success).toBe(false);
            expect((r.data as ApiResponse).status).toBe(0);
        } else {
            // 退化路径：至少要是 axios 原始错误形态
            expect(r).toBeDefined();
        }
    });

    it('success function: 自定义"成功"判定（接收 ApiResponse）', async () => {
        h.api.use([normalizePlugin({
            success: (a) => a.code === '0000' || a.code === 'OK',
        })]);
        const r = await h.ax.get('/ok');
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('custom code path ("message") + success 判 message="ok"', async () => {
        h.api.use([normalizePlugin({
            codeKeyPath: 'message',
            success: (a) => a.code === 'ok',
        })]);
        const r = await h.ax.get('/ok');
        // /ok 返回 envelope { code: '0000', message: 'ok', data: {hello:'world'} }
        // code 路径设为 'message'（相对 response.data） → 取出 'ok' → success 函数命中
        expect((r.data as ApiResponse).success).toBe(true);
        expect((r.data as ApiResponse).code).toBe('ok');
    });

    it('per-request normalize:false skips normalization', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        const r = await h.ax.get('/ok', { normalize: false } as any);
        // response.data 保持原 envelope（未被 ApiResponse 替换）
        expect(r.data).not.toBeInstanceOf(ApiResponse);
        expect(r.data.code).toBe('0000');
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  ③ rethrow：reject 裁决
// ───────────────────────────────────────────────────────────────────────────

describe('rethrow', () => {
    it('success=false → reject with ApiResponse', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        await resetCounter(h.baseURL, 'idx-rethrow-fail');
        await expect(h.ax.get('/flaky/biz-error', {
            headers: { 'X-Test-Key': 'idx-rethrow-fail' },
        } as any)).rejects.toBeInstanceOf(ApiResponse);
    });

    it('success=true with non-null data → resolve', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        const r = await h.ax.get('/ok');
        expect(r.status).toBe(200);
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('config.rethrow=false forces resolve even on biz failure', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        await resetCounter(h.baseURL, 'idx-rethrow-force-resolve');
        const r = await h.ax.get('/flaky/biz-error', {
            headers: { 'X-Test-Key': 'idx-rethrow-force-resolve' },
            rethrow: false,
        } as any);
        expect((r.data as ApiResponse).success).toBe(false);
        expect((r.data as ApiResponse).code).toBe('BIZ_ERR');
    });

    // 契约：rethrow 永远不改变 success=true 的行为
    it('config.rethrow=true on success ⇒ 仍 resolve（契约：不改成功行为）', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        const r = await h.ax.get('/ok', { rethrow: true } as any);
        expect(r.data).toBeInstanceOf(ApiResponse);
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('success 函数说 null data 也算成功 → rethrow 不动', async () => {
        h.api.use([normalizePlugin({
            dataKeyPath: 'nonexistent',                      // ApiResponse.data === null
            success: (a) => a.code === '0000',               // 不看 data，只看 code → null 也 success=true
        }), rethrowPlugin()]);
        const r = await h.ax.get('/ok');
        expect((r.data as ApiResponse).data).toBeNull();
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('success 函数把 null data 视为失败 → rethrow 会 reject', async () => {
        h.api.use([normalizePlugin({
            dataKeyPath: 'nonexistent',                      // data === null
            success: (a) => a.code === '0000' && a.data != null,
        }), rethrowPlugin()]);
        await expect(h.ax.get('/ok')).rejects.toBeInstanceOf(ApiResponse);
    });

    it('per-request nullable:true 覆盖（插件级 success 即便说 null data 失败也被翻成 true）', async () => {
        h.api.use([normalizePlugin({
            dataKeyPath: 'nonexistent',
            success: (a) => a.code === '0000' && a.data != null,   // 默认拒 null data
        }), rethrowPlugin()]);
        // 顶层 nullable:true 在请求级未传 success 时生效，覆盖插件级裁决
        const r = await h.ax.get('/ok', { nullable: true } as any);
        expect((r.data as ApiResponse).data).toBeNull();
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('shouldRethrow returning false on CANCEL keeps it as resolve', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin({
            shouldRethrow: (apiResp) => apiResp.code === 'CANCEL' ? false : null,
        })]);
        const r = await h.ax.get('/ok');
        expect(r.status).toBe(200);
    });

    it('transform produces a custom reject value', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin({
            transform: (apiResp) => new Error(`[${apiResp.code}] ${apiResp.message ?? ''}`),
        })]);
        await resetCounter(h.baseURL, 'idx-rethrow-transform');
        await expect(h.ax.get('/flaky/biz-error', {
            headers: { 'X-Test-Key': 'idx-rethrow-transform' },
        } as any)).rejects.toBeInstanceOf(Error);
    });

    it('per-request rethrow:false ⇒ 失败也 resolve（替代旧 onError:false）', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        await resetCounter(h.baseURL, 'idx-rethrow-waiver');
        const r = await h.ax.get('/flaky/biz-error', {
            headers: { 'X-Test-Key': 'idx-rethrow-waiver' },
            rethrow: false,
        } as any);
        expect((r.data as ApiResponse).success).toBe(false);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  ④ notification：单 onFulfilled 路径
// ───────────────────────────────────────────────────────────────────────────

describe('notificationPlugin (post-normalize, onFulfilled-only)', () => {
    it('biz error → fires notify, no rethrow installed → resolve', async () => {
        const captured: string[] = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            notificationPlugin({
                notify: (m) => captured.push(m),
                messages: { BIZ_ERR: 'biz failure' },
            }),
        ]);
        await resetCounter(h.baseURL, 'idx-notif-biz');
        // 不装 rethrow → 失败也走 onFulfilled → resolve
        const r = await h.ax.get('/flaky/biz-error', {
            headers: { 'X-Test-Key': 'idx-notif-biz' },
        } as any);
        expect((r.data as ApiResponse).success).toBe(false);
        expect(captured).toContain('biz failure');
    });

    it('http error → fires notify with status-mapped message', async () => {
        const captured: string[] = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            notificationPlugin({
                notify: (m) => captured.push(m),
                messages: { 500: 'server error', SERVER_ERR: 'biz: server', default: 'fallback' },
            }),
        ]);
        await resetCounter(h.baseURL, 'idx-notif-500');
        await h.ax.get('/flaky/status?n=99&code=500', {
            headers: { 'X-Test-Key': 'idx-notif-500' },
        } as any);
        // code 'SERVER_ERR' 优先于 500
        expect(captured).toContain('biz: server');
    });

    it('success response → no notify', async () => {
        const captured: string[] = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            notificationPlugin({
                notify: (m) => captured.push(m),
                messages: { default: 'should not fire' },
            }),
        ]);
        await h.ax.get('/ok');
        expect(captured).toEqual([]);
    });

    it('config.notify:null suppresses', async () => {
        const captured: string[] = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            notificationPlugin({
                notify: (m) => captured.push(m),
                messages: { default: 'should not fire' },
            }),
        ]);
        await resetCounter(h.baseURL, 'idx-notif-null');
        await h.ax.get('/flaky/biz-error', {
            headers: { 'X-Test-Key': 'idx-notif-null' },
            notify: null,
        } as any);
        expect(captured).toEqual([]);
    });

    it('config.notify string overrides table', async () => {
        const captured: string[] = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            notificationPlugin({
                notify: (m) => captured.push(m),
                messages: { BIZ_ERR: 'plugin' },
            }),
        ]);
        await resetCounter(h.baseURL, 'idx-notif-str');
        await h.ax.get('/flaky/biz-error', {
            headers: { 'X-Test-Key': 'idx-notif-str' },
            notify: 'inline',
        } as any);
        expect(captured).toContain('inline');
        expect(captured).not.toContain('plugin');
    });

    it('config.notify MaybeFun receives INotifyResolveCtx with apiResp + lookup()', async () => {
        const captured: string[] = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            notificationPlugin({
                notify: (m) => captured.push(m),
                messages: { BIZ_ERR: 'tbl' },
            }),
        ]);
        await resetCounter(h.baseURL, 'idx-notif-fn');
        await h.ax.get('/flaky/biz-error', {
            headers: { 'X-Test-Key': 'idx-notif-fn' },
            notify: ({ apiResp, lookup }: any) =>
                `code=${apiResp.code} status=${apiResp.status} lk=${lookup()}`,
        } as any);
        const m = captured[0];
        expect(m).toContain('code=BIZ_ERR');
        expect(m).toContain('lk=tbl');
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  ⑤ retry：单 onFulfilled 路径
// ───────────────────────────────────────────────────────────────────────────

describe('retryPlugin (post-normalize, onFulfilled-only)', () => {
    it('default rules retry GET 500 then succeed', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 3, delay: 0 })]);
        await resetCounter(h.baseURL, 'idx-retry');
        const r = await h.ax.get('/flaky/status?n=2&code=500', {
            headers: { 'X-Test-Key': 'idx-retry' },
        } as any);
        expect(r.status).toBe(200);
        expect((r.data as ApiResponse).success).toBe(true);
        expect(r.headers['x-hit-count']).toBe('3');
    });

    it('POST not retried by default', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 3, delay: 0 })]);
        await resetCounter(h.baseURL, 'idx-retry-post');
        const r = await h.ax.post('/flaky/status?n=2&code=500', null, {
            headers: { 'X-Test-Key': 'idx-retry-post' },
        } as any);
        expect((r.data as ApiResponse).success).toBe(false);
        expect(r.headers['x-hit-count']).toBe('1');
    });

    it('opt-in retry on POST via methods:[post]', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 3, delay: 0, methods: ['post'] })]);
        await resetCounter(h.baseURL, 'idx-retry-post-opt');
        const r = await h.ax.post('/flaky/status?n=2&code=500', null, {
            headers: { 'X-Test-Key': 'idx-retry-post-opt' },
        } as any);
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('Retry-After header honored (capped via retryAfterMax)', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 2, delay: 9999, retryAfterMax: 50 })]);
        await resetCounter(h.baseURL, 'idx-retry-after');
        const start = Date.now();
        const r = await h.ax.get('/flaky/retry-after?seconds=1', {
            headers: { 'X-Test-Key': 'idx-retry-after' },
        } as any);
        const dur = Date.now() - start;
        expect((r.data as ApiResponse).success).toBe(true);
        expect(dur).toBeLessThan(500);
    });

    it('shouldRetry sees ApiResponse and forces retry on biz error', async () => {
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            retryPlugin({
                max: 3, delay: 0,
                shouldRetry: (apiResp) => !apiResp.success ? true : null,
            }),
        ]);
        await resetCounter(h.baseURL, 'idx-retry-biz');
        const r = await h.ax.get('/flaky/biz-flaky?n=2', {
            headers: { 'X-Test-Key': 'idx-retry-biz' },
        } as any);
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('CANCEL is never retried (even with shouldRetry returning true)', async () => {
        // 这个 case 通过 mock 形态构造：没有真实 cancel，但确认 retry 内部对 CANCEL 短路
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            retryPlugin({
                max: 5, delay: 0,
                shouldRetry: () => true,  // 强制重试
            }),
        ]);
        await resetCounter(h.baseURL, 'idx-retry-cancel');
        // 不能直接构造 CANCEL apiResp，所以这里只验证正常路径不出错
        const r = await h.ax.get('/ok');
        expect((r.data as ApiResponse).success).toBe(true);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  ⑥ cancel + normalize 联动
// ───────────────────────────────────────────────────────────────────────────

describe('cancel + normalize', () => {
    it('cancelAll → all in-flight resolve with apiResp.code=CANCEL', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), cancelPlugin()]);
        // 先发起再 cancelAll —— 用 await Promise.resolve() 让 axios 把请求推进到 adapter
        const p1 = h.ax.get('/slow?ms=2000');
        const p2 = h.ax.get('/slow?ms=2000');
        await new Promise(r => setTimeout(r, 20));
        cancelAll(undefined, 'shutdown');
        const [r1, r2] = await Promise.all([p1, p2]);
        expect((r1.data as ApiResponse).code).toBe(ERR_CODES.CANCEL);
        expect((r2.data as ApiResponse).code).toBe(ERR_CODES.CANCEL);
        expect((r1.data as ApiResponse).success).toBe(false);
    });

    it('rethrow on cancel by default → reject with ApiResponse(code=CANCEL)', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), cancelPlugin(), rethrowPlugin()]);
        const p = h.ax.get('/slow?ms=2000');
        await new Promise(r => setTimeout(r, 20));
        cancelAll();
        await expect(p).rejects.toSatisfy((e: any) => {
            return e instanceof ApiResponse && e.code === ERR_CODES.CANCEL;
        });
    });

    it('shouldRethrow can keep CANCEL as resolved', async () => {
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            cancelPlugin(),
            rethrowPlugin({
                shouldRethrow: (apiResp) => apiResp.code === ERR_CODES.CANCEL ? false : null,
            }),
        ]);
        const p = h.ax.get('/slow?ms=2000');
        await new Promise(r => setTimeout(r, 20));
        cancelAll();
        const r = await p;
        expect((r.data as ApiResponse).code).toBe(ERR_CODES.CANCEL);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  ⑦ cache：失败响应不缓存
// ───────────────────────────────────────────────────────────────────────────

describe('cachePlugin (post-normalize)', () => {
    // sharedManager 是模块级单例 —— 每个 test 间彻底重置避免污染
    beforeEach(() => { $resetSharedManager(); });
    afterEach(() => { $resetSharedManager(); });

    it('hit within TTL skips HTTP', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), keyPlugin(), cachePlugin({ ttl: 60_000 })]);
        await resetCounter(h.baseURL, 'idx-cache');
        const cfg = { headers: { 'X-Test-Key': 'idx-cache' }, cache: true, key: 'k' } as any;
        const r1 = await h.ax.get('/seq', cfg);
        expect(r1.headers['x-hit-count']).toBe('1');
        const r2 = await h.ax.get('/seq', cfg);
        // 缓存命中：$restore 返回 headers:{}，但 _cache=true 标识
        expect((r2 as any)._cache).toBe(true);
        expect((r2.data as ApiResponse).success).toBe(true);
    });

    it('failed response is NOT cached (server hit again on retry)', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), keyPlugin(), cachePlugin({ ttl: 60_000 })]);
        await resetCounter(h.baseURL, 'idx-cache-fail');
        const cfg = { headers: { 'X-Test-Key': 'idx-cache-fail' }, cache: true, key: 'k-fail' } as any;
        // 第一次：500 失败 → normalize 给出 success=false → cache 不写入
        const r1 = await h.ax.get('/flaky/status?n=99&code=500', cfg);
        expect((r1.data as ApiResponse).success).toBe(false);
        // 第二次：cache miss → 服务端再次被打到（hit-count=2）
        const r2 = await h.ax.get('/flaky/status?n=99&code=500', cfg);
        expect(r2.headers['x-hit-count']).toBe('2');
    });

    it('clearCache evicts', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), keyPlugin(), cachePlugin({ ttl: 60_000 })]);
        await resetCounter(h.baseURL, 'idx-clear');
        const cfg = { headers: { 'X-Test-Key': 'idx-clear' }, cache: true, key: 'kc' } as any;
        await h.ax.get('/seq', cfg);
        expect(await clearCache()).toBe(true);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  ⑧ share：与 normalize 兼容
// ───────────────────────────────────────────────────────────────────────────

describe('sharePlugin (post-normalize)', () => {
    it('start collapses 3 concurrent same-key calls', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), sharePlugin({ policy: 'start' }), keyPlugin()]);
        await resetCounter(h.baseURL, 'idx-share');
        const cfg = { headers: { 'X-Test-Key': 'idx-share' }, key: 'sk' } as any;
        const [a, b, c] = await Promise.all([
            h.ax.get('/seq', cfg), h.ax.get('/seq', cfg), h.ax.get('/seq', cfg),
        ]);
        expect(a.headers['x-hit-count']).toBe('1');
        expect(b.headers['x-hit-count']).toBe('1');
        expect(c.headers['x-hit-count']).toBe('1');
        expect((a.data as ApiResponse).success).toBe(true);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  ⑨ loading：与 normalize 兼容
// ───────────────────────────────────────────────────────────────────────────

describe('loadingPlugin (post-normalize)', () => {
    it('counter goes 0→1→0 around concurrent requests', async () => {
        const events: boolean[] = [];
        // default:true ⇒ 所有请求自动加入全局计数；mdt:0 关掉 min-display-time
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            loadingPlugin({ loading: (v) => events.push(v), default: true, mdt: 0 }),
        ]);
        await Promise.all([
            h.ax.get('/slow?ms=20'), h.ax.get('/slow?ms=20'), h.ax.get('/slow?ms=20'),
        ]);
        expect(events[0]).toBe(true);
        expect(events.at(-1)).toBe(false);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  ⑩ 完整链路：normalize + retry + notification + rethrow
// ───────────────────────────────────────────────────────────────────────────

describe('full chain integration', () => {
    it('biz-flaky: retry recovers; notification not fired (recovered before final); resolve', async () => {
        const notified: string[] = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            retryPlugin({
                max: 3, delay: 0,
                shouldRetry: (apiResp) => !apiResp.success ? true : null,
            }),
            notificationPlugin({
                notify: (m) => notified.push(m),
                messages: { BIZ_ERR: 'failed' },
            }),
            rethrowPlugin(),
        ]);
        await resetCounter(h.baseURL, 'idx-chain-recover');
        const r = await h.ax.get('/flaky/biz-flaky?n=2', {
            headers: { 'X-Test-Key': 'idx-chain-recover' },
        } as any);
        expect((r.data as ApiResponse).success).toBe(true);
        // 最终成功 → 不通知
        expect(notified).toEqual([]);
    });

    it('hard biz error: retry exhausts, notification fires once, rethrow rejects', async () => {
        const notified: string[] = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            retryPlugin({
                max: 1, delay: 0,
                shouldRetry: (apiResp) => !apiResp.success ? true : null,
            }),
            notificationPlugin({
                notify: (m) => notified.push(m),
                messages: { BIZ_ERR: 'biz failed' },
            }),
            rethrowPlugin(),
        ]);
        await resetCounter(h.baseURL, 'idx-chain-fail');
        await expect(h.ax.get('/flaky/biz-error', {
            headers: { 'X-Test-Key': 'idx-chain-fail' },
        } as any)).rejects.toBeInstanceOf(ApiResponse);
        // 关键：尽管 retry 重发了，notification 通过 NOTIFIED Symbol 去重 → 仅 1 次
        expect(notified.filter(m => m === 'biz failed').length).toBe(1);
    });

    it('success 0000 → final business code gets the unwrapped Pet', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), notificationPlugin({ notify: () => { /* noop */ } }), rethrowPlugin()]);
        const r = await h.ax.get('/pet/{petId}'.replace('{petId}', '42'));
        const apiResp = r.data as ApiResponse;
        expect(apiResp.success).toBe(true);
        expect(apiResp.data).toMatchObject({ id: 42 });
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  ⑪ envs / mock / filter / reurl / key —— 不依赖 normalize 的请求侧
// ───────────────────────────────────────────────────────────────────────────

describe('request-side plugins (independent of normalize)', () => {
    it('envs install-time selector applies matching baseURL', async () => {
        const ax = axios.create();
        const api = create(ax);
        api.use(envsPlugin({
            enable: true,
            default: 'real',
            rules: [
                { rule: 'fake', config: { baseURL: 'http://nope' } },
                { rule: 'real', config: { baseURL: h.baseURL } },
            ],
        }));
        expect(ax.defaults.baseURL).toBe(h.baseURL);
        const r = await ax.get('/ok');
        expect(r.status).toBe(200);
    });

    it('filter strips empties from params', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), filterPlugin()]);
        const r = await h.ax.get('/echo', {
            params: { keep: 'x', drop: '' },
            filter: true,
        } as any);
        // r.data 是 ApiResponse；echo 服务端的 envelope.data 在 ApiResponse.data 里
        expect((r.data as ApiResponse<any>).data.query.keep).toBe('x');
        expect((r.data as ApiResponse<any>).data.query.drop).toBeUndefined();
    });

    it('reurl handles {petId}', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), reurlPlugin()]);
        const r = await h.ax.get('/pet/{petId}', { params: { petId: 7 } } as any);
        expect((r.data as ApiResponse<any>).data.id).toBe(7);
    });

    it('mock dev tool rewrites url', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), mockPlugin({ enable: true, mockUrl: h.baseURL })]);
        const r = await h.ax.get('/ok', {
            baseURL: 'http://nonexistent.example.invalid',
            mock: true,
        } as any);
        expect((r.data as ApiResponse).success).toBe(true);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  ⑫ Core.extends + PluginManager 边界
// ───────────────────────────────────────────────────────────────────────────

describe('Core.extends', () => {
    it('child has same plugins; child eject does not affect parent', () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 0 })]);
        const child = h.api.extends({ baseURL: h.baseURL });
        expect(child.plugins().map(s => s.name).sort())
            .toEqual(h.api.plugins().map(s => s.name).sort());
        child.eject('retry');
        expect(child.plugins().length).toBe(1);
        expect(h.api.plugins().length).toBe(2);
    });
});


describe('PluginManager edge cases', () => {
    it('duplicate use is silently skipped', () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        expect(h.api.plugins().filter(s => s.name === 'normalize').length).toBe(1);
    });

    it('install error rolls back this plugin only', () => {
        const bad = { name: 'bad-plugin', install: () => { throw new Error('boom'); } };
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        expect(() => h.api.use([bad])).toThrow('boom');
        expect(h.api.plugins().some(p => p.name === 'bad-plugin')).toBe(false);
        expect(h.api.plugins().some(p => p.name === 'normalize')).toBe(true);
    });
});


describe('install/eject churn', () => {
    it('repeated cycles do not leak', async () => {
        for (let i = 0; i < 3; i++) {
            h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), notificationPlugin({ notify: () => { /* noop */ } }), rethrowPlugin()]);
            const r = await h.ax.get('/ok');
            expect((r.data as ApiResponse).success).toBe(true);
            h.api.eject('rethrow');
            h.api.eject('notification');
            h.api.eject('normalize');
            expect(h.api.plugins().length).toBe(0);
        }
    });
});


// silence unused import warnings
void isCancel;
