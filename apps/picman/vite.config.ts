import { defineConfig } from "vite-plus";

// Determine which build to run based on environment
const isSWBuild = process.env.PICMAN_BUILD_SW === "1";

export default defineConfig({
  pack: isSWBuild
    ? {
        // Standalone SW build
        entry: { "picman-sw": "src/sw-standalone.ts" },
        format: "esm",
        platform: "browser",
        target: "es2022",
        outDir: "dist",
        fixedExtension: false,
        dts: false,
        clean: false,
      }
    : {
        // ESM entries build
        entry: {
          index: "src/index.ts",
          sw: "src/sw.ts",
          element: "src/element.ts",
          shared: "src/shared.ts",
        },
        format: "esm",
        platform: "browser",
        target: "es2022",
        outDir: "dist/esm",
        fixedExtension: true,
        dts: { tsgo: true },
        clean: true,
      },
});
