// Integration coverage for the rethrow plugin.
//
// 核心契约：
//   - apiResp.success === true  → 永远 resolve（rethrow 完全不动它）
//   - apiResp.success === false → 默认 reject；可由 config.rethrow:false / shouldRethrow 豁免

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiResponse, ERR_CODES, normalizePlugin, rethrowPlugin } from '../../src';
import { startHarness, stopHarness, type IntegrationHarness } from './_helpers';

describe('rethrow plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(() => {
        const names = h.api.plugins().map(p => p.name).reverse();
        for (const name of names) h.api.eject(name);
    });

    it('未装 normalize ⇒ install 抛错', () => {
        expect(() => h.api.use([rethrowPlugin()])).toThrow(/requires "normalize"/);
    });

    // ── 契约：success=true 永远 resolve ──

    it('success=true ⇒ resolve（默认）', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        const r = await h.ax.get('/pet/42');
        expect(r.data).toBeInstanceOf(ApiResponse);
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('success=true + config.rethrow=true ⇒ 仍 resolve（不允许强制 reject 成功响应）', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        const r = await h.ax.get('/pet/42', { rethrow: true } as any);
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('success=true + shouldRethrow 返回 true ⇒ 仍 resolve（钩子不会被调用）', async () => {
        let called = 0;
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            rethrowPlugin({
                shouldRethrow: () => { called++; return true; },
            }),
        ]);
        const r = await h.ax.get('/pet/42');
        expect((r.data as ApiResponse).success).toBe(true);
        expect(called).toBe(0);   // success=true 时根本不调 shouldRethrow
    });

    // ── 失败路径：默认 reject ──

    it('biz error ⇒ reject ApiResponse', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        await expect(h.ax.get('/flaky/biz-error'))
            .rejects.toSatisfy((apiResp: any) =>
                apiResp instanceof ApiResponse && apiResp.code === 'BIZ_ERR',
            );
    });

    it('HTTP 500 ⇒ reject', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        await expect(h.ax.get('/flaky/status?n=99&code=500', {
            headers: { 'X-Test-Key': 'rethrow-500-' + Date.now() },
        } as any)).rejects.toBeInstanceOf(ApiResponse);
    });

    // ── 失败路径的豁免 ──

    it('请求级 rethrow:false ⇒ 即使 biz 失败也 resolve', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        const r = await h.ax.get('/flaky/biz-error', { rethrow: false } as any);
        expect(r.data).toBeInstanceOf(ApiResponse);
        expect((r.data as ApiResponse).success).toBe(false);
    });

    it('shouldRethrow 钩子返回 false ⇒ 让本次失败也 resolve（如 CANCEL 不当错）', async () => {
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            rethrowPlugin({
                shouldRethrow: (apiResp) => apiResp.code === ERR_CODES.CANCEL ? false : null,
            }),
        ]);
        // BIZ_ERR 不在 CANCEL 豁免列表 ⇒ 仍然 reject
        await expect(h.ax.get('/flaky/biz-error')).rejects.toBeInstanceOf(ApiResponse);
    });

    it('请求级 rethrow:false 优先于 shouldRethrow', async () => {
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            rethrowPlugin({ shouldRethrow: () => true }),    // 钩子说"reject"
        ]);
        // 但请求级豁免最高
        const r = await h.ax.get('/flaky/biz-error', { rethrow: false } as any);
        expect((r.data as ApiResponse).success).toBe(false);
    });

    it('transform 钩子 ⇒ 自定义 reject 值', async () => {
        class HttpError extends Error {
            constructor(public api: ApiResponse) {
                super(api.message ?? 'failed');
            }
        }
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            rethrowPlugin({
                transform: (apiResp) => new HttpError(apiResp),
            }),
        ]);
        await expect(h.ax.get('/flaky/biz-error')).rejects.toBeInstanceOf(HttpError);
    });

    it('plugin enable:false ⇒ 失败也 resolve（插件根本不安装）', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin({ enable: false })]);
        const r = await h.ax.get('/flaky/biz-error');
        expect((r.data as ApiResponse).success).toBe(false);
    });
});
