import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios';
import cache, { $resolveCache, $resolveKey, clearCache, removeCache } from './cache';


function makeMockCtx() {
    let installedAdapter: AxiosAdapter | null = null;
    const ax: any = { defaults: { adapter: vi.fn() } };
    const cleanups: Array<() => void> = [];
    const ctx: any = {
        axios: ax,
        name: 'cache',
        logger: { log: () => { }, warn: () => { }, error: () => { } },
        request: () => { },
        response: () => { },
        adapter: (a: AxiosAdapter) => { installedAdapter = a; ax.defaults.adapter = a; },
        transformRequest: () => { },
        transformResponse: () => { },
        cleanup: (fn: any) => cleanups.push(fn),
    };
    return { ctx, ax, get adapter() { return installedAdapter!; }, cleanups };
}

const mockResp = (data: any, config: any = {}): AxiosResponse =>
    ({ status: 200, statusText: 'OK', headers: {}, config, data } as any);


describe('$resolveCache', () => {
    it('false / 未指定 → null', () => {
        expect($resolveCache({ cache: false } as any, {})).toBe(null);
        expect($resolveCache({} as any, {})).toBe(null);
    });
    it('true → 启用，用插件级 expires', () => {
        expect($resolveCache({ cache: true } as any, { expires: 1000 })).toEqual({ expires: 1000 });
    });
    it('对象 → 取请求级 expires/key，缺失时回退插件级', () => {
        expect($resolveCache({ cache: { expires: 50 } } as any, { expires: 1000 }))
            .toEqual({ expires: 50, key: undefined });
        expect($resolveCache({ cache: { key: 'k' } } as any, { expires: 1000 }))
            .toEqual({ expires: 1000, key: 'k' });
    });
});


describe('$resolveKey', () => {
    it('请求级字符串 key 优先', () => {
        expect($resolveKey({} as any, { key: 'req' }, { key: () => 'plug' })).toBe('req');
    });
    it('请求级函数次之', () => {
        expect($resolveKey({} as any, { key: () => 'fn' }, { key: () => 'plug' })).toBe('fn');
    });
    it('插件级函数再次之', () => {
        expect($resolveKey({} as any, {}, { key: () => 'plug' })).toBe('plug');
    });
    it('回退到 config.key（build-key 兜底）', () => {
        expect($resolveKey({ key: 'fromBuildKey' } as any, {}, {})).toBe('fromBuildKey');
    });
    it('全部缺失 → undefined', () => {
        expect($resolveKey({} as any, {}, {})).toBeUndefined();
    });
});


describe('cache 集成 — adapter 包装', () => {
    let originalAdapter: ReturnType<typeof vi.fn>;
    beforeEach(() => { originalAdapter = vi.fn(); });

    it('未启用缓存：直接走原 adapter', async () => {
        const { ctx, ax, adapter: _ } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        cache({ expires: 1000 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const config: any = { url: '/x' };  // 无 cache
        originalAdapter.mockResolvedValueOnce(mockResp('first', config));
        await wrapped(config);
        expect(originalAdapter).toHaveBeenCalledTimes(1);
    });

    it('首次：未命中 → 调原 adapter；二次同 key：命中 → 不调 adapter', async () => {
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        cache({ expires: 1000 }).install(ctx);
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

    it('TTL 过期 → 重新发起请求', async () => {
        vi.useFakeTimers();
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        cache({ expires: 100 }).install(ctx);
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

    it('请求级 expires 覆盖插件级', async () => {
        vi.useFakeTimers();
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        cache({ expires: 60_000 }).install(ctx);
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

    it('config.cache 在拦截后被 delete（避免污染下游）', async () => {
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        cache().install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const config: any = { url: '/x', cache: true, key: 'k' };
        originalAdapter.mockResolvedValueOnce(mockResp('x'));
        await wrapped(config);
        expect(config.cache).toBeUndefined();
    });
});


describe('removeCache / clearCache', () => {
    it('removeCache 删除单条', async () => {
        const { ctx, ax } = makeMockCtx();
        const adp = vi.fn().mockResolvedValue(mockResp('a'));
        ax.defaults.adapter = adp;
        cache().install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k1' } as any);
        expect(removeCache(ax, 'k1')).toBe(true);
        // 删除后再请求 → 重新发起
        adp.mockResolvedValueOnce(mockResp('b'));
        await wrapped({ cache: true, key: 'k1' } as any);
        expect(adp).toHaveBeenCalledTimes(2);
    });

    it('clearCache 清空全部', async () => {
        const { ctx, ax } = makeMockCtx();
        const adp = vi.fn().mockResolvedValue(mockResp('a'));
        ax.defaults.adapter = adp;
        cache().install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k1' } as any);
        await wrapped({ cache: true, key: 'k2' } as any);
        expect(clearCache(ax)).toBe(2);
        expect(clearCache(ax)).toBe(0);  // 已空
    });

    it('对未安装实例：返回 0/false', () => {
        const fakeAx = {} as any;
        expect(removeCache(fakeAx, 'x')).toBe(false);
        expect(clearCache(fakeAx)).toBe(0);
    });
});
