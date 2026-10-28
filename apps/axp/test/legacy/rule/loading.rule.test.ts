import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import loading, { $wrap, type TLoadingFunc } from '../../../src/plugins/loading';
import { Axp } from '../../../src/install';
import { makeNetwork } from '../../helpers/network';
import { use } from '../../helpers/install';

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

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// 来源 review 补丁
describe('loading 逻辑请求与清理', () => {
    const path = '/review-loading';

    it('[public.member.Core.extends][loading.fn.axpLoading] Core.extends 派生请求不继承父 loading adapter', async () => {
        const net = makeNetwork();
        const parent = Axp.create(axios.create({ adapter: net.adapter }));
        const fn = vi.fn();
        Axp.install(parent.axios, { loading: loading({ loading: fn }) });
        await parent.extends().axios.get(path);
        expect(fn).not.toHaveBeenCalled();
    });
});

describe('$wrap — 单请求生命周期', () => {
    it('[loading.fn.$wrap][loading.cb.loading] 成功：先 fn(true)，完成后 fn(false)', async () => {
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

    it('[loading.fn.$wrap][loading.cb.loading] 失败也触发 fn(false)（finally 兜底）', async () => {
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

    it('[loading.req.loading] config.loading: false → 完全跳过（fn 不被调用，原 adapter 仍执行）', async () => {
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

    it('[loading.req.loading.callback] config.loading 是函数 → 用请求级函数而非插件级', async () => {
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

    it('[loading.fn.$wrap] 插件级 + 请求级都无回调 → 不参与（直接透传 adapter）', async () => {
        const { adp, pending } = deferredAdapter();
        const wrapped = $wrap(adp, {});
        const p = wrapped({} as any);
        expect(adp).toHaveBeenCalledOnce();
        pending[0].resolve({});
        await p;
    });

    it('[loading.req.loading] 包装后保留 config.loading，供 retry 和 auth 重放复用', async () => {
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
    it('[loading.fn.$wrap][loading.cb.loading] 两并发：fn(true) 仅 1 次，fn(false) 在最后完成时 1 次', async () => {
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

    it('[loading.fn.$wrap][loading.cb.loading] 多请求中混杂成功/失败，count 仍正确归零', async () => {
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

    it('[loading.fn.$wrap][loading.cb.loading] count 归零后再发起请求 → 触发新一轮 true/false', async () => {
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

    it('[loading.fn.$wrap][loading.cb.loading] 参与与不参与混杂：不参与的不影响计数器', async () => {
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

    it('[loading.fn.$wrap][loading.req.loading.callback] 请求级覆盖：第一个请求用 customA，第二个用 customB → A(true), B(false)', async () => {
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
    it('[loading.opt.delay] delay 期间请求就结束了 → fn 从未被调用', async () => {
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

    it('[loading.opt.delay] delay 到点了、请求还没完 → fn(true) 触发；结束后 fn(false)', async () => {
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

    it('[loading.opt.delay] delay 为 0（默认）→ 立刻显示，跟旧行为一致', async () => {
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
    it('[loading.opt.delayClose] delayClose 期间又来了新请求 → 取消隐藏，保持显示', async () => {
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

    it('[loading.opt.delayClose] delayClose 到点、期间没有新请求 → 正常触发 fn(false)', async () => {
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

    it('[loading.opt.delayClose] delayClose 为 0（默认）→ 立刻隐藏，跟旧行为一致', async () => {
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
    it('[loading.req.loading.delay] 请求级对象的 delay 覆盖插件级', async () => {
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

    it('[loading.req.loading.loading] 请求级对象的 loading 回调覆盖插件级', async () => {
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

    it('[loading.req.loading.enable] 请求级对象 enable:false → 跳过（等价于顶层 false）', async () => {
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

describe('cancel/loading — 资源释放边界', () => {
    it('[loading.method.install][loading.opt.enable] loading enable:false 不包装 adapter', () => {
        const ax = axios.create();
        const before = ax.defaults.adapter;
        expect(loading({ enable: false }).install(ax)).toBeUndefined();
        expect(ax.defaults.adapter).toBe(before);
    });
});

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

/** 给请求加延迟（毫秒），配合 makeNetwork 制造乱序 */
const lat = (ms: number) => ({ latency: ms } as any);

describe('集成 — loading 并发计数', () => {
  it('[loading.fn.$wrap][loading.cb.loading] 多并发只 show 一次、hide 一次（计数边界）', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: 1 } }));
    const states: boolean[] = [];
    use(api, [loading({ loading: (v) => states.push(v) })]);

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => api.get(`/x${i}`)(undefined, { loading: true, ...lat(15) })),
    );

    expect(states.filter((v) => v === true)).toHaveLength(1);   // 仅一次 show
    expect(states.filter((v) => v === false)).toHaveLength(1);  // 仅一次 hide
    expect(states[0]).toBe(true);
    expect(states[states.length - 1]).toBe(false);
  });
});
