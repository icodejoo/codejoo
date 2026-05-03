// cancel：浏览器原生 AbortController —— vitest Node 环境下 axios 的 cancel 路径走的是
// CancelToken / AbortError，浏览器 fetch 触发的是 DOMException(AbortError)，路径不同。

import { test, expect } from './_fixture';


test('cancelAll() 清掉所有 in-flight，归一化为 ApiResponse(code=CANCEL)', async ({ page }) => {
    const r = await page.evaluate(async () => {
        const Api = window.__http.ApiResponse;
        const p1 = window.__http.ax.get('/slow?ms=2000');
        const p2 = window.__http.ax.get('/slow?ms=2000');
        // 等请求确实进到 adapter
        await new Promise((r) => setTimeout(r, 50));
        const cancelled = window.__http.cancelAll();
        const [r1, r2] = await Promise.all([p1, p2]);
        const apiResp1 = r1.data as any;
        const apiResp2 = r2.data as any;
        return {
            cancelled,
            r1: {
                isApiResp: apiResp1 instanceof Api,
                code: apiResp1.code,
                success: apiResp1.success,
            },
            r2: {
                isApiResp: apiResp2 instanceof Api,
                code: apiResp2.code,
            },
        };
    });
    expect(r.cancelled).toBeGreaterThanOrEqual(2);
    expect(r.r1).toEqual({ isApiResp: true, code: 'CANCEL', success: false });
    expect(r.r2.code).toBe('CANCEL');
});


test('命名分组：cancelAll("auth") 只清 auth 组', async ({ page }) => {
    const r = await page.evaluate(async () => {
        const pAuth = window.__http.ax.get('/slow?ms=1500', { aborter: 'auth' } as any);
        const pOther = window.__http.ax.get('/slow?ms=200', { aborter: 'other' } as any);
        await new Promise((r) => setTimeout(r, 50));
        const cancelled = window.__http.cancelAll('auth');
        const [rAuth, rOther] = await Promise.all([pAuth, pOther]);
        return {
            cancelled,
            authCode: (rAuth.data as any).code,
            otherCode: (rOther.data as any).code,
        };
    });
    expect(r.cancelled).toBe(1);
    expect(r.authCode).toBe('CANCEL');
    expect(r.otherCode).toBe('0000');     // 其他组未受影响
});


test('aborter:false 完全旁路（不参与登记）', async ({ page }) => {
    const r = await page.evaluate(async () => {
        const p = window.__http.ax.get('/slow?ms=200', { aborter: false } as any);
        await new Promise((r) => setTimeout(r, 50));
        const cancelled = window.__http.cancelAll();
        const res = await p;
        return {
            cancelled,
            code: (res.data as any).code,
        };
    });
    expect(r.cancelled).toBe(0);
    expect(r.code).toBe('0000');
});
