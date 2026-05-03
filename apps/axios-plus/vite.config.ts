// vite 现在只服务 dev / e2e demo —— 库构建迁去 tsup（见 tsup.config.ts）。
//
//   - `vite`            主源码 root 起 dev（无特殊用途，留作脚手架）
//   - `vite --mode e2e` 以 e2e/ 为 root，启用 /api proxy 转发到 bun mock server，
//                       playwright 通过 webServer 自动 spawn 这条命令

import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


const __dirname = fileURLToPath(new URL('.', import.meta.url));


export default defineConfig(({ mode }) => ({
    root: mode === 'e2e' ? resolve(__dirname, 'e2e') : __dirname,
    publicDir: 'public',
    server: mode === 'e2e' ? {
        port: 5173,
        proxy: {
            '/api': {
                target: `http://localhost:${process.env.MOCK_PORT || 3030}`,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
            },
        },
    } : undefined,
}));
