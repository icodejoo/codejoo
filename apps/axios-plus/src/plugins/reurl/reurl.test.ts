import { describe, it, expect, vi } from 'vitest';
import reurl, { $fixSlash } from './reurl';


function makeMockCtx() {
    const reqHandlers: Array<(c: any) => any> = [];
    const ctx: any = {
        axios: { defaults: { adapter: vi.fn() } },
        name: 'reurl',
        logger: { log: () => { }, warn: () => { }, error: () => { } },
        request: (fn: any) => { reqHandlers.push(fn); },
        response: () => { },
        adapter: () => { },
        transformRequest: () => { },
        transformResponse: () => { },
        cleanup: () => { },
        plugins: () => [],
    };
    return { ctx, reqHandlers };
}


describe('reurl —— 三种语法支持', () => {
    it('{var} —— 大括号语法', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = { url: '/users/{id}/orders/{oid}', params: { id: 5, oid: 'a1' } };
        reqHandlers[0](config);
        expect(config.url).toBe('/users/5/orders/a1');
    });

    it('[var] —— 方括号语法', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = { url: '/items/[name]', params: { name: 'pet' } };
        reqHandlers[0](config);
        expect(config.url).toBe('/items/pet');
    });

    it(':var —— 冒号语法', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = { url: '/api/:userId', params: { userId: 'u123' } };
        reqHandlers[0](config);
        expect(config.url).toBe('/api/u123');
    });

    it('混用三种语法在同一 url', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = {
            url: '/{a}/[b]/:c',
            params: { a: 'A', b: 'B', c: 'C' },
        };
        reqHandlers[0](config);
        expect(config.url).toBe('/A/B/C');
    });
});


describe('reurl —— params / data fallback', () => {
    it('params 优先：同名 key 在两边都有时取 params', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = {
            url: '/{id}',
            params: { id: 'from-params' },
            data: { id: 'from-data' },
        };
        reqHandlers[0](config);
        expect(config.url).toBe('/from-params');
    });

    it('params 没有 ⇒ 从 data 取（object）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = { url: '/{id}', data: { id: 99 } };
        reqHandlers[0](config);
        expect(config.url).toBe('/99');
    });

    it('data 是 primitive ⇒ 整个 data 当 value 用', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = { url: '/{x}', data: 42 };
        reqHandlers[0](config);
        expect(config.url).toBe('/42');
    });

    it('两边都没有命中 key ⇒ 保持原占位符', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = { url: '/{id}', params: { other: 1 } };
        reqHandlers[0](config);
        expect(config.url).toBe('/{id}');
    });
});


describe('reurl —— removeKey 行为', () => {
    it('removeKey:true（默认）⇒ 替换后从 params 删除', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = { url: '/{id}', params: { id: 1, other: 2 } };
        reqHandlers[0](config);
        expect(config.params).toEqual({ other: 2 });
    });

    it('removeKey:true ⇒ 同时从 data 删除', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = { url: '/{id}', data: { id: 1, other: 2 } };
        reqHandlers[0](config);
        expect(config.data).toEqual({ other: 2 });
    });

    it('removeKey:false ⇒ 保留原字段（避免删除）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl({ removeKey: false }).install(ctx);
        const config: any = { url: '/{id}', params: { id: 1 } };
        reqHandlers[0](config);
        expect(config.url).toBe('/1');
        expect(config.params).toEqual({ id: 1 }); // 不删
    });

    it('data 是 primitive 且 removeKey:true ⇒ 删除整个 data 字段', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = { url: '/{x}', data: 42 };
        reqHandlers[0](config);
        expect(config.data).toBeUndefined();
    });
});


describe('reurl —— 边界 / 控制', () => {
    it('enable:false ⇒ 不替换', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl({ enable: false }).install(ctx);
        const config: any = { url: '/{id}', params: { id: 1 } };
        reqHandlers[0](config);
        expect(config.url).toBe('/{id}');
    });

    it('isRetry(config) ⇒ 短路（重试 url 已替换好）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = {
            url: '/{id}',
            params: { id: 1 },
            __retry: 1, // RETRY_KEY
        };
        reqHandlers[0](config);
        expect(config.url).toBe('/{id}'); // 不动
    });

    it('url 缺失 ⇒ 不抛错（noop）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = { params: { id: 1 } };
        expect(() => reqHandlers[0](config)).not.toThrow();
    });

    it('自定义 pattern ⇒ 仅匹配自定义占位符', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl({ pattern: /<(\w+)>/g }).install(ctx);
        const config: any = { url: '/<id>/{other}', params: { id: 1, other: 2 } };
        reqHandlers[0](config);
        expect(config.url).toBe('/<id>/{other}'.replace('<id>', '1'));
    });

    it('value 为 0 / 空串 ⇒ 仍然替换（合法值）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = { url: '/{id}', params: { id: 0 } };
        reqHandlers[0](config);
        // 0 是 falsy 但是 valid number，?? 之后还是 0 所以 url 应该是 '/0'
        expect(config.url).toBe('/0');
    });
});


describe('reurl —— baseURL 与 url 分隔符规整 ($fixSlash)', () => {
    it('baseURL 不带尾 /，url 不带头 / ⇒ 给 url 补 /', () => {
        expect($fixSlash('users', 'https://x.com/api')).toBe('/users');
    });

    it('baseURL 带尾 /，url 带头 / ⇒ 去掉 url 头部 /', () => {
        expect($fixSlash('/users', 'https://x.com/api/')).toBe('users');
    });

    it('baseURL 带尾 /，url 不带头 / ⇒ 不动', () => {
        expect($fixSlash('users', 'https://x.com/api/')).toBe('users');
    });

    it('baseURL 不带尾 /，url 带头 / ⇒ 不动', () => {
        expect($fixSlash('/users', 'https://x.com/api')).toBe('/users');
    });

    it('url 自身有连续 // ⇒ 压缩为 /', () => {
        expect($fixSlash('//api//users//', 'https://x.com')).toBe('/api/users/');
    });

    it('绝对 url ⇒ 保留 protocol :// 不动，仅压 path 中的 //', () => {
        expect($fixSlash('https://x.com//api//users')).toBe('https://x.com/api/users');
    });

    it('无 baseURL + url 自带连续 / ⇒ 仅压缩自身', () => {
        expect($fixSlash('/api//v1///users')).toBe('/api/v1/users');
    });

    it('集成：path vars 替换后再做 fixSlash', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl().install(ctx);
        const config: any = {
            url: 'pets/{id}',
            baseURL: 'https://x.com/api',
            params: { id: 9 },
        };
        reqHandlers[0](config);
        expect(config.url).toBe('/pets/9');
    });

    it('fixSlash:false ⇒ 关闭分隔符规整，url 原样', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        reurl({ fixSlash: false }).install(ctx);
        const config: any = {
            url: 'pets/{id}',
            baseURL: 'https://x.com/api',
            params: { id: 9 },
        };
        reqHandlers[0](config);
        expect(config.url).toBe('pets/9'); // 不补 /
    });
});