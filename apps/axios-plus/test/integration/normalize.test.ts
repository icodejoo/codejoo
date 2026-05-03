// Integration coverage for the normalize plugin (v2: no-reject model).
// 全链路改造后：所有 settle 形态统一在 onFulfilled，response.data 是 ApiResponse。
// 业务/HTTP/网络/超时/cancel 失败 → resolve 而非 reject；rethrow 插件单独负责按需 reject。

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { normalizePlugin, rethrowPlugin, ApiResponse, ERR_CODES } from '../../src';
import { startHarness, stopHarness, type IntegrationHarness } from './_helpers';


describe('normalize plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(() => {
        const names = h.api.plugins().map(p => p.name).reverse();
        for (const name of names) h.api.eject(name);
    });

    it('success envelope → ApiResponse with success=true', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        const r = await h.ax.get('/pet/42');
        expect(r.data).toBeInstanceOf(ApiResponse);
        expect((r.data as ApiResponse).success).toBe(true);
        expect((r.data as ApiResponse).code).toBe('0000');
        expect((r.data as any).data.id).toBe(42);
    });

    it('business-error envelope (code !== "0000") → resolves with success=false', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        const r = await h.ax.get('/flaky/biz-error');
        expect(r.data).toBeInstanceOf(ApiResponse);
        const ar = r.data as ApiResponse;
        expect(ar.success).toBe(false);
        expect(ar.code).toBe('BIZ_ERR');
    });

    it('HTTP 500 → resolves with success=false (carrying envelope code)', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        const r = await h.ax.get('/flaky/status?n=1&code=500', {
            headers: { 'X-Test-Key': 'norm-500' },
        } as any);
        expect(r.data).toBeInstanceOf(ApiResponse);
        const ar = r.data as ApiResponse;
        expect(ar.success).toBe(false);
        expect(ar.status).toBe(500);
    });

    it('with rethrow installed: HTTP 500 → reject with ApiResponse', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        await expect(h.ax.get('/flaky/status?n=1&code=500', {
            headers: { 'X-Test-Key': 'norm-500-rethrow' },
        } as any)).rejects.toBeInstanceOf(ApiResponse);
    });

    it('with rethrow installed: biz error → reject', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' }), rethrowPlugin()]);
        await expect(h.ax.get('/flaky/biz-error'))
            .rejects.toSatisfy((apiResp: any) => apiResp instanceof ApiResponse && apiResp.code === 'BIZ_ERR');
    });

    it('per-request normalize:false bypasses transformation', async () => {
        h.api.use([normalizePlugin({ success: (a: any) => a.code === '0000' })]);
        const r = await h.ax.get('/pet/42', { normalize: false } as any);
        expect(r.data).not.toBeInstanceOf(ApiResponse);
        expect(r.data.code).toBe('0000');
    });

    it('error code constants are exported via ERR_CODES', () => {
        expect(ERR_CODES.HTTP).toBe('HTTP_ERR');
        expect(ERR_CODES.NETWORK).toBe('NETWORK_ERR');
        expect(ERR_CODES.TIMEOUT).toBe('TIMEOUT_ERR');
        expect(ERR_CODES.CANCEL).toBe('CANCEL');
    });

    // ── 请求级 nullable / emptyable ──
    //
    // 新设计：
    //   - 插件级 nullable / emptyable **已删除**；插件级 success 函数自己决定怎么处理 null/empty data
    //   - 请求级 config.nullable / emptyable 仅在请求级**未提供** success 函数时参与裁决，
    //     在 apiResp.success 已被插件级 success 函数算出后做"二次覆盖"

    // 默认 success 函数：业务码命中即成功（不看 data）
    const codeSuccess = (a: any) => a.code === '0000';
    // 严格 success 函数：业务码命中且 data 非 null
    const strictSuccess = (a: any) => a.code === '0000' && a.data != null;

    it('插件级 success 自己决定 null data 视为失败', async () => {
        h.api.use([normalizePlugin({
            dataKeyPath: 'nonexistent',
            success: strictSuccess,
        })]);
        const r = await h.ax.get('/pet/42');
        const ar = r.data as ApiResponse;
        expect(ar.code).toBe('0000');
        expect(ar.data).toBeNull();
        expect(ar.success).toBe(false);
    });

    it('插件级 success 不看 data → null data 仍 success=true', async () => {
        h.api.use([normalizePlugin({
            dataKeyPath: 'nonexistent',
            success: codeSuccess,
        })]);
        const r = await h.ax.get('/pet/42');
        const ar = r.data as ApiResponse;
        expect(ar.data).toBeNull();
        expect(ar.success).toBe(true);
    });

    it('请求级顶层 nullable:true 覆盖插件级裁决（即便 success 函数说 false）', async () => {
        h.api.use([normalizePlugin({
            dataKeyPath: 'nonexistent',
            success: strictSuccess,             // 默认拒 null data
        })]);
        const r = await h.ax.get('/pet/42', { nullable: true } as any);
        expect((r.data as ApiResponse).success).toBe(true);   // 请求级 nullable:true 翻盘
    });

    it('请求级 normalize.nullable:true 覆盖（嵌套写法）', async () => {
        h.api.use([normalizePlugin({
            dataKeyPath: 'nonexistent',
            success: strictSuccess,
        })]);
        const r = await h.ax.get('/pet/42', { normalize: { nullable: true } } as any);
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('顶层 nullable 优先级高于 normalize.nullable', async () => {
        h.api.use([normalizePlugin({
            dataKeyPath: 'nonexistent',
            success: strictSuccess,
        })]);
        const r = await h.ax.get('/pet/42', {
            normalize: { nullable: false },
            nullable: true,
        } as any);
        expect((r.data as ApiResponse).success).toBe(true);
    });

    it('请求级 emptyable:true 让空对象 / 数组 / 串视为 success', async () => {
        // 插件级 success 严格要求 data 非空
        h.api.use([normalizePlugin({
            dataKeyPath: () => ({}),
            success: (a) => a.code === '0000' && !!a.data && Object.keys(a.data).length > 0,
        })]);
        const r = await h.ax.get('/pet/42', { emptyable: true } as any);
        const ar = r.data as ApiResponse;
        expect(ar.data).toEqual({});
        expect(ar.success).toBe(true);
    });

    it('emptyable 不影响 null/undefined（null 由 nullable 单独管）', async () => {
        h.api.use([normalizePlugin({
            dataKeyPath: 'nonexistent',
            success: strictSuccess,
        })]);
        // 顶层 emptyable:true 但 data=null（不是空容器）+ 没传 nullable → 仍 false
        const r = await h.ax.get('/pet/42', { emptyable: true } as any);
        expect((r.data as ApiResponse).data).toBeNull();
        expect((r.data as ApiResponse).success).toBe(false);
    });

    it('请求级 success 函数 ⇒ 完全裁决，nullable/emptyable 不参与', async () => {
        h.api.use([normalizePlugin({
            dataKeyPath: 'nonexistent',
            success: strictSuccess,
        })]);
        // 即便顶层 nullable=false 想强制失败，请求级 success 函数返回 true 直接结束
        const r = await h.ax.get('/pet/42', {
            nullable: false,
            normalize: { success: () => true },
        } as any);
        expect((r.data as ApiResponse).success).toBe(true);
    });
});
