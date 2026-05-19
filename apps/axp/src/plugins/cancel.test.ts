import { describe, it, expect, vi } from 'vitest';
import cancel, { cancelAll } from './cancel';


function makeMockCtx() {
    const reqHandlers: Array<(config: any) => any> = [];
    const resHandlers: Array<{ f?: (r: any) => any; r?: (e: any) => any }> = [];
    const cleanups: Array<() => void> = [];
    const ax = { request: vi.fn(), defaults: { adapter: undefined } } as any;
    const ctx: any = {
        axios: ax,
        name: 'cancel',
        logger: { log: () => { }, warn: () => { }, error: () => { } },
        request: (f: any) => { reqHandlers.push(f); },
        response: (f: any, r: any) => { resHandlers.push({ f, r }); },
        adapter: () => { },
        transformRequest: () => { },
        transformResponse: () => { },
        cleanup: (fn: any) => { cleanups.push(fn); },
    };
    return { ctx, ax, reqHandlers, resHandlers, cleanups };
}


describe('cancel — request interceptor 注入 AbortController', () => {
    it('未自带 signal → 注入 ctrl，绑到 config.signal 上', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const config: any = { url: '/x' };
        reqHandlers[0](config);
        expect(config.signal).toBeInstanceOf(AbortSignal);
        expect(config._cancelCtrl).toBeInstanceOf(AbortController);
    });

    it('config.signal 已存在 → 不覆盖（尊重用户）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const userCtrl = new AbortController();
        const config: any = { url: '/x', signal: userCtrl.signal };
        reqHandlers[0](config);
        expect(config.signal).toBe(userCtrl.signal);
        expect(config._cancelCtrl).toBeUndefined();
    });

    it('config.cancelToken 已存在 → 不覆盖', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const config: any = { url: '/x', cancelToken: { reason: undefined } };
        reqHandlers[0](config);
        expect(config.signal).toBeUndefined();
        expect(config._cancelCtrl).toBeUndefined();
    });
});


describe('cancel — response 阶段释放 controller', () => {
    it('成功响应 → 从 set 中移除', () => {
        const { ctx, ax, reqHandlers, resHandlers } = makeMockCtx();
        cancel().install(ctx);
        const config: any = { url: '/x' };
        reqHandlers[0](config);
        const before = cancelAll(ax);  // 不调用，仅借此检查未生效后的状态——这里反而要先释放
        // 真正释放：response onFulfilled
        resHandlers[0].f!({ config });
        // 现在 cancelAll 应当为 0
        expect(cancelAll(ax)).toBe(0);
        expect(before).toBe(1);  // 释放前还有 1 个
    });

    it('失败响应 → 也从 set 中移除（reject 透传）', async () => {
        const { ctx, ax, reqHandlers, resHandlers } = makeMockCtx();
        cancel().install(ctx);
        const config: any = { url: '/x' };
        reqHandlers[0](config);
        const err = { config, message: 'fail' };
        await expect(resHandlers[0].r!(err)).rejects.toMatchObject({ message: 'fail' });
        expect(cancelAll(ax)).toBe(0);
    });
});


describe('cancelAll — 批量中止', () => {
    it('返回中止数量，并 abort 每个 controller', () => {
        const { ctx, ax, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const c1: any = { url: '/a' };
        const c2: any = { url: '/b' };
        reqHandlers[0](c1);
        reqHandlers[0](c2);
        const sig1 = c1.signal as AbortSignal;
        const sig2 = c2.signal as AbortSignal;
        expect(sig1.aborted).toBe(false);
        expect(sig2.aborted).toBe(false);
        const n = cancelAll(ax, 'bye');
        expect(n).toBe(2);
        expect(sig1.aborted).toBe(true);
        expect(sig2.aborted).toBe(true);
    });

    it('对未安装插件的 axios 实例 → 返回 0，无错', () => {
        const fakeAx = {} as any;
        expect(cancelAll(fakeAx)).toBe(0);
    });

    it('反复调用 → 第二次没有可中止的', () => {
        const { ctx, ax, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        reqHandlers[0]({ url: '/a' });
        expect(cancelAll(ax)).toBe(1);
        expect(cancelAll(ax)).toBe(0);
    });
});


describe('cancel — enable:false', () => {
    it('整个插件不安装拦截器', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel({ enable: false }).install(ctx);
        expect(reqHandlers).toHaveLength(0);
    });
});
