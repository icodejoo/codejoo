import { it, expect } from 'vitest';
import axios from 'axios';
import axpRetry from '../../src/plugins/retry';
import { Axp } from '../../src/install';
import { makeNetwork } from '../helpers/network';
import cache from '../../src/plugins/cache';

it('[retry.opt.max × cache.req.cache.key] retry + cache — 失败后重试成功的那次写入缓存，后续请求命中缓存', async () => {
    const net = makeNetwork().on('GET', '/rc', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
    const ax = axios.create({ adapter: net.adapter });
    Axp.install(ax, { retry: axpRetry({ max: 1, delay: 0 }), cache: cache() });
    const r1 = await ax.get('/rc', { cache: { key: 'retry-cache' } });
    expect(r1.status).toBe(200);
    expect(net.calls('GET', '/rc')).toBe(2);   // 500 + 重试成功
    const r2 = await ax.get('/rc', { cache: { key: 'retry-cache' } });
    expect(r2.status).toBe(200);
    expect(net.calls('GET', '/rc')).toBe(2);   // 命中缓存，没有新请求
});
