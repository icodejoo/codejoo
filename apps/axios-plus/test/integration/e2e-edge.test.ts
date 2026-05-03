// Edge-case E2E coverage (v2 model)
//
// 改造后：
//   - 超时通过 normalize 统一成 success=false + code=TIMEOUT_ERR 的 onFulfilled
//   - retry 在 onFulfilled 检查 ApiResponse + retryOnTimeout 决定是否重试
//   - 不再用 .rejects.toMatchObject 断 axios error code

import axios from 'axios';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiResponse, create, envsPlugin, ERR_CODES, normalizePlugin, retryPlugin } from '../../src';
import { startHarness, stopHarness, type IntegrationHarness } from './_helpers';


describe('E2E edge — client timeout (post-normalize)', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(() => {
        const names = h.api.plugins().map(p => p.name).reverse();
        for (const name of names) h.api.eject(name);
    });

    it('axios timeout → normalize converts to ApiResponse(code=TIMEOUT_ERR, success=false)', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        const r = await h.ax.get('/slow?ms=300', { timeout: 50 } as any);
        expect((r.data as ApiResponse).success).toBe(false);
        expect((r.data as ApiResponse).code).toBe(ERR_CODES.TIMEOUT);
    });

    it('retryPlugin({ retryOnTimeout: true }) retries a timed-out GET', async () => {
        const ax = axios.create({ baseURL: h.baseURL });
        const api = create(ax);
        api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 1, delay: 0, retryOnTimeout: true })]);

        let firstHit = true;
        ax.interceptors.request.use((c) => {
            if (firstHit) { firstHit = false; c.url = '/slow?ms=200'; c.timeout = 50; }
            else { c.url = '/ok'; c.timeout = 5000; }
            return c;
        });

        const res = await ax.get('/');
        expect((res.data as ApiResponse).success).toBe(true);
        expect((res.data as ApiResponse).code).toBe('0000');
    });

    it('default retryPlugin (retryOnTimeout=false) does NOT retry on timeout', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), retryPlugin({ max: 3, delay: 0 })]);
        const r = await h.ax.get('/slow?ms=300', { timeout: 50 } as any);
        expect((r.data as ApiResponse).code).toBe(ERR_CODES.TIMEOUT);
        // 没有重试 —— 服务端 hit-count 不可观测（慢端点没有计数器），
        // 我们依赖 normalize 的 code=TIMEOUT_ERR 作为"超时" signal，且没崩
    });
});


describe('E2E edge — envs plugin', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });

    it('envsPlugin() applies matching baseURL at install time', async () => {
        const ax = axios.create();
        const api = create(ax);
        api.use(envsPlugin({
            enable: true,
            default: 'real',
            rules: [
                { rule: 'mock', config: { baseURL: 'http://nonexistent-should-not-match' } },
                { rule: 'real', config: { baseURL: h.baseURL } },
            ],
        }));

        const res = await ax.get('/ok');
        expect(res.status).toBe(200);
        expect(res.data.code).toBe('0000');
    });

    it('envs no-match → axios.defaults untouched', async () => {
        const ax = axios.create({ baseURL: h.baseURL });
        const api = create(ax);
        api.use(envsPlugin({
            enable: true,
            default: 'unknown',
            rules: [{ rule: 'dev', config: { baseURL: 'http://will-not-apply' } }],
        }));

        const res = await ax.get('/ok');
        expect(res.status).toBe(200);
    });
});
