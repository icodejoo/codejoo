import { describe, it, expect, beforeEach, vi } from 'vitest';
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
        plugins: () => [],
    };
    return { ctx, ax, reqHandlers, resHandlers, cleanups };
}


// 全局共享 —— 每个测试之前清空所有分组，避免相互影响
beforeEach(() => { cancelAll(); });


describe('cancel — aborter 字段四态语义', () => {
    it('未指定 aborter + 未自带 signal ⇒ 注入默认组的 ctrl', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const config: any = { url: '/x' };
        reqHandlers[0](config);
        expect(config.signal).toBeInstanceOf(AbortSignal);
        expect(config.aborter).toBeUndefined(); // delete 后被清掉
        // cancelAll() 能命中
        expect(cancelAll()).toBe(1);
    });

    it('aborter: false ⇒ 完全不参与，不接管 signal 不登记', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const config: any = { url: '/x', aborter: false };
        reqHandlers[0](config);
        expect(config.signal).toBeUndefined();
        expect(config.aborter).toBeUndefined();
        expect(cancelAll()).toBe(0);
    });

    it('aborter: undefined + 用户已有 signal ⇒ 尊重不接管', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const userCtrl = new AbortController();
        const config: any = { url: '/x', signal: userCtrl.signal };
        reqHandlers[0](config);
        expect(config.signal).toBe(userCtrl.signal);
        expect(cancelAll()).toBe(0);
    });

    it('aborter: undefined + 用户已有 cancelToken ⇒ 尊重不接管', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const config: any = { url: '/x', cancelToken: { reason: undefined } };
        reqHandlers[0](config);
        expect(config.signal).toBeUndefined();
        expect(cancelAll()).toBe(0);
    });

    it('aborter: AbortController ⇒ 用 user ctrl，登记到默认组（cancelAll 仍命中）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const userCtrl = new AbortController();
        const config: any = { url: '/x', aborter: userCtrl };
        reqHandlers[0](config);
        expect(config.signal).toBe(userCtrl.signal);
        expect(config.aborter).toBeUndefined();
        expect(cancelAll()).toBe(1);
        expect(userCtrl.signal.aborted).toBe(true);
    });

    it('aborter: string ⇒ 命名组（cancelAll(name) 精准命中）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const c1: any = { url: '/a', aborter: 'auth' };
        const c2: any = { url: '/b', aborter: 'auth' };
        const c3: any = { url: '/c' }; // 默认组
        reqHandlers[0](c1);
        reqHandlers[0](c2);
        reqHandlers[0](c3);
        // 仅清 'auth' 组，默认组的 c3 不动
        expect(cancelAll('auth')).toBe(2);
        expect((c1.signal as AbortSignal).aborted).toBe(true);
        expect((c2.signal as AbortSignal).aborted).toBe(true);
        expect((c3.signal as AbortSignal).aborted).toBe(false);
    });
});


describe('cancel — response 阶段释放', () => {
    it('成功响应 ⇒ 从分组移除', () => {
        const { ctx, reqHandlers, resHandlers } = makeMockCtx();
        cancel().install(ctx);
        const config: any = { url: '/x' };
        reqHandlers[0](config);
        resHandlers[0].f!({ config });
        // settle 后已被释放
        expect(cancelAll()).toBe(0);
    });

    it('失败响应 ⇒ 也从分组移除（reject 透传）', async () => {
        const { ctx, reqHandlers, resHandlers } = makeMockCtx();
        cancel().install(ctx);
        const config: any = { url: '/x' };
        reqHandlers[0](config);
        const err = { config, message: 'fail' };
        await expect(resHandlers[0].r!(err)).rejects.toMatchObject({ message: 'fail' });
        expect(cancelAll()).toBe(0);
    });
});


describe('cancelAll — 批量中止', () => {
    it('不传 group ⇒ 清所有分组（默认 + 命名）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        reqHandlers[0]({ url: '/a' });                       // 默认组
        reqHandlers[0]({ url: '/b', aborter: 'g1' });        // g1
        reqHandlers[0]({ url: '/c', aborter: 'g2' });        // g2
        // cancelAll() 第一个参数是 group（不传 = 清所有），第二个才是 reason
        expect(cancelAll(undefined, 'shutdown')).toBe(3);
    });

    it('传 group ⇒ 仅清该组，其他不动', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        reqHandlers[0]({ url: '/a', aborter: 'g1' });
        reqHandlers[0]({ url: '/b', aborter: 'g1' });
        reqHandlers[0]({ url: '/c', aborter: 'g2' });
        expect(cancelAll('g1')).toBe(2);
        // g2 还在
        expect(cancelAll('g2')).toBe(1);
    });

    it('反复调用 ⇒ 第二次没有可中止的', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        reqHandlers[0]({ url: '/a' });
        expect(cancelAll()).toBe(1);
        expect(cancelAll()).toBe(0);
    });

    it('未知组名 ⇒ 返回 0', () => {
        expect(cancelAll('does-not-exist')).toBe(0);
    });
});


describe('cancel — enable:false', () => {
    it('整个插件不安装拦截器', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel({ enable: false }).install(ctx);
        expect(reqHandlers).toHaveLength(0);
    });
});


describe('cancel — 重发场景：aborter intent 持久化', () => {
    it("aborter:'payment' → 首发持久化 _cancel_intent；重发（aborter 已被消费删）仍进 payment 组", () => {
        const { ctx, reqHandlers, resHandlers } = makeMockCtx();
        cancel().install(ctx);
        const config: any = { aborter: 'payment' };

        // 首发
        reqHandlers[0](config);
        expect(config._cancel_intent).toBe('payment');
        expect(config._cancel_group).toBe('payment');
        expect(config.aborter).toBeUndefined();

        // 模拟响应 release（清 ctrl/group，但保留 _cancel_intent）
        resHandlers[0].f!({ config });
        expect(config._cancel_group).toBeUndefined();
        expect(config._cancel_intent).toBe('payment');

        // 重发：config.aborter 不在了，但 intent 仍在
        reqHandlers[0](config);
        expect(config._cancel_group).toBe('payment');
        // cancelAll('payment') 仍能命中重发请求
        const aborted = cancelAll('payment');
        expect(aborted).toBe(1);
    });

    it('aborter:false → 持久化禁用意图；重发仍跳过', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const config: any = { aborter: false };

        reqHandlers[0](config);
        expect(config._cancel_intent).toBe(false);
        expect(config._cancel_ctrl).toBeUndefined(); // 没创建 ctrl
        expect(config.signal).toBeUndefined();

        // 重发：aborter 已 delete，但 intent=false 仍持久化
        reqHandlers[0](config);
        expect(config._cancel_ctrl).toBeUndefined();
        expect(config.signal).toBeUndefined();
    });

    it('AbortController 实例不持久化（用户的 ctrl 不能跨重发复用）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        cancel().install(ctx);
        const ctrl = new AbortController();
        const config: any = { aborter: ctrl };

        reqHandlers[0](config);
        expect(config._cancel_intent).toBeUndefined(); // 不持久化
        expect(config.signal).toBe(ctrl.signal);
    });
});
