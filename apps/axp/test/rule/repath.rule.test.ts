import { describe, it, expect } from 'vitest';
import repath from '../../src/plugins/repath';
import axios from 'axios';
import { Axp } from '../../src';
import { makeNetwork } from '../helpers/network';
import { use } from '../helpers/install';

/** 捕获 request 拦截器的极简 axios */
function makeMockAxios() {
    const reqHandlers: Array<(config: any) => any> = [];
    const axios: any = {
        defaults: {},
        interceptors: {
            request: {
                use: (f: any) => { reqHandlers.push(f); return reqHandlers.length - 1; },
                eject: () => { },
            },
        },
    };
    return { axios, reqHandlers };
}

/** 安装插件并返回其 request 拦截器（已断言存在） */
function install(opts?: Parameters<typeof repath>[0]) {
    const { axios, reqHandlers } = makeMockAxios();
    repath(opts).install(axios);
    return { run: reqHandlers[0], reqHandlers };
}

describe('repath — 三种占位风格', () => {
    it('[repath.fn.axpRepath] {} 风格：/u/{id} + params → 替换并删除 key', () => {
        const { run } = install();
        const config: any = { url: '/u/{id}', params: { id: 5, keep: 1 } };
        run(config);
        expect(config.url).toBe('/u/5');
        expect(config.params).toEqual({ keep: 1 });
    });

    it('[repath.fn.axpRepath] [] 风格：/u/[id]', () => {
        const { run } = install();
        const config: any = { url: '/u/[id]', params: { id: 7 } };
        run(config);
        expect(config.url).toBe('/u/7');
    });

    it('[repath.fn.axpRepath] : 风格单变量：/u/:id', () => {
        const { run } = install();
        const config: any = { url: '/u/:id', params: { id: 9 } };
        run(config);
        expect(config.url).toBe('/u/9');
    });
});

describe('repath — B1 回归：冒号多段路径', () => {
    it('[repath.fn.axpRepath] /users/:id/posts/:pid 两段都正确替换（旧版贪婪正则会吞成一段）', () => {
        const { run } = install();
        const config: any = { url: '/users/:id/posts/:pid', params: { id: 1, pid: 2 } };
        run(config);
        expect(config.url).toBe('/users/1/posts/2');
        expect(config.params).toEqual({});
    });

    it('[repath.fn.axpRepath] 混合风格：/mix/:id/{x}/[y]', () => {
        const { run } = install();
        const config: any = { url: '/mix/:id/{x}/[y]', params: { id: 'a', x: 'b', y: 'c' } };
        run(config);
        expect(config.url).toBe('/mix/a/b/c');
    });
});

describe('repath — 取值来源与边界', () => {
    it('[repath.fn.axpRepath] params 缺失 → 回退 data 对象', () => {
        const { run } = install();
        const config: any = { url: '/u/:id', data: { id: 3 } };
        run(config);
        expect(config.url).toBe('/u/3');
        expect(config.data).toEqual({});
    });

    it('[repath.fn.axpRepath] data 为原始值 → 直接用作变量值并删除 config.data', () => {
        const { run } = install();
        const config: any = { url: '/u/:id', data: 42 };
        run(config);
        expect(config.url).toBe('/u/42');
        expect(config.data).toBeUndefined();
    });

    it('[repath.opt.removeKey] removeKey:false → 替换但保留 key', () => {
        const { run } = install({ removeKey: false });
        const config: any = { url: '/u/:id', params: { id: 5 } };
        run(config);
        expect(config.url).toBe('/u/5');
        expect(config.params).toEqual({ id: 5 });
    });

    it('[repath.fn.axpRepath] params 优先于 data（同名时不再 fallback 到 data）', () => {
        const { run } = install();
        const config: any = { url: '/u/:id', params: { id: 'P' }, data: { id: 'D' } };
        run(config);
        expect(config.url).toBe('/u/P');
        expect(config.params).toEqual({});
        expect(config.data).toEqual({ id: 'D' });  // data 未被动
    });
});

describe('repath — enable 开关', () => {
    it('[repath.opt.enable] enable:false → 不安装拦截器', () => {
        const { reqHandlers } = install({ enable: false });
        expect(reqHandlers).toHaveLength(0);
    });

    it('[repath.opt.pattern] 自定义 pattern 生效', () => {
        const { run } = install({ pattern: /<([^>]+)>/g });
        const config: any = { url: '/u/<id>', params: { id: 8 } };
        run(config);
        expect(config.url).toBe('/u/8');
    });
});

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('repath', () => {
  it('[repath.fn.axpRepath][repath.opt.removeKey] {id}/:id placeholders are substituted from params, and removed from it by default', async () => {
    const { net, api } = mkApi();
    let seenUrl = '';
    net.on('GET', '/user/42/posts/7', (config) => { seenUrl = config.url ?? ''; return { data: { code: 0, data: null } }; });
    use(api, [repath()]);

    const r = await api.axios.get('/user/{id}/posts/:postId', { params: { id: 42, postId: 7, page: 1 } });
    expect(seenUrl).toBe('/user/42/posts/7');
    expect(r.config.params).toEqual({ page: 1 });
  });

  it('[repath.fn.axpRepath][repath.opt.removeKey] falls back to the data map when a placeholder is not in params, and removeKey:false keeps the source key', async () => {
    const { net, api } = mkApi();
    let seenUrl = '';
    net.on('POST', '/user/99', (config) => { seenUrl = config.url ?? ''; return { data: { code: 0, data: null } }; });
    use(api, [repath({ removeKey: false })]);

    const r = await api.axios.post('/user/{id}', { id: 99 });
    expect(seenUrl).toBe('/user/99');
    // r.config.data reflects the post-transformRequest value (axios's
    // default JSON.stringify runs between repath's interceptor and here).
    expect(JSON.parse(r.config.data as string)).toEqual({ id: 99 });
  });

  it('[repath.fn.axpRepath][repath.opt.removeKey] the default removeKey:true also removes a data-map substitution', async () => {
    const { net, api } = mkApi();
    let seenUrl = '';
    net.on('POST', '/user/99', (config) => { seenUrl = config.url ?? ''; return { data: { code: 0, data: null } }; });
    use(api, [repath()]);

    const r = await api.axios.post('/user/{id}', { id: 99 });
    expect(seenUrl).toBe('/user/99');
    expect(JSON.parse(r.config.data as string)).toEqual({});
  });

  it('[repath.opt.enable] a constructor-level disabled repath never substitutes', async () => {
    const { net, api } = mkApi();
    let seenUrl = '';
    net.fallback((config) => { seenUrl = config.url ?? ''; return { data: { code: 0, data: null } }; });
    use(api, [repath({ enable: false })]);

    await api.axios.get('/user/{id}', { params: { id: 42 } });
    expect(seenUrl).toBe('/user/{id}');
  });
});


/** 装好 repath 的真实 axios，返回 adapter 收到的 config 列表与 cleanup。 */
function realAxios(opts?: Parameters<typeof repath>[0]) {
    const seen: any[] = [];
    const ax = axios.create({
        adapter: async (c: any) => { seen.push(c); return { config: c, data: 'ok', status: 200, statusText: '', headers: {} }; },
    });
    const off = repath(opts).install(ax) as () => void;
    return { ax, seen, off };
}

describe('repath — 安装/卸载（真实 axios）', () => {
    it("[repath.prop.name] 插件实例 name 为 'axp:repath'", () => {
        expect(repath().name).toBe('axp:repath');
    });

    it('[repath.method.install][repath.method.cleanup] install 后 URL 变量被替换，cleanup 后原样发出', async () => {
        const { ax, seen, off } = realAxios();
        expect(typeof off).toBe('function');
        await ax.get('/u/:id', { params: { id: 7 } });
        expect(seen[0].url).toBe('/u/7');
        expect(seen[0].params).toEqual({});
        off();
        await ax.get('/u/:id', { params: { id: 7 } });
        expect(seen[1].url).toBe('/u/:id');
        expect(seen[1].params).toEqual({ id: 7 });
    });
});
