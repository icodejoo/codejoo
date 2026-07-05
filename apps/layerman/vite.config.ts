import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      vue: "src/vue.ts", // 可选子路径 @codejoo/layerman/vue（vue 为外部 peer）
      react: "src/react.ts", // @codejoo/layerman/react
      svelte: "src/svelte.ts", // @codejoo/layerman/svelte
      solid: "src/solid.ts", // @codejoo/layerman/solid
    },
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    outDir: "dist/esm",
    fixedExtension: true,
    dts: { tsgo: true },
    clean: true,
  },
});
