import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import normalize from '../../src/plugins/normalize';
import AxpResponse from '../../src/objects/Response';

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

function makeMockAxios() {
    const resHandlers: Array<{ f?: (r: any) => any; r?: (e: any) => any }> = [];
    const axios: any = {
        defaults: {},
        interceptors: {
            response: {
                use: (f: any, r: any) => { resHandlers.push({ f, r }); return resHandlers.length - 1; },
                eject: () => { },
            },
        },
    };
    return { axios, resHandlers };
}

function install() {
    const { axios, resHandlers } = makeMockAxios();
    normalize().install(axios);
    return resHandlers[0];
}

describe('normalize/notify — 失败旁路与清理', () => {
    it('[normalize.fn.axpNormalize][normalize.method.cleanup] normalize 无 response 时读取 err.status，卸载后不附加 api', async () => {
        const { ax, response: hooks } = interceptors();
        const off = normalize().install(ax);
        const error = Object.assign(new AxiosError('offline'), { status: 504 });
        await expect(hooks.use.mock.calls[0][1](error)).rejects.toBe(error);
        expect((error as any).api.status).toBe(504);
        off?.();
        expect(hooks.eject).toHaveBeenCalledOnce();
    });
});

describe('normalize — 错误路径（onRejected）', () => {
    it('[normalize.fn.axpNormalize] 无 response（网络错误/超时）→ fromResponse 防 null，仍附 .api', async () => {
        const h = install();
        const err: any = { message: 'Network Error' };  // 无 response
        await expect(h.r!(err)).rejects.toBe(err);
        expect(err.api).toBeInstanceOf(AxpResponse);
        expect(err.api.status).toBe(0);
        expect(err.api.data).toBeNull();
    });
});
