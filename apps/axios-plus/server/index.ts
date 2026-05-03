/* eslint-disable */
// Server bootstrap for integration tests.
//
// Vitest runs under Node, but the mock HTTP server uses `Bun.serve`. We spawn
// `bun` as a child process running `server/run.ts`, which prints
// `LISTENING:<port>` on stdout once the listener is up. The parent process
// reads that line and uses the port number to point its axios baseURL at the
// child, then signals the child to exit on `close()`.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerHandle {
    port: number;
    close: () => Promise<void>;
}

// Resolve `bun` executable. Honor BUN_PATH env override; fall back to a
// well-known npm-installed location on Windows; finally trust PATH lookup.
function resolveBunBin(): string {
    if (process.env.BUN_PATH && existsSync(process.env.BUN_PATH)) {
        return process.env.BUN_PATH;
    }
    // Prefer the real `bun.exe` over npm shim `.cmd`s — child_process.spawn on
    // Windows refuses to launch `.cmd` files without `shell: true` (EINVAL).
    const candidates = [
        'C:/Users/Administrator/AppData/Roaming/npm/node_modules/bun/bin/bun.exe',
        'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\bun\\bin\\bun.exe',
        'C:/Users/Administrator/AppData/Roaming/npm/bun.exe',
    ];
    for (const c of candidates) if (existsSync(c)) return c;
    return process.platform === 'win32' ? 'bun.exe' : 'bun';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function startServer(): Promise<ServerHandle> {
    const bunBin = resolveBunBin();
    const runScript = join(__dirname, 'run.ts');

    return new Promise<ServerHandle>((resolve, reject) => {
        const child: ChildProcess = spawn(bunBin, [runScript], {
            cwd: dirname(__dirname),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, FORCE_COLOR: '0' },
            shell: false,
            windowsHide: true,
        });

        let buf = '';
        let resolved = false;
        const errBuf: string[] = [];

        const onStdout = (chunk: Buffer) => {
            buf += chunk.toString('utf8');
            const lines = buf.split(/\r?\n/);
            buf = lines.pop() || '';
            for (const line of lines) {
                const m = /^LISTENING:(\d+)$/.exec(line.trim());
                if (m && !resolved) {
                    resolved = true;
                    const port = parseInt(m[1], 10);
                    resolve({
                        port,
                        close: () =>
                            new Promise<void>((res) => {
                                if (child.exitCode != null) return res();
                                child.once('exit', () => res());
                                // SIGTERM works on Bun-on-Linux. On Windows
                                // child_process.kill() falls back to forceful
                                // termination, which is fine for tests.
                                try { child.kill(); } catch { /* noop */ }
                                // Belt-and-suspenders timeout.
                                setTimeout(() => {
                                    try { child.kill('SIGKILL' as any); } catch { /* noop */ }
                                    res();
                                }, 2000).unref?.();
                            }),
                    });
                }
            }
        };

        child.stdout?.on('data', onStdout);
        child.stderr?.on('data', (c) => errBuf.push(c.toString('utf8')));

        child.once('error', (err) => {
            if (!resolved) {
                resolved = true;
                reject(new Error(`Failed to spawn bun (${bunBin}): ${err.message}`));
            }
        });
        child.once('exit', (code) => {
            if (!resolved) {
                resolved = true;
                reject(new Error(
                    `Server exited before listening (code=${code}). bun=${bunBin}\nstderr:\n${errBuf.join('')}`,
                ));
            }
        });

        // Timeout if Bun never reports LISTENING.
        const t = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                try { child.kill(); } catch { /* noop */ }
                reject(new Error(
                    `Server failed to start within 10s. bun=${bunBin}\nstderr:\n${errBuf.join('')}`,
                ));
            }
        }, 10_000);
        t.unref?.();
    });
}
