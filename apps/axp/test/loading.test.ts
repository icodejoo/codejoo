import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import loading, { $resolveLoading, $resolveDelay, $resolveDelayClose, $wrap, type ILoadingOptions, type TLoadingFunc } from '../src/plugins/loading';
import { Axp } from '../src/install';
import retry from '../src/plugins/retry';
import auth from '../src/plugins/auth';
import normalize from '../src/plugins/normalize';
import cancel, { cancelAll } from '../src/plugins/cancel';
import TokenManager from '../src/objects/TokenManager';
import mock from '../src/plugins/mock';
import { makeNetwork } from './helpers/network';

describe('review — loading 逻辑请求与清理', () => {
    const path = '/review-loading';

    it('mock 先卸载时 loading 保持生效，两者全卸载后不复活 mock', async () => {
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        const fn = vi.fn();
        const mockHandle = Axp.install(ax, { mock: mock({ enable: true, mock: true, mockUrl: 'http://mock' }) });
        const loadingHandle = Axp.install(ax, { loading: loading({ loading: fn }) });
        mockHandle.dispose();
        await ax.get(path);
        expect(fn.mock.calls.map(([value]) => value)).toEqual([true, false]);
        loadingHandle.dispose();
        await ax.get(path);
        expect(net.log.map((record) => record.url)).toEqual([path, path]);
        expect(ax.defaults.adapter).toBe(net.adapter);
    });

    it('Core.extends 派生请求不继承父 loading adapter', async () => {
        const net = makeNetwork();
        const parent = Axp.create(axios.create({ adapter: net.adapter }));
        const fn = vi.fn();
        Axp.install(parent.axios, { loading: loading({ loading: fn }) });
        await parent.extends().axios.get(path);
        expect(fn).not.toHaveBeenCalled();
    });

    it.each([200, 500])('retry 最终 %i：等待期间保持显示，最终只有一对回调', async (status) => {
        const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit === 1 ? 500 : status }));
        const values: boolean[] = [];
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, {
            retry: retry({ max: 1, delay: () => { expect(values).toEqual([true]); return 1; } }),
            loading: loading({ loading: (value) => values.push(value) }),
        });
        await ax.get(path).catch(() => undefined);
        expect(values).toEqual([true, false]);
    });

    it('auth 刷新和 replay 后 retry 期间始终显示', async () => {
        const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit === 1 ? 401 : hit === 2 ? 500 : 200 }));
        const values: boolean[] = [];
        const tm = new TokenManager();
        tm.set('old');
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, {
            auth: auth({ tokenManager: tm, onRefresh: () => { expect(values).toEqual([true]); tm.set('fresh'); return true; }, onAccessExpired: vi.fn() }),
            retry: retry({ max: 1, delay: 1 }),
            loading: loading({ loading: (value) => values.push(value) }),
        });
        await ax.get(path);
        expect(values).toEqual([true, false]);
        expect(net.totalStarted).toBe(3);
    });

    it('loading:false 在 retry 后仍不参与计数', async () => {
        const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit === 1 ? 500 : 200 }));
        const fn = vi.fn();
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { retry: retry({ max: 1, delay: 0 }), loading: loading({ loading: fn }) });
        await ax.get(path, { loading: false });
        expect(fn).not.toHaveBeenCalled();
    });

    it.each([401, 500])('首发 %i 后重发抛出无 config 的错误也释放 loading', async (status) => {
        const failure = new Error('adapter failed');
        const net = makeNetwork().on('GET', path, (_config, hit) => {
            if (hit === 1) return { status };
            throw failure;
        });
        const tm = new TokenManager();
        tm.set('old');
        const fn = vi.fn();
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, {
            auth: auth({ tokenManager: tm, onRefresh: () => { tm.set('fresh'); return true; }, onAccessExpired: vi.fn() }),
            retry: retry({ max: 1, delay: 0 }), loading: loading({ loading: fn }),
        });
        await expect(ax.get(path)).rejects.toBe(failure);
        expect(fn.mock.calls.map(([value]) => value)).toEqual([true, false]);
    });

    it('业务错误与 retry 等待期间取消均正确关闭 loading', async () => {
        const net = makeNetwork().on('GET', path, () => ({ data: { code: 1 } }));
        const values: boolean[] = [];
        const ax = axios.create({ adapter: net.adapter });
        const handle = Axp.install(ax, { normalize: normalize(), loading: loading({ loading: (value) => values.push(value) }) });
        await expect(ax.get(path)).rejects.toThrow();
        expect(values).toEqual([true, false]);
        handle.dispose();
        values.length = 0;
        net.on('GET', path, () => ({ status: 500 }));
        Axp.install(ax, { cancel: cancel(), retry: retry({ max: 1, delay: () => { cancelAll(ax); return 1; } }), loading: loading({ loading: (value) => values.push(value) }) });
        await expect(ax.get(path)).rejects.toMatchObject({ code: 'ERR_CANCELED' });
        expect(values).toEqual([true, false]);
    });

    it.each([0, 1])('回调抛错与拒绝不影响请求和后续计数（delay=%i）', async (delay) => {
        const net = makeNetwork();
        const fn = vi.fn((visible: boolean) => { if (visible) throw new Error('UI failed'); return Promise.reject(new Error('UI rejected')); });
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { loading: loading({ loading: fn, delay }) });
        await ax.get(path, { latency: 10 } as any);
        await ax.get(path, { latency: 10 } as any);
        expect(fn.mock.calls.map(([value]) => value)).toEqual([true, false, true, false]);
    });

    it.each(['show', 'hide'])('dispose 清除 %s 定时器，旧请求完成也不再回调', async (phase) => {
        vi.useFakeTimers();
        try {
            const { adp, pending } = deferredAdapter();
            const fn = vi.fn();
            const ax = axios.create({ adapter: adp });
            const handle = Axp.install(ax, { loading: loading({ loading: fn, delay: phase === 'show' ? 10 : 0, delayClose: 10 }) });
            const request = ax.get(path);
            if (phase === 'hide') {
                pending[0].resolve({ config: pending[0].config, status: 200, data: null });
                await request;
            }
            handle.dispose();
            const before = fn.mock.calls.length;
            await vi.advanceTimersByTimeAsync(20);
            if (phase === 'show') {
                pending[0].resolve({ config: pending[0].config, status: 200, data: null });
                await request;
                await vi.advanceTimersByTimeAsync(20);
            }
            expect(fn).toHaveBeenCalledTimes(before);
        } finally { vi.useRealTimers(); }
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $resolveLoading：请求级 → 插件级 兜底
// ───────────────────────────────────────────────────────────────────────────

describe('$resolveLoading', () => {
    const fallback: TLoadingFunc = () => { };
    const defaults: ILoadingOptions = { loading: fallback };

    it('config.loading === false → null（跳过）', () => {
        expect($resolveLoading({ loading: false } as any, defaults)).toBe(null);
    });

    it('config.loading === true → 走插件级回退', () => {
        expect($resolveLoading({ loading: true } as any, defaults)).toBe(fallback);
    });

    it('config.loading 未指定 → 走插件级回退', () => {
        expect($resolveLoading({} as AxiosRequestConfig, defaults)).toBe(fallback);
    });

    it('config.loading 是函数 → 直接作为回调（请求级覆盖）', () => {
        const custom: TLoadingFunc = () => { };
        expect($resolveLoading({ loading: custom } as any, defaults)).toBe(custom);
    });

    it('插件级也没回调 + config 显式 true → null', () => {
        expect($resolveLoading({ loading: true } as any, {})).toBe(null);
    });

    it('插件级也没回调 + config 未指定 → null', () => {
        expect($resolveLoading({} as AxiosRequestConfig, {})).toBe(null);
    });

    it('config.loading 是对象且 enable:false → null（跳过，等价于顶层 false）', () => {
        expect($resolveLoading({ loading: { enable: false } } as any, defaults)).toBe(null);
    });

    it('config.loading 是对象且给了 loading 字段 → 用它', () => {
        const custom: TLoadingFunc = () => { };
        expect($resolveLoading({ loading: { loading: custom } } as any, defaults)).toBe(custom);
    });

    it('config.loading 是对象但没给 loading 字段 → 走插件级回退', () => {
        expect($resolveLoading({ loading: { delay: 100 } } as any, defaults)).toBe(fallback);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $resolveDelay / $resolveDelayClose：请求级对象 → 插件级 → 0 兜底
// ───────────────────────────────────────────────────────────────────────────

describe('$resolveDelay / $resolveDelayClose', () => {
    it('都未指定 → 默认 0', () => {
        expect($resolveDelay({} as AxiosRequestConfig, {})).toBe(0);
        expect($resolveDelayClose({} as AxiosRequestConfig, {})).toBe(0);
    });

    it('插件级设置 → 用插件级', () => {
        expect($resolveDelay({} as AxiosRequestConfig, { delay: 200 })).toBe(200);
        expect($resolveDelayClose({} as AxiosRequestConfig, { delayClose: 300 })).toBe(300);
    });

    it('请求级对象覆盖插件级', () => {
        expect($resolveDelay({ loading: { delay: 50 } } as any, { delay: 200 })).toBe(50);
        expect($resolveDelayClose({ loading: { delayClose: 50 } } as any, { delayClose: 300 })).toBe(50);
    });

    it('请求级是函数（非对象）→ 走插件级', () => {
        const fn: TLoadingFunc = () => { };
        expect($resolveDelay({ loading: fn } as any, { delay: 200 })).toBe(200);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $wrap：单计数器 + 按请求解析回调
// ───────────────────────────────────────────────────────────────────────────

/** 创建可控制 resolve/reject 的 mock adapter */
function deferredAdapter() {
    const pending: Array<{ resolve: (v: any) => void; reject: (e: any) => void; config: AxiosRequestConfig }> = [];
    const adp: AxiosAdapter = vi.fn((config) =>
        new Promise((resolve, reject) => {
            pending.push({ resolve, reject, config });
        })
    ) as any;
    return { adp, pending };
}


describe('$wrap — 单请求生命周期', () => {
    it('成功：先 fn(true)，完成后 fn(false)', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        const p = wrapped({ url: '/x' } as any);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenLastCalledWith(true);
        pending[0].resolve({ data: 'ok' });
        await p;
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenLastCalledWith(false);
    });

    it('失败也触发 fn(false)（finally 兜底）', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        const p = wrapped({ url: '/x' } as any);
        expect(fn).toHaveBeenLastCalledWith(true);
        pending[0].reject(new Error('boom'));
        await expect(p).rejects.toThrow('boom');
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenLastCalledWith(false);
    });

    it('config.loading: false → 完全跳过（fn 不被调用，原 adapter 仍执行）', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        const p = wrapped({ loading: false } as any);
        expect(fn).not.toHaveBeenCalled();
        expect(adp).toHaveBeenCalledOnce();
        pending[0].resolve({});
        await p;
        expect(fn).not.toHaveBeenCalled();
    });

    it('config.loading 是函数 → 用请求级函数而非插件级', async () => {
        const fallback: TLoadingFunc = vi.fn();
        const custom: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fallback });
        const p = wrapped({ loading: custom } as any);
        expect(custom).toHaveBeenCalledTimes(1);
        expect(custom).toHaveBeenLastCalledWith(true);
        expect(fallback).not.toHaveBeenCalled();
        pending[0].resolve({});
        await p;
        expect(custom).toHaveBeenCalledTimes(2);
        expect(custom).toHaveBeenLastCalledWith(false);
        expect(fallback).not.toHaveBeenCalled();
    });

    it('插件级 + 请求级都无回调 → 不参与（直接透传 adapter）', async () => {
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, {});
        const p = wrapped({} as any);
        expect(adp).toHaveBeenCalledOnce();
        pending[0].resolve({});
        await p;
    });

    it('包装后保留 config.loading，供 retry 和 auth 重放复用', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        const config: any = { url: '/x', loading: true };
        const p = wrapped(config);
        expect(config.loading).toBe(true);
        pending[0].resolve({});
        await p;
    });
});


describe('$wrap — 并发计数器', () => {
    it('两并发：fn(true) 仅 1 次，fn(false) 在最后完成时 1 次', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        const pA = wrapped({ url: '/a' } as any);
        const pB = wrapped({ url: '/b' } as any);
        expect(fn).toHaveBeenCalledTimes(1);
        pending[0].resolve({});
        await pA;
        expect(fn).toHaveBeenCalledTimes(1);  // count 仍 = 1
        pending[1].resolve({});
        await pB;
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenLastCalledWith(false);
    });

    it('多请求中混杂成功/失败，count 仍正确归零', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        const p1 = wrapped({ url: '/1' } as any);
        const p2 = wrapped({ url: '/2' } as any);
        const p3 = wrapped({ url: '/3' } as any);
        expect(fn).toHaveBeenCalledTimes(1);
        pending[1].reject(new Error('mid fail'));
        await expect(p2).rejects.toThrow();
        expect(fn).toHaveBeenCalledTimes(1);
        pending[0].resolve({});
        await p1;
        expect(fn).toHaveBeenCalledTimes(1);
        pending[2].resolve({});
        await p3;
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenLastCalledWith(false);
    });

    it('count 归零后再发起请求 → 触发新一轮 true/false', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        const p1 = wrapped({} as any);
        pending[0].resolve({});
        await p1;
        expect(fn).toHaveBeenCalledTimes(2);  // true, false
        const p2 = wrapped({} as any);
        pending[1].resolve({});
        await p2;
        expect(fn).toHaveBeenCalledTimes(4);  // 又一轮 true, false
    });

    it('参与与不参与混杂：不参与的不影响计数器', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        const pSkip = wrapped({ loading: false } as any);
        const pUse = wrapped({} as any);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenLastCalledWith(true);
        pending[0].resolve({});
        await pSkip;
        expect(fn).toHaveBeenCalledTimes(1);
        pending[1].resolve({});
        await pUse;
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenLastCalledWith(false);
    });

    it('请求级覆盖：第一个请求用 customA，第二个用 customB → A(true), B(false)', async () => {
        // 此测试明确这种"非对称"是 by design：调用方混用回调时自负其责
        const customA: TLoadingFunc = vi.fn();
        const customB: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, {});
        const pA = wrapped({ loading: customA } as any);
        const pB = wrapped({ loading: customB } as any);
        expect(customA).toHaveBeenCalledTimes(1);
        expect(customA).toHaveBeenLastCalledWith(true);
        expect(customB).not.toHaveBeenCalled();
        pending[0].resolve({});
        await pA;
        // count 还是 1
        expect(customB).not.toHaveBeenCalled();
        pending[1].resolve({});
        await pB;
        // 最后一个完成时用它自己的 fn 触发 false
        expect(customA).toHaveBeenCalledTimes(1);
        expect(customB).toHaveBeenCalledTimes(1);
        expect(customB).toHaveBeenLastCalledWith(false);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $wrap — delay / delayClose 防闪烁
// ───────────────────────────────────────────────────────────────────────────

describe('$wrap — delay 防闪烁（快请求从不显示）', () => {
    it('delay 期间请求就结束了 → fn 从未被调用', async () => {
        vi.useFakeTimers();
        try {
            const fn: TLoadingFunc = vi.fn();
            const { adp, pending } = deferredAdapter();
            const wrapped = $wrap(adp, { loading: fn, delay: 100 });
            const p = wrapped({ url: '/x' } as any);
            expect(fn).not.toHaveBeenCalled();
            pending[0].resolve({});
            await p;
            await vi.advanceTimersByTimeAsync(200);
            expect(fn).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('delay 到点了、请求还没完 → fn(true) 触发；结束后 fn(false)', async () => {
        vi.useFakeTimers();
        try {
            const fn: TLoadingFunc = vi.fn();
            const { adp, pending } = deferredAdapter();
            const wrapped = $wrap(adp, { loading: fn, delay: 100 });
            const p = wrapped({ url: '/x' } as any);
            await vi.advanceTimersByTimeAsync(100);
            expect(fn).toHaveBeenCalledTimes(1);
            expect(fn).toHaveBeenLastCalledWith(true);
            pending[0].resolve({});
            await p;
            expect(fn).toHaveBeenCalledTimes(2);
            expect(fn).toHaveBeenLastCalledWith(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('delay 为 0（默认）→ 立刻显示，跟旧行为一致', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        wrapped({ url: '/x' } as any);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenLastCalledWith(true);
        pending[0].resolve({});
    });
});

describe('$wrap — delayClose 防闪烁（连续请求不闪一下）', () => {
    it('delayClose 期间又来了新请求 → 取消隐藏，保持显示', async () => {
        vi.useFakeTimers();
        try {
            const fn: TLoadingFunc = vi.fn();
            const { adp, pending } = deferredAdapter();
            const wrapped = $wrap(adp, { loading: fn, delayClose: 100 });
            const p1 = wrapped({ url: '/a' } as any);
            expect(fn).toHaveBeenCalledTimes(1);
            pending[0].resolve({});
            await p1;
            expect(fn).toHaveBeenCalledTimes(1); // 还没到 delayClose，没触发 false

            const p2 = wrapped({ url: '/b' } as any);
            await vi.advanceTimersByTimeAsync(200); // 早就过了 delayClose 的时间点
            expect(fn).toHaveBeenCalledTimes(1); // 一直没有额外的 true/false —— 全程保持显示

            pending[1].resolve({});
            await p2;
            await vi.advanceTimersByTimeAsync(200);
            expect(fn).toHaveBeenCalledTimes(2);
            expect(fn).toHaveBeenLastCalledWith(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('delayClose 到点、期间没有新请求 → 正常触发 fn(false)', async () => {
        vi.useFakeTimers();
        try {
            const fn: TLoadingFunc = vi.fn();
            const { adp, pending } = deferredAdapter();
            const wrapped = $wrap(adp, { loading: fn, delayClose: 100 });
            const p = wrapped({ url: '/x' } as any);
            pending[0].resolve({});
            await p;
            expect(fn).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(100);
            expect(fn).toHaveBeenCalledTimes(2);
            expect(fn).toHaveBeenLastCalledWith(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('delayClose 为 0（默认）→ 立刻隐藏，跟旧行为一致', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        const p = wrapped({ url: '/x' } as any);
        pending[0].resolve({});
        await p;
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenLastCalledWith(false);
    });
});

describe('$wrap — 请求级对象覆盖 delay/delayClose/loading/enable', () => {
    it('请求级对象的 delay 覆盖插件级', async () => {
        vi.useFakeTimers();
        try {
            const fn: TLoadingFunc = vi.fn();
            const { adp, pending } = deferredAdapter();
            const wrapped = $wrap(adp, { loading: fn, delay: 1000 });
            const p = wrapped({ url: '/x', loading: { delay: 10 } } as any);
            await vi.advanceTimersByTimeAsync(10);
            expect(fn).toHaveBeenCalledTimes(1);
            expect(fn).toHaveBeenLastCalledWith(true);
            pending[0].resolve({});
            await p;
        } finally {
            vi.useRealTimers();
        }
    });

    it('请求级对象的 loading 回调覆盖插件级', async () => {
        const fallback: TLoadingFunc = vi.fn();
        const custom: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fallback });
        const p = wrapped({ loading: { loading: custom } } as any);
        expect(custom).toHaveBeenCalledWith(true);
        expect(fallback).not.toHaveBeenCalled();
        pending[0].resolve({});
        await p;
    });

    it('请求级对象 enable:false → 跳过（等价于顶层 false）', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        const p = wrapped({ loading: { enable: false } } as any);
        expect(fn).not.toHaveBeenCalled();
        pending[0].resolve({});
        await p;
        expect(fn).not.toHaveBeenCalled();
    });
});


describe('loading — adapter 同步抛错 / 非函数 adapter', () => {
    it('prev 同步抛错 → 请求 reject，且回调 true/false 成对（计数不泄漏）', async () => {
        const fn = vi.fn();
        const thrower: AxiosAdapter = (() => { throw new Error('sync boom'); }) as any;
        const wrapped = $wrap(thrower, { loading: fn });
        await expect(wrapped({} as any)).rejects.toThrow('sync boom');
        expect(fn.mock.calls).toEqual([[true], [false]]);
        // 计数已回落：下一次请求仍能重新触发 true
        await expect(wrapped({} as any)).rejects.toThrow('sync boom');
        expect(fn.mock.calls).toEqual([[true], [false], [true], [false]]);
    });

    it('裸 axios.create()（adapter 为数组）安装 loading 后请求正常', async () => {
        const net = vi.fn(async (config: any) => ({ status: 200, statusText: 'OK', headers: {}, config, data: 'ok' }) as any);
        const ax = axios.create({ adapter: [net as any] });
        const fn = vi.fn();
        loading({ loading: fn }).install(ax);
        const r = await ax.get('/x');
        expect(r.data).toBe('ok');
        expect(fn.mock.calls).toEqual([[true], [false]]);
    });
});

describe('review — loading 泄漏修复', () => {
    const path = '/leak';

    it('transformResponse 抛无 config 的 Error 仍释放计数', async () => {
        const net = makeNetwork();
        const ax = axios.create({
            adapter: net.adapter,
            transformResponse: [() => { throw new Error('boom'); }],
        });
        const fn = vi.fn();
        Axp.install(ax, { loading: loading({ loading: fn }) });
        await expect(ax.get(path)).rejects.toThrow('boom');
        expect(fn.mock.calls.map(([v]) => v)).toEqual([true, false]);
    });

    it('同实例两个独立 handle 各装 loading，各自计数都能归零', async () => {
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        const outer = vi.fn();
        const inner = vi.fn();
        Axp.install(ax, { loading: loading({ loading: outer }) });
        Axp.install(ax, { loading: loading({ loading: inner }) });
        await ax.get(path);
        expect(inner.mock.calls.map(([v]) => v)).toEqual([true, false]);
        expect(outer.mock.calls.map(([v]) => v)).toEqual([true, false]);
    });
});
