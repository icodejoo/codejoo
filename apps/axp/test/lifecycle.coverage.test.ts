import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import envs from '../src/plugins/envs';
import filter, { $filter } from '../src/plugins/filter';
import repath from '../src/plugins/repath';
import normalize from '../src/plugins/normalize';
import notify from '../src/plugins/notify';
import cancel, { cancelAll } from '../src/plugins/cancel';

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

describe('envs/filter/repath — 次要分支与卸载', () => {
    it.each([{ timeout: 1 }, { name: 'named' }])('envs 无 baseURL 配置 %s 也可安装并还原', (config) => {
        const ax = axios.create();
        const before = ax.defaults.timeout;
        const off = envs([{ rule: () => true, config }]).install(ax);
        expect(ax.defaults).toMatchObject(config);
        off?.();
        expect(ax.defaults.timeout).toBe(before);
    });
    it('envs rule 抛错不修改 defaults', () => {
        const ax = axios.create();
        const before = ax.defaults.baseURL;
        expect(() => envs([{ rule: () => { throw new Error('rule'); }, config: { baseURL: '/new' } }]).install(ax)).toThrow('rule');
        expect(ax.defaults.baseURL).toBe(before);
    });
    it('filter 忽略继承属性，收集 dropped，ignoreValues 支持 NaN', () => {
        const data = Object.assign(Object.create({ inherited: 1 }), { n: NaN, empty: null, keep: 0 });
        const dropped: any[] = [];
        expect($filter(data, { predicate: ([, v]) => v == null || Number.isNaN(v), ignoreValues: [NaN] }, dropped))
            .toEqual({ n: NaN, keep: 0 });
        expect(dropped).toEqual([['empty', null]]);
    });
    it('filter 函数解析为 false 时删除配置，数组与文本保持原值', async () => {
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        const off = filter().install(ax);
        await ax.post('/', 'body', { params: [1, null], filter: () => false });
        const config = adapter.mock.calls[0][0];
        expect(config).not.toHaveProperty('filter');
        expect(config.params).toEqual([1, null]);
        expect(config.data).toBe('body');
        off?.();
        await ax.get('/', { params: { empty: null }, filter: true });
        expect(adapter.mock.calls[1][0].params).toEqual({ empty: null });
    });
    it('repath 无 url 与无捕获组模式原样返回，卸载后不替换', async () => {
        const { ax, request } = interceptors();
        const off = repath({ pattern: /(?:x)/g }).install(ax);
        const handler = request.use.mock.calls[0][0];
        const config = { url: undefined, params: { id: 1 } };
        expect(handler(config)).toBe(config);
        expect(handler({ url: 'x' }).url).toBe('x');
        off?.();
        expect(request.eject).toHaveBeenCalledOnce();
    });
    it.each([0, false, ''])('repath 原始请求体 %s 应可用于路径变量', async (data) => {
        const { ax, request } = interceptors();
        repath().install(ax);
        const config = { url: '/:id', data };
        const result = request.use.mock.calls[0][0](config);
        // 原始值 0/false/'' 也是有效路径值，不能被 truthy 守卫漏掉。
        expect(result.url).toBe('/' + encodeURIComponent(String(data)));
    });
});

describe('normalize/notify — 失败旁路与清理', () => {
    it.each([true, { enable: true }, () => ({ enable: true })])('normalize=%s 仍校验业务失败并携带 config', async (option) => {
        const ax = axios.create({ adapter: async (c) => response(c, { code: 1 }) });
        normalize().install(ax);
        const error = await ax.get('/', { normalize: option }).catch((e) => e);
        expect(error.name).toBe('ApiError');
        expect(error.config.url).toBe('/');
    });
    it('normalize 无 response 时读取 err.status，卸载后不附加 api', async () => {
        const { ax, response: hooks } = interceptors();
        const off = normalize().install(ax);
        const error = Object.assign(new AxiosError('offline'), { status: 504 });
        await expect(hooks.use.mock.calls[0][1](error)).rejects.toBe(error);
        expect((error as any).api.status).toBe(504);
        off?.();
        expect(hooks.eject).toHaveBeenCalledOnce();
    });
    it.each(['stringify', 'notify'])('HTTP 错误路径 %s 抛错仍保留原错误，并记录日志', async (phase) => {
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const { ax, response: hooks } = interceptors();
        const sideEffectError = new Error('side effect');
        const stringify = vi.fn(() => { if (phase === 'stringify') throw sideEffectError; return 'message'; });
        const callback = vi.fn(() => { throw sideEffectError; });
        const off = notify({ stringify, notify: callback }).install(ax);
        const config = { debug: true, logger: sink };
        const error = Object.assign(new Error('network'), { config });
        await expect(hooks.use.mock.calls[0][1](error)).rejects.toBe(error);
        expect(sink.error).toHaveBeenCalledWith(expect.any(String), sideEffectError);
        expect(stringify).toHaveBeenCalledWith(undefined, 'network', 0, config);
        off?.();
        expect(hooks.eject).toHaveBeenCalledOnce();
    });
    it('notify error 无 config/message/response 时使用空值回退', async () => {
        const { ax, response: hooks } = interceptors();
        const stringify = vi.fn(() => '');
        notify({ stringify, notify: vi.fn() }).install(ax);
        const error = {};
        await expect(hooks.use.mock.calls[0][1](error)).rejects.toBe(error);
        expect(stringify).toHaveBeenCalledWith(undefined, '', 0, {});
    });
});

describe('cancel/loading — 资源释放边界', () => {
    it('cancel 完成后的旧 signal 再进请求链应签发新 signal；无 config 错误原样透传', async () => {
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
