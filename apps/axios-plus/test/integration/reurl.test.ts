// Integration coverage for the reurl plugin against /echo, which
// reflects the exact pathname + query the server saw.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reurlPlugin } from '../../src';
import { startHarness, stopHarness, type IntegrationHarness } from './_helpers';

describe('reurl plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });

    it('substitutes {petId} from params and removes it from query', async () => {
        h.api.use([reurlPlugin()]);
        const r = await h.ax.get('/pet/{petId}', {
            params: { petId: 99, extra: 'kept' },
        });
        // The actual hit reaches /pet/99 (replaced) with extra=kept still in query.
        expect(r.data.code).toBe('0000');
        expect(r.data.data.id).toBe(99);
        // petId was consumed; extra survives.
        expect((r.config.params as any).petId).toBeUndefined();
        expect((r.config.params as any).extra).toBe('kept');
        h.api.eject('reurl');
    });

    it('substitutes via the {var} syntax and proves removal via /counter', async () => {
        h.api.use([reurlPlugin()]);
        const r = await h.ax.get('/counter/{name}', {
            params: { name: 'pv-curly' },
            headers: { 'X-Test-Key': 'pv-test' },
        });
        // /counter/pv-curly returned 200 OK envelope.
        expect(r.data.code).toBe('0000');
        expect(r.data.data).toHaveProperty('count');
        // params should no longer carry name (delete in plugin).
        expect((r.config.params as any).name).toBeUndefined();
        h.api.eject('reurl');
    });

    it('substitutes via the [var] syntax', async () => {
        h.api.use([reurlPlugin()]);
        const r = await h.ax.get('/counter/[name]', {
            params: { name: 'pv-bracket' },
            headers: { 'X-Test-Key': 'pv-test' },
        });
        expect(r.data.code).toBe('0000');
        expect((r.config.params as any).name).toBeUndefined();
        h.api.eject('reurl');
    });

    it('substitutes via the :var syntax', async () => {
        h.api.use([reurlPlugin()]);
        const r = await h.ax.get('/counter/:name', {
            params: { name: 'pv-colon' },
            headers: { 'X-Test-Key': 'pv-test' },
        });
        expect(r.data.code).toBe('0000');
        expect((r.config.params as any).name).toBeUndefined();
        h.api.eject('reurl');
    });

    it('removeKey: false leaves the field in params', async () => {
        h.api.use([reurlPlugin({ removeKey: false })]);
        const r = await h.ax.get('/counter/{name}', {
            params: { name: 'pv-keep' },
            headers: { 'X-Test-Key': 'pv-test' },
        });
        expect(r.data.code).toBe('0000');
        expect((r.config.params as any).name).toBe('pv-keep');
        h.api.eject('reurl');
    });
});