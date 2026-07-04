import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      vue: "src/vue.ts", // 可选子路径 @codejoo/overlaymanager/vue（vue 为外部 peer）
      react: "src/react.ts", // @codejoo/overlaymanager/react
      svelte: "src/svelte.ts", // @codejoo/overlaymanager/svelte
      solid: "src/solid.ts", // @codejoo/overlaymanager/solid
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
