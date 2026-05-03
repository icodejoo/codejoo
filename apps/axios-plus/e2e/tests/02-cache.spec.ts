// cache：浏览器侧 sessionStorage 真实可用 —— 这是 vitest 集成测试覆盖不到的关键差异。
// 在 vitest 下 sessionStorage 不可用 → fallback 到 memory；只有真实浏览器才能验证 storage 路径。

import { test, expect } from './_fixture';


test('sessionStorage 真实落盘：第一次 miss + 第二次 hit', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        const k = 'e2e-cache-' + Date.now();
        const cfg = { key: k, cache: true, headers: { 'X-Test-Key': k } } as any;
        const r1 = await window.__http.ax.get('/seq', cfg);
        const r2 = await window.__http.ax.get('/seq', cfg);
        return {
            r1n: (r1.data as any).data.n,
            r2n: (r2.data as any).data.n,
            r2Cached: (r2 as any)._cache === true,
        };
    });
    expect(r.r1n).toBe(1);
    expect(r.r2n).toBe(1);    // 同 n → 缓存命中
    expect(r.r2Cached).toBe(true);
});


test('removeCache(key) 驱逐单条，再发即 miss', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        const k = 'e2e-cache-rm-' + Date.now();
        const cfg = { key: k, cache: true, headers: { 'X-Test-Key': k } } as any;
        const r1 = await window.__http.ax.get('/seq', cfg);
        await window.__http.removeCache(k);
        const r2 = await window.__http.ax.get('/seq', cfg);
        return { r1n: (r1.data as any).data.n, r2n: (r2.data as any).data.n };
    });
    expect(r.r1n).toBe(1);
    expect(r.r2n).toBe(2);
});


test('clearCache() 清空整个共享池', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        const k = 'e2e-cache-cl-' + Date.now();
        const cfg = { key: k, cache: true, headers: { 'X-Test-Key': k } } as any;
        await window.__http.ax.get('/seq', cfg);
        const cleared = await window.__http.clearCache();
        const r2 = await window.__http.ax.get('/seq', cfg);
        return { cleared, r2n: (r2.data as any).data.n };
    });
    expect(r.cleared).toBe(true);
    expect(r.r2n).toBe(2);
});


test('失败响应不写入缓存', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        const k = 'e2e-cache-fail-' + Date.now();
        const cfg = { key: k, cache: true, headers: { 'X-Test-Key': k } } as any;
        const r1 = await window.__http.ax.get('/flaky/status?n=99&code=500', cfg);
        const r2 = await window.__http.ax.get('/flaky/status?n=99&code=500', cfg);
        return {
            r1Success: (r1.data as any).success,
            r2HitCount: r2.headers['x-hit-count'],
        };
    });
    expect(r.r1Success).toBe(false);
    expect(r.r2HitCount).toBe('2');   // 第二次仍打到服务端 → 失败响应没缓存
});
