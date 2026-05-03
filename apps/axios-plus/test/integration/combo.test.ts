// Integration coverage for plugin combinations (v2: post-normalize model).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiResponse, keyPlugin, normalizePlugin, retryPlugin, sharePlugin } from '../../src';
import cachePlugin, { $resetSharedManager } from '../../src/plugins/cache/cache';
import { resetCounter, startHarness, stopHarness, type IntegrationHarness } from './_helpers';


function makeAfterEach(h: () => IntegrationHarness) {
    return () => {
        const names = h().api.plugins().map(p => p.name).reverse();
        for (const name of names) h().api.eject(name);
        $resetSharedManager();
    };
}


describe('combo: normalize + retry + key + cache', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    beforeEach(() => { $resetSharedManager(); });
    afterEach(makeAfterEach(() => h));

    it('first-success request is cached; second call skips server entirely', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), keyPlugin(), retryPlugin({ max: 2, delay: 0 }), cachePlugin({ ttl: 60_000 })]);
        await resetCounter(h.baseURL, 'combo-rkc');
        const cfg = {
            headers: { 'X-Test-Key': 'combo-rkc' },
            cache: true,
            key: 'combo-rkc-key',
        } as any;

        const r1 = await h.ax.get('/seq', cfg);
        expect((r1.data as ApiResponse).success).toBe(true);
        expect(r1.headers['x-hit-count']).toBe('1');

        const r2 = await h.ax.get('/seq', cfg);
        // 缓存命中：$restore 返回 headers:{}，但 _cache=true 标识有
        expect((r2 as any)._cache).toBe(true);
        expect((r2.data as ApiResponse).success).toBe(true);
    });

    it('failed responses are NOT cached (cache skips success=false)', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), keyPlugin(), retryPlugin({ max: 0, delay: 0 }), cachePlugin({ ttl: 60_000 })]);
        await resetCounter(h.baseURL, 'combo-rkc-fail');
        const cfg = {
            headers: { 'X-Test-Key': 'combo-rkc-fail' },
            cache: true,
            key: 'combo-rkc-fail-key',
        } as any;
        const r1 = await h.ax.get('/flaky/status?n=99&code=500', cfg);
        expect((r1.data as ApiResponse).success).toBe(false);

        // 2nd call: cache miss → server hit again
        const r2 = await h.ax.get('/flaky/status?n=99&code=500', cfg);
        expect(r2.headers['x-hit-count']).toBe('2');
    });
});


describe('combo: normalize + retryPlugin (biz error path)', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(makeAfterEach(() => h));

    it('business-error envelope triggers retry via shouldRetry, eventually succeeds', async () => {
        await resetCounter(h.baseURL, 'combo-rn');
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            retryPlugin({
                max: 3,
                delay: 0,
                shouldRetry: (apiResp) => !apiResp.success ? true : null,
            }),
        ]);
        const r = await h.ax.get('/flaky/biz-flaky?n=2', {
            headers: { 'X-Test-Key': 'combo-rn' },
        } as any);
        expect((r.data as ApiResponse).success).toBe(true);
        expect(r.headers['x-hit-count']).toBe('3');
    });
});


describe('combo: normalize + share + retry', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(makeAfterEach(() => h));

    it('share + retry: every caller eventually succeeds despite a transient server error', async () => {
        await resetCounter(h.baseURL, 'combo-rs');
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            sharePlugin({ policy: 'start' }),
            retryPlugin({
                max: 3,
                delay: 0,
                shouldRetry: (apiResp) => !apiResp.success ? true : null,
            }),
            keyPlugin(),
        ]);
        const opts = {
            headers: { 'X-Test-Key': 'combo-rs' },
            key: 'combo-rs-key',
            share: true,
        } as any;
        const results = await Promise.all([
            h.ax.get('/flaky/status?n=1&code=500', opts),
            h.ax.get('/flaky/status?n=1&code=500', opts),
            h.ax.get('/flaky/status?n=1&code=500', opts),
        ]);
        results.forEach(r => expect((r.data as ApiResponse).success).toBe(true));
    });
});
