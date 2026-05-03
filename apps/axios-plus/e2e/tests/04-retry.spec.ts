// retry：失败 N 次后成功 / Retry-After 头 —— 浏览器侧也能拦下重试。

import { test, expect } from './_fixture';


test('GET 5xx 失败 2 次 → 第 3 次成功（per-request retry: 2）', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        const k = 'e2e-retry-' + Date.now();
        const r = await window.__http.ax.get('/flaky/status?n=2&code=500', {
            headers: { 'X-Test-Key': k },
            retry: 2,
        } as any);
        return {
            success: (r.data as any).success,
            hitCount: r.headers['x-hit-count'],
        };
    });
    expect(r.success).toBe(true);
    expect(r.hitCount).toBe('3');
});


test('Retry-After 头：服务端要求等待，第二次成功', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        const k = 'e2e-retry-after-' + Date.now();
        const t = Date.now();
        const r = await window.__http.ax.get('/flaky/retry-after?seconds=1', {
            headers: { 'X-Test-Key': k },
            retry: { max: 2, retryAfterMax: 100 },
        } as any);
        return {
            success: (r.data as any).success,
            elapsed: Date.now() - t,
        };
    });
    expect(r.success).toBe(true);
    expect(r.elapsed).toBeLessThan(2_000);
});
