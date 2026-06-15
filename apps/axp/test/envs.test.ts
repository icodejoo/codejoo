import { describe, it, expect, vi } from 'vitest';
import envs from '../src/plugins/envs';


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
    };
    return { ctx, ax };
}


describe('envs', () => {
    it('选第一个匹配的规则，merge 到 defaults', () => {
        const { ctx, ax } = makeMockCtx();
        envs([
            { rule: () => false, config: { baseURL: 'http://a' } },
            { rule: () => true, config: { baseURL: 'http://b', timeout: 5000 } },
            { rule: () => true, config: { baseURL: 'http://c' } },  // 不会执行
        ]).install(ctx);
        expect(ax.defaults.baseURL).toBe('http://b');
        expect(ax.defaults.timeout).toBe(5000);
    });

    it('第一条命中后 break：后续 rule() 不再调用', () => {
        const { ctx } = makeMockCtx();
        const r1 = vi.fn(() => true);
        const r2 = vi.fn(() => true);
        envs([
            { rule: r1, config: { baseURL: '/a' } },
            { rule: r2, config: { baseURL: '/b' } },
        ]).install(ctx);
        expect(r1).toHaveBeenCalledOnce();
        expect(r2).not.toHaveBeenCalled();
    });

    it('没有匹配 → 不修改 defaults', () => {
        const { ctx, ax } = makeMockCtx();
        const before = { ...ax.defaults };
        envs([
            { rule: () => false, config: { baseURL: '/a' } },
            { rule: () => false, config: { baseURL: '/b' } },
        ]).install(ctx);
        expect(ax.defaults).toEqual(before);
    });

    it('空规则列表 → no-op', () => {
        const { ctx, ax } = makeMockCtx();
        const before = { ...ax.defaults };
        envs().install(ctx);
        expect(ax.defaults).toEqual(before);
    });

    it('合并是浅 Object.assign（不递归）', () => {
        const { ctx, ax } = makeMockCtx();
        ax.defaults.headers = { 'X-A': '1' };
        envs([
            { rule: () => true, config: { headers: { 'X-B': '2' } as any } },
        ]).install(ctx);
        // 浅合并：X-A 被整体替换掉
        expect(ax.defaults.headers).toEqual({ 'X-B': '2' });
        expect(ax.defaults.headers['X-A']).toBeUndefined();
    });
});
