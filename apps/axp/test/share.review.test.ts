import { describe, it, expect, vi } from 'vitest';
import { AxiosError, CanceledError } from 'axios';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import share from '../src/plugins/share';

// Review 修复：#9 每个订阅者独立 error / #10 跟随者各自取消与超时

const mockResp = (data: any, config: any = {}): AxiosResponse =>
    ({ status: 200, statusText: 'OK', headers: {}, config, data }) as any;

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

describe('share — #9 失败时每个订阅者拿到独立 error', () => {
    it('error.config / response.config 重绑为各自 config，保留原型', async () => {
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

    it('非对象错误原样传递', async () => {
        const d = deferred<AxiosResponse>();
        const wrapped = setup(vi.fn(() => d.promise));
        const pa = wrapped({ url: '/x', key: 'k' } as any).catch((e) => e);
        const pb = wrapped({ url: '/x', key: 'k' } as any).catch((e) => e);
        d.reject('plain');
        expect(await pa).toBe('plain');
        expect(await pb).toBe('plain');
    });
});

describe('share — #10 跟随者响应自己的取消 / 超时', () => {
    it('跟随者 abort → 立即 CanceledError，首发与其他订阅者不受影响', async () => {
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

    it('已 abort 的 signal 立即拒绝', async () => {
        const d = deferred<AxiosResponse>();
        const wrapped = setup(vi.fn(() => d.promise));
        wrapped({ url: '/x', key: 'k' } as any).catch(() => {});
        const ctl = new AbortController();
        ctl.abort();
        await expect(wrapped({ url: '/x', key: 'k', signal: ctl.signal } as any)).rejects.toBeInstanceOf(CanceledError);
    });

    it('跟随者按自己的 timeout 退出', async () => {
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
