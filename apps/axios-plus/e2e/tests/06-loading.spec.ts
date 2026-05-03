// loading：delay + mdt 在浏览器真实定时器下的行为。
//
// 当前 main.ts 配置：delay=200, mdt=500
// 卡片 demo 用 config.loading=true 触发全局计数路径

import { test, expect } from './_fixture';


test('快请求（< delay）⇒ spinner 不出现，loadingLog 为空', async ({ page }) => {
    const events = await page.evaluate(async () => {
        window.__http.loadingLog.splice(0);
        await window.__http.ax.get('/slow?ms=50', { loading: true } as any);
        return window.__http.loadingLog.slice();
    });
    expect(events).toEqual([]);
});


test('慢请求（> delay+mdt）⇒ loadingLog: [true, false]', async ({ page }) => {
    const events = await page.evaluate(async () => {
        window.__http.loadingLog.splice(0);
        await window.__http.ax.get('/slow?ms=900', { loading: true } as any);
        // mdt 已满 → false 立即触发
        return window.__http.loadingLog.slice();
    });
    expect(events[0]).toBe(true);
    expect(events.at(-1)).toBe(false);
});


test('私有 loading 函数：每请求自管，不入全局计数', async ({ page }) => {
    const r = await page.evaluate(async () => {
        const calls: boolean[] = [];
        const fn = (v: boolean) => calls.push(v);
        window.__http.loadingLog.splice(0);
        await window.__http.ax.get('/slow?ms=100', { loading: fn } as any);
        return { private: calls, global: window.__http.loadingLog.slice() };
    });
    expect(r.private).toEqual([true, false]);
    expect(r.global).toEqual([]);   // 全局计数完全不动
});
