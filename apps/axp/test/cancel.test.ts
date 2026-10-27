import { sleep } from './helpers/sleep';
import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { Axp, axpKey, axpCache, axpShare, axpRetry } from '../src';
import { makeNetwork } from './helpers/network';
import cancel, { cancelAll } from '../src/plugins/cancel';
import { getInternal } from '../src/bag';


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
    it('同一在途请求重进请求链时沿用 signal，仅追踪一个 controller', () => {
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

    it('cancelAll 后重进请求链保留 aborted 状态且不新增 controller', () => {
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

    it('未自带 signal → 注入 ctrl，绑到 config.signal 上', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        const config: any = { url: '/x' };
        reqHandlers[0](config);
        expect(config.signal).toBeInstanceOf(AbortSignal);
        // controller 收进私有 bag（Symbol 键），不再以可枚举 config._cancelCtrl 暴露
        expect(config._cancelCtrl).toBeUndefined();
        expect(getInternal(config, 'axp:cancel:ctrl')).toBeInstanceOf(AbortController);
    });

    it('config.signal 已存在 → 不覆盖（尊重用户）', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        const userCtrl = new AbortController();
        const config: any = { url: '/x', signal: userCtrl.signal };
        reqHandlers[0](config);
        expect(config.signal).toBe(userCtrl.signal);
        expect(getInternal(config, 'axp:cancel:ctrl')).toBeUndefined();
    });

    it('config.cancelToken 已存在 → 不覆盖', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        const config: any = { url: '/x', cancelToken: { reason: undefined } };
        reqHandlers[0](config);
        expect(config.signal).toBeUndefined();
        expect(getInternal(config, 'axp:cancel:ctrl')).toBeUndefined();
    });
});


describe('cancel — response 阶段释放 controller', () => {
    it('成功响应 → 从 set 中移除', () => {
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

    it('失败响应 → 也从 set 中移除（reject 透传）', async () => {
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
    it('返回中止数量，并 abort 每个 controller', () => {
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

    it('对未安装插件的 axios 实例 → 返回 0，无错', () => {
        const fakeAx = {} as any;
        expect(cancelAll(fakeAx)).toBe(0);
    });

    it('反复调用 → 第二次没有可中止的', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel().install(ax);
        reqHandlers[0]({ url: '/a' });
        expect(cancelAll(ax)).toBe(1);
        expect(cancelAll(ax)).toBe(0);
    });
});


describe('cancel — enable:false', () => {
    it('整个插件不安装拦截器', () => {
        const { ax, reqHandlers } = makeMockCtx();
        cancel({ enable: false }).install(ax);
        expect(reqHandlers).toHaveLength(0);
    });
});


describe('cancel — 与 cache / share / retry 组合（Axp.install 规范顺序）', () => {

    it('cancel + cache：命中缓存后 controller 不残留，cancelAll 返回 0', async () => {
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { key: axpKey(), cancel: cancel(), cache: axpCache() });
        await ax.get('/a', { key: 'k', cache: true } as any);   // 未命中，真实请求
        await ax.get('/a', { key: 'k', cache: true } as any);   // 命中，响应来自缓存
        expect(net.calls('GET', '/a')).toBe(1);
        expect(cancelAll(ax)).toBe(0);
    });

    it('cancel + key + share：并发同 key 请求全部完成后 cancelAll 返回 0', async () => {
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { key: axpKey(), cancel: cancel(), share: axpShare() });
        const reqs = Array.from({ length: 5 }, () => ax.get('/s', { key: 'same', share: 'start', latency: 10 } as any));
        await Promise.all(reqs);
        expect(net.calls('GET', '/s')).toBe(1);
        expect(cancelAll(ax)).toBe(0);
    });

    it('cancel + retry：重试等待期间 cancelAll 能中止（返回 1），请求以取消告终', async () => {
        const net = makeNetwork();
        net.fallback(() => ({ status: 500 }));
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { cancel: cancel(), retry: axpRetry({ max: 2, delay: 200 }) });
        const p = ax.get('/r').then(() => 'ok' as const, (e) => e);
        await sleep(60);                       // 首次 500 已返回，正在等待重试
        expect(cancelAll(ax)).toBe(1);
        const out: any = await p;
        expect(axios.isCancel(out)).toBe(true);
        expect(net.calls('GET', '/r')).toBe(1); // 取消后没有再发第二次
    });

    it('cancel + retry：重试最终成功后 controller 被释放（cancelAll 返回 0）', async () => {
        const net = makeNetwork();
        net.fallback((_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { cancel: cancel(), retry: axpRetry({ max: 2, delay: 1 }) });
        const r = await ax.get('/r2');
        expect(r.status).toBe(200);
        expect(net.calls('GET', '/r2')).toBe(2);
        expect(cancelAll(ax)).toBe(0);
    });
});
