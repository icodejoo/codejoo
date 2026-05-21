import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    // .browser.test.ts 由 vitest.browser.config.ts 在真实 Chromium 中跑
    exclude: ["**/*.browser.test.ts", "**/node_modules/**"],
    environment: "jsdom",
    disableConsoleIntercept: true,
    reporters: ["verbose"],
  },
});
