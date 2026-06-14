import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: "src/index.ts",
      format: "esm",
      platform: "browser",
      target: "es2022",
      fixedExtension: true,
      dts: { tsgo: true },
      clean: true,
    },
    {
      entry: "src/index.ts",
      format: "esm",
      platform: "browser",
      target: "es2022",
      minify: true,
      dts: false,
      clean: false,
      outExtensions: () => ({ js: ".min.js" }),
    },
    {
      // 解包（每个源模块单独成文件）的 ESM 产物，便于下游按模块 tree-shake。
      // debug 不在主入口（防止进 bundle），需作为独立 entry 才会被产出，经 "./debug" 子路径导出
      entry: ["src/index.ts", "src/debug.ts"],
      format: "esm",
      platform: "browser",
      target: "es2022",
      unbundle: true,
      outDir: "dist/esm",
      fixedExtension: true,
      dts: { tsgo: true },
      clean: true,
    },
  ],
});
