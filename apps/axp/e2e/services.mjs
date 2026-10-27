import { createServer } from 'vite-plus';
import { fileURLToPath } from 'node:url';
import { createMockServer } from './server/mock-server.mjs';

/** 本地后端地址。 */
export const MOCK = 'http://localhost:4570';
/** 本地演练场地址。 */
export const APP = 'http://localhost:5180';

/** 探测已有服务，网络异常视为未启动。 */
async function up(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; }
  catch { return false; }
}

/**
 * 在当前进程启动缺失的本地服务，避免 Windows shell 子进程残留。
 * @returns 仅关闭本次启动服务的异步函数。
 * @example const close = await startServices(); await close();
 */
export async function startServices() {
  const owned = [];
  /** 按相反顺序关闭自有服务，保留复用的服务。 */
  const close = async () => {
    for (const stop of owned.splice(0).reverse()) await stop();
  };
  try {
    if (!(await up(MOCK + '/api/hits'))) {
      const mock = createMockServer();
      await new Promise((resolve, reject) => {
        mock.once('error', reject);
        mock.listen(4570, resolve);
      });
      owned.push(() => new Promise((resolve) => { mock.close(resolve); mock.closeAllConnections(); }));
    }
    if (!(await up(APP))) {
      const app = await createServer({
        root: fileURLToPath(new URL('./playground', import.meta.url)),
        configFile: false,
        server: { port: 5180, strictPort: true, host: 'localhost' },
      });
      owned.push(() => app.close());
      await app.listen();
    }
    console.log(`[e2e] mock → ${MOCK} · playground → ${APP}`);
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}
