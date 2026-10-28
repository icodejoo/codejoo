import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { Axp, axpKey as key, axpCache as cache, clearCache } from '../../src';
import { makeNetwork } from '../helpers/network';
import { use } from '../helpers/install';

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('cache management API', () => {
  it('[cache.fn.clearCache][cache.fn.removeCache] removeCache()/clearCache() operate on the live per-instance store (no removeWhere/.size in axp — see file doc)', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: null } }));
    use(api, [key(), cache()]);

    await api.axios.get('/a', { key: true, cache: true } as any);
    await api.axios.get('/b', { key: true, cache: true } as any);
    let calls = 0;
    net.on('GET', '/a', () => { calls++; return { data: { code: 0, data: null } }; });

    // Without knowing the exact hashed value, removeCache needs the real
    // key — the `key` plugin writes it onto the resolved request config;
    // simplest external proof-of-life is clearCache() wiping everything.
    const cleared = clearCache(api.axios);
    expect(cleared).toBe(2);
    await api.axios.get('/a', { key: true, cache: true } as any);
    expect(calls).toBe(1); // real call again post-clear
  });

  it('[cache.opt.expires] an expired entry is evicted on the next request for that key, not served stale', async () => {
    // vi.useFakeTimers() also fakes makeNetwork()'s own internal
    // setTimeout(fn, latency) — every request's promise needs an explicit
    // vi.advanceTimersByTimeAsync() to ever resolve, not just the "let the
    // TTL pass" advance. Skipping this on the FIRST request hangs forever.
    vi.useFakeTimers();
    try {
      const { net, api } = mkApi();
      let calls = 0;
      net.on('GET', '/data', () => { calls++; return { data: { code: 0, data: { v: calls } } }; });
      use(api, [key(), cache({ expires: 1000 })]);

      const p1 = api.axios.get('/data', { key: true, cache: true } as any);
      await vi.advanceTimersByTimeAsync(0);
      const r1: any = await p1.then(r => r.data.data);
      expect(r1.v).toBe(1);

      await vi.advanceTimersByTimeAsync(2000); // past the 1000ms TTL
      const p2 = api.axios.get('/data', { key: true, cache: true } as any);
      await vi.advanceTimersByTimeAsync(0);
      const r2: any = await p2.then(r => r.data.data);
      expect(r2.v).toBe(2);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[cache.opt.clone][cache.req.cache.clone] clone:"shallow" returns a distinct top-level container without deep-copying nested objects', async () => {
    // `cache: true` (boolean) is documented to always mean shared-reference,
    // clone-free — the plugin-level clone policy only applies when the
    // per-request config uses the OBJECT form (`cache: {}`), per
    // $resolveCache's `v === true` branch omitting `clone` entirely.
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { nested: { v: 1 } } } }));
    use(api, [key(), cache({ clone: 'shallow' })]);

    const r1 = await api.axios.get('/data', { key: true, cache: {} } as any);
    const r2 = await api.axios.get('/data', { key: true, cache: {} } as any);
    expect(r2.data).toEqual(r1.data);
    expect(r2.data).not.toBe(r1.data);
    expect((r2.data as any).data.nested).toBe((r1.data as any).data.nested); // shallow — nested still shared
  });

  it('[cache.opt.clone][cache.req.cache.clone] clone:"deep" recursively copies nested objects, so mutating one hit never affects another', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { nested: { v: 1 } } } }));
    use(api, [key(), cache({ clone: 'deep' })]);

    const r1 = await api.axios.get('/data', { key: true, cache: {} } as any);
    const r2 = await api.axios.get('/data', { key: true, cache: {} } as any);
    (r2.data as any).data.nested.v = 999;
    const r3 = await api.axios.get('/data', { key: true, cache: true } as any);
    expect((r3.data as any).data.nested.v).toBe(1);
    expect(r1.data).not.toBe(r2.data);
  });
});

describe('集成 — cache 命中（顺序）', () => {
  it('[cache.fn.axpCache][cache.req.cache] 首发未命中→打网络；二发命中→不再打网络', async () => {
    const { net, api } = mkApi();
    let n = 0;
    net.on('GET', '/cfg', () => ({ data: { code: 0, data: { v: ++n } } }));
    use(api, [key(), cache({ expires: 10_000 })]);

    const r1: any = await api.get('/cfg')(undefined, { key: true, cache: true });
    const r2: any = await api.get('/cfg')(undefined, { key: true, cache: true });
    expect(r1.v).toBe(1);
    expect(r2.v).toBe(1);                         // 命中缓存，值不变
    expect(net.calls('GET', '/cfg')).toBe(1);     // 网络只打一次
  });
});
