/* eslint-disable */
// Dev mock server — fixed port for vite e2e proxy. Run with:
//
//   bun server/dev.ts
//
// Default port 3030; override via `MOCK_PORT=3050 bun server/dev.ts`.
// Vite (mode=e2e) proxies `/api/*` to this server.

import { startServerImpl } from './server';

const port = parseInt(process.env.MOCK_PORT || '3030', 10);
const handle = startServerImpl(port);
console.log(`[mock] listening on http://localhost:${handle.port}`);

const shutdown = async () => {
    console.log('\n[mock] shutting down...');
    try { await handle.close(); } catch { /* noop */ }
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
