import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import retry, { type IRetryOptions } from '../../../src/plugins/retry';
import { Axp } from '../../../src/install';
import { makeNetwork } from '../../helpers/network';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 首次失败、随后成功，以调用次数和虚拟时钟判断重试决策。 */
function setup(options: IRetryOptions = {}, status = 500, headers = {}) {
    const net = makeNetwork().on('GET', '/x', (_c, hit) => ({ status: hit === 1 ? status : 200, headers }));
    const ax = axios.create({ adapter: net.adapter });
    Axp.install(ax, { retry: retry({ max: 1, delay: 0, ...options }) });
    return { net, ax };
}

describe('retry — 请求开关与空集合', () => {
    it('[retry.opt.enable] 插件关闭时请求级 enable:true 和正预算不能重新开启', async () => {
        const { net, ax } = setup({ enable: false });
        await expect(ax.get('/x', { retry: { enable: true, max: 5 } })).rejects.toMatchObject({ status: 500 });
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it.each([0, -1])('[retry.req.retry][retry.req.retry.max] 请求级 max=%s 覆盖正预算且原样拒绝', async (max) => {
        const { net, ax } = setup({ max: 3 });
        await expect(ax.get('/x', { retry: { max } })).rejects.toMatchObject({ status: 500 });
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it('[retry.req.retry.enable] 请求关闭优先于正预算和会抛错的 shouldRetry', async () => {
        const { net, ax } = setup();
        const shouldRetry = vi.fn(() => { throw new Error('不应调用'); });
        await expect(ax.get('/x', { retry: { enable: false, max: 5, shouldRetry } })).rejects.toMatchObject({ status: 500 });
        expect(shouldRetry).not.toHaveBeenCalled();
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it('[retry.req.retry.methods] 空方法列表硬性否决请求级 shouldRetry', async () => {
        const { net, ax } = setup({ methods: ['get'] });
        const shouldRetry = vi.fn(() => true);
        await expect(ax.get('/x', { retry: { methods: [], shouldRetry } })).rejects.toMatchObject({ status: 500 });
        expect(shouldRetry).not.toHaveBeenCalled();
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it.each([false, true])('[retry.opt.statusCodes][retry.req.retry.statusCodes] 空状态列表不沿用默认值，使用请求级=%s', async (requestLevel) => {
        const { net, ax } = setup({ statusCodes: requestLevel ? [500] : [] });
        await expect(ax.get('/x', requestLevel ? { retry: { statusCodes: [] } } : {})).rejects.toMatchObject({ status: 500 });
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it('[retry.req.retry.shouldRetry] 请求级判定抛错时原样拒绝且不回退插件判定', async () => {
        const fallback = vi.fn(() => true);
        const { net, ax } = setup({ shouldRetry: fallback });
        const error = new Error('请求判定失败');
        await expect(ax.get('/x', { retry: { shouldRetry: () => { throw error; } } })).rejects.toBe(error);
        expect(fallback).not.toHaveBeenCalled();
        expect(net.calls('GET', '/x')).toBe(1);
    });
});

describe('retry — 零延时与异常回调', () => {
    it.each([false, true])('[retry.opt.delay][retry.req.retry.delay] 零延时不等待且请求值覆盖插件延时，使用请求级=%s', async (requestLevel) => {
        vi.useFakeTimers();
        const { net, ax } = setup({ delay: requestLevel ? 9000 : 0 });
        const start = Date.now();
        const pending = ax.get('/x', requestLevel ? { retry: { delay: 0 } } : {});
        await vi.runAllTimersAsync();
        expect((await pending).status).toBe(200);
        expect(net.calls('GET', '/x')).toBe(2);
        expect(Date.now() - start).toBeLessThan(3);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[retry.req.retry.jitter] 请求级 jitter:true 在随机值为零时立即重发', async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const fallback = vi.fn(() => 9000);
        const { net, ax } = setup({ delay: 500, jitter: fallback });
        const pending = ax.get('/x', { retry: { jitter: true } });
        await vi.advanceTimersByTimeAsync(2);
        expect((await pending).status).toBe(200);
        expect(fallback).not.toHaveBeenCalled();
        expect(net.calls('GET', '/x')).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([false, true])('[retry.opt.delayMax][retry.req.retry.delayMax] delayMax=0 截断正延时，使用请求级=%s', async (requestLevel) => {
        vi.useFakeTimers();
        const { net, ax } = setup({ delay: 9000, delayMax: requestLevel ? 8000 : 0 });
        const pending = ax.get('/x', requestLevel ? { retry: { delayMax: 0 } } : {});
        await vi.advanceTimersByTimeAsync(2);
        expect((await pending).status).toBe(200);
        expect(net.calls('GET', '/x')).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([NaN, Infinity, -1])('[retry.opt.jitter][retry.req.retry.jitter.callback] 请求级抖动返回 %s 时回退原始延时', async (value) => {
        vi.useFakeTimers();
        const { net, ax } = setup({ delay: 30 });
        const jitter = vi.fn(() => value);
        const pending = ax.get('/x', { retry: { jitter } });
        await vi.advanceTimersByTimeAsync(29);
        expect(net.calls('GET', '/x')).toBe(1);
        expect(jitter).toHaveBeenCalledExactlyOnceWith(30);
        await vi.advanceTimersByTimeAsync(2);
        expect((await pending).status).toBe(200);
        expect(net.calls('GET', '/x')).toBe(2);
    });

    it('[retry.req.retry.delay.callback] 请求级 delay 返回 null 时立即重发', async () => {
        vi.useFakeTimers();
        const { net, ax } = setup({ delay: 9000 });
        const delay = vi.fn(() => null);
        const pending = ax.get('/x', { retry: { delay } });
        await vi.advanceTimersByTimeAsync(2);
        expect((await pending).status).toBe(200);
        expect(delay).toHaveBeenCalledOnce();
        expect(net.calls('GET', '/x')).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['delay', 'jitter'] as const)('[retry.req.retry.delay.callback][retry.req.retry.jitter.callback] 请求级 %s 抛错后不再发送且不留下定时器', async (field) => {
        vi.useFakeTimers();
        const { net, ax } = setup();
        const error = new Error('延时回调失败');
        const callback = vi.fn(() => { throw error; });
        const pending = ax.get('/x', { retry: { [field]: callback } });
        const assertion = expect(pending).rejects.toBe(error);
        await vi.runAllTimersAsync();
        await assertion;
        expect(callback).toHaveBeenCalledOnce();
        expect(net.calls('GET', '/x')).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('retry — Retry-After 的请求级边界', () => {
    it.each([false, true])('[retry.opt.afterStatusCodes][retry.req.retry.afterStatusCodes] 空列表忽略有效的 Retry-After，使用请求级=%s', async (requestLevel) => {
        vi.useFakeTimers();
        const { net, ax } = setup({ afterStatusCodes: requestLevel ? [503] : [] }, 503, { 'retry-after': '90' });
        const pending = ax.get('/x', requestLevel ? { retry: { afterStatusCodes: [] } } : {});
        await vi.advanceTimersByTimeAsync(2);
        expect((await pending).status).toBe(200);
        expect(net.calls('GET', '/x')).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[retry.req.retry.respectRetryAfter] 请求级 false 忽略有效头并覆盖插件 true', async () => {
        vi.useFakeTimers();
        const { net, ax } = setup({ respectRetryAfter: true }, 503, { 'retry-after': '90' });
        const pending = ax.get('/x', { retry: { respectRetryAfter: false } });
        await vi.advanceTimersByTimeAsync(2);
        expect((await pending).status).toBe(200);
        expect(net.calls('GET', '/x')).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([false, true])('[retry.opt.retryAfterMax][retry.req.retry.retryAfterMax] retryAfterMax=0 使有效头立即到期且不调用 delay，使用请求级=%s', async (requestLevel) => {
        vi.useFakeTimers();
        const delay = vi.fn(() => 9000);
        const { net, ax } = setup({ delay, retryAfterMax: requestLevel ? 8000 : 0 }, 503, { 'retry-after': '90' });
        const pending = ax.get('/x', requestLevel ? { retry: { retryAfterMax: 0 } } : {});
        await vi.advanceTimersByTimeAsync(2);
        expect((await pending).status).toBe(200);
        expect(delay).not.toHaveBeenCalled();
        expect(net.calls('GET', '/x')).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('retry — 重复安装与清理', () => {
    it('[retry.method.install][retry.method.cleanup] 同一插件重复安装后分别卸载，重复清理不移除另一份安装', async () => {
        const net = makeNetwork().on('GET', '/x', () => ({ status: 500 }));
        const ax = axios.create({ adapter: net.adapter });
        const plugin = retry({ max: 1, delay: 0 });
        const first = plugin.install(ax);
        const second = plugin.install(ax);
        first?.();
        first?.();
        await expect(ax.get('/x')).rejects.toMatchObject({ status: 500 });
        expect(net.calls('GET', '/x')).toBe(2);
        second?.();
        second?.();
        await expect(ax.get('/x')).rejects.toMatchObject({ status: 500 });
        expect(net.calls('GET', '/x')).toBe(3);
    });
});
