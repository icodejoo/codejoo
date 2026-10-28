import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import type { AxiosResponse, AxiosAdapter } from 'axios';
import cache, { clearCache, removeCache } from '../../src/plugins/cache';

const mockResp = (data: any, config: any = {}): AxiosResponse =>
    ({ status: 200, statusText: 'OK', headers: {}, config, data } as any);

// Review 修复：#11 旧响应不覆盖 / #12 原始快照 / #14 容量 / #15 shouldCache / #1 clearCache 竞态

const mockAxios = (): any => ({ defaults: { adapter: vi.fn() } });

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

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** 构造 adapter 层原始响应。 */
function response(data: unknown, config: any = {}) {
    return { data, config, status: 200, statusText: '', headers: {} };
}

describe('removeCache / clearCache', () => {
    it('[cache.fn.removeCache][cache.fn.clearCache] 对未安装实例：返回 0/false', () => {
        const fakeAx = {} as any;
        expect(removeCache(fakeAx, 'x')).toBe(false);
        expect(clearCache(fakeAx)).toBe(0);
    });
});

describe('cache — 裸 axios.create()（非函数 adapter）', () => {
    it('[cache.fn.axpCache] defaults.adapter 是数组时安装不崩，二次同 key 命中缓存', async () => {
        const net = vi.fn(async (config: any) => mockResp({ n: 1 }, config));
        // 数组形式的 adapter：与 axios.create() 默认的 ['xhr','http','fetch'] 同属“非函数”分支
        const ax = axios.create({ adapter: [net as any] });
        expect(typeof ax.defaults.adapter).not.toBe('function');
        cache().install(ax);
        await ax.get('/a', { cache: true, key: 'k' } as any);
        const r2 = await ax.get('/a', { cache: true, key: 'k' } as any);
        expect(r2.data).toEqual({ n: 1 });
        expect(net).toHaveBeenCalledTimes(1);
    });
});

// 来源 review #11
describe('cache — 较晚完成的旧响应不覆盖新结果', () => {
    it('[cache.fn.axpCache] A 先发后到、B 后发先到 → 缓存保留 B', async () => {
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

// 来源 review #15
describe('cache — shouldCache', () => {
    it('[cache.fn.$defaultShouldCache] 未解析的 JSON 字符串信封同样识别', async () => {
        const ax = mockAxios();
        const adp = vi.fn(async () => mockResp('{"code":1}'));
        ax.defaults.adapter = adp;
        cache().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        await wrapped({ cache: true, key: 'k' } as any);
        await wrapped({ cache: true, key: 'k' } as any);
        expect(adp).toHaveBeenCalledTimes(2);
    });
});

// 来源 review #1
describe('cache — clearCache 与在途请求', () => {
    it('[cache.fn.clearCache] clearCache 之前发出的请求落定后不回写', async () => {
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
    it('[cache.opt.max] A 先发、B 后发先到，其他 key 淘汰 B 后 A 到达不得写入', async () => {
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

    it('[cache.fn.axpCache] 在途请求结束后 key 的 seq 表被清理', async () => {
        const ax = mockAxios();
        ax.defaults.adapter = vi.fn().mockResolvedValue(mockResp(1));
        cache({ max: 1 }).install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        for (let i = 0; i < 3; i++) await wrapped({ url: '/x', cache: true, key: `k${i}` } as any);
        // 行为层面：仍可正常工作且不抛错
        expect((await wrapped({ url: '/x', cache: true, key: 'k2' } as any)).data).toBe(1);
    });
});

describe('cache — 解析与错误边界', () => {
    it('[cache.opt.clone][cache.req.cache.clone] structuredClone 不可用时 deep 明确抛错且不发送请求', async () => {
        vi.stubGlobal('structuredClone', undefined);
        const adapter = vi.fn(async (c) => response('ok', c));
        const ax = axios.create({ adapter });
        cache().install(ax);
        await expect(ax.get('/', { cache: { key: 'k', clone: 'deep' } })).rejects.toThrow('structuredClone');
        expect(adapter).not.toHaveBeenCalled();
    });
    it('[cache.cb.shouldCache][cache.req.cache.shouldCache] shouldCache 抛错后同 key 后续仍能缓存', async () => {
        const adapter = vi.fn(async (c) => response('ok', c));
        const ax = axios.create({ adapter });
        cache().install(ax);
        const error = new Error('predicate');
        await expect(ax.get('/', { cache: { key: 'k', shouldCache: () => { throw error; } } })).rejects.toBe(error);
        await ax.get('/', { cache: { key: 'k' } });
        await ax.get('/', { cache: { key: 'k' } });
        expect(adapter).toHaveBeenCalledTimes(2);
    });
    it('[cache.fn.axpCache] 拒绝不会入缓存，后续成功可正常写入', async () => {
        const error = new Error('network');
        const adapter = vi.fn().mockRejectedValueOnce(error).mockImplementation(async (c) => response('ok', c));
        const ax = axios.create({ adapter });
        cache().install(ax);
        await expect(ax.get('/', { key: 'k', cache: true })).rejects.toBe(error);
        await ax.get('/', { key: 'k', cache: true });
        await ax.get('/', { key: 'k', cache: true });
        expect(adapter).toHaveBeenCalledTimes(2);
    });
});

describe('cache — 卸载、代次与 TTL 边界', () => {
    it('[cache.method.cleanup] 卸载时在途请求仍返回，但旧响应不写入重新安装后的缓存', async () => {
        const pending = deferred<any>();
        const adapter = vi.fn().mockReturnValueOnce(pending.promise).mockImplementation(async (c) => response('new', c));
        const ax = axios.create({ adapter });
        const off = cache().install(ax);
        const old = ax.get('/', { key: 'k', cache: true });
        await vi.waitFor(() => expect(adapter).toHaveBeenCalledOnce());
        off?.();
        expect(removeCache(ax, 'k')).toBe(false);
        cache().install(ax);
        pending.resolve(response('old'));
        expect((await old).data).toBe('old');
        expect((await ax.get('/', { key: 'k', cache: true })).data).toBe('new');
        expect(adapter).toHaveBeenCalledTimes(2);
    });
    it.each([0, -1])('[cache.opt.expires] TTL=%i 不命中，即使时间未推进', async (expires) => {
        vi.useFakeTimers();
        const adapter = vi.fn(async (c) => response('ok', c));
        const ax = axios.create({ adapter });
        cache({ expires }).install(ax);
        await ax.get('/', { key: 'k', cache: true });
        await ax.get('/', { key: 'k', cache: true });
        expect(adapter).toHaveBeenCalledTimes(2);
    });
    it('[cache.opt.expires][cache.opt.max] TTL 恰好到期时重新发送，max=0 回退默认容量', async () => {
        vi.useFakeTimers();
        const adapter = vi.fn(async (c) => response('ok', c));
        const ax = axios.create({ adapter });
        cache({ expires: 10, max: 0 }).install(ax);
        await ax.get('/', { key: 'a', cache: true });
        await ax.get('/', { key: 'b', cache: true });
        expect(clearCache(ax)).toBe(2);
        await ax.get('/', { key: 'a', cache: true });
        vi.advanceTimersByTime(10);
        await ax.get('/', { key: 'a', cache: true });
        expect(adapter).toHaveBeenCalledTimes(4);
    });
});

describe('cache — 选项与回调边界', () => {
    /** 建一个已装插件的实例，adapter 计数。 */
    function setup(opts: any = {}) {
        const adapter = vi.fn(async (c: any) => response('ok', c));
        const ax = axios.create({ adapter });
        const off = cache(opts).install(ax);
        return { adapter, ax, off };
    }

    it('[cache.opt.enable] enable:false 时请求级 cache:true 也不缓存；enable:undefined 视为开启', async () => {
        const a = setup({ enable: false });
        await a.ax.get('/', { key: 'k', cache: true });
        await a.ax.get('/', { key: 'k', cache: true });
        expect(a.adapter).toHaveBeenCalledTimes(2);
        const b = setup({ enable: undefined });
        await b.ax.get('/', { key: 'k', cache: true });
        await b.ax.get('/', { key: 'k', cache: true });
        expect(b.adapter).toHaveBeenCalledTimes(1);
    });

    it.each([false, null, undefined, 0, '', 'yes'])('[cache.req.cache] cache=%j → 视为未启用，不缓存', async (v) => {
        const { adapter, ax } = setup();
        await ax.get('/', { key: 'k', cache: v } as any);
        await ax.get('/', { key: 'k', cache: v } as any);
        expect(adapter).toHaveBeenCalledTimes(2);
        expect(removeCache(ax, 'k')).toBe(false);
    });

    it('[cache.req.cache.expires] expires 为 0/负数/NaN → 写入即视为过期，不命中；undefined 回退插件级', async () => {
        for (const expires of [0, -5, NaN]) {
            const { adapter, ax } = setup();
            await ax.get('/', { key: 'k', cache: { expires } });
            await ax.get('/', { key: 'k', cache: { expires } });
            expect(adapter).toHaveBeenCalledTimes(2);
        }
        const { adapter, ax } = setup({ expires: 1000 });
        await ax.get('/', { key: 'k', cache: { expires: undefined } });
        await ax.get('/', { key: 'k', cache: { expires: undefined } });
        expect(adapter).toHaveBeenCalledTimes(1);
    });

    it('[cache.req.cache.key][cache.cb.key] key 回调返回 undefined/空串 → 不缓存且不回退 config.key', async () => {
        const { adapter, ax } = setup({ key: () => undefined });
        await ax.get('/', { key: 'cfg', cache: true });
        await ax.get('/', { key: 'cfg', cache: true });
        expect(adapter).toHaveBeenCalledTimes(2);
        expect(removeCache(ax, 'cfg')).toBe(false);

        const c = setup();
        await c.ax.get('/', { cache: { key: () => '' } });
        await c.ax.get('/', { cache: { key: () => '' } });
        expect(c.adapter).toHaveBeenCalledTimes(2);
    });

    it('[cache.cb.key] 插件级 key 回调抛错 → 请求以该错误拒绝且不发出；后续请求不受影响', async () => {
        const err = new Error('key boom');
        const { adapter, ax } = setup({ key: () => { throw err; } });
        await expect(ax.get('/', { cache: true })).rejects.toBe(err);
        expect(adapter).not.toHaveBeenCalled();
        await ax.get('/', { cache: false });
        expect(adapter).toHaveBeenCalledTimes(1);
    });

    it('[cache.req.cache.key.callback] 请求级 key 回调抛错 → 以该错误拒绝且不发出；返回 undefined → 直通不缓存', async () => {
        const err = new Error('req key boom');
        const { adapter, ax } = setup();
        await expect(ax.get('/', { cache: { key: () => { throw err; } } })).rejects.toBe(err);
        expect(adapter).not.toHaveBeenCalled();
        await ax.get('/', { cache: { key: () => undefined } });
        await ax.get('/', { cache: { key: () => undefined } });
        expect(adapter).toHaveBeenCalledTimes(2);
    });

    it('[cache.cb.clone][cache.req.cache.clone.callback] clone 回调命中时抛错 → 请求拒绝，但缓存条目保留', async () => {
        const err = new Error('clone boom');
        let boom = false;
        const { adapter, ax } = setup();
        const clone = (d: any) => { if (boom) throw err; return d; };
        await ax.get('/', { key: 'k', cache: { clone } });
        boom = true;
        await expect(ax.get('/', { key: 'k', cache: { clone } })).rejects.toBe(err);
        boom = false;
        await ax.get('/', { key: 'k', cache: { clone } });
        expect(adapter).toHaveBeenCalledTimes(1);
    });

    it('[cache.cb.clone][cache.req.cache.clone.callback] clone 回调返回 null → 本次 data 为 null，不影响缓存原件', async () => {
        const { ax } = setup();
        await ax.get('/', { key: 'k', cache: { clone: () => undefined } });
        const hit = await ax.get('/', { key: 'k', cache: { clone: () => null } });
        expect(hit.data).toBeNull();
        const raw = await ax.get('/', { key: 'k', cache: true });
        expect(raw.data).toBe('ok');
    });

    it('[cache.method.install] 同一实例重复 install → 后装的接管缓存仓，旧 cleanup 不抛错', async () => {
        const adapter = vi.fn(async (c: any) => response('ok', c));
        const ax = axios.create({ adapter });
        const off1 = cache().install(ax) as () => void;
        cache().install(ax);
        await ax.get('/', { key: 'k', cache: true });
        expect(removeCache(ax, 'k')).toBe(true);
        expect(() => off1()).not.toThrow();
    });

    it('[cache.method.cleanup] 重复 cleanup 不抛错，且 adapter 保持已恢复', () => {
        const ax = axios.create({ adapter: vi.fn() as any });
        const before = ax.defaults.adapter;
        const off = cache().install(ax) as () => void;
        off();
        expect(() => off()).not.toThrow();
        expect(ax.defaults.adapter).toBe(before);
    });

    it('[cache.prop.name] name 恒为 axp:cache，不随 options 变化（含 enable:false / 空对象）', () => {
        expect(cache({ enable: false }).name).toBe('axp:cache');
        expect(cache({}).name).toBe('axp:cache');
    });

    it('[cache.opt.storage][cache.cb.storage.getItem][cache.cb.storage.setItem][cache.cb.storage.removeItem][cache.cb.storage.clear] storage 方法抛错/返回 rejected Promise 也不影响缓存（工厂未消费）', async () => {
        const boom = () => { throw new Error('x'); };
        const storage = { getItem: vi.fn(boom), setItem: vi.fn(boom), removeItem: vi.fn(boom), clear: vi.fn(() => Promise.reject(new Error('y'))) };
        const { adapter, ax } = setup({ storage });
        await ax.get('/', { key: 'k', cache: true });
        await ax.get('/', { key: 'k', cache: true });
        removeCache(ax, 'k');
        clearCache(ax);
        expect(adapter).toHaveBeenCalledTimes(1);
        for (const fn of Object.values(storage)) expect(fn).not.toHaveBeenCalled();
    });

    it('[cache.opt.memory] memory 为 null/非布尔 → 忽略，仍走进程内缓存', async () => {
        const { adapter, ax } = setup({ memory: null });
        await ax.get('/', { key: 'k', cache: true });
        await ax.get('/', { key: 'k', cache: true });
        expect(adapter).toHaveBeenCalledTimes(1);
    });
});
