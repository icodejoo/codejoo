// Integration coverage for the retry plugin (v2: post-normalizePlugin, no-reject model).
//
// 改造后的核心契约：
//   - retry 必须在 normalize 之后 use（依赖 ApiResponse）
//   - retry 仅在 onFulfilled 工作；axios 的所有错误经 normalize 转化为 success=false 的 response
//   - 测试用 h.ax.get(...).then(r => r.data.success) 的方式断言；不再 .rejects 形态
//   - 加上 rethrow 才会真正 reject —— 单独的 rethrow 集成测试覆盖那部分

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiResponse, isRetry, normalizePlugin, RETRY_KEY, retryPlugin, rethrowPlugin } from '../../src';
import { startHarness, stopHarness, resetCounter, type IntegrationHarness } from './_helpers';


describe('retry plugin — integration (post-normalize)', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(() => {
        const names = h.api.plugins().map(p => p.name).reverse();
        for (const name of names) h.api.eject(name);
    });

    it('countdown 3 → 2 → 1 → 0 against a 500-then-OK endpoint', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 3, delay: 0 })]);
        await resetCounter(h.baseURL, 'count-3');
        const res = await h.ax.get('/flaky/status?n=2&code=500', {
            headers: { 'X-Test-Key': 'count-3' },
        } as any);
        expect((res.data as ApiResponse).success).toBe(true);
        expect(res.headers['x-hit-count']).toBe('3');
        expect(res.config[RETRY_KEY]).toBeUndefined();
    });

    it('idempotent default: GET retries automatically on 500', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 2, delay: 0 })]);
        await resetCounter(h.baseURL, 'idem-get');
        const res = await h.ax.get('/flaky/status?n=1&code=500', {
            headers: { 'X-Test-Key': 'idem-get' },
        } as any);
        expect(res.headers['x-hit-count']).toBe('2');
    });

    it('POST not retried by default — server seen once, ApiResponse.success=false', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 3, delay: 0 })]);
        await resetCounter(h.baseURL, 'post-default');
        const res = await h.ax.post('/flaky/status?n=10&code=500', null, {
            headers: { 'X-Test-Key': 'post-default' },
        } as any);
        expect((res.data as ApiResponse).success).toBe(false);
        expect(res.headers['x-hit-count']).toBe('1');
    });

    it('POST opt-in via methods: ["post"] — POST 500 now retries', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 3, delay: 0, methods: ['post'] })]);
        await resetCounter(h.baseURL, 'post-optin');
        const res = await h.ax.post('/flaky/status?n=2&code=500', null, {
            headers: { 'X-Test-Key': 'post-optin' },
        } as any);
        expect((res.data as ApiResponse).success).toBe(true);
        expect(res.headers['x-hit-count']).toBe('3');
    });

    it('500 → success: retry succeeds', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 1, delay: 0 })]);
        await resetCounter(h.baseURL, 'r500');
        const res = await h.ax.get('/flaky/status?n=1&code=500', {
            headers: { 'X-Test-Key': 'r500' },
        } as any);
        expect((res.data as ApiResponse).success).toBe(true);
        expect(res.headers['x-hit-count']).toBe('2');
    });

    it('401 not retried (default status whitelist)', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 3, delay: 0 })]);
        await resetCounter(h.baseURL, 'r401');
        const res = await h.ax.get('/flaky/status?n=5&code=401', {
            headers: { 'X-Test-Key': 'r401' },
        } as any);
        expect((res.data as ApiResponse).success).toBe(false);
        expect((res.data as ApiResponse).status).toBe(401);
        expect(res.headers['x-hit-count']).toBe('1');
    });

    it('Retry-After honored against /flaky/retry-after (capped to 50ms)', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 1, retryAfterMax: 50, delay: 0 })]);
        await resetCounter(h.baseURL, 'ra');
        const start = Date.now();
        const res = await h.ax.get('/flaky/retry-after?seconds=1', {
            headers: { 'X-Test-Key': 'ra' },
        } as any);
        const elapsed = Date.now() - start;
        expect((res.data as ApiResponse).success).toBe(true);
        expect(elapsed).toBeLessThan(800);
    });

    it('shouldRetry returns true → forces POST retry', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({
            max: 2,
            delay: 0,
            shouldRetry: (apiResp) => !apiResp.success ? true : null,
        })]);
        await resetCounter(h.baseURL, 'forced-post');
        const res = await h.ax.post('/flaky/status?n=2&code=500', null, {
            headers: { 'X-Test-Key': 'forced-post' },
        } as any);
        expect(res.headers['x-hit-count']).toBe('3');
    });

    it('shouldRetry returns false → blocks default retry', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 5, delay: 0, shouldRetry: () => false })]);
        await resetCounter(h.baseURL, 'blocked');
        const res = await h.ax.get('/flaky/status?n=10&code=500', {
            headers: { 'X-Test-Key': 'blocked' },
        } as any);
        expect((res.data as ApiResponse).success).toBe(false);
        expect(res.headers['x-hit-count']).toBe('1');
    });

    it('max: -1 with shouldRetry exit (avoid infinite loop)', async () => {
        let attempts = 0;
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({
            max: -1,
            delay: 0,
            shouldRetry: () => { attempts++; return attempts < 4; },
        })]);
        await resetCounter(h.baseURL, 'inf');
        const res = await h.ax.get('/flaky/status?n=100&code=500', {
            headers: { 'X-Test-Key': 'inf' },
        } as any);
        expect((res.data as ApiResponse).success).toBe(false);
        // shouldRetry 在第 4 次返回 false 终止
        expect(attempts).toBe(4);
    });

    it('beforeRetry returning false cancels retry', async () => {
        let beforeCalls = 0;
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({
            max: 5,
            delay: 0,
            beforeRetry: () => { beforeCalls++; return false; },
        })]);
        await resetCounter(h.baseURL, 'before-false');
        const res = await h.ax.get('/flaky/status?n=10&code=500', {
            headers: { 'X-Test-Key': 'before-false' },
        } as any);
        expect((res.data as ApiResponse).success).toBe(false);
        expect(beforeCalls).toBe(1);
    });

    it('CANCEL never retried (apiResp.code=CANCEL is hard-stopped)', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 5, delay: 0, shouldRetry: () => true })]);
        const ctrl = new AbortController();
        const p = h.ax.get('/slow?ms=2000', { signal: ctrl.signal });
        setTimeout(() => ctrl.abort(), 10);
        const res = await p;
        // normalize 把 cancel 转换成 ApiResponse(code=CANCEL)
        expect((res.data as ApiResponse).code).toBe('CANCEL');
        expect((res.data as ApiResponse).success).toBe(false);
    });

    it('isRetry helper reflects retry plugin ownership during retry attempts', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 1, delay: 0 })]);
        await resetCounter(h.baseURL, 'isretry');

        let sawRetry = false;
        const id = h.ax.interceptors.request.use((cfg) => {
            if ((cfg.headers as any)?.['X-Test-Key'] === 'isretry') {
                if (isRetry(cfg)) sawRetry = true;
            }
            return cfg;
        });
        try {
            await h.ax.get('/flaky/status?n=1&code=500', {
                headers: { 'X-Test-Key': 'isretry' },
            } as any);
        } finally {
            h.ax.interceptors.request.eject(id);
        }
        expect(sawRetry).toBe(true);
    });
});


describe('retry plugin — request-level overrides', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(() => {
        const names = h.api.plugins().map(p => p.name).reverse();
        for (const name of names) h.api.eject(name);
    });

    it('config.retry: false disables retry per-request', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 5, delay: 0 })]);
        await resetCounter(h.baseURL, 'per-off');
        const res = await h.ax.get('/flaky/status?n=10&code=500', {
            headers: { 'X-Test-Key': 'per-off' },
            retry: false,
        } as any);
        expect((res.data as ApiResponse).success).toBe(false);
        expect(res.headers['x-hit-count']).toBe('1');
    });

    it('config.retry: number overrides max', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 0, delay: 0 })]);
        await resetCounter(h.baseURL, 'per-num');
        const res = await h.ax.get('/flaky/status?n=1&code=500', {
            headers: { 'X-Test-Key': 'per-num' },
            retry: 2,
        } as any);
        expect((res.data as ApiResponse).success).toBe(true);
        expect(res.headers['x-hit-count']).toBe('2');
    });
});


describe('retry plugin — combined with rethrow', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(() => {
        const names = h.api.plugins().map(p => p.name).reverse();
        for (const name of names) h.api.eject(name);
    });

    it('retry exhausts → rethrow rejects with ApiResponse', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 1, delay: 0 }), rethrowPlugin()]);
        await resetCounter(h.baseURL, 'retry-rethrow');
        await expect(h.ax.get('/flaky/status?n=10&code=500', {
            headers: { 'X-Test-Key': 'retry-rethrow' },
        } as any)).rejects.toBeInstanceOf(ApiResponse);
    });
});
