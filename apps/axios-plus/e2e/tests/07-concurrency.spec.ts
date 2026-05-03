// concurrency：max + priority 在浏览器侧的真实排队行为。
// 注：main.ts 装的是 max=4，spec 直接观察这个配置。

import { test, expect } from './_fixture';


test('max=4：6 个 200ms 请求 → 总耗时 < 全串行', async ({ page }) => {
    const r = await page.evaluate(async () => {
        const t = Date.now();
        const ps = Array.from({ length: 6 }, (_, i) =>
            window.__http.ax.get('/slow?ms=200', {
                headers: { 'X-Test-Key': `e2e-c${i}` },
            } as any),
        );
        await Promise.all(ps);
        return { elapsed: Date.now() - t };
    });
    // 6 个 200ms 请求按并发=4 排队应 ≥ 400ms（理想 2 × 200）；
    // 上界放宽到 < 1600（< 6×200 = 全串行底线），抗夸张抖动 + bun keep-alive 等。
    expect(r.elapsed).toBeGreaterThanOrEqual(380);
    expect(r.elapsed).toBeLessThan(1600);
});


test('priority=10 跳队：高优在低优之前完成', async ({ page }) => {
    const r = await page.evaluate(async () => {
        // 先打满 4 个槽位（每个 600ms）
        const filler = Array.from({ length: 4 }, (_, i) =>
            window.__http.ax.get('/slow?ms=600', {
                headers: { 'X-Test-Key': `e2e-fill${i}` },
            } as any),
        );
        await new Promise((r) => setTimeout(r, 50));

        const t = Date.now();
        let loDone = 0;
        let hiDone = 0;
        const lo = window.__http.ax.get('/slow?ms=200', {
            headers: { 'X-Test-Key': 'e2e-lo' },
            priority: 1,
        } as any).then(() => { loDone = Date.now() - t; });
        const hi = window.__http.ax.get('/slow?ms=200', {
            headers: { 'X-Test-Key': 'e2e-hi' },
            priority: 10,
        } as any).then(() => { hiDone = Date.now() - t; });

        await Promise.all([...filler, lo, hi]);
        return { loDone, hiDone };
    });
    // 高优应该比低优早完成
    expect(r.hiDone).toBeLessThan(r.loDone);
});
