import { defineConfig } from "vitest/config";

/** 在一个进程中汇总 browser/node 的真实执行记录和覆盖率。 */
export default defineConfig({
  test: {
    projects: ["vitest.browser.config.ts", "vitest.node.config.ts"],
    coverage: {
      clean: false,
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
    },
  },
});
