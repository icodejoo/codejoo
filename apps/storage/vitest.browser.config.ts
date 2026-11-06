import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

/**
 * 集成测试配置 —— 在真实 Chromium（Playwright）中跑全部用例。
 *
 * 测试位于 `test/*.browser.test.ts`，使用真实 localStorage / sessionStorage /
 * IndexedDB / BroadcastChannel（非 jsdom 模拟），覆盖同步后端、异步 IDB 事务、
 * 跨标签同步等真实浏览器行为。用法：`pnpm test`（见 package.json）。
 */
export default defineConfig({
  test: {
    name: "browser",
    // 多路进程使用独立端口；限制并发以免大量真实页面抢占浏览器会话。
    fileParallelism: false,
    include: ["test/**/*.browser.test.ts"],
    coverage: {
      // 由 run-coverage 统一清理，普通测试和 accept 不删除刚生成的门禁报告。
      clean: false,
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "json-summary", "json"],
    },
    browser: {
      api: { port: 20000 + (process.pid % 40000) },
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
