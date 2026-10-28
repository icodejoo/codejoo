import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import cache, { clearCache, removeCache } from '../../src/plugins/cache';
import axios from 'axios';

function makeMockAxios() {
    const ax: any = { defaults: { adapter: vi.fn() } };
    return ax;
}

const mockResp = (data: any, config: any = {}): AxiosResponse =>
    ({ status: 200, statusText: 'OK', headers: {}, config, data } as any);

// Review 修复：#11 旧响应不覆盖 / #12 原始快照 / #14 容量 / #15 shouldCache / #1 clearCache 竞态

const mockAxios = (): any => ({ defaults: { adapter: vi.fn() } });

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('cache 集成 — adapter 包装', () => {
    let originalAdapter: ReturnType<typeof vi.fn>;
    beforeEach(() => { originalAdapter = vi.fn(); });

    it('[cache.req.cache] 未启用缓存：直接走原 adapter', async () => {
        const ax = makeMockAxios();
        ax.defaults.adapter = originalAdapter;
        cache({ expires: 1000 }).install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const config: any = { url: '/x' };  // 无 cache
        originalAdapter.mockResolvedValueOnce(mockResp('first', config));
        await wrapped(config);
        expect(originalAdapter).toHaveBeenCalledTimes(1);
    });

    it('[cache.fn.axpCache] 首次：未命中 → 调原 adapter；二次同 key：命中 → 不调 adapter', async () => {
        const ax = makeMockAxios();
        ax.defaults.adapter = originalAdapter;
        cache({ expires: 1000 }).install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ url: '/x', cache: true, key: 'k1' });

        originalAdapter.mockResolvedValueOnce(mockResp('first', cfg()));
        const r1 = await wrapped(cfg());
        expect(r1.data).toBe('first');
        expect(originalAdapter).toHaveBeenCalledTimes(1);

        // 第二次：命中缓存，原 adapter 不再调
        const r2 = await wrapped(cfg());
        expect(r2.data).toBe('first');  // 同一个缓存
        expect(originalAdapter).toHaveBeenCalledTimes(1);
    });

    it('[cache.opt.expires] TTL 过期 → 重新发起请求', async () => {
        vi.useFakeTimers();
        const ax = makeMockAxios();
        ax.defaults.adapter = originalAdapter;
        cache({ expires: 100 }).install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ url: '/x', cache: true, key: 'k' });

        originalAdapter.mockResolvedValueOnce(mockResp('a'));
        await wrapped(cfg());
        expect(originalAdapter).toHaveBeenCalledTimes(1);

        // 时间推进超过 TTL
        vi.advanceTimersByTime(150);
        originalAdapter.mockResolvedValueOnce(mockResp('b'));
        const r = await wrapped(cfg());
        expect(originalAdapter).toHaveBeenCalledTimes(2);
        expect(r.data).toBe('b');
        vi.useRealTimers();
    });

    it('[cache.req.cache.expires] 请求级 expires 覆盖插件级', async () => {
        vi.useFakeTimers();
        const ax = makeMockAxios();
        ax.defaults.adapter = originalAdapter;
        cache({ expires: 60_000 }).install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ url: '/x', cache: { expires: 50 }, key: 'k' });

        originalAdapter.mockResolvedValueOnce(mockResp('a'));
        await wrapped(cfg());
        vi.advanceTimersByTime(100);  // 超过请求级 50ms
        originalAdapter.mockResolvedValueOnce(mockResp('b'));
        const r = await wrapped(cfg());
        expect(originalAdapter).toHaveBeenCalledTimes(2);
        expect(r.data).toBe('b');
        vi.useRealTimers();
    });

    it('[cache.fn.axpCache] config.cache 在拦截后被 delete（避免污染下游）', async () => {
        const ax = makeMockAxios();
        ax.defaults.adapter = originalAdapter;
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const config: any = { url: '/x', cache: true, key: 'k' };
        originalAdapter.mockResolvedValueOnce(mockResp('x'));
        await wrapped(config);
        expect(config.cache).toBeUndefined();
    });
});

describe('cache 集成 — clone 策略', () => {
    const mkAdapter = (data: any) => vi.fn().mockResolvedValue(mockResp(data));

    it('[cache.opt.clone][cache.req.cache.clone] 默认 / cache:true → 命中返回共享引用，就地改会污染后续命中', async () => {
        const ax = makeMockAxios();
        ax.defaults.adapter = mkAdapter({ list: [1] });
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const r1 = await wrapped({ url: '/x', cache: true, key: 'k' } as any);
        (r1.data as any).list.push(2);                 // 调用方就地改
        const r2 = await wrapped({ url: '/x', cache: true, key: 'k' } as any);
        expect((r2.data as any).list).toEqual([1, 2]); // 共享引用 → 命中被污染
        expect(r2.data).toBe(r1.data);
    });

    it("[cache.opt.clone][cache.req.cache.clone] clone:'shallow' → 顶层隔离，嵌套仍共享", async () => {
        const ax = makeMockAxios();
        ax.defaults.adapter = mkAdapter({ a: 1, nested: { b: 2 } });
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ url: '/x', cache: { clone: 'shallow' }, key: 'k' });
        const r1 = await wrapped(cfg());
        const r2 = await wrapped(cfg());
        expect(r2.data).not.toBe(r1.data);             // 顶层各自独立
        (r1.data as any).a = 999;                       // 改顶层不影响缓存
        const r3 = await wrapped(cfg());
        expect((r3.data as any).a).toBe(1);
    });

    it("[cache.opt.clone][cache.req.cache.clone] clone:'deep' → 完整隔离，就地改任意层都不污染缓存", async () => {
        const ax = makeMockAxios();
        ax.defaults.adapter = mkAdapter({ nested: { b: 2 } });
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ url: '/x', cache: { clone: 'deep' }, key: 'k' });
        const r1 = await wrapped(cfg());
        (r1.data as any).nested.b = 999;                // 改嵌套
        const r2 = await wrapped(cfg());
        expect((r2.data as any).nested.b).toBe(2);      // 缓存原件未被污染
    });

    it('[cache.cb.clone][cache.req.cache.clone.callback] clone:function → 调用自定义拷贝', async () => {
        const ax = makeMockAxios();
        ax.defaults.adapter = mkAdapter({ a: 1 });
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const custom = vi.fn((d: any) => ({ ...d, cloned: true }));
        const r = await wrapped({ url: '/x', cache: { clone: custom }, key: 'k' } as any);
        expect(custom).toHaveBeenCalledTimes(1);
        expect((r.data as any).cloned).toBe(true);
    });
});

describe('removeCache / clearCache', () => {
    it('[cache.fn.removeCache] removeCache 删除单条', async () => {
        const ax = makeMockAxios();
        const adp = vi.fn().mockResolvedValue(mockResp('a'));
        ax.defaults.adapter = adp;
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k1' } as any);
        expect(removeCache(ax, 'k1')).toBe(true);
        // 删除后再请求 → 重新发起
        adp.mockResolvedValueOnce(mockResp('b'));
        await wrapped({ cache: true, key: 'k1' } as any);
        expect(adp).toHaveBeenCalledTimes(2);
    });

    it('[cache.fn.clearCache] clearCache 清空全部', async () => {
        const ax = makeMockAxios();
        const adp = vi.fn().mockResolvedValue(mockResp('a'));
        ax.defaults.adapter = adp;
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k1' } as any);
        await wrapped({ cache: true, key: 'k2' } as any);
        expect(clearCache(ax)).toBe(2);
        expect(clearCache(ax)).toBe(0);  // 已空
    });
});

describe('cache — 命中响应的 config 是本次请求的', () => {
    it('[cache.fn.axpCache] 命中时 response.config 换成本次 config，data 仍共享引用', async () => {
        const ax = makeMockAxios();
        const data = { v: 1 };
        ax.defaults.adapter = vi.fn().mockResolvedValue(mockResp(data, { first: true }));
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k' } as any);
        const cfg2: any = { cache: true, key: 'k', second: true };
        const hit = await wrapped(cfg2);
        expect(hit.config).toBe(cfg2);
        expect(hit.data).toBe(data);
    });
});

// 来源 review #12
describe('cache — 缓存原始快照，命中不被 transformResponse 二次改写', () => {
    it('[cache.fn.axpCache] 每次命中都只转换一次', async () => {
        const net = vi.fn(async (config: any) => mockResp('raw', config));
        const ax = axios.create({
            adapter: [net as any],
            transformResponse: [(d: any) => ({ wrapped: d })],
        });
        cache().install(ax);
        const r1 = await ax.get('/a', { cache: true, key: 'k' } as any);
        const r2 = await ax.get('/a', { cache: true, key: 'k' } as any);
        const r3 = await ax.get('/a', { cache: true, key: 'k' } as any);
        expect(r1.data).toEqual({ wrapped: 'raw' });
        expect(r2.data).toEqual({ wrapped: 'raw' });
        expect(r3.data).toEqual({ wrapped: 'raw' });
        expect(net).toHaveBeenCalledTimes(1);
    });

    it('[cache.fn.axpCache] 命中返回独立外壳（改 headers/status 不影响缓存）', async () => {
        const ax = mockAxios();
        ax.defaults.adapter = vi.fn().mockResolvedValue({ ...mockResp('a'), headers: { x: '1' } });
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ cache: true, key: 'k' });
        await wrapped(cfg());
        const h1 = await wrapped(cfg());
        (h1.headers as any).x = 'changed';
        h1.status = 500;
        const h2 = await wrapped(cfg());
        expect(h2.status).toBe(200);
        expect((h2.headers as any).x).toBe('1');
    });
});

// 来源 review #14
describe('cache — max 容量 / LRU / 写入清理过期', () => {
    it('[cache.opt.max] 超出 max 淘汰最久未使用项', async () => {
        const ax = mockAxios();
        const adp = vi.fn(async () => mockResp('v'));
        ax.defaults.adapter = adp;
        cache({ max: 2 }).install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const c = (k: string): any => ({ cache: true, key: k });
        await wrapped(c('a'));
        await wrapped(c('b'));
        await wrapped(c('a')); // 命中，a 变最近使用
        await wrapped(c('c')); // 写入，淘汰 b
        expect(adp).toHaveBeenCalledTimes(3);
        await wrapped(c('a'));
        expect(adp).toHaveBeenCalledTimes(3); // a 仍在
        await wrapped(c('b'));
        expect(adp).toHaveBeenCalledTimes(4); // b 被淘汰
    });

    it('[cache.opt.max] 写入时顺带清理过期项', async () => {
        vi.useFakeTimers();
        try {
            const ax = mockAxios();
            ax.defaults.adapter = vi.fn(async () => mockResp('v'));
            cache({ expires: 100 }).install(ax);
            const wrapped = ax.defaults.adapter as AxiosAdapter;
            await wrapped({ cache: true, key: 'old1' } as any);
            await wrapped({ cache: true, key: 'old2' } as any);
            vi.advanceTimersByTime(200);
            await wrapped({ cache: true, key: 'fresh' } as any);
            expect(clearCache(ax)).toBe(1); // 过期两项已被清掉
        } finally {
            vi.useRealTimers();
        }
    });
});

// 来源 review #15
describe('cache — shouldCache', () => {
    it('[cache.cb.shouldCache][cache.fn.$defaultShouldCache] 默认不缓存业务失败信封（code 非 0/"0000"）', async () => {
        const ax = mockAxios();
        const adp = vi
            .fn()
            .mockResolvedValueOnce(mockResp({ code: 1, message: 'bad' }))
            .mockResolvedValue(mockResp({ code: 0, data: 1 }));
        ax.defaults.adapter = adp;
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ cache: true, key: 'k' });
        await wrapped(cfg());
        const r2 = await wrapped(cfg());
        expect((r2.data as any).code).toBe(0);
        expect(adp).toHaveBeenCalledTimes(2);
        await wrapped(cfg()); // 成功已缓存
        expect(adp).toHaveBeenCalledTimes(2);
    });

    it('[cache.fn.$defaultShouldCache] 无信封的普通响应照常缓存', async () => {
        const ax = mockAxios();
        const adp = vi.fn(async () => mockResp([1, 2]));
        ax.defaults.adapter = adp;
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k' } as any);
        await wrapped({ cache: true, key: 'k' } as any);
        expect(adp).toHaveBeenCalledTimes(1);
    });

    it('[cache.cb.shouldCache][cache.req.cache.shouldCache] 插件级 / 请求级 shouldCache 覆盖默认（请求级优先）', async () => {
        const ax = mockAxios();
        const adp = vi.fn(async () => mockResp({ code: 1 }));
        ax.defaults.adapter = adp;
        cache({ shouldCache: () => true }).install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k' } as any);
        await wrapped({ cache: true, key: 'k' } as any);
        expect(adp).toHaveBeenCalledTimes(1);
        await wrapped({ cache: { shouldCache: () => false }, key: 'k2' } as any);
        await wrapped({ cache: { shouldCache: () => false }, key: 'k2' } as any);
        expect(adp).toHaveBeenCalledTimes(3);
    });
});

describe('cache — 卸载、代次与 TTL 边界', () => {
    it('[cache.opt.enable] enable:false 保持 adapter 身份且不创建缓存仓', () => {
        const ax = axios.create();
        const before = ax.defaults.adapter;
        expect(cache({ enable: false }).install(ax)).toBeUndefined();
        expect(ax.defaults.adapter).toBe(before);
        expect(clearCache(ax)).toBe(0);
    });
});
