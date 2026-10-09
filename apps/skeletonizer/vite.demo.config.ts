import { defineConfig } from "vite-plus";

/** demo 静态构建配置：只打包 demo/index.html，产物输出到 demo-dist；样式分片由 scripts/build-demo.mjs 另行编译 */
export default defineConfig({
  root: "demo",
  // GitHub Pages 子路径；本地预览可用 DEMO_BASE 覆盖（例如 DEMO_BASE=/ ）
  base: process.env.DEMO_BASE || "/codejoo/skeletonizer/",
  build: {
    outDir: "../demo-dist",
    emptyOutDir: true,
  },
});
