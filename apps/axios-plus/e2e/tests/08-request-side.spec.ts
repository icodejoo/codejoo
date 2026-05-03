// 请求侧插件：filter / reurl / mock / key —— 浏览器侧 axios 请求行为快照。

import { test, expect } from './_fixture';


test('filter：null / "" / undefined 字段从 query 中剔除', async ({ page }) => {
    const r = await page.evaluate(async () => {
        const r = await window.__http.ax.get('/echo', {
            filter: true,
            params: { a: 1, b: null, c: '', d: 'ok', e: undefined },
        } as any);
        return (r.data as any).data?.query;
    });
    expect(r).toEqual({ a: '1', d: 'ok' });
});


test('reurl：/pet/{petId} 从 params 取值，发出去时 url 已替换', async ({ page }) => {
    const r = await page.evaluate(async () => {
        const r = await window.__http.ax.get('/pet/{petId}', { params: { petId: 7 } } as any);
        const apiResp = r.data as any;
        return { id: apiResp.data?.id, code: apiResp.code };
    });
    expect(r).toEqual({ id: 7, code: '0000' });
});


test('mock：config.mock=true + 无 mockUrl ⇒ no-op（warn 但不改 url）', async ({ page }) => {
    // mock 插件是 URL 重写而非合成响应；当前 main.ts 没传 mockUrl，
    // config.mock 仅 enable 跳路径但因没 mockUrl 静默 no-op，请求照常打到默认 baseURL
    const r = await page.evaluate(async () => {
        const r = await window.__http.ax.get('/pet/42', { mock: true } as any);
        const apiResp = r.data as any;
        return {
            success: apiResp.success,
            id: apiResp.data?.id,
        };
    });
    expect(r).toEqual({ success: true, id: 42 });
});


test('key：相同参数发两次 → key 计算一致（驱动 cache / share 去重）', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        const cfg = { key: true, params: { a: 1, b: 'x' }, cache: true } as any;
        const r1 = await window.__http.ax.get('/seq', { ...cfg, headers: { 'X-Test-Key': 'e2e-key' } });
        const r2 = await window.__http.ax.get('/seq', { ...cfg, headers: { 'X-Test-Key': 'e2e-key' } });
        return {
            r1n: (r1.data as any).data.n,
            r2n: (r2.data as any).data.n,
            r2Cached: (r2 as any)._cache === true,
        };
    });
    // 同 key → 第二次 cache 命中
    expect(r.r1n).toBe(1);
    expect(r.r2n).toBe(1);
    expect(r.r2Cached).toBe(true);
});
