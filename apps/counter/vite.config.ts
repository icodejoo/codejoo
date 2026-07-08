import { defineConfig } from "vite-plus";

// 多入口 ESM：核心(index) 打成一包；count-down / count-up 及各渲染插件单独成文件，
// 调用方按需 import（如 @codejoo/counter/ring），便于 tree-shaking。
// 插件仅以 type 依赖 count-down，运行时零依赖 → 各自独立、互不牵连。
export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      "count-down": "src/count-down/index.ts",
      "count-up": "src/count-up/index.ts",
      card: "src/plugins/card.ts",
      odometer: "src/plugins/odometer.ts",
      ring: "src/plugins/ring.ts",
      vue: "src/vue.ts",
    },
    external: ["vue"],
    format: "esm",
    platform: "browser",
    target: "es2015",
    fixedExtension: true,
    dts: { tsgo: true },
    clean: true,
  },
});
