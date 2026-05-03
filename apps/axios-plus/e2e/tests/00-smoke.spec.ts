// 启动冒烟 —— page 能加载 / 13 个插件全部装载 / vite proxy 能转发到 mock。

import { test, expect } from './_fixture';


test('页面加载 + window.__http 暴露 + 15 个插件就绪', async ({ page }) => {
    const meta = await page.evaluate(() => ({
        pluginCount: window.__http.api.plugins().length,
        pluginNames: window.__http.api.plugins().map((p) => p.name),
        baseURL: window.__http.ax.defaults.baseURL,
    }));

    expect(meta.pluginCount).toBe(15);
    expect(meta.baseURL).toBe('/api');
    // 关键插件都得在
    for (const n of ['normalize', 'auth', 'cache', 'share', 'retry', 'cancel', 'rethrow']) {
        expect(meta.pluginNames).toContain(n);
    }
});


test('vite proxy /api/* → bun mock：GET /ok', async ({ page }) => {
    const r = await page.evaluate(async () => {
        const r = await window.__http.ax.get('/ok');
        return {
            isApiResponse: r.data instanceof window.__http.ApiResponse,
            success: (r.data as any).success,
            code: (r.data as any).code,
        };
    });
    expect(r).toEqual({ isApiResponse: true, success: true, code: '0000' });
});
