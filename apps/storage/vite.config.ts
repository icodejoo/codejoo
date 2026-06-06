import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: "src/index.ts",
      format: "esm",
      platform: "browser",
      target: "es2015",
      fixedExtension: true,
      dts: { tsgo: true },
      clean: true,
    },
    {
      entry: "src/index.ts",
      format: "esm",
      platform: "browser",
      target: "es2015",
      minify: true,
      dts: false,
      clean: false,
      outExtensions: () => ({ js: ".min.js" }),
    },
    {
      // 解包（每个源模块单独成文件）的 ESM 产物，便于下游按模块 tree-shake
      entry: "src/index.ts",
      format: "esm",
      platform: "browser",
      target: "es2015",
      unbundle: true,
      outDir: "dist/esm",
      fixedExtension: true,
      dts: { tsgo: true },
      clean: true,
    },
  ],
});
