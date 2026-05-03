// Integration coverage for the filter plugin. /echo bounces back the request
// it actually saw, so we can assert against the stripped params/data.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filterPlugin } from '../../src';
import { startHarness, stopHarness, type IntegrationHarness } from './_helpers';

describe('filter plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });

    it('strips empty fields from params', async () => {
        h.api.use([filterPlugin()]);
        const r = await h.ax.get('/echo', {
            params: { keep: 'yes', drop1: '', drop2: null, drop3: undefined, blank: '   ' },
            filter: true,
        });
        const echoed = r.data.data.query;
        expect(echoed).toEqual({ keep: 'yes' });
        h.api.eject('filter');
    });

    it('strips empty fields from JSON body', async () => {
        h.api.use([filterPlugin()]);
        const r = await h.ax.post('/echo', {
            keep: 'yes', drop1: '', drop2: null, blank: '   ',
        }, { filter: true });
        const echoed = r.data.data.body;
        expect(echoed).toEqual({ keep: 'yes' });
        h.api.eject('filter');
    });

    it('ignoreKeys preserves named keys', async () => {
        h.api.use([filterPlugin({ ignoreKeys: ['token'] })]);
        const r = await h.ax.get('/echo', {
            params: { keep: 'yes', token: '', drop: null },
            filter: true,
        });
        const echoed = r.data.data.query;
        expect(echoed).toEqual({ keep: 'yes', token: '' });
        h.api.eject('filter');
    });

    it('ignoreValues preserves matching values', async () => {
        // null is normally dropped; ignoreValues:[null] keeps it.
        h.api.use([filterPlugin({ ignoreValues: [null] })]);
        const r = await h.ax.post('/echo', {
            keep: 'yes', explicit: null, blank: '',
        }, { filter: true });
        const echoed = r.data.data.body;
        expect(echoed).toEqual({ keep: 'yes', explicit: null });
        h.api.eject('filter');
    });

    it('per-request filter: false bypasses filtering', async () => {
        h.api.use([filterPlugin()]);
        const r = await h.ax.post('/echo', {
            keep: 'yes', drop: null,
        }, { filter: false });
        const echoed = r.data.data.body;
        expect(echoed).toEqual({ keep: 'yes', drop: null });
        h.api.eject('filter');
    });
});
