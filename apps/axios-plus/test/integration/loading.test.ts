// Integration coverage for the loading plugin. We track 0→1 / 1→0 transitions
// while concurrent calls are in-flight against /slow.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadingPlugin } from '../../src';
import { startHarness, stopHarness, type IntegrationHarness } from './_helpers';

describe('loading plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });

    it('counter goes 0→1 on first request, stays at 1 during 2nd-Nth, returns to 0 on settle', async () => {
        const calls: boolean[] = [];
        h.api.use([loadingPlugin({ default: true, mdt: 0, loading: (v) => calls.push(v) })]);
        // Three concurrent calls.
        const promises = [
            h.ax.get('/slow?ms=80'),
            h.ax.get('/slow?ms=80'),
            h.ax.get('/slow?ms=80'),
        ];
        await Promise.all(promises);
        // We expect exactly one 'true' (count 0→1) and one 'false' (count 1→0).
        expect(calls).toEqual([true, false]);
        h.api.eject('loading');
    });

    it('subsequent batch starts from 0 again', async () => {
        const calls: boolean[] = [];
        h.api.use([loadingPlugin({ default: true, mdt: 0, loading: (v) => calls.push(v) })]);
        await Promise.all([h.ax.get('/ok'), h.ax.get('/ok')]);
        await Promise.all([h.ax.get('/ok'), h.ax.get('/ok')]);
        // Two batches × (true, false)
        expect(calls).toEqual([true, false, true, false]);
        h.api.eject('loading');
    });

    it('config.loading: false skips counting that request', async () => {
        const calls: boolean[] = [];
        h.api.use([loadingPlugin({ default: true, mdt: 0, loading: (v) => calls.push(v) })]);
        // First call participates; second opts out → still single batch lifecycle.
        await Promise.all([
            h.ax.get('/ok'),
            h.ax.get('/ok', { loading: false }),
        ]);
        expect(calls).toEqual([true, false]);
        h.api.eject('loading');
    });

    it('per-request loading function overrides plugin default', async () => {
        const baseCalls: boolean[] = [];
        const reqCalls: boolean[] = [];
        h.api.use([loadingPlugin({ default: true, mdt: 0, loading: (v) => baseCalls.push(v) })]);
        await h.ax.get('/ok', { loading: (v) => reqCalls.push(v) });
        expect(reqCalls).toEqual([true, false]);
        expect(baseCalls).toEqual([]);
        h.api.eject('loading');
    });
});
