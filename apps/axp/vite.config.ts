import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    lib: {
      // 库的入口文件
      entry: path.resolve(__dirname, "src/index.ts"),
      // 暴露的全局变量名（用于 UMD/IIFE 格式）
    //   name: "MyLibrary",
      // 输出的文件名
      fileName: (format) => `index.es.js`,
      // 指定输出格式
      formats: ["es"],
    },
    rollupOptions: {
      // 关键：告诉 Rollup 不要打包 axios
      external: ["axios"],
      output: {
        // 在 UMD 构建模式下，为这些外部依赖提供一个全局变量
        globals: {
          axios: "axios",
        },
      },
    },
  },
});
