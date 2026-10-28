import { afterEach, describe, expect, it, vi } from 'vitest';
import repath from '../../src/plugins/repath';
import axios from 'axios';
import { Axp } from '../../src';
import { makeNetwork } from '../helpers/network';
import { use } from '../helpers/install';

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

describe('envs/filter/repath — 次要分支与卸载', () => {
    it('[repath.opt.pattern][repath.method.cleanup] repath 无 url 与无捕获组模式原样返回，卸载后不替换', async () => {
        const { ax, request } = interceptors();
        const off = repath({ pattern: /(?:x)/g }).install(ax);
        const handler = request.use.mock.calls[0][0];
        const config = { url: undefined, params: { id: 1 } };
        expect(handler(config)).toBe(config);
        expect(handler({ url: 'x' }).url).toBe('x');
        off?.();
        expect(request.eject).toHaveBeenCalledOnce();
    });
    it.each([0, false, ''])('[repath.fn.axpRepath] repath 原始请求体 %s 应可用于路径变量', async (data) => {
        const { ax, request } = interceptors();
        repath().install(ax);
        const config = { url: '/:id', data };
        const result = request.use.mock.calls[0][0](config);
        // 原始值 0/false/'' 也是有效路径值，不能被 truthy 守卫漏掉。
        expect(result.url).toBe('/' + encodeURIComponent(String(data)));
    });
});

describe('repath — 取值来源与边界', () => {
    it('[repath.fn.axpRepath] 值为 0 → 用 ?? 兜底，仍替换为 "0"', () => {
        const { run } = install();
        const config: any = { url: '/u/:id', params: { id: 0 } };
        run(config);
        expect(config.url).toBe('/u/0');
    });

    it('[repath.fn.axpRepath] 无匹配值 → 原样保留占位符', () => {
        const { run } = install();
        const config: any = { url: '/u/:missing', params: {} };
        run(config);
        expect(config.url).toBe('/u/:missing');
    });
});

// 来源 review #22
describe('repath — 路径边界', () => {
    /** 重复占位符的输入路径。 */
    const repeatedPath = '/u/{id}/again/{id}';
    /** 两次替换完成后的路径。 */
    const repeatedResult = '/u/5/again/5';
    it('[repath.fn.axpRepath] 只替换 pathname，完整保留 query 与 hash', () => {
        const { run } = install();
        const config = { url: '/u/:id?view=1&other={id}#tab/:id', params: { id: 5 } };
        run(config);
        expect(config.url).toBe('/u/5?view=1&other={id}#tab/:id');
        expect(config.params).toEqual({});
    });

    it.each(['params', 'data'])('[repath.fn.axpRepath] 重复占位符从 %s 读取后统一删除', (source) => {
        const { run } = install();
        const config = { url: repeatedPath, [source]: { id: 5, keep: true } };
        run(config);
        expect(config.url).toBe(repeatedResult);
        expect(config[source]).toEqual({ keep: true });
    });

    it('[repath.fn.axpRepath] 原始 data 可用于重复占位符，替换后统一删除', () => {
        const { run } = install();
        const config = { url: repeatedPath, data: 5 };
        run(config);
        expect(config.url).toBe(repeatedResult);
        expect(config.data).toBeUndefined();
    });

    it('[repath.fn.axpRepath] 值按路径段编码，不能注入斜杠、query 或 hash', () => {
        const { run } = install();
        const config = { url: '/u/[id]?view=1#tab', params: { id: 'a/b?admin=1#中文 %' } };
        run(config);
        expect(config.url).toBe('/u/a%2Fb%3Fadmin%3D1%23%E4%B8%AD%E6%96%87%20%25?view=1#tab');
    });

    it('[repath.fn.axpRepath] 绝对 URL 的协议和端口保持原样', () => {
        const { run } = install();
        const config = { url: 'http://localhost:4570/u/:id?view=1', params: { id: 5 } };
        run(config);
        expect(config.url).toBe('http://localhost:4570/u/5?view=1');
    });
});

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('repath', () => {
  it('[repath.fn.axpRepath] a placeholder with no match in either params or data is left as-is in the path', async () => {
    const { net, api } = mkApi();
    let seenUrl = '';
    net.fallback((config) => { seenUrl = config.url ?? ''; return { data: { code: 0, data: null } }; });
    use(api, [repath()]);

    await api.axios.get('/user/{id}');
    expect(seenUrl).toBe('/user/{id}');
  });
});
