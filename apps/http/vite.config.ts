import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:10001",
        rewrite(path) {
          return path.replace(/^\/api/, "");
        },
      },
    },
  },
});
