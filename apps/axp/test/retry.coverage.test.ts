import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import retry, { $shouldRetry, $resolveMethods, $resolveStatusCodes, $resolveAfterStatusCodes,
    $resolveDelay, $resolveJitter, $resolveDelayMax, $resolveRespectRetryAfter, $resolveRetryAfterMax,
} from '../src/plugins/retry';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 构造成功或可重试的 adapter 响应。 */
function response(config: any, status = 200, headers: any = {}) {
    return { status, statusText: '', headers, config, data: { code: 0 } };
}

describe('retry — 请求级空对象与插件级回退', () => {
    it('全部解析器在 retry:{} 时回退插件值，零值与 false 不丢失', () => {
        const config = { retry: {} };
        const defaults = { methods: ['put'], statusCodes: [418], afterStatusCodes: [418],
            delay: 0, jitter: true as const, delayMax: 0, respectRetryAfter: false, retryAfterMax: 0 };
        expect($resolveMethods(config, defaults)).toBe(defaults.methods);
        expect($resolveStatusCodes(config, defaults)).toBe(defaults.statusCodes);
        expect($resolveAfterStatusCodes(config, defaults)).toBe(defaults.afterStatusCodes);
        expect($resolveDelay(config, defaults)).toBe(0);
        expect($resolveJitter(config, defaults)).toBe(true);
        expect($resolveDelayMax(config, defaults)).toBe(0);
        expect($resolveRespectRetryAfter(config, defaults)).toBe(false);
        expect($resolveRetryAfterMax(config, defaults)).toBe(0);
    });
    it('无响应的网络错误默认不重试，自定义判断可明确启用', () => {
        const error = new AxiosError('offline');
        expect($shouldRetry({}, {}, undefined, error)).toBe(false);
        expect($shouldRetry({}, { shouldRetry: () => true }, undefined, error)).toBe(true);
    });
    it('空方法和状态码列表显式否决，method 缺失按 get 处理', () => {
        expect($shouldRetry({}, {}, response({}, 500))).toBe(true);
        expect($shouldRetry({ retry: { methods: [] } }, {}, response({}, 500))).toBe(false);
        expect($shouldRetry({ retry: { statusCodes: [] } }, {}, response({}, 500))).toBe(false);
    });
    it('methods 白名单按声明应不区分大小写', () => {
        expect($shouldRetry({ method: 'GET' }, { methods: ['GET'] }, response({}, 500))).toBe(true);
    });
});

describe('retry — 循环终止与 Header 边界', () => {
    it.each(['garbage', '-1', '0', 'Thu, 01 Jan 1970 00:00:00 GMT'])('Retry-After=%s 无效或过去值不造成额外长等待', async (header) => {
        vi.useFakeTimers();
        const adapter = vi.fn()
            .mockImplementationOnce(async (c) => response(c, 503, new AxiosHeaders({ 'retry-after': header })))
            .mockImplementation(async (c) => response(c));
        const ax = axios.create({ adapter });
        retry({ max: 1, delay: 25 }).install(ax);
        const pending = ax.get('/');
        await vi.advanceTimersByTimeAsync(0);
        expect(adapter).toHaveBeenCalledTimes(header === 'garbage' ? 1 : 2);
        await vi.advanceTimersByTimeAsync(25);
        expect((await pending).status).toBe(200);
        expect(adapter).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('重试得到不应重试的错误时立刻停止并返回该错误', async () => {
        const adapter = vi.fn()
            .mockImplementationOnce(async (c) => { throw new AxiosError('first', 'E', c, undefined, response(c, 500)); })
            .mockImplementation(async (c) => { throw new AxiosError('last', 'E', c, undefined, response(c, 400)); });
        const ax = axios.create({ adapter });
        retry({ max: 4, delay: 0 }).install(ax);
        await expect(ax.get('/')).rejects.toThrow('last');
        expect(adapter).toHaveBeenCalledTimes(2);
    });
    it('错误无 config 时原样拒绝，不启动重试循环', async () => {
        const error = new Error('no config');
        const adapter = vi.fn(async () => { throw error; });
        const ax = axios.create({ adapter });
        retry({ max: 4, delay: 0, shouldRetry: () => true }).install(ax);
        await expect(ax.get('/')).rejects.toBe(error);
        expect(adapter).toHaveBeenCalledOnce();
    });
    it('卸载后不重试，enable:false 不安装任何拦截器', async () => {
        const adapter = vi.fn(async (c) => response(c, 500));
        const ax = axios.create({ adapter });
        const off = retry({ max: 2, delay: 0 }).install(ax);
        off?.();
        expect(retry({ enable: false }).install(ax)).toBeUndefined();
        expect((await ax.get('/')).status).toBe(500);
        expect(adapter).toHaveBeenCalledOnce();
    });
    it('shouldRetry 抛错明确拒绝，不发出额外尝试', async () => {
        const error = new Error('predicate');
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        retry({ max: 2, shouldRetry: () => { throw error; } }).install(ax);
        await expect(ax.get('/')).rejects.toBe(error);
        expect(adapter).toHaveBeenCalledOnce();
    });
});
