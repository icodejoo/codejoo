// normalize：浏览器侧三种 settle 形态都被归一化为 ApiResponse。
// 浏览器特性：fetch 错误 / AbortError 经过 axios 适配器后的形态可能与 Node http 不同 ——
// 这正是 e2e 要验证的差异点。

import { test, expect } from './_fixture';


test('成功响应 → ApiResponse(success=true)', async ({ page }) => {
    const r = await page.evaluate(async () => {
        const r = await window.__http.ax.get('/pet/42');
        const apiResp = r.data as any;
        return {
            isApiResponse: apiResp instanceof window.__http.ApiResponse,
            success: apiResp.success,
            code: apiResp.code,
            id: apiResp.data?.id,
        };
    });
    expect(r).toEqual({ isApiResponse: true, success: true, code: '0000', id: 42 });
});


test('业务失败 → ApiResponse(success=false, code=BIZ_ERR)', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        const r = await window.__http.ax.get('/flaky/biz-error', {
            headers: { 'X-Test-Key': 'e2e-biz-' + Date.now() },
        } as any);
        const apiResp = r.data as any;
        return { success: apiResp.success, code: apiResp.code, status: apiResp.status };
    });
    expect(r.success).toBe(false);
    expect(r.code).toBe('BIZ_ERR');
    expect(r.status).toBe(200);
});


test('HTTP 500 → ApiResponse(success=false, status=500)', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        const r = await window.__http.ax.get('/flaky/status?n=99&code=500', {
            headers: { 'X-Test-Key': 'e2e-500-' + Date.now() },
        } as any);
        const apiResp = r.data as any;
        return { success: apiResp.success, status: apiResp.status, code: apiResp.code };
    });
    expect(r.success).toBe(false);
    expect(r.status).toBe(500);
    expect(r.code).toBe('SERVER_ERR');
});


test('per-request normalize:false 旁路 → 拿到原始 envelope', async ({ page }) => {
    const r = await page.evaluate(async () => {
        const r = await window.__http.ax.get('/ok', { normalize: false } as any);
        return {
            isApiResponse: r.data instanceof window.__http.ApiResponse,
            rawCode: (r.data as any).code,
        };
    });
    expect(r.isApiResponse).toBe(false);
    expect(r.rawCode).toBe('0000');
});
