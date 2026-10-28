import { afterEach, describe, expect, it, vi } from 'vitest';
import cancel, { cancelAll } from '../../src/plugins/cancel';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 创建可直接调用拦截器回调的最小 axios 替身。 */
function interceptors() {
    const request = { use: vi.fn(), eject: vi.fn() };
    const response = { use: vi.fn(), eject: vi.fn() };
    const ax: any = { defaults: {}, interceptors: { request, response } };
    return { ax, request, response };
}

/** 构造 adapter 层成功响应。 */
function response(config: any, data: unknown = 'ok') {
    return { config, data, status: 200, statusText: '', headers: {} };
}

function makeMockCtx() {
    const reqHandlers: Array<(config: any) => any> = [];
    const resHandlers: Array<{ f?: (r: any) => any; r?: (e: any) => any }> = [];
    const ax: any = {
        request: vi.fn(),
        defaults: { adapter: undefined },
        interceptors: {
            request: {
                use: (f: any) => { reqHandlers.push(f); return reqHandlers.length - 1; },
                eject: () => { },
            },
            response: {
                use: (f: any, r: any) => { resHandlers.push({ f, r }); return resHandlers.length - 1; },
                eject: () => { },
            },
        },
    };
    return { ax, reqHandlers, resHandlers };
}

describe('cancel/loading — 资源释放边界', () => {
    it('[cancel.fn.cancelAll][cancel.method.cleanup] cancel 完成后的旧 signal 再进请求链应签发新 signal；无 config 错误原样透传', async () => {
        const { ax, request, response: hooks } = interceptors();
        const off = cancel().install(ax);
        const prepare = request.use.mock.calls[0][0];
        const finish = hooks.use.mock.calls[0][0];
        const config: any = prepare({});
        const signal = config.signal;
        finish(response(config));
        prepare(config);
        expect(config.signal).not.toBe(signal);
        expect(cancelAll(ax, 'leave')).toBe(1);
        expect(config.signal.reason).toBe('leave');
        await expect(hooks.use.mock.calls[0][1](undefined)).rejects.toBeUndefined();
        off?.();
        expect(cancelAll(ax)).toBe(0);
        expect(request.eject).toHaveBeenCalledOnce();
        expect(hooks.eject).toHaveBeenCalledOnce();
    });
});

describe('cancel — request interceptor 注入 AbortController', () => {
    it('[cancel.fn.axpCancel] 同一在途请求重进请求链时沿用 signal，仅追踪一个 controller', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        const original: any = { url: '/review-cancel' };
        reqHandlers[0](original);
        const replay = { ...original };
        reqHandlers[0](replay);
        expect(replay.signal).toBe(original.signal);
        expect(cancelAll(ax)).toBe(1);
        expect(replay.signal.aborted).toBe(true);
    });

    it('[cancel.fn.axpCancel] cancelAll 后重进请求链保留 aborted 状态且不新增 controller', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        const original: any = { url: '/review-cancel' };
        reqHandlers[0](original);
        expect(cancelAll(ax)).toBe(1);
        const replay = { ...original };
        reqHandlers[0](replay);
        expect(replay.signal).toBe(original.signal);
        expect(replay.signal.aborted).toBe(true);
        expect(cancelAll(ax)).toBe(0);
    });
});

describe('cancelAll — 批量中止', () => {
    it('[cancel.fn.cancelAll] 对未安装插件的 axios 实例 → 返回 0，无错', () => {
        const fakeAx = {} as any;
        expect(cancelAll(fakeAx)).toBe(0);
    });

    it('[cancel.fn.cancelAll] 反复调用 → 第二次没有可中止的', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        reqHandlers[0]({ url: '/a' });
        expect(cancelAll(ax)).toBe(1);
        expect(cancelAll(ax)).toBe(0);
    });
});
