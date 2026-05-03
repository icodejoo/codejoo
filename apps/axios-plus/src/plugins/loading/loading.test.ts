import { describe, it, expect, vi } from 'vitest';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import { $wrap } from './loading';
import type { TLoadingFunc } from './types';


// ───────────────────────────────────────────────────────────────────────────
//  $wrap — 三条路径：跳过 / 私有 / 全局
// ───────────────────────────────────────────────────────────────────────────

/** 创建可控制 resolve/reject 的 mock adapter */
function deferredAdapter() {
    const pending: Array<{
        resolve: (v: any) => void;
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


describe('$wrap — 跳过路径', () => {
    it('config.loading: false ⇒ 完全跳过（fn 不被调用，原 adapter 仍执行）', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, fn, 0, 0, false);
        const p = wrapped({ loading: false } as any);
        expect(fn).not.toHaveBeenCalled();
        expect(adp).toHaveBeenCalledOnce();
        pending[0].resolve({});
        await p;
        expect(fn).not.toHaveBeenCalled();
    });

    it('未指定 + default:false（默认）⇒ 跳过', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, fn, 0, 0, false);
        const p = wrapped({} as any);
        expect(fn).not.toHaveBeenCalled();
        pending[0].resolve({});
        await p;
        expect(fn).not.toHaveBeenCalled();
    });

    it('插件级无 cb + 显式 true ⇒ 仍跳过（无回调可调）', async () => {
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, undefined, 0, 0, false);
        const p = wrapped({ loading: true } as any);
        pending[0].resolve({});
        await p;
        // 不抛错，正常完成
    });

    it('包装后会 delete config.loading（防泄漏）', async () => {
        const fn: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, fn, 0, 0, false);
        const config: any = { url: '/x', loading: true };
        const p = wrapped(config);
        expect(config.loading).toBeUndefined();
        pending[0].resolve({});
        await p;
    });
});


describe('$wrap — 私有路径（function 形式）', () => {
    it('config.loading: function ⇒ 立即 fn(true)，settle 后 fn(false)', async () => {
        const fallback: TLoadingFunc = vi.fn();
        const custom: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, fallback, 0, 0, false);
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

    it('失败也触发 fn(false)', async () => {
        const custom: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, undefined, 0, 0, false);
        const p = wrapped({ loading: custom } as any);
        pending[0].reject(new Error('boom'));
        await expect(p).rejects.toThrow('boom');
        expect(custom).toHaveBeenCalledTimes(2);
        expect(custom).toHaveBeenLastCalledWith(false);
    });

    it('多个私有请求并发 ⇒ 各自独立，互不影响', async () => {
        const fnA: TLoadingFunc = vi.fn();
        const fnB: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, undefined, 0, 0, false);
        const pA = wrapped({ loading: fnA } as any);
        const pB = wrapped({ loading: fnB } as any);
        expect(fnA).toHaveBeenCalledTimes(1);
        expect(fnB).toHaveBeenCalledTimes(1);
        pending[0].resolve({});
        await pA;
        expect(fnA).toHaveBeenCalledTimes(2);
        expect(fnB).toHaveBeenCalledTimes(1); // 不受 A 影响
        pending[1].resolve({});
        await pB;
        expect(fnB).toHaveBeenCalledTimes(2);
    });
});


describe('$wrap — 全局计数路径', () => {
    it('显式 true ⇒ 立即 cb(true)，settle 后 cb(false)', async () => {
        const cb: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, cb, 0, 0, false);
        const p = wrapped({ loading: true } as any);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenLastCalledWith(true);
        pending[0].resolve({});
        await p;
        expect(cb).toHaveBeenCalledTimes(2);
        expect(cb).toHaveBeenLastCalledWith(false);
    });

    it('default:true + 未指定 ⇒ 入全局计数', async () => {
        const cb: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, cb, 0, 0, true);
        const p = wrapped({} as any);
        expect(cb).toHaveBeenCalledWith(true);
        pending[0].resolve({});
        await p;
        expect(cb).toHaveBeenLastCalledWith(false);
    });

    it('两并发：cb(true) 仅 1 次，cb(false) 在最后完成时 1 次', async () => {
        const cb: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, cb, 0, 0, false);
        const pA = wrapped({ loading: true } as any);
        const pB = wrapped({ loading: true } as any);
        expect(cb).toHaveBeenCalledTimes(1);
        pending[0].resolve({});
        await pA;
        expect(cb).toHaveBeenCalledTimes(1); // count 仍 1
        pending[1].resolve({});
        await pB;
        expect(cb).toHaveBeenCalledTimes(2);
        expect(cb).toHaveBeenLastCalledWith(false);
    });

    it('count 归零后再发起 ⇒ 新一轮 true/false', async () => {
        const cb: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, cb, 0, 0, false);
        const p1 = wrapped({ loading: true } as any);
        pending[0].resolve({});
        await p1;
        expect(cb).toHaveBeenCalledTimes(2);
        const p2 = wrapped({ loading: true } as any);
        pending[1].resolve({});
        await p2;
        expect(cb).toHaveBeenCalledTimes(4);
    });

    it('失败也触发 cb(false)（finally 兜底）', async () => {
        const cb: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, cb, 0, 0, false);
        const p = wrapped({ loading: true } as any);
        pending[0].reject(new Error('boom'));
        await expect(p).rejects.toThrow('boom');
        expect(cb).toHaveBeenLastCalledWith(false);
    });

    it('混杂跳过 + 全局：跳过的不计数', async () => {
        const cb: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, cb, 0, 0, false);
        const pSkip = wrapped({ loading: false } as any);
        const pUse = wrapped({ loading: true } as any);
        expect(cb).toHaveBeenCalledTimes(1);
        pending[0].resolve({});
        await pSkip;
        expect(cb).toHaveBeenCalledTimes(1);
        pending[1].resolve({});
        await pUse;
        expect(cb).toHaveBeenCalledTimes(2);
    });
});


describe('$wrap — delay (防快闪)', () => {
    it('delay > 0：count 0→1 时 setTimeout，归零前未触发则取消（不闪）', async () => {
        vi.useFakeTimers();
        const cb: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, cb, 200, 0, false);
        const p = wrapped({ loading: true } as any);
        // 还没到 delay，cb 不触发
        expect(cb).not.toHaveBeenCalled();
        // 在 delay 内 settle
        pending[0].resolve({});
        await p;
        // 整段被 debounce 掉，cb 永远不调
        vi.advanceTimersByTime(500);
        expect(cb).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('delay 后才 fn(true)，慢请求显示完整时长', async () => {
        vi.useFakeTimers();
        const cb: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, cb, 200, 0, false);
        const p = wrapped({ loading: true } as any);
        expect(cb).not.toHaveBeenCalled();
        vi.advanceTimersByTime(200);
        expect(cb).toHaveBeenCalledWith(true);
        vi.useRealTimers();
        pending[0].resolve({});
        await p;
        expect(cb).toHaveBeenLastCalledWith(false);
    });
});


describe('$wrap — mdt (min display time)', () => {
    it('settle 时可见时长 < mdt ⇒ 延后到刚好 mdt 才 cb(false)', async () => {
        vi.useFakeTimers();
        const cb: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, cb, 0, 500, false);
        const p = wrapped({ loading: true } as any);
        expect(cb).toHaveBeenCalledWith(true);
        pending[0].resolve({});
        // 立即 settle 但 mdt 还没满 ⇒ cb(false) 不触发
        await Promise.resolve();
        await Promise.resolve();
        expect(cb).toHaveBeenCalledTimes(1);
        // 等 mdt
        vi.advanceTimersByTime(500);
        expect(cb).toHaveBeenLastCalledWith(false);
        vi.useRealTimers();
        await p;
    });

    it('mdt 等待期内来新请求 ⇒ 取消 hide，spinner 持续可见', async () => {
        vi.useFakeTimers();
        const cb: TLoadingFunc = vi.fn();
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, cb, 0, 500, false);
        const p1 = wrapped({ loading: true } as any);
        pending[0].resolve({});
        await Promise.resolve();
        await Promise.resolve();
        // 半路：mdt 还没到，新请求来了
        vi.advanceTimersByTime(200);
        const p2 = wrapped({ loading: true } as any);
        // cb(false) 没有被取消的 hideTimer 触发过
        expect(cb).toHaveBeenCalledTimes(1);
        pending[1].resolve({});
        await Promise.resolve();
        await Promise.resolve();
        // 已经在 visible 200ms + 即将再走 mdt（从原 shownAt 算）
        vi.advanceTimersByTime(500);
        expect(cb).toHaveBeenLastCalledWith(false);
        vi.useRealTimers();
        await p1; await p2;
    });
});
