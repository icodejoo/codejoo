// Playwright e2e config —— 在真实浏览器（chromium）里跑插件代码，作为 vitest 集成测试在浏览器侧的对照。
//
// 启动顺序由 webServer 数组保证：
//   1. Bun mock server (port 3030) —— vite 的 /api proxy 转发目标
//   2. Vite e2e dev (port 5173)    —— 提供 window.__http 句柄给 spec
//
// CI 用：`npm run e2e`（playwright 自动 spawn 上述两个 server）。

import { defineConfig, devices } from '@playwright/test';

const MOCK_PORT = 3030;
const VITE_PORT = 5173;

export default defineConfig({
    testDir: './e2e/tests',
    fullyParallel: false,           // 共享同一个 vite + mock 实例 → 串行更稳
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : [['list']],

    timeout: 30_000,
    expect: { timeout: 5_000 },

    use: {
        baseURL: `http://localhost:${VITE_PORT}`,
        trace: 'retain-on-failure',
        actionTimeout: 10_000,
        navigationTimeout: 15_000,
    },

    // 双 webServer：mock 先起，vite 后起。Playwright 启动时按数组顺序探活。
    webServer: [
        {
            command: `bun server/dev.ts`,
            env: { MOCK_PORT: String(MOCK_PORT) },
            url: `http://localhost:${MOCK_PORT}/ok`,
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
            stdout: 'ignore',
            stderr: 'pipe',
        },
        {
            command: `vite --mode e2e`,
            env: { MOCK_PORT: String(MOCK_PORT) },
            url: `http://localhost:${VITE_PORT}`,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            stdout: 'ignore',
            stderr: 'pipe',
        },
    ],

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        // 取消注释可启用 firefox / webkit；需先 `npx playwright install firefox webkit`
        // { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
        // { name: 'webkit',   use: { ...devices['Desktop Safari']  } },
    ],
});
