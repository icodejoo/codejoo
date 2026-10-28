import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';

/** 读取 e2e 源文件，检查 runner 与页面对外的自动化契约。 */
function source(path: string) {
  return readFileSync(new URL(`../../../e2e/${path}`, import.meta.url), 'utf8');
}

describe('e2e review #28/#29 回归', () => {
  it('runner 的每个动作和结果面板都有页面实现', () => {
    const page = source('playground/main.ts');
    const ids = new Set([...page.matchAll(/\bid: '([^']+)'/g)].map((match) => match[1]));
    for (const match of source('run.mjs').matchAll(/action: '([^']+)', result: '([^']+)'/g)) {
      expect(ids.has(match[1]), `缺少动作 ${match[1]}`).toBe(true);
      expect(ids.has(match[2].replace(/-result$/, '')), `缺少结果 ${match[2]}`).toBe(true);
    }
  });

});

describe('e2e 页面动作 — 真实本地 HTTP', () => {
  let server: Server;
  let actions: Array<{
    /** 页面动作标识。 */
    id: string;
    /** 执行页面动作。 */
    run: () => Promise<any>;
  }>;
  const origin = 'http://localhost:4570';

  beforeAll(async () => {
    // 变量导入让 tsgo 只检查测试代码，演练场由 Vite 转换执行。
    const backendPath = '../../../e2e/server/mock-server.mjs';
    const playgroundPath = '../../../e2e/playground/main.ts';
    const { createMockServer } = await import(backendPath);
    server = createMockServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(4570, resolve);
    });
    const { features, integrationFeatures } = await import(playgroundPath);
    actions = [...features, ...integrationFeatures].flatMap((feature) => feature.actions);
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  });

  /** 运行与浏览器按钮相同的动作，不模拟请求或返回值。 */
  async function run(id: string) {
    const action = actions.find((item) => item.id === id);
    expect(action, `缺少动作 ${id}`).toBeDefined();
    return action!.run();
  }

  it('真实计数可归零，读取不增加命中数，失败次数在重置后恢复', async () => {
    /** 清空计数与失败序列。 */
    const reset = () => fetch(origin + '/api/hits/reset', { method: 'POST' });
    /** 请求前两次失败的测试接口。 */
    const hit = () => fetch(origin + '/api/hit?id=counter&fail=2');
    await reset();
    expect((await hit()).status).toBe(500);
    expect((await hit()).status).toBe(500);
    const third = await hit();
    expect(third.status).toBe(200);
    expect((await third.json()).data.hits).toBe(3);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(origin + '/api/hits?id=counter');
      expect((await response.json()).data.hits).toBe(3);
    }
    await reset();
    expect((await hit()).status).toBe(500);
  });

  it('[cache.fn.axpCache][cache.fn.removeCache] cache 真正省去第二次网络请求，remove 后重新请求', async () => {
    const cached = await run('cache-hit-twice');
    expect(cached.serverHits).toBe(1);
    expect(cached.r2.hits).toBe(1);
    expect((await run('cache-remove')).serverHits).toBe(2);
  });

  it.each(['share-start', 'share-race', 'share-end'])('[share.opt.policy] %s 的真实网络次数符合策略', async (id) => {
    const result = await run(id);
    expect(result.serverHits).toBe(id === 'share-start' ? 1 : 3);
    if (id === 'share-start') expect(result.hitsSeen).toEqual([1, 1, 1, 1, 1]);
    if (id === 'share-end') expect(result.sameResult).toBe(1);
  });

  it('[retry.opt.max] retry 前两次真实 HTTP 500，第三次恢复；禁用后仅一次网络', async () => {
    const recovered = await run('retry-run');
    expect(recovered.serverHits).toBe(3);
    expect(recovered.result.hits).toBe(3);
    const disabled = await run('retry-disabled');
    expect(disabled.rejected).toBe(true);
    expect(disabled.serverHits).toBe(1);
  });

  it.each(['int-share-start', 'int-race-run', 'int-retry-recover', 'int-retry-exhaust',
    'int-crosstalk-run', 'int-loading-run', 'int-auth-run', 'int-auth-fail-run',
    'int-auth-burst-run', 'int-auth-bounded-run'])('%s 在真实网络上收敛', async (id) => {
    expect((await run(id)).pass).toBe(true);
  });

  it('[mock.fn.axpMock] mock 真正改写 URL，404 后真正回落到原始接口', async () => {
    expect((await run('mock-run')).mocked).toBe(true);
    const fallback = await run('mock-fallback');
    expect(fallback.path).toBe('/api/echo');
    expect(fallback.query.via).toBe('fallback');
    expect(fallback.mocked).toBeUndefined();
  });
});
