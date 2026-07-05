import { defineConfig } from "vitest/config";

// 只跑本包 test/ 下的单测（node + 假时钟）。
// 嵌套的 example/ 子工程是独立 workspace 包，有自己的 `vp test -c vitest.browser.config.ts`
// （真实浏览器），此处不纳入。
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
