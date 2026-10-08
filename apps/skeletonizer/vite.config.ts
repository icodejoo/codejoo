import { defineConfig } from "vite-plus";

export default defineConfig({
  // demo 开发服务：npm run dev
  server: { port: 5188, open: "/demo/index.html" },
  pack: [
    {
      // JS：主入口 + 各框架适配层（子路径导出），框架本身为外部依赖
      entry: {
        index: "src/index.ts",
        vue: "src/vue.ts",
        react: "src/react.ts",
        svelte: "src/svelte.ts",
      },
      format: "esm",
      platform: "browser",
      target: "es2015",
      minify: true,
      outDir: "dist",
      fixedExtension: true,
      dts: { tsgo: true },
      clean: true,
    },
    {
      // CSS：SCSS 编译 + 压缩成 dist/skeletonizer.css
      entry: { skeletonizer: "src/styles/skeletonizer.scss" },
      format: "esm",
      platform: "browser",
      dts: false,
      clean: false,
      // 压缩，并按最低支持线降级语法（避免产出 8 位 hex 等新写法）
      css: { fileName: "skeletonizer.css", minify: true, target: ["chrome49", "firefox52", "safari10", "edge15"] },
    },
  ],
});
