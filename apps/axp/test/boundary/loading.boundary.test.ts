import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import loading, { $wrap } from '../../src/plugins/loading';
import { Axp } from '../../src/install';
import mock from '../../src/plugins/mock';
import { makeNetwork } from '../helpers/network';

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

/** 构造 adapter 层成功响应。 */
function response(config: any, data: unknown = 'ok') {
    return { config, data, status: 200, statusText: '', headers: {} };
}

// 来源 review 补丁
describe('loading 逻辑请求与清理', () => {
    const path = '/review-loading';

    it.each([0, 1])('[loading.cb.loading][loading.opt.delay] 回调抛错与拒绝不影响请求和后续计数（delay=%i）', async (delay) => {
        const net = makeNetwork();
        const fn = vi.fn((visible: boolean) => { if (visible) throw new Error('UI failed'); return Promise.reject(new Error('UI rejected')); });
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { loading: loading({ loading: fn, delay }) });
        await ax.get(path, { latency: 10 } as any);
        await ax.get(path, { latency: 10 } as any);
        expect(fn.mock.calls.map(([value]) => value)).toEqual([true, false, true, false]);
    });

    it.each(['show', 'hide'])('[loading.method.cleanup][loading.opt.delay][loading.opt.delayClose] dispose 清除 %s 定时器，旧请求完成也不再回调', async (phase) => {
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

describe('loading — adapter 同步抛错 / 非函数 adapter', () => {
    it('[loading.fn.$wrap] prev 同步抛错 → 请求 reject，且回调 true/false 成对（计数不泄漏）', async () => {
        const fn = vi.fn();
        const thrower: AxiosAdapter = (() => { throw new Error('sync boom'); }) as any;
        const wrapped = $wrap(thrower, { loading: fn });
        await expect(wrapped({} as any)).rejects.toThrow('sync boom');
        expect(fn.mock.calls).toEqual([[true], [false]]);
        // 计数已回落：下一次请求仍能重新触发 true
        await expect(wrapped({} as any)).rejects.toThrow('sync boom');
        expect(fn.mock.calls).toEqual([[true], [false], [true], [false]]);
    });

    it('[loading.fn.axpLoading] 裸 axios.create()（adapter 为数组）安装 loading 后请求正常', async () => {
        const net = vi.fn(async (config: any) => ({ status: 200, statusText: 'OK', headers: {}, config, data: 'ok' }) as any);
        const ax = axios.create({ adapter: [net as any] });
        const fn = vi.fn();
        loading({ loading: fn }).install(ax);
        const r = await ax.get('/x');
        expect(r.data).toBe('ok');
        expect(fn.mock.calls).toEqual([[true], [false]]);
    });
});

// 来源 review 补丁
describe('loading 泄漏修复', () => {
    const path = '/leak';

    it('[loading.fn.$wrap] transformResponse 抛无 config 的 Error 仍释放计数', async () => {
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

    it('[loading.fn.axpLoading][loading.method.cleanup] 同实例两个独立 handle 各装 loading，各自计数都能归零', async () => {
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

describe('cancel/loading — 资源释放边界', () => {
    it('[loading.method.cleanup][loading.fn.$wrap] loading dispose 后旧 wrapper 直通且 finish 对无配置幂等', async () => {
        const callback = vi.fn();
        const adapter = vi.fn(async (c) => response(c));
        const wrapped = $wrap(adapter, { loading: callback }, true);
        wrapped.finish();
        wrapped.finish({});
        wrapped.dispose();
        expect((await wrapped({} as any)).data).toBe('ok');
        expect(callback).not.toHaveBeenCalled();
    });
});
