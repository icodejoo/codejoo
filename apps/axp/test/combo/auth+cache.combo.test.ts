import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { Axp } from '../../src';
import auth from '../../src/plugins/auth';
import cache from '../../src/plugins/cache';
import { makeTM, authBackend } from '../helpers/auth';

describe('auth 集成 — 刷新重放 + cache', () => {
  it('[auth.cb.onRefresh × cache.req.cache.key] 401 → 刷新 → 重放成功的那次写入缓存，后续相同 key 请求命中缓存', async () => {
    const net = authBackend('srv-1');
    const tm = makeTM('stale');
    const ax = axios.create({ adapter: net.adapter });
    Axp.install(ax, {
      auth: auth({ tokenManager: tm, urlPattern: ['/me'], onRefresh: () => { tm.set('srv-1'); return true; }, onAccessExpired: () => { } }),
      cache: cache(),
    });

    const r1 = await ax.get('/me', { cache: { key: 'auth-cache' } });
    expect(r1.status).toBe(200);
    expect(net.calls('GET', '/me')).toBe(2);   // 401 + 重放
    const r2 = await ax.get('/me', { cache: { key: 'auth-cache' } });
    expect(r2.status).toBe(200);
    expect(net.calls('GET', '/me')).toBe(2);   // 命中缓存，没有新请求
  });
});
