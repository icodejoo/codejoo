import { describe, it, expect, vi } from 'vitest';
import envs from './envs';


function makeMockCtx() {
    const ax: any = { defaults: { baseURL: '', headers: {} } };
    const ctx: any = {
        axios: ax,
        name: 'envs',
        logger: { log: () => { }, warn: () => { }, error: () => { } },
        request: () => { },
        response: () => { },
        adapter: () => { },
        transformRequest: () => { },
        transformResponse: () => { },
        cleanup: () => { },
        plugins: () => [],
    };
    return { ctx, ax };
}


describe('envs — 双工模式：default 选择器 + rules 候选', () => {
    it('default 是字面量 ⇒ 直接当 env 名查 rules', () => {
        const { ctx, ax } = makeMockCtx();
        envs({
            enable: true,
            default: 'prod',
            rules: [
                { rule: 'dev', config: { baseURL: 'http://dev' } },
                { rule: 'prod', config: { baseURL: 'http://prod', timeout: 5000 } },
            ],
        }).install(ctx);
        expect(ax.defaults.baseURL).toBe('http://prod');
        expect(ax.defaults.timeout).toBe(5000);
    });

    it('default 是函数 ⇒ install 时调一次取 env 名', () => {
        const { ctx, ax } = makeMockCtx();
        const selector = vi.fn(() => 'staging');
        envs({
            enable: true,
            default: selector,
            rules: [
                { rule: 'dev', config: { baseURL: 'http://dev' } },
                { rule: 'staging', config: { baseURL: 'http://staging' } },
            ],
        }).install(ctx);
        expect(selector).toHaveBeenCalledOnce();
        expect(ax.defaults.baseURL).toBe('http://staging');
    });

    it('rules[i].rule 也支持函数（同样 install 时求值）', () => {
        const { ctx, ax } = makeMockCtx();
        envs({
            enable: true,
            default: 'mock',
            rules: [
                { rule: () => 'mock', config: { baseURL: 'http://mock-fn' } },
                { rule: 'mock', config: { baseURL: 'http://mock-literal' } },
            ],
        }).install(ctx);
        // 第一条 (函数) 命中，break，不再判后续
        expect(ax.defaults.baseURL).toBe('http://mock-fn');
    });

    it('未命中任何 rule ⇒ no-op，不修改 defaults', () => {
        const { ctx, ax } = makeMockCtx();
        const before = { ...ax.defaults };
        envs({
            enable: true,
            default: 'unknown',
            rules: [
                { rule: 'dev', config: { baseURL: '/dev' } },
                { rule: 'prod', config: { baseURL: '/prod' } },
            ],
        }).install(ctx);
        expect(ax.defaults).toEqual(before);
    });

    it('rules 缺省 ⇒ 永远不会命中', () => {
        const { ctx, ax } = makeMockCtx();
        const before = { ...ax.defaults };
        envs({ enable: true, default: 'anything' }).install(ctx);
        expect(ax.defaults).toEqual(before);
    });

    it('enable: false ⇒ 整个 install 早退，不查也不合并', () => {
        const { ctx, ax } = makeMockCtx();
        const before = { ...ax.defaults };
        const selector = vi.fn(() => 'dev');
        envs({
            enable: false,
            default: selector,
            rules: [{ rule: 'dev', config: { baseURL: '/dev' } }],
        }).install(ctx);
        expect(selector).not.toHaveBeenCalled();
        expect(ax.defaults).toEqual(before);
    });

    it('合并是浅 Object.assign（headers 不递归）', () => {
        const { ctx, ax } = makeMockCtx();
        ax.defaults.headers = { 'X-A': '1' };
        envs({
            enable: true,
            default: 'dev',
            rules: [
                { rule: 'dev', config: { headers: { 'X-B': '2' } as any } },
            ],
        }).install(ctx);
        expect(ax.defaults.headers).toEqual({ 'X-B': '2' });
        expect(ax.defaults.headers['X-A']).toBeUndefined();
    });

    it('支持 number 字面量作为 env id', () => {
        const { ctx, ax } = makeMockCtx();
        envs({
            enable: true,
            default: 1,
            rules: [
                { rule: 0, config: { baseURL: '/zero' } },
                { rule: 1, config: { baseURL: '/one' } },
            ],
        }).install(ctx);
        expect(ax.defaults.baseURL).toBe('/one');
    });

    it('支持 symbol 字面量作为 env id', () => {
        const { ctx, ax } = makeMockCtx();
        const PROD = Symbol('prod');
        envs({
            enable: true,
            default: PROD,
            rules: [
                { rule: PROD, config: { baseURL: '/prod-sym' } },
            ],
        }).install(ctx);
        expect(ax.defaults.baseURL).toBe('/prod-sym');
    });
});
