import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: "src/index.ts",
    format: "esm",
    platform: "node",
    target: "node18",
    shims: true,
    dts: { tsgo: true },
    deps: {
      neverBundle: ["quicktype-core", "js-yaml"],
    },
  },
});
