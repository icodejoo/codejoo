import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      // 仅 "./min" 主动引用的单文件压缩版：自带一份模块实例，不与根入口/子路径共享状态；
      // 根入口 "." 指向下面的 unbundle 产物，避免与子路径 (cache/cancel/...) 出现两份模块实例
      entry: "src/index.ts",
      format: "esm",
      platform: "browser",
      target: "es2015",
      minify: true,
      dts: false,
      // 只清理自己的旧产物，别误删并行构建的 dist/esm
      clean: ["dist/index.*"],
      outExtensions: () => ({ js: ".min.js" }),
      deps: {
        neverBundle: ["axios"],
      },
    },
    {
      // 每个插件产出独立 esm 文件,支持按需 subpath 导入 (dist/esm/plugins/*.mjs);
      // 根入口 "." 同样指向本产物 (dist/esm/index.mjs),与子路径共享同一份模块实例
      entry: ["src/index.ts", "src/plugins/*.ts"],
      format: "esm",
      platform: "browser",
      target: "es2015",
      fixedExtension: true,
      unbundle: true,
      outDir: "dist/esm",
      dts: { tsgo: true },
      clean: true,
      deps: {
        neverBundle: ["axios"],
      },
    },
  ],
});
