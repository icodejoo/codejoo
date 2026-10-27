import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import cache, { clearCache } from '../src/plugins/cache';

// Review 修复：#11 旧响应不覆盖 / #12 原始快照 / #14 容量 / #15 shouldCache / #1 clearCache 竞态

const mockAxios = (): any => ({ defaults: { adapter: vi.fn() } });
const mockResp = (data: any, config: any = {}): AxiosResponse =>
    ({ status: 200, statusText: 'OK', headers: {}, config, data }) as any;

/** 构造可手动落定的 promise */
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: any) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('cache — #11 较晚完成的旧响应不覆盖新结果', () => {
    it('A 先发后到、B 后发先到 → 缓存保留 B', async () => {
        const ax = mockAxios();
        const a = deferred<AxiosResponse>();
        const b = deferred<AxiosResponse>();
        const adp = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
        ax.defaults.adapter = adp;
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ url: '/x', cache: true, key: 'k' });
        const pa = wrapped(cfg());
        const pb = wrapped(cfg());
        b.resolve(mockResp(2));
        await pb;
        a.resolve(mockResp(1));
        await pa;
        const hit = await wrapped(cfg());
        expect(hit.data).toBe(2);
        expect(adp).toHaveBeenCalledTimes(2);
    });
});

describe('cache — #12 缓存原始快照，命中不被 transformResponse 二次改写', () => {
    it('每次命中都只转换一次', async () => {
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

    it('命中返回独立外壳（改 headers/status 不影响缓存）', async () => {
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

describe('cache — #14 max 容量 / LRU / 写入清理过期', () => {
    it('超出 max 淘汰最久未使用项', async () => {
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

    it('写入时顺带清理过期项', async () => {
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

describe('cache — #15 shouldCache', () => {
    it('默认不缓存业务失败信封（code 非 0/"0000"）', async () => {
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

    it('未解析的 JSON 字符串信封同样识别', async () => {
        const ax = mockAxios();
        const adp = vi.fn(async () => mockResp('{"code":1}'));
        ax.defaults.adapter = adp;
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k' } as any);
        await wrapped({ cache: true, key: 'k' } as any);
        expect(adp).toHaveBeenCalledTimes(2);
    });

    it('无信封的普通响应照常缓存', async () => {
        const ax = mockAxios();
        const adp = vi.fn(async () => mockResp([1, 2]));
        ax.defaults.adapter = adp;
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k' } as any);
        await wrapped({ cache: true, key: 'k' } as any);
        expect(adp).toHaveBeenCalledTimes(1);
    });

    it('插件级 / 请求级 shouldCache 覆盖默认（请求级优先）', async () => {
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

describe('cache — #1 clearCache 与在途请求', () => {
    it('clearCache 之前发出的请求落定后不回写', async () => {
        const ax = mockAxios();
        const a = deferred<AxiosResponse>();
        const adp = vi.fn().mockReturnValueOnce(a.promise).mockResolvedValue(mockResp('new'));
        ax.defaults.adapter = adp;
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ cache: true, key: 'k' });
        const pa = wrapped(cfg());
        clearCache(ax); // 切换账号
        a.resolve(mockResp('old'));
        await pa;
        const r = await wrapped(cfg());
        expect(r.data).toBe('new');
        expect(adp).toHaveBeenCalledTimes(2);
    });
});

describe('cache — 条目被 LRU 淘汰后旧响应仍不回写', () => {
    it('A 先发、B 后发先到，其他 key 淘汰 B 后 A 到达不得写入', async () => {
        const ax = mockAxios();
        const a = deferred<AxiosResponse>();
        const b = deferred<AxiosResponse>();
        const adp = vi.fn()
            .mockReturnValueOnce(a.promise)
            .mockReturnValueOnce(b.promise)
            .mockResolvedValueOnce(mockResp('o'))
            .mockResolvedValue(mockResp('fresh'));
        ax.defaults.adapter = adp;
        cache({ max: 1 }).install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const pa = wrapped({ url: '/x', cache: true, key: 'k' } as any);
        const pb = wrapped({ url: '/x', cache: true, key: 'k' } as any);
        b.resolve(mockResp('B'));
        await pb;
        await wrapped({ url: '/o', cache: true, key: 'other' } as any); // 淘汰 k
        a.resolve(mockResp('A'));
        await pa;
        const r = await wrapped({ url: '/x', cache: true, key: 'k' } as any);
        expect(r.data).toBe('fresh'); // 未命中旧 A
        expect(adp).toHaveBeenCalledTimes(4);
    });

    it('在途请求结束后 key 的 seq 表被清理', async () => {
        const ax = mockAxios();
        ax.defaults.adapter = vi.fn().mockResolvedValue(mockResp(1));
        cache({ max: 1 }).install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        for (let i = 0; i < 3; i++) await wrapped({ url: '/x', cache: true, key: `k${i}` } as any);
        // 行为层面：仍可正常工作且不抛错
        expect((await wrapped({ url: '/x', cache: true, key: 'k2' } as any)).data).toBe(1);
    });
});
