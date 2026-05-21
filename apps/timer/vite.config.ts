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
  ],
});
