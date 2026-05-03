// share：同 key 并发去重 —— 浏览器 fetch + axios 实例下也成立。

import { test, expect } from './_fixture';


test('start 策略：3 个同 key 并发只发 1 次 HTTP', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        const k = 'e2e-share-' + Date.now();
        const cfg = { key: k, share: true, headers: { 'X-Test-Key': k } } as any;
        const responses = await Promise.all([
            window.__http.ax.get('/seq', cfg),
            window.__http.ax.get('/seq', cfg),
            window.__http.ax.get('/seq', cfg),
        ]);
        return responses.map((r) => ({
            n: (r.data as any).data.n,
            hit: r.headers['x-hit-count'],
        }));
    });
    // 三个 caller 都拿到同一份响应（n 相同），且 server 只看到 1 次请求
    expect(r[0].n).toBe(1);
    expect(r[1].n).toBe(1);
    expect(r[2].n).toBe(1);
});
