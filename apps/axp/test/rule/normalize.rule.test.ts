import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import normalize from '../../src/plugins/normalize';
import AxpResponse, { AxpError } from '../../src/objects/Response';
import { Axp } from '../../src/install';
import { makeNetwork } from '../helpers/network';
import { ApiError } from '../../src';
import { use } from '../helpers/install';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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
    it.each([true, { enable: true }, () => ({ enable: true })])('[normalize.req.normalize][normalize.fn.axpNormalize] normalize=%s 仍校验业务失败并携带 config', async (option) => {
        const ax = axios.create({ adapter: async (c) => response(c, { code: 1 }) });
        normalize().install(ax);
        const error = await ax.get('/', { normalize: option }).catch((e) => e);
        expect(error.name).toBe('ApiError');
        expect(error.config.url).toBe('/');
    });
});

// 来源 review #24/#26
describe('请求级归一化与原始响应包装', () => {
    const path = '/review';
    it.each([false, { enable: false }, () => false])('[normalize.req.normalize][normalize.req.normalize.enable][normalize.req.normalize.callback] normalize=%s 放行业务失败', async (option) => {
        const body = { code: 1, message: 'bad', data: null };
        const net = makeNetwork().fallback(() => ({ data: body }));
        const api = Axp.create(axios.create({ adapter: net.adapter }));
        Axp.install(api.axios, { normalize: normalize() });
        await expect(api.get(path)(undefined, { normalize: option, raw: true })).resolves.toEqual(body);
        await expect(api.get(path)()).rejects.toBeInstanceOf(AxpError);
    });

    it('[normalize.req.normalize] normalize:false 的 HTTP 错误原样拒绝且不附加 api', async () => {
        const net = makeNetwork().fallback(() => ({ status: 500 }));
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { normalize: normalize() });
        const error = await ax.get(path, { normalize: false }).catch((err) => err);
        expect(error.status).toBe(500);
        expect(error).not.toHaveProperty('api');
    });

    it.each([[1, 2], { name: 'plain' }, { data: [3, 4] }, 'text', 0, false, null].map((body) => ({ body })))('[public.req.wrap][normalize.fn.axpNormalize] wrap 保留非信封 body：$body', async ({ body }) => {
        const net = makeNetwork().fallback(() => ({ data: body }));
        const api = Axp.create(axios.create({ adapter: net.adapter }));
        const wrapped = await api.get(path)(undefined, { wrap: true });
        expect(wrapped).toBeInstanceOf(AxpResponse);
        expect(wrapped.data).toEqual(body);
    });
});

describe('normalize — 成功路径', () => {
    it('[normalize.fn.axpNormalize] 业务成功（code=0）→ 原样返回 response（不改写 data）', () => {
        const h = install();
        const response = { status: 200, data: { code: 0, message: 'ok', data: { x: 1 } } };
        expect(h.f!(response)).toBe(response);  // 同一引用，未改写
        expect(response.data.data).toEqual({ x: 1 });
    });

    it("[normalize.fn.axpNormalize] 业务成功（code='0000'）→ 原样返回", () => {
        const h = install();
        const response = { status: 200, data: { code: '0000', data: [1, 2] } };
        expect(h.f!(response)).toBe(response);
    });

    it('[normalize.fn.axpNormalize] 非信封式（无 code）→ 退化为 HTTP 语义，2xx 即成功', () => {
        const h = install();
        const response = { status: 200, data: [1, 2, 3] };  // 纯数组，无 code
        expect(h.f!(response)).toBe(response);
    });
});

describe('normalize — 业务失败路径', () => {
    it('[normalize.fn.axpNormalize] code 非成功码 → reject 一个 ApiError（携带结构化 ApiResponse）', async () => {
        const h = install();
        const response = { status: 200, data: { code: 1, message: 'bad biz' } };
        await expect(h.f!(response)).rejects.toBeInstanceOf(AxpError);
        try {
            await h.f!(response);
        } catch (e) {
            const err = e as AxpError;
            expect(err.response).toBeInstanceOf(AxpResponse);
            expect(err.response.code).toBe(1);
            expect(err.response.message).toBe('bad biz');
            expect(err.message).toBe('bad biz');
        }
    });

    it('[normalize.fn.axpNormalize] HTTP 2xx 但 code 失败 → 仍判失败', async () => {
        const h = install();
        const response = { status: 200, data: { code: 'ERR' } };
        await expect(h.f!(response)).rejects.toBeInstanceOf(AxpError);
    });
});

describe('normalize — 错误路径（onRejected）', () => {
    it('[normalize.fn.axpNormalize] 有 response → 附加 .api（结构化 ApiResponse）并透传原 error', async () => {
        const h = install();
        const err: any = { response: { status: 401, data: { code: 'AUTH', message: 'no' } }, message: 'Request failed' };
        await expect(h.r!(err)).rejects.toBe(err);  // 原 error 透传
        expect(err.api).toBeInstanceOf(AxpResponse);
        expect(err.api.code).toBe('AUTH');
        expect(err.api.status).toBe(401);
    });
});

describe('normalize — 元信息', () => {
    it('[normalize.opt.enable] enable:false → 不安装响应拦截器', () => {
        const { axios, resHandlers } = makeMockAxios();
        normalize({ enable: false }).install(axios);
        expect(resHandlers).toHaveLength(0);
    });

    it("[normalize.prop.name] 工厂 .name 对齐插件名 'axp:normalize'", () => {
        expect(normalize.name).toBe('axp:normalize');
    });
});

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('normalize', () => {
  it('[normalize.fn.axpNormalize][public.export.ApiError] a business failure (code !== 0) rejects with an ApiError carrying a structured ApiResponse', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 1, data: null, message: 'boom' } }));
    use(api, [normalize()]);
    await expect(api.axios.get('/data')).rejects.toThrow('boom');
    try {
      await api.axios.get('/data');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as InstanceType<typeof ApiError>).response.code).toBe(1);
    }
  });

  it('[normalize.fn.axpNormalize] a successful envelope passes through untouched — normalize does not unwrap (Core.dispatch does that unconditionally, independent of this plugin)', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { v: 1 }, message: '' } }));
    use(api, [normalize()]);
    const r = await api.axios.get('/data');
    expect(r.data).toEqual({ code: 0, data: { v: 1 }, message: '' });
  });
});

describe('normalize — 安装/卸载、预留 nullable 与全局配置（真实 axios）', () => {
    /** 业务失败（code=1）的 axios 实例。 */
    function failing() {
        return axios.create({ adapter: async (c) => response(c, { code: 1, message: 'bad' }) });
    }

    it('[normalize.method.install][normalize.method.cleanup] install 后业务失败被 reject，cleanup 后恢复为原样 resolve', async () => {
        const ax = failing();
        const off = normalize().install(ax) as () => void;
        await expect(ax.get('/')).rejects.toBeInstanceOf(AxpError);
        off();
        await expect(ax.get('/')).resolves.toMatchObject({ status: 200 });
    });

    it('[normalize.opt.nullable][normalize.req.normalize.nullable] nullable 是预留字段：插件级/请求级设置都不改变校验结果', async () => {
        for (const nullable of [true, false]) {
            const ax = failing();
            normalize({ nullable }).install(ax);
            await expect(ax.get('/')).rejects.toBeInstanceOf(AxpError);
            await expect(ax.get('/', { normalize: { nullable } })).rejects.toBeInstanceOf(AxpError);
        }
        const ok = axios.create({ adapter: async (c) => response(c, { code: 0, data: null }) });
        normalize().install(ok);
        await expect(ok.get('/', { normalize: { nullable: false } })).resolves.toMatchObject({ status: 200 });
    });

    it('[normalize.global.normalize][normalize.global.normalize.enable][normalize.global.normalize.nullable] 全局 ICommonOptions.normalize 仅为类型声明：Core 构造选项当前预留未消费，传入 enable:false 也不改变校验', async () => {
        const ax = failing();
        const api = Axp.create(ax, { normalize: { enable: false, nullable: true } });
        normalize().install(ax);
        await expect(api.get('/x')()).rejects.toBeInstanceOf(AxpError);
    });
});
