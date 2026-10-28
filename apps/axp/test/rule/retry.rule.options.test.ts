import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import retry from '../../src/plugins/retry';
import { makeNetwork } from '../helpers/network';
import { Axp } from '../../src/install';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('retry — 请求级回调与安装', () => {
    it('[retry.req.retry.delay.callback] 请求级 delay 覆盖插件回调并收到本次错误和预算', async () => {
        vi.useFakeTimers();
        const net = makeNetwork().on('GET', '/x', (_c, hit) => ({ status: hit === 1 ? 500 : 200 }));
        const ax = axios.create({ adapter: net.adapter });
        const fallback = vi.fn(() => 9000);
        Axp.install(ax, { retry: retry({ max: 3, delay: fallback }) });
        const delay = vi.fn(() => 40);
        const pending = ax.get('/x', { retry: { max: 1, delay } });
        await vi.advanceTimersByTimeAsync(0);
        expect(delay).toHaveBeenCalledExactlyOnceWith(1, 1,
            expect.objectContaining({ status: 500 }), expect.objectContaining({ status: 500 }));
        expect(fallback).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(39);
        expect(net.calls('GET', '/x')).toBe(1);
        await vi.advanceTimersByTimeAsync(2);
        expect((await pending).status).toBe(200);
        expect(net.calls('GET', '/x')).toBe(2);
    });

    it.each([false, true])('[retry.cb.jitter][retry.req.retry.jitter.callback] 抖动回调接收原始延时并决定等待，使用请求级=%s', async (requestLevel) => {
        vi.useFakeTimers();
        const net = makeNetwork().on('GET', '/x', (_c, hit) => ({ status: hit === 1 ? 500 : 200 }));
        const ax = axios.create({ adapter: net.adapter });
        const jitter = vi.fn((ms: number) => ms / 2);
        const fallback = vi.fn(() => 9000);
        Axp.install(ax, { retry: retry({ max: 1, delay: 100, jitter: requestLevel ? fallback : jitter }) });
        const pending = ax.get('/x', requestLevel ? { retry: { jitter } } : {});
        await vi.advanceTimersByTimeAsync(0);
        expect(jitter).toHaveBeenCalledExactlyOnceWith(100);
        expect(fallback).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(49);
        expect(net.calls('GET', '/x')).toBe(1);
        await vi.advanceTimersByTimeAsync(2);
        expect((await pending).status).toBe(200);
        expect(net.calls('GET', '/x')).toBe(2);
    });
});
