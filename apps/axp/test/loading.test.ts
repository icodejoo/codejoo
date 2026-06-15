import { describe, it, expect, vi } from 'vitest';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import { $resolveLoading, $wrap, type ILoadingOptions, type TLoadingFunc } from '../src/plugins/loading';


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

    it('包装后会 delete config.loading（避免污染下游）', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, { loading: fn });
        const config: any = { url: '/x', loading: true };
        const p = wrapped(config);
        expect(config.loading).toBeUndefined();
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
