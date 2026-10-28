import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import share, { $createEntry, $end, $race, $start, $follow, $rebindError } from '../../src/plugins/share';
import axios, { AxiosError, CanceledError } from 'axios';

// ───────────────────────────────────────────────────────────────────────────
//  共用：可控 mock adapter
// ───────────────────────────────────────────────────────────────────────────

function deferredAdapter() {
    const pending: Array<{
        resolve: (v: AxiosResponse) => void;
        reject: (e: any) => void;
        config: AxiosRequestConfig;
    }> = [];
    const adp: AxiosAdapter = vi.fn((config) =>
        new Promise((resolve, reject) => {
            pending.push({ resolve, reject, config });
        }),
    ) as any;
    return { adp, pending };
}

const mockResp = (data: any): AxiosResponse =>
    ({ status: 200, statusText: 'OK', headers: {}, config: {} as any, data } as any);

const cfg = (): InternalAxiosRequestConfig => ({} as any);

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: any) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function setup(adp: any) {
    const ax: any = { defaults: { adapter: adp } };
    share().install(ax);
    return ax.defaults.adapter as AxiosAdapter;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 构造成功响应。 */
function response(config: any = {}) {
    return { data: 'ok', config, headers: {}, status: 200, statusText: '' };
}

// ───────────────────────────────────────────────────────────────────────────
//  兼容性 / 异常 / config 归属
// ───────────────────────────────────────────────────────────────────────────

describe('share — 不依赖 Promise.withResolvers（ES2024）', () => {
    it('[share.fn.$createEntry] 环境缺少 Promise.withResolvers 时 $createEntry 照常工作', async () => {
        const orig = (Promise as any).withResolvers;
        (Promise as any).withResolvers = undefined;
        try {
            const map = new Map();
            const e = $createEntry(map, 'k');
            expect(map.get('k')).toBe(e);
            e.resolve(mockResp('ok'));
            await expect(e.promise).resolves.toMatchObject({ data: 'ok' });
            await Promise.resolve();
            expect(map.has('k')).toBe(false); // settle 后自动清理
        } finally {
            (Promise as any).withResolvers = orig;
        }
    });
});

describe('share — prev 同步抛错不会让条目永久挂起', () => {
    const syncThrowOnce = () => {
        let first = true;
        return vi.fn((_config: any) => {
            if (first) { first = false; throw new Error('sync boom'); }
            return Promise.resolve(mockResp('ok'));
        }) as unknown as AxiosAdapter;
    };

    it.each([
        ['start', $start],
        ['end', $end],
        ['race', $race],
    ] as const)('[share.fn.$start][share.fn.$end][share.fn.$race] %s：首次同步抛错 → reject；同 key 第二次请求拿到结果', async (_name, run) => {
        const map = new Map();
        const adp = syncThrowOnce();
        await expect(run(adp, map, 'k', cfg())).rejects.toThrow('sync boom');
        const r = await run(adp, map, 'k', cfg());
        expect(r.data).toBe('ok');
    });
});

// ───────────────────────────────────────────────────────────────────────────
//  B4：start 下 leader 单独取消不连带 follower
// ───────────────────────────────────────────────────────────────────────────

describe('$start 取消语义', () => {
    /** 构造带独立 AbortController 的订阅者：返回 config、ctrl 与 $follow 后的 promise */
    const sub = (adp: AxiosAdapter, map: Map<string, any>) => {
        const ctrl = new AbortController();
        const config = { signal: ctrl.signal } as any as InternalAxiosRequestConfig;
        const p = $follow($start(adp, map, 'k1', config), config);
        p.catch(() => {}); // 避免晚挂 handler 触发 unhandled 告警
        return { ctrl, p };
    };

    it('[share.fn.$start][share.fn.$follow] leader 取消：自己 canceled，follower 仍拿到结果，底层不 abort', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const L = sub(adp, map);
        const F = sub(adp, map);
        const underlying = pending[0].config.signal as AbortSignal;
        L.ctrl.abort();
        await expect(L.p).rejects.toMatchObject({ code: 'ERR_CANCELED' });
        expect(underlying.aborted).toBe(false);
        pending[0].resolve(mockResp('ok'));
        await expect(F.p).resolves.toMatchObject({ data: 'ok' });
        expect(adp).toHaveBeenCalledOnce();
    });

    it('[share.fn.$start][share.fn.$follow] 底层请求不带 leader 的 signal', () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const L = sub(adp, map);
        expect(pending[0].config.signal).not.toBe(L.ctrl.signal);
        L.ctrl.abort();
        return expect(L.p).rejects.toBeDefined();
    });

    it('[share.fn.$start][share.fn.$follow] 全部订阅者都取消才 abort 底层，并摘除 entry', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const L = sub(adp, map);
        const F = sub(adp, map);
        const underlying = pending[0].config.signal as AbortSignal;
        L.ctrl.abort();
        expect(underlying.aborted).toBe(false);
        F.ctrl.abort();
        expect(underlying.aborted).toBe(true);
        expect(map.size).toBe(0);
        await expect(L.p).rejects.toMatchObject({ code: 'ERR_CANCELED' });
        await expect(F.p).rejects.toMatchObject({ code: 'ERR_CANCELED' });
        // 全取消后新请求重新发 HTTP
        const N = sub(adp, map);
        expect(adp).toHaveBeenCalledTimes(2);
        pending[1].resolve(mockResp('new'));
        await expect(N.p).resolves.toMatchObject({ data: 'new' });
    });

    it('[share.fn.$start][share.fn.$follow] leader 取消后新订阅者加入：仍复用同一请求并拿到结果', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const L = sub(adp, map);
        const F1 = sub(adp, map);
        L.ctrl.abort();
        const F2 = sub(adp, map);
        expect(adp).toHaveBeenCalledOnce();
        F1.ctrl.abort();
        // F2 还在，底层不能 abort
        expect((pending[0].config.signal as AbortSignal).aborted).toBe(false);
        pending[0].resolve(mockResp('late'));
        await expect(F2.p).resolves.toMatchObject({ data: 'late' });
        await expect(F1.p).rejects.toBeDefined();
    });

    it('[share.fn.$start][share.fn.$follow] 已中止 signal 的单一订阅者：直接 canceled 且底层被 abort', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const ctrl = new AbortController();
        ctrl.abort();
        const config = { signal: ctrl.signal } as any as InternalAxiosRequestConfig;
        const p = $follow($start(adp, map, 'k1', config), config);
        p.catch(() => {}); // 避免晚挂 handler 触发 unhandled 告警
        await expect(p).rejects.toMatchObject({ code: 'ERR_CANCELED' });
        expect((pending[0].config.signal as AbortSignal).aborted).toBe(true);
        expect(map.size).toBe(0);
    });
});

// 来源 review #9
describe('share — 失败时每个订阅者拿到独立 error', () => {
    it('[share.fn.$rebindError] 非对象错误原样传递', async () => {
        const d = deferred<AxiosResponse>();
        const wrapped = setup(vi.fn(() => d.promise));
        const pa = wrapped({ url: '/x', key: 'k' } as any).catch((e) => e);
        const pb = wrapped({ url: '/x', key: 'k' } as any).catch((e) => e);
        d.reject('plain');
        expect(await pa).toBe('plain');
        expect(await pb).toBe('plain');
    });
});

// 来源 review #10
describe('share — 跟随者响应自己的取消 / 超时', () => {
    it('[share.fn.$follow] 跟随者 abort → 立即 CanceledError，首发与其他订阅者不受影响', async () => {
        const d = deferred<AxiosResponse>();
        const adp = vi.fn(() => d.promise);
        const wrapped = setup(adp);
        const ctl = new AbortController();
        const owner = wrapped({ url: '/x', key: 'k' } as any);
        const follower = wrapped({ url: '/x', key: 'k', signal: ctl.signal } as any);
        const other = wrapped({ url: '/x', key: 'k' } as any);
        const caught = follower.catch((e) => e);
        ctl.abort();
        const e = await caught; // 不需要等首发完成
        expect(e).toBeInstanceOf(CanceledError);
        d.resolve(mockResp('ok'));
        expect((await owner).data).toBe('ok');
        expect((await other).data).toBe('ok');
        expect(adp).toHaveBeenCalledTimes(1);
    });

    it('[share.fn.$follow] 已 abort 的 signal 立即拒绝', async () => {
        const d = deferred<AxiosResponse>();
        const wrapped = setup(vi.fn(() => d.promise));
        wrapped({ url: '/x', key: 'k' } as any).catch(() => {});
        const ctl = new AbortController();
        ctl.abort();
        await expect(wrapped({ url: '/x', key: 'k', signal: ctl.signal } as any)).rejects.toBeInstanceOf(CanceledError);
    });

    it('[share.fn.$follow] 跟随者按自己的 timeout 退出', async () => {
        vi.useFakeTimers();
        try {
            const d = deferred<AxiosResponse>();
            const wrapped = setup(vi.fn(() => d.promise));
            wrapped({ url: '/x', key: 'k' } as any).catch(() => {});
            const follower = wrapped({ url: '/x', key: 'k', timeout: 50 } as any).catch((e) => e);
            vi.advanceTimersByTime(60);
            const e = await follower;
            expect(e).toBeInstanceOf(AxiosError);
            expect(e.code).toBe('ETIMEDOUT');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('share — 订阅清理与错误属性', () => {
    it('[share.fn.$createEntry] 共享 entry 的旧轮次落定不得删除同 key 新轮次', async () => {
        const map = new Map();
        const old = $createEntry(map, 'k');
        const fresh = $createEntry(map, 'k');
        old.resolve(response());
        await old.promise;
        expect(map.get('k')).toBe(fresh);
        fresh.reject(new Error('fresh'));
        await expect(fresh.promise).rejects.toThrow('fresh');
        expect(map.has('k')).toBe(false);
    });
    it.each([false, true])('[share.fn.$follow] 订阅落定清除 timer、signal 与 cancelToken 监听，reject=%s', async (reject) => {
        vi.useFakeTimers();
        const pending = deferred<any>();
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const token = { subscribe: vi.fn(), unsubscribe: vi.fn() };
        const config: any = { signal: controller.signal, cancelToken: token, timeout: 100 };
        const followed = $follow(pending.promise, config);
        const assertion = reject ? expect(followed).rejects.toThrow('failure') : expect(followed).resolves.toMatchObject({ config });
        if (reject) pending.reject(new Error('failure')); else pending.resolve(response());
        await assertion;
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(token.unsubscribe).toHaveBeenCalledWith(token.subscribe.mock.calls[0][0]);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('[share.opt.policy][share.fn.$follow] CancelToken 单独取消 leader 后 follower 仍成功，底层不携带 leader token', async () => {
        const pending = deferred<any>();
        const token = axios.CancelToken.source();
        const adapter = vi.fn((_config: any) => pending.promise);
        const ax = axios.create({ adapter });
        share().install(ax);
        const leader = ax.get('/', { key: 'k', cancelToken: token.token }).catch((e) => e);
        const follower = ax.get('/', { key: 'k' });
        await vi.waitFor(() => expect(adapter).toHaveBeenCalledOnce());
        expect(adapter.mock.calls[0][0].cancelToken).toBeUndefined();
        token.cancel('leader left');
        expect(await leader).toBeInstanceOf(CanceledError);
        expect(adapter.mock.calls[0][0].signal.aborted).toBe(false);
        pending.resolve(response());
        expect((await follower).data).toBe('ok');
    });
    it.fails('[share.fn.$rebindError] 冻结 AxiosError 仍应重绑为 follower 的独立错误', () => {
        const error = Object.freeze(new AxiosError('frozen', 'E', {} as any));
        const config = {};
        expect(($rebindError(error, config) as any).config).toBe(config);
    });
    it.fails('[share.opt.policy][share.fn.$follow] 所有订阅者 timeout 后也应退出共享轮次并 abort 底层', async () => {
        vi.useFakeTimers();
        const adapter = vi.fn((_config: any) => new Promise<any>(() => {}));
        const ax = axios.create({ adapter });
        share().install(ax);
        const request = ax.get('/', { key: 'k', timeout: 10 }).catch((e) => e);
        await vi.advanceTimersByTimeAsync(10);
        expect((await request).code).toBe('ETIMEDOUT');
        expect(adapter.mock.calls[0][0].signal.aborted).toBe(true);
    });
});

describe('share — 关闭与清理边界', () => {
    it('[share.req.share.callback][share.req.share] 未提供 key 不计算动态 policy，none 则删除 share 并直接转发', async () => {
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        share().install(ax);
        const policy = vi.fn(() => false as const);
        await ax.get('/', { share: policy });
        expect(policy).not.toHaveBeenCalled();
        await ax.get('/', { key: 'k', share: policy });
        expect(policy).toHaveBeenCalledOnce();
        expect(adapter.mock.calls[1][0]).not.toHaveProperty('share');
    });
});
