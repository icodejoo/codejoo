import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

/**
 * Browser-mode 端到端测试配置 —— 在真实 Chromium 中跑真 RAF 行为。
 *
 * 与 `vitest.config.ts`（jsdom）互补：单元测试走 jsdom（快、覆盖逻辑分支），
 * E2E 走真实浏览器（验证 RAF 调度、performance.now()、textContent 同步等
 * 与 jsdom 行为不一致的浏览器原生 API）。
 *
 * 用法：`pnpm test:browser`（见 package.json）
 */
export default defineConfig({
  test: {
    include: ["src/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: "chromium" }],
    },
    // 真 RAF 测试涉及实际 wall-clock 等待，单个用例给宽松超时
    testTimeout: 10000,
  },
});
