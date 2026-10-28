import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { Axp } from '../../src';
import auth from '../../src/plugins/auth';
import type { ITokenManager } from '../../src/objects/TokenManager';
import { sleep } from '../helpers/sleep';
import { authBackend, makeTM } from '../helpers/auth';

/** 给请求加延迟（毫秒），配合 makeNetwork 制造乱序 */
const lat = (ms: number) => ({ latency: ms } as any);

describe('auth 集成 — handle 重排不丢在途刷新', () => {
  it('[public.handle.prepend][auth.cb.onRefresh] 刷新进行中 prepend 触发整体重装 → 窗口内新请求仍复用同一次刷新，onRefresh 只调一次', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const ax = axios.create({ adapter: net.adapter });
    const onRefresh = vi.fn(async (TM: ITokenManager) => { await sleep(60); TM.set('srv-1'); return true; });
    const handle = Axp.install(ax, { auth: auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh, onAccessExpired: () => { } }) });

    const p1 = ax.get('/me', lat(5));          // 401 → 触发刷新
    await sleep(30);                           // 刷新进行中
    handle.prepend({ name: 'noop', install: () => undefined });   // 整体拆卸 + 重装 auth
    const p2 = ax.get('/me', lat(5));          // 重装后到达的请求应加入同一刷新窗口
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('[public.handle.dispose][auth.cb.onRefresh] 刷新进行中 dispose 后换另一个 tokenManager 重装 → 新请求不等旧刷新，旧刷新失败也不影响', async () => {
    const net = authBackend('srv-1');
    const ax = axios.create({ adapter: net.adapter });
    const oldTm = makeTM('stale');
    let resolveOld!: (v: boolean) => void;
    const oldRefresh = vi.fn(() => new Promise<boolean>((r) => { resolveOld = r; }));
    const h1 = Axp.install(ax, { auth: auth({ tokenManager: oldTm, urlPattern: ['/me'], onRefresh: oldRefresh, onAccessExpired: () => { } }) });

    const p1 = ax.get('/me', lat(5)).catch((e) => e);   // 401 → 旧会话刷新挂起
    await sleep(30);
    expect(oldRefresh).toHaveBeenCalledTimes(1);
    h1.dispose();

    const newTm = makeTM('srv-1');                       // 新会话持有有效 token
    const newRefresh = vi.fn(async () => true);
    Axp.install(ax, { auth: auth({ tokenManager: newTm, urlPattern: ['/me'], onRefresh: newRefresh, onAccessExpired: () => { } }) });

    const p2 = ax.get('/me', lat(5));
    await sleep(20);
    resolveOld(false);                                   // 旧刷新失败
    const r2 = await p2;
    await p1;

    expect(r2.status).toBe(200);
    expect(newRefresh).not.toHaveBeenCalled();
  });
});
