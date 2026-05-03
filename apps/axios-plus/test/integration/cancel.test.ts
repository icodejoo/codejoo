// Integration coverage for the cancel plugin (v2: post-normalize model).
//   - 全链路归一化后，cancel 不再 reject 原 CanceledError，而是被 normalize 转成
//     resolved response，data 是 ApiResponse(code='CANCEL', success=false, status=0)。
//   - 业务侧用 `apiResp.code === 'CANCEL'`（或 `ERR_CODES.CANCEL`）判定取消。

import axios from 'axios';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiResponse, cancelPlugin, cancelAll, ERR_CODES, normalizePlugin } from '../../src';
import { startHarness, stopHarness, type IntegrationHarness } from './_helpers';


describe('cancel plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(() => {
        // 反序卸载，确保下一个 test 有空白状态
        const names = h.api.plugins().map(p => p.name).reverse();
        for (const name of names) h.api.eject(name);
    });

    it('cancelAll aborts all in-flight requests; results normalized to code=CANCEL', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), cancelPlugin()]);
        const p1 = h.ax.get('/slow?ms=2000');
        const p2 = h.ax.get('/slow?ms=2000');
        await Promise.resolve();
        const n = cancelAll(undefined, 'shutdown');
        expect(n).toBe(2);
        const [r1, r2] = await Promise.all([p1, p2]);
        expect((r1.data as ApiResponse).code).toBe(ERR_CODES.CANCEL);
        expect((r2.data as ApiResponse).code).toBe(ERR_CODES.CANCEL);
        expect((r1.data as ApiResponse).success).toBe(false);
    });

    it('user-provided signal is respected (no double-inject); cancel still normalized', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), cancelPlugin()]);
        const ctrl = new AbortController();
        const p = h.ax.get('/slow?ms=2000', { signal: ctrl.signal });
        // cancelAll() should NOT abort this request (cancel plugin skips it).
        const cancelled = cancelAll(undefined, 'should-not-abort-this');
        expect(cancelled).toBe(0);
        ctrl.abort();
        const r = await p;
        // 用户自己 abort，依然被 normalize 归一化为 CANCEL
        expect((r.data as ApiResponse).code).toBe(ERR_CODES.CANCEL);
    });

    it('settled requests are removed from active set', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), cancelPlugin()]);
        await h.ax.get('/ok');
        expect(cancelAll()).toBe(0);
    });
});


void axios;
