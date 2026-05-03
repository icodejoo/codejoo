// Integration coverage for the key plugin. We send real HTTP requests and
// snoop the produced `config.key` via a request interceptor installed *after*
// the key plugin (response config preserves the field, so we read it there).

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { keyPlugin, normalizePlugin } from '../../src';
import { startHarness, stopHarness, type IntegrationHarness } from './_helpers';

// Snoop on `response.config.key`, which is set by the key plugin and survives
// the round-trip back to the response interceptor. (Request interceptors run
// LIFO in axios — peeking from a request interceptor would see the user-level
// key field, not the hash the plugin computed.)
function captureKey(h: IntegrationHarness): { keys: string[] } {
    const out = { keys: [] as string[] };
    const id = h.ax.interceptors.response.use((res) => {
        const k = (res.config as any).key as string | undefined;
        if (k !== undefined) out.keys.push(k);
        return res;
    });
    (out as any)._dispose = () => h.ax.interceptors.response.eject(id);
    return out;
}

describe('key plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(() => {
        const names = h.api.plugins().map(p => p.name).reverse();
        for (const name of names) h.api.eject(name);
    });

    it('deterministic key for same request', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), keyPlugin()]);
        const cap = captureKey(h);
        await h.ax.get('/seq', { params: { id: 1 }, key: 'deep' });
        await h.ax.get('/seq', { params: { id: 1 }, key: 'deep' });
        expect(cap.keys.length).toBe(2);
        expect(cap.keys[0]).toBe(cap.keys[1]);
        (cap as any)._dispose();
        h.api.eject('key');
    });

    it('different params → different keys', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), keyPlugin()]);
        const cap = captureKey(h);
        await h.ax.get('/seq', { params: { id: 1 }, key: 'deep' });
        await h.ax.get('/seq', { params: { id: 2 }, key: 'deep' });
        expect(cap.keys.length).toBe(2);
        expect(cap.keys[0]).not.toBe(cap.keys[1]);
        (cap as any)._dispose();
        h.api.eject('key');
    });

    it('fastMode true vs deep: same params produce different hashes', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), keyPlugin()]);
        const cap = captureKey(h);
        // fastMode=true ignores params, so two calls with different params share key.
        await h.ax.get('/seq', { params: { id: 1 }, key: { fastMode: true } });
        await h.ax.get('/seq', { params: { id: 2 }, key: { fastMode: true } });
        expect(cap.keys[0]).toBe(cap.keys[1]);
        // deep keys differ for different params.
        await h.ax.get('/seq', { params: { id: 1 }, key: 'deep' });
        await h.ax.get('/seq', { params: { id: 2 }, key: 'deep' });
        expect(cap.keys[2]).not.toBe(cap.keys[3]);
        (cap as any)._dispose();
        h.api.eject('key');
    });

    it('ignoreKeys retains a key with empty value in the hash', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), keyPlugin()]);
        const cap = captureKey(h);
        // With ignoreKeys=['token'], an empty `token` field still contributes.
        await h.ax.get('/seq', { params: { token: '' }, key: { fastMode: false, ignoreKeys: ['token'] } });
        await h.ax.get('/seq', { params: {}, key: { fastMode: false, ignoreKeys: ['token'] } });
        expect(cap.keys[0]).not.toBe(cap.keys[1]);
        (cap as any)._dispose();
        h.api.eject('key');
    });

    it('ignoreValues retains specific values', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), keyPlugin()]);
        const cap = captureKey(h);
        await h.ax.get('/seq', {
            params: { tier: null },
            key: { fastMode: false, ignoreValues: [null] },
        });
        await h.ax.get('/seq', {
            params: {},
            key: { fastMode: false, ignoreValues: [null] },
        });
        expect(cap.keys[0]).not.toBe(cap.keys[1]);
        (cap as any)._dispose();
        h.api.eject('key');
    });
});
