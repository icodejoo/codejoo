import { defineConfig } from "vite-plus";

// `vp dev` 起本地 demo（http://localhost:5173）。@codejoo/stomp 通过 workspace:* 链接到
// 本地未发布的构建产物，不依赖 CDN/已发布版本——用来在库改动还没发版之前就能测新功能。
export default defineConfig({});
