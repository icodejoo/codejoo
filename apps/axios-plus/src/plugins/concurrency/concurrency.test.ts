import { describe, it, expect, vi } from 'vitest';
import type { AxiosAdapter } from 'axios';
import concurrency from './concurrency';


function makeMockCtx() {
    let installedAdapter: AxiosAdapter | null = null;
    const cleanups: Array<() => void> = [];
    const ax: any = { defaults: { adapter: vi.fn() } };
    const ctx: any = {
        axios: ax,
        name: 'concurrency',
        logger: { log: () => { }, warn: () => { }, error: () => { } },
        request: () => { },
        response: () => { },
        adapter: (a: AxiosAdapter) => { installedAdapter = a; ax.defaults.adapter = a; },
        transformRequest: () => { },
        transformResponse: () => { },
        cleanup: (fn: any) => { cleanups.push(fn); },
        plugins: () => [],
    };
    return { ctx, ax, get adapter() { return installedAdapter!; } };
}


/** 创建一个可控 resolve/reject 的 adapter，用于精准模拟 in-flight */
function deferredAdapter() {
    const pending: Array<{ resolve: (v: any) => void; reject: (e: any) => void; config: any }> = [];
    const adp = vi.fn((config: any) =>
        new Promise((resolve, reject) => {
            pending.push({ resolve, reject, config });
        }),
    );
    return { adp, pending };
}


describe('concurrency —— enable / max 边界', () => {
    it('enable:false ⇒ 不装 adapter', () => {
        const { ctx, ax } = makeMockCtx();
        const orig = ax.defaults.adapter;
        concurrency({ enable: false }).install(ctx);
        expect(ax.defaults.adapter).toBe(orig);
    });

    it('max <= 0 ⇒ 装轻量直通 adapter，不做并发限制', async () => {
        const { ctx, ax } = makeMockCtx();
        const { adp, pending } = deferredAdapter();
        ax.defaults.adapter = adp;
        concurrency({ max: 0 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        // 5 个请求并发 —— 不限制，全部立即进入 adp
        const promises = Array.from({ length: 5 }, (_, i) =>
            wrapped({ url: '/' + i, concurrency: true } as any),
        );
        expect(adp).toHaveBeenCalledTimes(5);
        for (const p of pending) p.resolve({ data: 'ok' });
        await Promise.all(promises);
    });

    it('max <= 0 ⇒ 仍清理 config.concurrency 和 config.priority', async () => {
        const { ctx, ax } = makeMockCtx();
        const adp = vi.fn().mockResolvedValue({ data: 'ok' });
        ax.defaults.adapter = adp;
        concurrency({ max: 0 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const config: any = { url: '/x', concurrency: true, priority: 5 };
        await wrapped(config);
        expect(config.concurrency).toBeUndefined();
        expect(config.priority).toBeUndefined();
    });
});


describe('concurrency —— FIFO 队列限流', () => {
    it('max=2，5 个并发 ⇒ 仅前 2 个立即发；后 3 个排队', () => {
        const { ctx, ax } = makeMockCtx();
        const { adp, pending } = deferredAdapter();
        ax.defaults.adapter = adp;
        concurrency({ max: 2 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        for (let i = 0; i < 5; i++) {
            void wrapped({ url: '/' + i } as any);
        }
        // 队列异步入口需要 Promise tick 才能生效，但同步同时只 acquire 一次
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                expect(adp).toHaveBeenCalledTimes(2);
                // 释放第一个 ⇒ 第三个进入
                pending[0].resolve({});
                setTimeout(() => {
                    expect(adp).toHaveBeenCalledTimes(3);
                    // 释放第二个 ⇒ 第四个
                    pending[1].resolve({});
                    setTimeout(() => {
                        expect(adp).toHaveBeenCalledTimes(4);
                        // 释放第三个 ⇒ 第五个
                        pending[2].resolve({});
                        setTimeout(() => {
                            expect(adp).toHaveBeenCalledTimes(5);
                            // 收尾
                            pending[3].resolve({});
                            pending[4].resolve({});
                            resolve();
                        }, 0);
                    }, 0);
                }, 0);
            }, 0);
        });
    });

    it('请求失败也释放槽位（finally 兜底）', async () => {
        const { ctx, ax } = makeMockCtx();
        const { adp, pending } = deferredAdapter();
        ax.defaults.adapter = adp;
        concurrency({ max: 1 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        const p1 = wrapped({ url: '/a' } as any);
        const p2 = wrapped({ url: '/b' } as any);
        await new Promise((r) => setTimeout(r, 0));
        expect(adp).toHaveBeenCalledTimes(1);
        // 第一个失败
        pending[0].reject(new Error('boom'));
        await expect(p1).rejects.toThrow('boom');
        // 第二个应进入
        await new Promise((r) => setTimeout(r, 0));
        expect(adp).toHaveBeenCalledTimes(2);
        pending[1].resolve({});
        await p2;
    });
});


describe('concurrency —— priority 优先级', () => {
    it('队列已满时，高 priority 排前面', async () => {
        const { ctx, ax } = makeMockCtx();
        const { adp, pending } = deferredAdapter();
        ax.defaults.adapter = adp;
        concurrency({ max: 1 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        // 第一个占住唯一槽位
        void wrapped({ url: '/initial' } as any);
        await new Promise((r) => setTimeout(r, 0));

        // 三个排队：priority 1, 5, 3 —— 派发顺序应为 5, 3, 1
        void wrapped({ url: '/p1', priority: 1 } as any);
        void wrapped({ url: '/p5', priority: 5 } as any);
        void wrapped({ url: '/p3', priority: 3 } as any);

        // 释放第一个，唤醒队首（priority=5）
        pending[0].resolve({});
        await new Promise((r) => setTimeout(r, 0));
        expect(adp).toHaveBeenCalledTimes(2);
        expect(adp.mock.calls[1][0].url).toBe('/p5');

        pending[1].resolve({});
        await new Promise((r) => setTimeout(r, 0));
        expect(adp.mock.calls[2][0].url).toBe('/p3');

        pending[2].resolve({});
        await new Promise((r) => setTimeout(r, 0));
        expect(adp.mock.calls[3][0].url).toBe('/p1');

        pending[3].resolve({});
    });

    it('同 priority ⇒ FIFO（先入先出）', async () => {
        const { ctx, ax } = makeMockCtx();
        const { adp, pending } = deferredAdapter();
        ax.defaults.adapter = adp;
        concurrency({ max: 1 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        void wrapped({ url: '/initial' } as any);
        await new Promise((r) => setTimeout(r, 0));
        void wrapped({ url: '/a', priority: 5 } as any);
        void wrapped({ url: '/b', priority: 5 } as any);
        void wrapped({ url: '/c', priority: 5 } as any);

        pending[0].resolve({});
        await new Promise((r) => setTimeout(r, 0));
        expect(adp.mock.calls[1][0].url).toBe('/a');
        pending[1].resolve({});
        await new Promise((r) => setTimeout(r, 0));
        expect(adp.mock.calls[2][0].url).toBe('/b');
        pending[2].resolve({});
        await new Promise((r) => setTimeout(r, 0));
        expect(adp.mock.calls[3][0].url).toBe('/c');
        pending[3].resolve({});
    });

    it('priority 仅在排队时生效；空槽位直接进 adp 不参与排序', async () => {
        const { ctx, ax } = makeMockCtx();
        const { adp, pending } = deferredAdapter();
        ax.defaults.adapter = adp;
        concurrency({ max: 5 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        // 4 个并发，全部立即派发，priority 不影响顺序
        void wrapped({ url: '/a', priority: 1 } as any);
        void wrapped({ url: '/b', priority: 100 } as any);
        void wrapped({ url: '/c', priority: 50 } as any);

        await new Promise((r) => setTimeout(r, 0));
        expect(adp).toHaveBeenCalledTimes(3);
        expect(adp.mock.calls[0][0].url).toBe('/a');
        expect(adp.mock.calls[1][0].url).toBe('/b');
        expect(adp.mock.calls[2][0].url).toBe('/c');

        for (const p of pending) p.resolve({});
    });
});


describe('concurrency —— 请求级 bypass', () => {
    it('config.concurrency: false ⇒ 跳过队列直接发', async () => {
        const { ctx, ax } = makeMockCtx();
        const { adp, pending } = deferredAdapter();
        ax.defaults.adapter = adp;
        concurrency({ max: 1 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        // 占住唯一槽位
        void wrapped({ url: '/normal' } as any);
        // bypass：仍然立即进 adp
        void wrapped({ url: '/big', concurrency: false } as any);

        await new Promise((r) => setTimeout(r, 0));
        expect(adp).toHaveBeenCalledTimes(2);
        for (const p of pending) p.resolve({});
    });

    it('bypass 后 ⇒ delete config.concurrency 防泄漏', async () => {
        const { ctx, ax } = makeMockCtx();
        const adp = vi.fn().mockResolvedValue({ data: 'ok' });
        ax.defaults.adapter = adp;
        concurrency({ max: 4 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const config: any = { url: '/x', concurrency: false };
        await wrapped(config);
        expect(config.concurrency).toBeUndefined();
    });
});


describe('concurrency —— method 白名单', () => {
    it('methods: ["get"] ⇒ 仅 GET 入队，POST 直接放行', async () => {
        const { ctx, ax } = makeMockCtx();
        const { adp, pending } = deferredAdapter();
        ax.defaults.adapter = adp;
        concurrency({ max: 1, methods: ['get'] }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        void wrapped({ method: 'GET', url: '/a' } as any);
        // POST 不计入并发
        void wrapped({ method: 'POST', url: '/b' } as any);

        await new Promise((r) => setTimeout(r, 0));
        expect(adp).toHaveBeenCalledTimes(2);
        for (const p of pending) p.resolve({});
    });

    it('methods: ["*"] / 缺省 ⇒ 所有 method 都入队', async () => {
        const { ctx, ax } = makeMockCtx();
        const { adp, pending } = deferredAdapter();
        ax.defaults.adapter = adp;
        concurrency({ max: 1 }).install(ctx); // 默认 methods='*'
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        void wrapped({ method: 'GET', url: '/a' } as any);
        void wrapped({ method: 'POST', url: '/b' } as any);

        await new Promise((r) => setTimeout(r, 0));
        // 第二个应排队
        expect(adp).toHaveBeenCalledTimes(1);
        pending[0].resolve({});
        await new Promise((r) => setTimeout(r, 0));
        expect(adp).toHaveBeenCalledTimes(2);
        pending[1].resolve({});
    });
});


describe('concurrency —— abort 友好', () => {
    it('signal 已 aborted ⇒ acquire 立即 reject', async () => {
        const { ctx, ax } = makeMockCtx();
        const adp = vi.fn().mockResolvedValue({ data: 'ok' });
        ax.defaults.adapter = adp;
        concurrency({ max: 1 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        const ctrl = new AbortController();
        ctrl.abort('user-cancel');
        await expect(
            wrapped({ url: '/x', signal: ctrl.signal } as any),
        ).rejects.toBe('user-cancel');
        expect(adp).not.toHaveBeenCalled();
    });

    it('入队后 abort ⇒ 自动从队列移除并 reject', async () => {
        const { ctx, ax } = makeMockCtx();
        const { adp, pending } = deferredAdapter();
        ax.defaults.adapter = adp;
        concurrency({ max: 1 }).install(ctx);
        const wrapped = ax.defaults.adapter as AxiosAdapter;

        // 占住槽位
        void wrapped({ url: '/normal' } as any);
        await new Promise((r) => setTimeout(r, 0));

        const ctrl = new AbortController();
        const queued = wrapped({ url: '/q', signal: ctrl.signal } as any);
        // 入队后取消
        ctrl.abort('cancel-while-queued');
        await expect(queued).rejects.toBe('cancel-while-queued');
        // adp 没被调（因为还没轮到它）
        expect(adp).toHaveBeenCalledTimes(1);
        pending[0].resolve({});
    });
});
