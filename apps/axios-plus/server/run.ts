/* eslint-disable */
// Entrypoint for the Bun child process. Started by `server/index.ts` via
// `bun server/run.ts`. Prints `LISTENING:<port>` once the OS-assigned port
// is bound, then idles until the parent kills the process.

import { startServerImpl } from './server';

const handle = startServerImpl(0);
// Use process.stdout.write to avoid trailing-newline weirdness across shells.
process.stdout.write(`LISTENING:${handle.port}\n`);

// Keep the process alive even when stdin is closed.
const keepAlive = setInterval(() => { /* noop */ }, 1 << 30);
keepAlive.unref?.();

const shutdown = async () => {
    try { await handle.close(); } catch { /* noop */ }
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
