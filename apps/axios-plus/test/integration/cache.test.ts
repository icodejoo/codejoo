// Integration coverage for the cache plugin against /seq, which increments a
// counter on every server hit. Cached calls won't bump the counter.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keyPlugin } from '../../src';
import cachePlugin, {
    $resetSharedManager,
    clearCache,
    removeCache,
} from '../../src/plugins/cache/cache';
import { resetCounter, startHarness, stopHarness, type IntegrationHarness } from './_helpers';

describe('cache plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    // sharedManager 是模块级单例 —— 每个 test 之间彻底重置，避免上一个 test 留下的 storage 污染本次
    beforeEach(() => { $resetSharedManager(); });
    afterEach(() => { $resetSharedManager(); });

    it('first call hits server, second within TTL is cached', async () => {
        // key 必须在 cache 之前装：cache.install 会 requirePlugin('key')。
        h.api.use([keyPlugin(), cachePlugin({ ttl: 60_000 })]);
        await resetCounter(h.baseURL, 'cache-1');
        const r1 = await h.ax.get('/seq', { headers: { 'X-Test-Key': 'cache-1' }, cache: true, key: 'cache-1-key' });
        const r2 = await h.ax.get('/seq', { headers: { 'X-Test-Key': 'cache-1' }, cache: true, key: 'cache-1-key' });
        expect(r1.data.data.n).toBe(1);
        expect(r2.data.data.n).toBe(1); // same payload — proves cache HIT
        expect(r1.headers['x-hit-count']).toBe('1');
        // r2 是缓存命中：$restore 返回 headers: {}，没有 server 头
        expect((r2 as any)._cache).toBe(true);
        h.api.eject('cache'); h.api.eject('key');
    });

    it('cache expires → re-hits server', async () => {
        h.api.use([keyPlugin(), cachePlugin({ ttl: 30 })]);
        await resetCounter(h.baseURL, 'cache-ttl');
        const r1 = await h.ax.get('/seq', { headers: { 'X-Test-Key': 'cache-ttl' }, cache: true, key: 'cache-ttl-key' });
        await new Promise(r => setTimeout(r, 60));
        const r2 = await h.ax.get('/seq', { headers: { 'X-Test-Key': 'cache-ttl' }, cache: true, key: 'cache-ttl-key' });
        expect(r1.data.data.n).toBe(1);
        expect(r2.data.data.n).toBe(2);
        h.api.eject('cache'); h.api.eject('key');
    });

    it('removeCache(ax, key) evicts a single entry', async () => {
        h.api.use([keyPlugin(), cachePlugin({ ttl: 60_000 })]);
        await resetCounter(h.baseURL, 'cache-rm');
        await h.ax.get('/seq', { headers: { 'X-Test-Key': 'cache-rm' }, cache: true, key: 'rm-key' });
        const removed = await removeCache('rm-key');
        expect(removed).toBe(true);
        const r2 = await h.ax.get('/seq', { headers: { 'X-Test-Key': 'cache-rm' }, cache: true, key: 'rm-key' });
        expect(r2.data.data.n).toBe(2);
        h.api.eject('cache'); h.api.eject('key');
    });

    it('clearCache(ax) wipes the entire store', async () => {
        h.api.use([keyPlugin(), cachePlugin({ ttl: 60_000 })]);
        await resetCounter(h.baseURL, 'cache-cl-a');
        await resetCounter(h.baseURL, 'cache-cl-b');
        await h.ax.get('/seq', { headers: { 'X-Test-Key': 'cache-cl-a' }, cache: true, key: 'cl-a' });
        await h.ax.get('/seq', { headers: { 'X-Test-Key': 'cache-cl-b' }, cache: true, key: 'cl-b' });
        const cleared = await clearCache();
        expect(cleared).toBe(true);
        const r1 = await h.ax.get('/seq', { headers: { 'X-Test-Key': 'cache-cl-a' }, cache: true, key: 'cl-a' });
        expect(r1.data.data.n).toBe(2);
        h.api.eject('cache'); h.api.eject('key');
    });

    it('cache: false bypasses cache for one request', async () => {
        h.api.use([keyPlugin(), cachePlugin({ ttl: 60_000 })]);
        await resetCounter(h.baseURL, 'cache-skip');
        await h.ax.get('/seq', { headers: { 'X-Test-Key': 'cache-skip' }, cache: true, key: 'skip-key' });
        const r2 = await h.ax.get('/seq', { headers: { 'X-Test-Key': 'cache-skip' }, cache: false, key: 'skip-key' });
        expect(r2.data.data.n).toBe(2);
        h.api.eject('cache'); h.api.eject('key');
    });
});
