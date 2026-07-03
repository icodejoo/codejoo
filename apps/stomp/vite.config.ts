import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: "src/index.ts",
    format: "esm",
    platform: "browser",
    target: "es2022",
    outDir: "dist/esm",
    fixedExtension: true,
    dts: { tsgo: true },
    clean: true,
  },
});
