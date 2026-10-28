import { describe, it, expect, vi } from 'vitest';
import cancel, { cancelAll } from '../../../src/plugins/cancel';
import { getInternal } from '../../../src/bag';
import axios from 'axios';
import { Axp } from '../../../src';
import { makeNetwork } from '../../helpers/network';
import { use } from '../../helpers/install';

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

describe('cancel — request interceptor 注入 AbortController', () => {
    it('[cancel.fn.axpCancel] 未自带 signal → 注入 ctrl，绑到 config.signal 上', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        const config: any = { url: '/x' };
        reqHandlers[0](config);
        expect(config.signal).toBeInstanceOf(AbortSignal);
        // controller 收进私有 bag（Symbol 键），不再以可枚举 config._cancelCtrl 暴露
        expect(config._cancelCtrl).toBeUndefined();
        expect(getInternal(config, 'axp:cancel:ctrl')).toBeInstanceOf(AbortController);
    });

    it('[cancel.fn.axpCancel] config.signal 已存在 → 不覆盖（尊重用户）', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        const userCtrl = new AbortController();
        const config: any = { url: '/x', signal: userCtrl.signal };
        reqHandlers[0](config);
        expect(config.signal).toBe(userCtrl.signal);
        expect(getInternal(config, 'axp:cancel:ctrl')).toBeUndefined();
    });

    it('[cancel.fn.axpCancel] config.cancelToken 已存在 → 不覆盖', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        const config: any = { url: '/x', cancelToken: { reason: undefined } };
        reqHandlers[0](config);
        expect(config.signal).toBeUndefined();
        expect(getInternal(config, 'axp:cancel:ctrl')).toBeUndefined();
    });
});

describe('cancel — response 阶段释放 controller', () => {
    it('[cancel.fn.axpCancel] 成功响应 → 从 set 中移除', () => {
        const { ax, reqHandlers, resHandlers } = makeMockCtx();
        cancel().install(ax);
        const config: any = { url: '/x' };
        reqHandlers[0](config);
        const before = cancelAll(ax);  // 不调用，仅借此检查未生效后的状态——这里反而要先释放
        // 真正释放：response onFulfilled
        resHandlers[0].f!({ config });
        // 现在 cancelAll 应当为 0
        expect(cancelAll(ax)).toBe(0);
        expect(before).toBe(1);  // 释放前还有 1 个
    });

    it('[cancel.fn.axpCancel] 失败响应 → 也从 set 中移除（reject 透传）', async () => {
        const { ax, reqHandlers, resHandlers } = makeMockCtx();
        cancel().install(ax);
        const config: any = { url: '/x' };
        reqHandlers[0](config);
        const err = { config, message: 'fail' };
        await expect(resHandlers[0].r!(err)).rejects.toMatchObject({ message: 'fail' });
        expect(cancelAll(ax)).toBe(0);
    });
});

describe('cancelAll — 批量中止', () => {
    it('[cancel.fn.cancelAll] 返回中止数量，并 abort 每个 controller', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
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
});

describe('cancel — enable:false', () => {
    it('[cancel.opt.enable] 整个插件不安装拦截器', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel({ enable: false }).install(ax);
        expect(reqHandlers).toHaveLength(0);
    });
});

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('cancel: cancelAll bookkeeping', () => {
  it('[cancel.fn.cancelAll] cancelAll() genuinely aborts an in-flight request and clears its own bookkeeping', async () => {
    // axios enforces `signal.aborted` in dispatchRequest's own
    // throwIfCancellationRequested — independent of whether the adapter
    // itself listens for it — so cancelAll() actually rejects the pending
    // call even though makeNetwork()'s fake adapter never checks the signal.
    const { net, api } = mkApi();
    const { cancelAll } = await import('../../../src/plugins/cancel');
    net.fallback(() => ({ data: { code: 0, data: null } }));
    use(api, [cancel()]);

    const p = api.axios.get('/data', { latency: 200 } as any); // still in flight below
    await new Promise((r) => setTimeout(r, 10));
    const cancelled = cancelAll(api.axios, 'test');
    expect(cancelled).toBeGreaterThanOrEqual(1);
    const cancelledAgain = cancelAll(api.axios, 'test');
    expect(cancelledAgain).toBe(0); // already cleared, nothing left to report
    await expect(p).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  });
});

describe('cancel — 插件契约（install / cleanup / name / reason）', () => {
  it('[cancel.prop.name] 插件名为 axp:cancel', () => {
    expect(cancel().name).toBe('axp:cancel');
  });

  it('[cancel.method.install] install 注册一个请求拦截器和一个响应拦截器，并返回 cleanup 函数', () => {
    const { ax, reqHandlers, resHandlers } = makeMockCtx();
    const off = cancel().install(ax);
    expect(reqHandlers).toHaveLength(1);
    expect(resHandlers).toHaveLength(1);
    expect(typeof off).toBe('function');
  });

  it('[cancel.method.cleanup] cleanup 后 cancelAll 返回 0，在飞的 controller 不再被中止', () => {
    const { ax, reqHandlers } = makeMockCtx();
    const off = cancel().install(ax);
    const config: any = { url: '/a' };
    reqHandlers[0](config);
    (off as () => void)();
    expect(cancelAll(ax, 'x')).toBe(0);
    expect(config.signal.aborted).toBe(false);
  });

  it('[cancel.fn.cancelAll.reason] reason 会成为 signal.reason', () => {
    const { ax, reqHandlers } = makeMockCtx();
    cancel().install(ax);
    const config: any = { url: '/a' };
    reqHandlers[0](config);
    cancelAll(ax, '用户切走了页面');
    expect(config.signal.aborted).toBe(true);
    expect(config.signal.reason).toBe('用户切走了页面');
  });
});
