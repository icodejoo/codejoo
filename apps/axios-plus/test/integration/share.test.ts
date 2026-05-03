// Integration coverage for the share plugin.
//
// Strategy: /seq increments a server-side counter. Concurrent calls under
//   - start  → only 1 server hit (subsequent share)
//   - end    → all hit, but only the *last* settle is observed
//   - race   → all hit, fastest wins; we add /slow to introduce a fast/slow gap
//   - none   → all hit, all observed independently

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keyPlugin, sharePlugin } from '../../src';
import { resetCounter, startHarness, stopHarness, type IntegrationHarness } from './_helpers';

describe('share plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });

    it('start: concurrent same-key calls only hit server once', async () => {
        h.api.use([sharePlugin({ policy: 'start' }), keyPlugin()]);
        await resetCounter(h.baseURL, 'share-start');
        const opts = {
            headers: { 'X-Test-Key': 'share-start' },
            key: 'share-start-key',
            share: true,
        };
        const [r1, r2, r3] = await Promise.all([
            h.ax.get('/seq', opts),
            h.ax.get('/seq', opts),
            h.ax.get('/seq', opts),
        ]);
        // All callers see the *same* response (n=1).
        expect(r1.data.data.n).toBe(1);
        expect(r2.data.data.n).toBe(1);
        expect(r3.data.data.n).toBe(1);
        // Confirm via the server counter peek.
        const peek = await h.ax.get('/counter/seq', { headers: { 'X-Test-Key': 'share-start' } });
        expect(peek.data.data.count).toBe(1);
        h.api.eject('share'); h.api.eject('key');
    });

    it('race: multiple HTTPs go out, fastest wins; all callers settle with same value', async () => {
        h.api.use([sharePlugin({ policy: 'race' }), keyPlugin()]);
        await resetCounter(h.baseURL, 'share-race');
        const opts = {
            headers: { 'X-Test-Key': 'share-race' },
            key: 'share-race-key',
            share: 'race' as const,
        };
        // Use slow endpoint so the 3 HTTPs are concurrently in-flight.
        const slowPath = '/slow?ms=50';
        const promises = [
            h.ax.get(slowPath, opts),
            h.ax.get(slowPath, opts),
            h.ax.get(slowPath, opts),
        ];
        const results = await Promise.all(promises);
        // All callers receive the same winning response object (Promise.any-like).
        expect(results[0].data).toEqual(results[1].data);
        expect(results[1].data).toEqual(results[2].data);
        h.api.eject('share'); h.api.eject('key');
    });

    it('end: last in-flight wins; all callers see last result', async () => {
        h.api.use([sharePlugin({ policy: 'end' }), keyPlugin()]);
        await resetCounter(h.baseURL, 'share-end');
        const opts = {
            headers: { 'X-Test-Key': 'share-end' },
            key: 'share-end-key',
            share: 'end' as const,
        };
        const promises = [h.ax.get('/seq', opts), h.ax.get('/seq', opts), h.ax.get('/seq', opts)];
        const results = await Promise.all(promises);
        // All callers see the same response (last settle wins) — and counter == 3.
        expect(results[0].data.data.n).toBe(results[1].data.data.n);
        expect(results[1].data.data.n).toBe(results[2].data.data.n);
        const peek = await h.ax.get('/counter/seq', { headers: { 'X-Test-Key': 'share-end' } });
        expect(peek.data.data.count).toBe(3);
        h.api.eject('share'); h.api.eject('key');
    });

    it('share: false bypasses sharing — every caller hits independently', async () => {
        h.api.use([sharePlugin({ policy: 'start' }), keyPlugin()]);
        await resetCounter(h.baseURL, 'share-off');
        const opts = {
            headers: { 'X-Test-Key': 'share-off' },
            key: 'share-off-key',
            share: false as const,
        };
        const results = await Promise.all([h.ax.get('/seq', opts), h.ax.get('/seq', opts)]);
        // n values differ (1 and 2 — order may vary but both should appear).
        const ns = results.map(r => r.data.data.n).sort();
        expect(ns).toEqual([1, 2]);
        h.api.eject('share'); h.api.eject('key');
    });
});
