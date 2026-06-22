import { describe, it, expect } from 'vitest';
import repath from '../src/plugins/repath';


/** 捕获 request 拦截器的极简 ctx */
function makeMockCtx() {
    const reqHandlers: Array<(config: any) => any> = [];
    const ctx: any = {
        axios: { defaults: {} },
        name: 'repath',
        logger: { log: () => { }, warn: () => { }, error: () => { } },
        request: (f: any) => { reqHandlers.push(f); },
        response: () => { },
        adapter: () => { },
        transformRequest: () => { },
        transformResponse: () => { },
        cleanup: () => { },
    };
    return { ctx, reqHandlers };
}

/** 安装插件并返回其 request 拦截器（已断言存在） */
function install(opts?: Parameters<typeof repath>[0]) {
    const { ctx, reqHandlers } = makeMockCtx();
    repath(opts).install(ctx);
    return { run: reqHandlers[0], reqHandlers };
}


describe('repath — 三种占位风格', () => {
    it('{} 风格：/u/{id} + params → 替换并删除 key', () => {
        const { run } = install();
        const config: any = { url: '/u/{id}', params: { id: 5, keep: 1 } };
        run(config);
        expect(config.url).toBe('/u/5');
        expect(config.params).toEqual({ keep: 1 });
    });

    it('[] 风格：/u/[id]', () => {
        const { run } = install();
        const config: any = { url: '/u/[id]', params: { id: 7 } };
        run(config);
        expect(config.url).toBe('/u/7');
    });

    it(': 风格单变量：/u/:id', () => {
        const { run } = install();
        const config: any = { url: '/u/:id', params: { id: 9 } };
        run(config);
        expect(config.url).toBe('/u/9');
    });
});


describe('repath — B1 回归：冒号多段路径', () => {
    it('/users/:id/posts/:pid 两段都正确替换（旧版贪婪正则会吞成一段）', () => {
        const { run } = install();
        const config: any = { url: '/users/:id/posts/:pid', params: { id: 1, pid: 2 } };
        run(config);
        expect(config.url).toBe('/users/1/posts/2');
        expect(config.params).toEqual({});
    });

    it('混合风格：/mix/:id/{x}/[y]', () => {
        const { run } = install();
        const config: any = { url: '/mix/:id/{x}/[y]', params: { id: 'a', x: 'b', y: 'c' } };
        run(config);
        expect(config.url).toBe('/mix/a/b/c');
    });
});


describe('repath — 取值来源与边界', () => {
    it('params 缺失 → 回退 data 对象', () => {
        const { run } = install();
        const config: any = { url: '/u/:id', data: { id: 3 } };
        run(config);
        expect(config.url).toBe('/u/3');
        expect(config.data).toEqual({});
    });

    it('data 为原始值 → 直接用作变量值并删除 config.data', () => {
        const { run } = install();
        const config: any = { url: '/u/:id', data: 42 };
        run(config);
        expect(config.url).toBe('/u/42');
        expect(config.data).toBeUndefined();
    });

    it('值为 0 → 用 ?? 兜底，仍替换为 "0"', () => {
        const { run } = install();
        const config: any = { url: '/u/:id', params: { id: 0 } };
        run(config);
        expect(config.url).toBe('/u/0');
    });

    it('无匹配值 → 原样保留占位符', () => {
        const { run } = install();
        const config: any = { url: '/u/:missing', params: {} };
        run(config);
        expect(config.url).toBe('/u/:missing');
    });

    it('removeKey:false → 替换但保留 key', () => {
        const { run } = install({ removeKey: false });
        const config: any = { url: '/u/:id', params: { id: 5 } };
        run(config);
        expect(config.url).toBe('/u/5');
        expect(config.params).toEqual({ id: 5 });
    });

    it('params 优先于 data（同名时不再 fallback 到 data）', () => {
        const { run } = install();
        const config: any = { url: '/u/:id', params: { id: 'P' }, data: { id: 'D' } };
        run(config);
        expect(config.url).toBe('/u/P');
        expect(config.params).toEqual({});
        expect(config.data).toEqual({ id: 'D' });  // data 未被动
    });
});


describe('repath — enable 开关', () => {
    it('enable:false → 不安装拦截器', () => {
        const { reqHandlers } = install({ enable: false });
        expect(reqHandlers).toHaveLength(0);
    });

    it('自定义 pattern 生效', () => {
        const { run } = install({ pattern: /<([^>]+)>/g });
        const config: any = { url: '/u/<id>', params: { id: 8 } };
        run(config);
        expect(config.url).toBe('/u/8');
    });
});
