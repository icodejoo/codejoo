import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import normalize from '../../../src/plugins/normalize';
import AxpResponse, { AxpError } from '../../../src/objects/Response';
import { Axp } from '../../../src';

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

describe('normalize — 选项与请求级开关边界（真实 axios）', () => {
    /** 业务失败（code=1）的 axios 实例，可选 HTTP 500 失败。 */
    function make(http = false) {
        return axios.create({
            adapter: async (c) => {
                const r = response(c, { code: 1, message: 'bad' });
                if (!http) return r;
                throw Object.assign(new AxiosError('500', 'ERR_BAD_RESPONSE', c, undefined, { ...r, status: 500 } as any), { config: c });
            },
        });
    }

    it('[normalize.opt.enable][normalize.method.install] enable 缺省/undefined 视为开启；enable:false 无 cleanup 且不拦截', async () => {
        const ax = make();
        expect(typeof normalize({ enable: undefined }).install(ax)).toBe('function');
        await expect(ax.get('/')).rejects.toBeInstanceOf(AxpError);
        const ax2 = make();
        expect(normalize({ enable: false }).install(ax2)).toBeUndefined();
        await expect(ax2.get('/')).resolves.toMatchObject({ status: 200 });
    });

    it('[normalize.method.cleanup] cleanup 重复调用安全，卸载后可重装', async () => {
        const ax = make();
        const off = normalize().install(ax) as () => void;
        off();
        expect(() => off()).not.toThrow();
        normalize().install(ax);
        await expect(ax.get('/')).rejects.toBeInstanceOf(AxpError);
    });

    it('[normalize.req.normalize] 只有 false 才跳过：null/undefined/0/空串/空对象都照常校验', async () => {
        const ax = make();
        normalize().install(ax);
        for (const option of [null, undefined, 0, '', {}] as any[]) {
            await expect(ax.get('/', { normalize: option })).rejects.toBeInstanceOf(AxpError);
        }
    });

    it('[normalize.req.normalize.enable] {enable:undefined} 照常校验；HTTP 错误路径 {enable:false} 不附加 api', async () => {
        const ax = make();
        normalize().install(ax);
        await expect(ax.get('/', { normalize: { enable: undefined } })).rejects.toBeInstanceOf(AxpError);
        const http = make(true);
        normalize().install(http);
        const skipped = await http.get('/', { normalize: { enable: false, nullable: true } }).catch((e) => e);
        expect(skipped).not.toHaveProperty('api');
        const kept = await http.get('/', { normalize: { enable: true } }).catch((e) => e);
        expect(kept.api.status).toBe(500);
    });

    it('[normalize.req.normalize.nullable][normalize.opt.nullable] nullable 不影响 enable:false 的跳过判定；插件级 nullable 取任意值均不改变校验', async () => {
        const ax = make();
        normalize().install(ax);
        await expect(ax.get('/', { normalize: { enable: false, nullable: false } })).resolves.toMatchObject({ status: 200 });
        for (const nullable of [undefined, null] as any[]) {
            const bare = make();
            normalize({ nullable }).install(bare);
            await expect(bare.get('/')).rejects.toBeInstanceOf(AxpError);
        }
    });

    it('[normalize.req.normalize.callback] 函数形式：收到 config；返回 null/undefined 照常校验；抛错则请求以该错误拒绝', async () => {
        const ax = make();
        normalize().install(ax);
        const fn = vi.fn(() => undefined);
        await expect(ax.get('/u', { normalize: fn })).rejects.toBeInstanceOf(AxpError);
        expect(fn.mock.calls[0][0]).toMatchObject({ url: '/u' });
        await expect(ax.get('/', { normalize: () => null })).rejects.toBeInstanceOf(AxpError);
        const err = new Error('cb');
        await expect(ax.get('/', { normalize: () => { throw err; } })).rejects.toBe(err);
    });

    it('[normalize.global.normalize][normalize.global.normalize.enable][normalize.global.normalize.nullable] Core 构造选项传 false / 函数 / null / 空对象均被忽略（预留未消费），不影响校验', async () => {
        for (const global of [false, () => false, null, {}, { enable: false }, { nullable: true }] as any[]) {
            const ax = make();
            Axp.create(ax, { normalize: global });
            normalize().install(ax);
            await expect(ax.get('/')).rejects.toBeInstanceOf(AxpError);
        }
    });
});
