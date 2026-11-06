import { defineConfig } from "vitest/config";

/** Node 套件只运行纯逻辑及无浏览器环境测试。 */
export default defineConfig({
  test: {
    name: "node",
    environment: "node",
    include: ["test/**/*.node.test.ts"],
    coverage: { clean: false },
  },
});
