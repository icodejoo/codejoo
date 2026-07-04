import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

// `vp dev` 起本地 demo（http://localhost:5173）。全部依赖复用父工程 catalog。
export default defineConfig({
  plugins: [vue()],
});
