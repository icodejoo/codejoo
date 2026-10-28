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

describe('cancel — 插件契约边界', () => {
    it('[cancel.opt.enable] enable:false → install 不返回 cleanup，cancelAll 返回 0；enable 缺省/undefined 视为开启', () => {
        const off = cancel({ enable: false }).install(makeMockCtx().ax);
        expect(off).toBeUndefined();
        const { ax, reqHandlers } = makeMockCtx();
        cancel({ enable: false }).install(ax);
        expect(cancelAll(ax)).toBe(0);

        const on = makeMockCtx();
        cancel({ enable: undefined }).install(on.ax);
        expect(on.reqHandlers).toHaveLength(1);
    });

    it('[cancel.method.install] 同一实例重复 install → 后装的覆盖集合，只中止新集合内的请求', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        const a: any = { url: '/a' };
        reqHandlers[0](a);
        cancel().install(ax);
        const b: any = { url: '/b' };
        reqHandlers[1](b);
        expect(cancelAll(ax)).toBe(1);
        expect(b.signal.aborted).toBe(true);
        expect(a.signal.aborted).toBe(false);
    });

    it('[cancel.method.install] 对无 interceptors 的实例 install → 抛错（不静默吞掉）', () => {
        expect(() => cancel().install({ defaults: {} } as any)).toThrow();
    });

    it('[cancel.method.cleanup] 重复调用 cleanup → 不抛错，仍保持已清空状态', () => {
        const { ax, reqHandlers } = makeMockCtx();
        const off = cancel().install(ax) as () => void;
        reqHandlers[0]({ url: '/a' });
        off();
        expect(() => off()).not.toThrow();
        expect(cancelAll(ax)).toBe(0);
    });

    it('[cancel.prop.name] name 在不同 options 下恒定，且不被实例间共享修改影响', () => {
        expect(cancel({ enable: false }).name).toBe('axp:cancel');
        const p = cancel();
        p.name = 'other';
        expect(cancel().name).toBe('axp:cancel');
    });

    it('[cancel.fn.cancelAll.reason] reason 为 undefined/空串/非字符串 → 原样透传到 signal.reason（undefined 时为默认 AbortError）', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        const a: any = { url: '/a' }, b: any = { url: '/b' }, c: any = { url: '/c' };
        reqHandlers[0](a); cancelAll(ax);
        expect(a.signal.aborted).toBe(true);
        expect((a.signal.reason as any).name).toBe('AbortError');
        reqHandlers[0](b); cancelAll(ax, '');
        expect(b.signal.reason).toBe('');
        reqHandlers[0](c); cancelAll(ax, 42 as any);
        expect(c.signal.reason).toBe(42);
    });
});
