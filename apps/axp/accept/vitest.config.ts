import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** accept/ 目录 */
const ACCEPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 被测打包产物入口：验收对象是 dist/esm，而不是 src */
const DIST_ENTRY = path.resolve(ACCEPT_DIR, "..", "dist", "esm", "index.mjs");

/**
 * 验收执行器自己的单元测试配置，与根目录 vitest.config.ts（测 src）完全分开。
 * 运行：npx vp test run --config accept/vitest.config.ts
 * 注意：真正的验收（对服务器跑场景）不走 vitest，见 accept/cli.ts。
 */
export default defineConfig({
  root: ACCEPT_DIR,
  resolve: { alias: { "@codejoo/axp": DIST_ENTRY } },
  test: {
    include: ["unit/**/*.test.ts"],
    disableConsoleIntercept: true,
    reporters: ["verbose"],
  },
});
