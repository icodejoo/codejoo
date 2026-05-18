import { describe, it, expect, vi } from 'vitest';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { $resolveMax, $resolveException, type IRetryOptions } from './retry';


describe('$resolveMax', () => {
    it('请求级 number 优先', () => {
        expect($resolveMax({ retry: 5 } as any, { max: 1 })).toBe(5);
    });
    it('请求级对象 max 次之', () => {
        expect($resolveMax({ retry: { max: 3 } } as any, { max: 1 })).toBe(3);
    });
    it('请求级未指定 → 插件级', () => {
        expect($resolveMax({} as AxiosRequestConfig, { max: 2 })).toBe(2);
    });
    it('全部未指定 → 0', () => {
        expect($resolveMax({} as AxiosRequestConfig, {})).toBe(0);
    });
    it('请求级 number=0 显式禁用', () => {
        expect($resolveMax({ retry: 0 } as any, { max: 5 })).toBe(0);
    });
});


describe('$resolveException', () => {
    const fn = (r: AxiosResponse) => r.data?.code !== 0;
    it('请求级对象 isExceptionRequest 优先', () => {
        const reqFn = vi.fn(() => true);
        expect($resolveException({ retry: { max: 1, isExceptionRequest: reqFn } } as any, { isExceptionRequest: fn }))
            .toBe(reqFn);
    });
    it('请求级 number → 走插件级', () => {
        expect($resolveException({ retry: 3 } as any, { isExceptionRequest: fn })).toBe(fn);
    });
    it('都未指定 → undefined', () => {
        expect($resolveException({} as AxiosRequestConfig, {})).toBeUndefined();
    });
});


// ── 集成：mock 一个最小 ctx + axios，验证 onFulfilled / onRejected 的重试编排 ──

function makeMockCtx() {
    type FulfilledFn = (resp: AxiosResponse) => any;
    type RejectedFn = (err: any) => any;
    const handlers: Array<{ fulfilled?: FulfilledFn; rejected?: RejectedFn }> = [];
    const requestFn = vi.fn();
    const ctx: any = {
        axios: { request: requestFn, defaults: { adapter: undefined } },
        name: 'retry',
        logger: { log: () => { }, warn: () => { }, error: () => { } },
        request: () => { },
        response: (f: FulfilledFn, r: RejectedFn) => { handlers.push({ fulfilled: f, rejected: r }); },
        adapter: () => { },
        transformRequest: () => { },
        transformResponse: () => { },
        cleanup: () => { },
    };
    return { ctx, handlers, requestFn };
}


describe('retry 集成 — onRejected 路径', () => {
    it('max=2：第 1、2 次失败后重试，第 3 次失败彻底 reject', async () => {
        const { default: retry } = await import('./retry');
        const { ctx, handlers, requestFn } = makeMockCtx();
        retry({ max: 2 }).install(ctx);
        const onRejected = handlers[0].rejected!;
        const config = { url: '/x', method: 'get' } as any;

        // 第一次 retry → ctx.axios.request 被调用，返回成功
        requestFn.mockResolvedValueOnce({ data: 'ok' } as any);
        const r1 = await onRejected({ config, message: 'fail-1' });
        expect(requestFn).toHaveBeenCalledTimes(1);
        expect(r1).toMatchObject({ data: 'ok' });

        // 模拟同一 config 第 2 次失败 → 还在预算内
        requestFn.mockClear();
        requestFn.mockResolvedValueOnce({ data: 'ok2' } as any);
        await onRejected({ config, message: 'fail-2' });
        expect(requestFn).toHaveBeenCalledTimes(1);

        // 第 3 次失败 → 超额，不再重试
        requestFn.mockClear();
        await expect(onRejected({ config, message: 'fail-3' })).rejects.toMatchObject({ message: 'fail-3' });
        expect(requestFn).not.toHaveBeenCalled();
    });

    it('max=0 → 不重试，直接 reject', async () => {
        const { default: retry } = await import('./retry');
        const { ctx, handlers, requestFn } = makeMockCtx();
        retry({ max: 0 }).install(ctx);
        const onRejected = handlers[0].rejected!;
        await expect(onRejected({ config: {}, message: 'x' })).rejects.toMatchObject({ message: 'x' });
        expect(requestFn).not.toHaveBeenCalled();
    });

    it('error 没有 config → 直接 reject（防御性）', async () => {
        const { default: retry } = await import('./retry');
        const { ctx, handlers, requestFn } = makeMockCtx();
        retry({ max: 5 }).install(ctx);
        const onRejected = handlers[0].rejected!;
        await expect(onRejected({ message: 'no config' })).rejects.toMatchObject({ message: 'no config' });
        expect(requestFn).not.toHaveBeenCalled();
    });

    it('请求级 retry: 0 强制禁用（覆盖插件级 max=5）', async () => {
        const { default: retry } = await import('./retry');
        const { ctx, handlers, requestFn } = makeMockCtx();
        retry({ max: 5 }).install(ctx);
        const onRejected = handlers[0].rejected!;
        await expect(onRejected({ config: { retry: 0 }, message: 'x' })).rejects.toBeDefined();
        expect(requestFn).not.toHaveBeenCalled();
    });
});


describe('retry 集成 — isExceptionRequest 路径', () => {
    it('成功响应被判为业务异常时也触发重试', async () => {
        const { default: retry } = await import('./retry');
        const { ctx, handlers, requestFn } = makeMockCtx();
        const isException = vi.fn((r: AxiosResponse) => r.data?.code !== 0);
        retry({ max: 2, isExceptionRequest: isException }).install(ctx);
        const onFulfilled = handlers[0].fulfilled!;
        const config = { url: '/x' } as any;

        requestFn.mockResolvedValueOnce({ data: { code: 0, msg: 'ok' }, config } as any);
        const r = await onFulfilled({ data: { code: 1 }, config } as any);
        expect(isException).toHaveBeenCalledTimes(1);
        expect(requestFn).toHaveBeenCalledTimes(1);
        expect((r as any).data.code).toBe(0);
    });

    it('正常成功响应不触发重试', async () => {
        const { default: retry } = await import('./retry');
        const { ctx, handlers, requestFn } = makeMockCtx();
        retry({ max: 2, isExceptionRequest: (r) => r.data?.code !== 0 }).install(ctx);
        const onFulfilled = handlers[0].fulfilled!;
        const r = await onFulfilled({ data: { code: 0 }, config: {} } as any);
        expect(requestFn).not.toHaveBeenCalled();
        expect((r as any).data.code).toBe(0);
    });
});
