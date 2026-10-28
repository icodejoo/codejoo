import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import share, { $end, $race, $start } from '../../../src/plugins/share';
import axios, { AxiosError } from 'axios';

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

// ───────────────────────────────────────────────────────────────────────────
//  $start：相同 key 并发请求复用首发的 promise，HTTP 只发一次，无内部重试
// ───────────────────────────────────────────────────────────────────────────

describe('$start', () => {
    it('[share.opt.policy][share.fn.$start] 单请求：正常发 HTTP，成功返回', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p = $start(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledOnce();
        pending[0].resolve(mockResp('ok'));
        await expect(p).resolves.toMatchObject({ data: 'ok' });
    });

    it('[share.opt.policy][share.fn.$start] 两并发同 key：HTTP 只发一次，两个 caller 都拿到同一结果', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $start(adp, map, 'k1', cfg());
        const pB = $start(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledOnce();
        pending[0].resolve(mockResp('shared'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a).toBe(b);
        expect(a.data).toBe('shared');
    });

    it('[share.opt.policy][share.fn.$start] 失败也共享：所有 caller 都收到同一个 reject', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $start(adp, map, 'k1', cfg());
        const pB = $start(adp, map, 'k1', cfg());
        pending[0].reject(new Error('boom'));
        await expect(pA).rejects.toThrow('boom');
        await expect(pB).rejects.toThrow('boom');
    });

    it('[share.opt.policy][share.fn.$start] 完成后：相同 key 的新请求重新发 HTTP', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p1 = $start(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('first'));
        await p1;
        const p2 = $start(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledTimes(2);
        pending[1].resolve(mockResp('second'));
        await expect(p2).resolves.toMatchObject({ data: 'second' });
    });

    it('[share.opt.policy][share.fn.$start] 不同 key：互不干扰，独立 HTTP', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $start(adp, map, 'k1', cfg());
        const pB = $start(adp, map, 'k2', cfg());
        expect(adp).toHaveBeenCalledTimes(2);
        pending[0].resolve(mockResp('A'));
        pending[1].resolve(mockResp('B'));
        await expect(pA).resolves.toMatchObject({ data: 'A' });
        await expect(pB).resolves.toMatchObject({ data: 'B' });
    });
});

// ───────────────────────────────────────────────────────────────────────────
//  $end：后到顶替前面，所有 caller 等最后一个的结果
// ───────────────────────────────────────────────────────────────────────────

describe('$end', () => {
    it('[share.opt.policy][share.fn.$end] 单请求：正常返回', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p = $end(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('ok'));
        await expect(p).resolves.toMatchObject({ data: 'ok' });
    });

    it('[share.opt.policy][share.fn.$end] 两并发：两次 HTTP 都发，但只有第二次的结果分发给两个 caller', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $end(adp, map, 'k1', cfg());
        const pB = $end(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledTimes(2);
        pending[0].resolve(mockResp('OLD'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].resolve(mockResp('NEW'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data).toBe('NEW');
        expect(b.data).toBe('NEW');
    });

    it('[share.opt.policy][share.fn.$end] 三并发：仅最后一次的结果分发，前两次结果丢弃', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p1 = $end(adp, map, 'k1', cfg());
        const p2 = $end(adp, map, 'k1', cfg());
        const p3 = $end(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledTimes(3);
        pending[0].resolve(mockResp('first'));
        pending[1].resolve(mockResp('second'));
        await new Promise((r) => setTimeout(r, 0));
        pending[2].resolve(mockResp('third'));
        const results = await Promise.all([p1, p2, p3]);
        for (const r of results) expect(r.data).toBe('third');
    });

    it('[share.opt.policy][share.fn.$end] 最后一次失败 → 所有 caller 都 reject', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $end(adp, map, 'k1', cfg());
        const pB = $end(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('OLD'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].reject(new Error('newest fails'));
        await expect(pA).rejects.toThrow('newest fails');
        await expect(pB).rejects.toThrow('newest fails');
    });

    it('[share.opt.policy][share.fn.$end] 完成后：相同 key 新请求重新计数', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p1 = $end(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('A'));
        await p1;
        const p2 = $end(adp, map, 'k1', cfg());
        pending[1].resolve(mockResp('B'));
        await expect(p2).resolves.toMatchObject({ data: 'B' });
    });
});

// ───────────────────────────────────────────────────────────────────────────
//  $race：所有都发 HTTP，最先返回的赢家分发给所有 caller
// ───────────────────────────────────────────────────────────────────────────

describe('$race', () => {
    it('[share.opt.policy][share.fn.$race] 两并发：先返回的赢家结果给两个 caller', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledTimes(2);
        pending[1].resolve(mockResp('FAST'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data).toBe('FAST');
        expect(b.data).toBe('FAST');
    });

    it('[share.opt.policy][share.fn.$race] 一个失败、一个成功 → 用成功的（Promise.any 语义）', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        // A 先失败 → 不立即 reject（B 还在跑）
        pending[0].reject(new Error('first fail'));
        await new Promise((r) => setTimeout(r, 0));
        // B 后成功 → 共享 promise resolve
        pending[1].resolve(mockResp('LATE_SUCCESS'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data).toBe('LATE_SUCCESS');
        expect(b.data).toBe('LATE_SUCCESS');
    });

    it('[share.opt.policy][share.fn.$race] 全部失败 → 用最后一次 error reject', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[0].reject(new Error('A failed'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].reject(new Error('B failed'));
        await expect(pA).rejects.toThrow('B failed');
        await expect(pB).rejects.toThrow('B failed');
    });

    it('[share.opt.policy][share.fn.$race] 单请求失败 → 直接 reject（in-flight 归零）', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p = $race(adp, map, 'k1', cfg());
        pending[0].reject(new Error('alone fail'));
        await expect(p).rejects.toThrow('alone fail');
    });

    it('[share.opt.policy][share.fn.$race] 成功后续到的失败结果被忽略', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[1].resolve(mockResp('FAST'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data).toBe('FAST');
        expect(b.data).toBe('FAST');
        // 慢的失败已是 noop，不抛
        pending[0].reject(new Error('SLOW_LATE_FAIL'));
        await new Promise((r) => setTimeout(r, 0));
    });

    it('[share.opt.policy][share.fn.$race] 赢家结算后，新请求重新比赛', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p1 = $race(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('round1'));
        await p1;
        const p2 = $race(adp, map, 'k1', cfg());
        const p3 = $race(adp, map, 'k1', cfg());
        pending[1].resolve(mockResp('round2-A'));
        await Promise.all([p2, p3]);
    });

    it('[share.opt.policy][share.fn.$race] 单请求：正常返回（无人和它 race）', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p = $race(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('alone'));
        await expect(p).resolves.toMatchObject({ data: 'alone' });
    });
});

describe('share — 共享响应按调用方换上各自的 config', () => {
    it('[share.fn.axpShare][share.method.install][share.fn.$follow][share.fn.$rebindResponse] 并发同 key 的每个 caller 拿到的 response.config 就是自己的 config，data 共享', async () => {
        const data = { v: 1 };
        const ax: any = {
            defaults: {
                adapter: vi.fn(async () => ({ status: 200, statusText: 'OK', headers: {}, config: { first: true }, data })),
            },
        };
        share().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const c1: any = { key: 'k' };
        const c2: any = { key: 'k' };
        const [r1, r2] = await Promise.all([wrapped(c1), wrapped(c2)]);
        expect(r1.config).toBe(c1);
        expect(r2.config).toBe(c2);
        expect(r1.data).toBe(data);
        expect(r2.data).toBe(data);
    });
});

// ───────────────────────────────────────────────────────────────────────────
//  B5：race 下 business 风格失败（200 + 非成功 code）不算赢家
// ───────────────────────────────────────────────────────────────────────────

describe('$race business 风格', () => {
    const bizFail = (msg: string) => mockResp({ code: 500, message: msg, data: null });
    const bizOk = (v: any) => mockResp({ code: 0, message: 'ok', data: v });

    it('[share.opt.policy][share.fn.$race] 先到的 200+code500 不算赢家，后到成功者胜出', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[0].resolve(bizFail('A fail'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].resolve(bizOk('B'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data.data).toBe('B');
        expect(b.data.data).toBe('B');
    });

    it('[share.opt.policy][share.fn.$race] adapter 层 data 是未解析的 JSON 字符串时，200+code500 同样不算赢家', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp(JSON.stringify({ code: 500, message: 'A fail', data: null })));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].resolve(mockResp(JSON.stringify({ code: 0, message: 'ok', data: 'B' })));
        const [a, b] = await Promise.all([pA, pB]);
        expect(JSON.parse(a.data).data).toBe('B');
        expect(JSON.parse(b.data).data).toBe('B');
    });

    it('[share.opt.policy][share.fn.$race] 先失败者之后又有 reject，再来成功者仍胜出', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        const pC = $race(adp, map, 'k1', cfg());
        pending[0].resolve(bizFail('A'));
        pending[1].reject(new Error('B net'));
        await new Promise((r) => setTimeout(r, 0));
        pending[2].resolve(bizOk('C'));
        const [a] = await Promise.all([pA, pB, pC]);
        expect(a.data.data).toBe('C');
    });

    it('[share.opt.policy][share.fn.$race] 全部业务失败：resolve 最后一个失败响应（与不装 share 时形态一致）', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[0].resolve(bizFail('A'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].resolve(bizFail('B'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data.message).toBe('B');
        expect(b.data.message).toBe('B');
    });

    it('[share.opt.policy][share.fn.$race] 最后落定的是 reject：以该 error reject', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[0].resolve(bizFail('A'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].reject(new Error('B net'));
        await expect(pA).rejects.toThrow('B net');
        await expect(pB).rejects.toThrow('B net');
    });

    it('[share.opt.policy][share.fn.$race] http 风格（无 code 信封）：首个 resolve 仍直接胜出', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[1].resolve(mockResp('FAST'));
        const [a] = await Promise.all([pA, pB]);
        expect(a.data).toBe('FAST');
    });
});

// 来源 review #9
describe('share — 失败时每个订阅者拿到独立 error', () => {
    it('[share.fn.$rebindError] error.config / response.config 重绑为各自 config，保留原型', async () => {
        const d = deferred<AxiosResponse>();
        const wrapped = setup(vi.fn(() => d.promise));
        const cfgA: any = { url: '/x', key: 'k', tag: 'A' };
        const cfgB: any = { url: '/x', key: 'k', tag: 'B' };
        const pa = wrapped(cfgA).catch((e) => e);
        const pb = wrapped(cfgB).catch((e) => e);
        const err = new AxiosError('boom', 'ERR_BAD_RESPONSE', cfgA, null, { status: 500, config: cfgA } as any);
        d.reject(err);
        const [ea, eb] = await Promise.all([pa, pb]);
        expect(ea).toBeInstanceOf(AxiosError);
        expect(eb).toBeInstanceOf(AxiosError);
        expect(ea.config).toBe(cfgA);
        expect(eb.config).toBe(cfgB);
        expect(eb.response.config).toBe(cfgB);
        expect(ea).not.toBe(eb);
        expect(eb.message).toBe('boom');
        expect(eb.code).toBe('ERR_BAD_RESPONSE');
    });
});

describe('share — 关闭与清理边界', () => {
    it('[share.opt.enable] enable:false 不包装 adapter', () => {
        const ax = axios.create();
        const before = ax.defaults.adapter;
        expect(share({ enable: false }).install(ax)).toBeUndefined();
        expect(ax.defaults.adapter).toBe(before);
    });
});
