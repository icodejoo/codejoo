// Playwright 自定义 fixture：每个 test 自动 navigate + wait for window.__http
// + 提供一个 `resetServer()` 把 mock server 的 counter 清空，避免跨用例污染。
//
// 用法：
//   import { test, expect } from './_fixture';
//   test('xxx', async ({ page, resetServer, evalHttp }) => { ... });

import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';


/** 重置 mock server 的所有计数器（/seq /flaky/* 等） */
async function resetMockCounters(page: Page): Promise<void> {
    await page.request.post('http://localhost:3030/flaky/reset');
}


/** 等 main.ts 装载完毕：window.__http + 全部插件 + auth testkit 就绪 */
async function waitForReady(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        const h = (window as any).__http;
        return !!h
            && typeof h.api?.plugins === 'function'
            && h.api.plugins().length >= 15
            && !!h.auth;
    }, undefined, { timeout: 15_000 });
}


/** 每个 test 都拿到一个 fresh page：navigate + ready + 计数器重置 + buffer 清空 */
export const test = base.extend<{
    /** 跳过默认 navigate，需要自定义起点的 spec 用 */
    bare: void;
    /** spec 内调用：执行任意 page-side 代码，用 window.__http 句柄；无需重复写 evaluate */
    resetServer: () => Promise<void>;
}>({
    bare: [async ({ page }, use) => {
        await use();
        // teardown noop
    }, { auto: false }],

    page: async ({ page }, use) => {
        await page.goto('/');
        await waitForReady(page);
        // 全套重置：notify/loading buffer + auth testkit + 共享缓存池
        await page.evaluate(() => {
            const h = (window as any).__http;
            h.auth.reset();          // 内部已 splice notifyLog / loadingLog + tm.clear
            return h.clearCache();
        });
        await use(page);
    },

    resetServer: async ({ page }, use) => {
        await use(() => resetMockCounters(page));
    },
});


export { expect };
