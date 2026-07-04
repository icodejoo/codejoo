import vue from "@vitejs/plugin-vue";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * 在真实 Chromium（Playwright）中运行的浏览器集成测试。
 * 覆盖 @codejoo/layerman 全部核心 API + Vue/Vant 适配层。
 * 全部依赖复用父工程 catalog（vue、vant、plugin-vue、vitest、@vitest/browser 系列、playwright）。
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ["test/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: "chromium" }],
    },
    testTimeout: 15000,
  },
});
