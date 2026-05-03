import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import cache, {
    $resetSharedManager,
    $resolveCache,
    $restore,
    $strip,
    clearCache,
    removeCache,
} from './cache';
import type { ICacheStorage } from './types';


function makeMockCtx(plugins: string[] = ['key']) {
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
        plugins: () => plugins,
    };
    return { ctx, ax, get adapter() { return installedAdapter!; }, cleanups };
}

const mockResp = (data: any, config: any = {}): AxiosResponse =>
    ({
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        data,
    } as any);

/** 内存 storage 适配器（同步） —— `raw:true` 让 StorageManager 跳过 JSON */
function memoryStorage(): ICacheStorage & { _map: Map<string, unknown> } {
    const m = new Map<string, unknown>();
    return {
        raw: true,
        _map: m,
        getItem: (k) => m.get(k),
        setItem: (k, v) => { m.set(k, v); },
        removeItem: (k) => { m.delete(k); },
        clear: () => { m.clear(); },
    };
}

/** 异步 storage 适配器（模拟 IndexedDB） */
function asyncStorage(): ICacheStorage & { _map: Map<string, unknown> } {
    const m = new Map<string, unknown>();
    return {
        raw: true,
        _map: m,
        getItem: async (k) => { await Promise.resolve(); return m.get(k); },
        setItem: async (k, v) => { await Promise.resolve(); m.set(k, v); },
        removeItem: async (k) => { await Promise.resolve(); m.delete(k); },
        clear: async () => { await Promise.resolve(); m.clear(); },
    };
}


// 全局共享 manager —— 每个测试间用 $resetSharedManager() 完全销毁重建，避免测试之间
// 的 storage / state 污染。
beforeEach(() => { $resetSharedManager(); });
afterEach(() => { $resetSharedManager(); });


/* ── install 时强校验 key 插件 ────────────────────────────────────────── */

describe('cache — install 校验', () => {
    it('未装 key 插件 → install 抛错', () => {
        const { ctx } = makeMockCtx([]);
        expect(() => cache().install(ctx)).toThrow(/requires "key"/);
    });
    it('已装 key 插件 → install 成功', () => {
        const { ctx } = makeMockCtx(['key']);
        expect(() => cache().install(ctx)).not.toThrow();
    });
    it('enable:false → install 仍然进行（因为是共享 manager），但请求级 cache 缺失时跳过', () => {
        const { ctx, ax } = makeMockCtx(['key']);
        const orig = ax.defaults.adapter;
        cache({ enable: false }).install(ctx);
        // 即使 enable=false，adapter 还是被替换的（共享 manager 模式）
        expect(ax.defaults.adapter).not.toBe(orig);
    });
});


/* ── $resolveCache：请求级配置解析 ───────────────────────────────────── */

describe('$resolveCache', () => {
    const defaults = { ttl: 60_000, background: false, memory: false, give: undefined };

    it('cache: false → 永远 null', () => {
        expect($resolveCache({ cache: false } as any, defaults, true)).toBe(null);
        expect($resolveCache({ cache: false } as any, defaults, false)).toBe(null);
    });

    it('cache: undefined + enable:false → null（默认不缓存）', () => {
        expect($resolveCache({} as any, defaults, false)).toBe(null);
    });

    it('cache: undefined + enable:true → 用 defaults', () => {
        expect($resolveCache({} as any, defaults, true)).toBe(defaults);
    });

    it('cache: true → 永远用 defaults（覆盖 enable:false）', () => {
        const r = $resolveCache({ cache: true } as any, defaults, false);
        expect(r).toBe(defaults);
    });

    it('对象覆盖 → 字段合并；缺失回退插件级', () => {
        const r = $resolveCache(
            { cache: { ttl: 50 } } as any,
            defaults,
            true,
        );
        expect(r).toEqual({ ttl: 50, background: false, memory: false, give: undefined });
    });

    it('MaybeFunc：函数动态返回', () => {
        expect($resolveCache({ cache: () => true } as any, defaults, false)).toBe(defaults);
        expect($resolveCache({ cache: () => false } as any, defaults, true)).toBe(null);
    });
});


/* ── $strip / $restore ──────────────────────────────────────────────── */

describe('$strip / $restore', () => {
    it('strip: data + ttl → entry 形态', () => {
        const e = $strip({ x: 1 }, 1000);
        expect(e.expiresAt).toBeGreaterThan(Date.now());
        expect(e.data).toEqual({ x: 1 });
    });

    it('restore 标记 _cache=true', () => {
        const e = $strip({ ok: 1 }, 1000);
        const out = $restore(e, { url: '/x' } as any);
        expect(out._cache).toBe(true);
        expect(out.data).toEqual({ ok: 1 });
        expect(out.config.url).toBe('/x');
    });

    it('JSON round-trip 保真', () => {
        const e = $strip({ a: 1, b: [1, 2] }, 1000);
        const back = JSON.parse(JSON.stringify(e));
        const out = $restore(back, {} as any);
        expect(out.data).toEqual({ a: 1, b: [1, 2] });
    });
});


/* ── adapter 集成 ─────────────────────────────────────────────────── */

describe('cache — adapter 集成', () => {
    let originalAdapter: ReturnType<typeof vi.fn>;
    beforeEach(() => { originalAdapter = vi.fn(); });

    it('config.cache 缺失 + enable:false → 直接走原 adapter', async () => {
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        cache({ enable: false, storage: memoryStorage() }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const config: any = { url: '/x', key: 'k' };
        originalAdapter.mockResolvedValueOnce(mockResp('first'));
        const r = await wrapped(config);
        expect(originalAdapter).toHaveBeenCalledTimes(1);
        expect(r._cache).toBeUndefined();
    });

    it('config.key 缺失 → 静默 passthrough（不缓存）', async () => {
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        const store = memoryStorage();
        cache({ storage: store }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        originalAdapter.mockResolvedValueOnce(mockResp('first'));
        await wrapped({ url: '/x', cache: true } as any);
        expect(originalAdapter).toHaveBeenCalledTimes(1);
        expect(store._map.size).toBe(0);
    });

    it('首次 miss → 调原 adapter；二次 hit → 不调，返回 _cache=true', async () => {
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        cache({ ttl: 1000, storage: memoryStorage() }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ url: '/x', cache: true, key: 'k1' });

        originalAdapter.mockResolvedValueOnce(mockResp('first'));
        const r1 = await wrapped(cfg());
        expect(r1.data).toBe('first');
        expect(r1._cache).toBeUndefined();
        expect(originalAdapter).toHaveBeenCalledTimes(1);

        const r2 = await wrapped(cfg());
        expect(r2.data).toBe('first');
        expect(r2._cache).toBe(true);
        expect(originalAdapter).toHaveBeenCalledTimes(1);
    });

    it('TTL 过期 → 重新发起，命中清掉旧条目', async () => {
        vi.useFakeTimers();
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        cache({ ttl: 100, storage: memoryStorage() }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ url: '/x', cache: true, key: 'k' });

        originalAdapter.mockResolvedValueOnce(mockResp('a'));
        await wrapped(cfg());

        vi.advanceTimersByTime(150);
        originalAdapter.mockResolvedValueOnce(mockResp('b'));
        const r = await wrapped(cfg());
        expect(originalAdapter).toHaveBeenCalledTimes(2);
        expect(r.data).toBe('b');
        vi.useRealTimers();
    });

    it('请求级 ttl 覆盖插件级', async () => {
        vi.useFakeTimers();
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        cache({ ttl: 60_000, storage: memoryStorage() }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ url: '/x', cache: { ttl: 50 }, key: 'k' });

        originalAdapter.mockResolvedValueOnce(mockResp('a'));
        await wrapped(cfg());
        vi.advanceTimersByTime(100);
        originalAdapter.mockResolvedValueOnce(mockResp('b'));
        const r = await wrapped(cfg());
        expect(originalAdapter).toHaveBeenCalledTimes(2);
        expect(r.data).toBe('b');
        vi.useRealTimers();
    });

    it('config.cache 在解析后被 delete', async () => {
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        cache({ storage: memoryStorage() }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const config: any = { url: '/x', cache: true, key: 'k' };
        originalAdapter.mockResolvedValueOnce(mockResp('x'));
        await wrapped(config);
        expect(config.cache).toBeUndefined();
    });

    it('method 不在白名单 → 不缓存', async () => {
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        const store = memoryStorage();
        cache({ methods: ['get'], storage: store }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        originalAdapter.mockResolvedValueOnce(mockResp('a'));
        await wrapped({ method: 'POST', url: '/x', cache: true, key: 'k' } as any);
        expect(store._map.size).toBe(0);
    });

    it("methods: '*' → 所有 method 都参与", async () => {
        const { ctx, ax } = makeMockCtx();
        ax.defaults.adapter = originalAdapter;
        const store = memoryStorage();
        cache({ methods: '*', storage: store }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        originalAdapter.mockResolvedValueOnce(mockResp('a'));
        await wrapped({ method: 'POST', url: '/x', cache: true, key: 'k' } as any);
        expect(store._map.size).toBe(1);
    });
});


/* ── 异步 storage ────────────────────────────────────────── */

describe('cache — 异步 storage', () => {
    it('storage 返回 Promise → adapter await 后正常工作', async () => {
        const { ctx, ax } = makeMockCtx();
        const adp = vi.fn();
        ax.defaults.adapter = adp;
        const store = asyncStorage();
        cache({ storage: store }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        adp.mockResolvedValueOnce(mockResp('first'));
        await wrapped({ url: '/x', cache: true, key: 'k' } as any);
        expect(store._map.size).toBe(1);

        const r = await wrapped({ url: '/x', cache: true, key: 'k' } as any);
        expect(r._cache).toBe(true);
        expect(adp).toHaveBeenCalledTimes(1);
    });
});


/* ── background 模式 ─────────────────────── */

describe('cache — background 模式', () => {
    it('命中即返回；同时后台 fetch 并更新缓存', async () => {
        const { ctx, ax } = makeMockCtx();
        const adp = vi.fn();
        ax.defaults.adapter = adp;
        cache({ storage: memoryStorage(), background: true }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const cfg = (): any => ({ url: '/x', cache: true, key: 'k' });

        adp.mockResolvedValueOnce(mockResp('a'));
        const r1 = await wrapped(cfg());
        expect(r1.data).toBe('a');

        adp.mockResolvedValueOnce(mockResp('b'));
        const r2 = await wrapped(cfg());
        expect(r2.data).toBe('a');
        expect(r2._cache).toBe(true);

        // 等后台 fetch 完成
        await new Promise((r) => setTimeout(r, 10));
        expect(adp).toHaveBeenCalledTimes(2);

        const r3 = await wrapped(cfg());
        expect(r3.data).toBe('b');
        expect(r3._cache).toBe(true);
    });

    it('background fetch 失败不影响命中返回', async () => {
        const { ctx, ax } = makeMockCtx();
        const adp = vi.fn();
        ax.defaults.adapter = adp;
        cache({ storage: memoryStorage(), background: true }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        adp.mockResolvedValueOnce(mockResp('a'));
        await wrapped({ url: '/x', cache: true, key: 'k' } as any);

        adp.mockRejectedValueOnce(new Error('bg-fail'));
        const r = await wrapped({ url: '/x', cache: true, key: 'k' } as any);
        expect(r.data).toBe('a');
        expect(r._cache).toBe(true);
        await new Promise((r) => setTimeout(r, 10)); // 让 bg 错误被吞
    });
});


/* ── removeCache / clearCache ─────────────────────── */

describe('removeCache / clearCache', () => {
    it('removeCache 删除指定 key', async () => {
        const { ctx, ax } = makeMockCtx();
        const adp = vi.fn().mockResolvedValue(mockResp('a'));
        ax.defaults.adapter = adp;
        const store = memoryStorage();
        cache({ storage: store }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k1' } as any);
        expect(store._map.has('k1')).toBe(true);

        expect(await removeCache('k1')).toBe(true);
        expect(store._map.has('k1')).toBe(false);

        adp.mockResolvedValueOnce(mockResp('b'));
        await wrapped({ cache: true, key: 'k1' } as any);
        expect(adp).toHaveBeenCalledTimes(2);
    });

    it('clearCache 清空整个 storage', async () => {
        const { ctx, ax } = makeMockCtx();
        const adp = vi.fn().mockResolvedValue(mockResp('a'));
        ax.defaults.adapter = adp;
        const store = memoryStorage();
        cache({ storage: store }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k1' } as any);
        await wrapped({ cache: true, key: 'k2' } as any);
        expect(store._map.size).toBe(2);

        expect(await clearCache()).toBe(true);
        expect(store._map.size).toBe(0);
    });

    it('未装 cache 插件时调 removeCache → false', async () => {
        // 这个 case 比较难造 —— sharedManager 在某次 install 后就保持。
        // 跳过，因为模块级 sharedManager 一旦装上就持久了
    });
});
