import { describe, it, expect } from 'vitest';
import normalize from '../src/plugins/normalize';
import AxpResponse, { AxpError } from '../src/objects/Response';


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


describe('normalize — 成功路径', () => {
    it('业务成功（code=0）→ 原样返回 response（不改写 data）', () => {
        const h = install();
        const response = { status: 200, data: { code: 0, message: 'ok', data: { x: 1 } } };
        expect(h.f!(response)).toBe(response);  // 同一引用，未改写
        expect(response.data.data).toEqual({ x: 1 });
    });

    it("业务成功（code='0000'）→ 原样返回", () => {
        const h = install();
        const response = { status: 200, data: { code: '0000', data: [1, 2] } };
        expect(h.f!(response)).toBe(response);
    });

    it('非信封式（无 code）→ 退化为 HTTP 语义，2xx 即成功', () => {
        const h = install();
        const response = { status: 200, data: [1, 2, 3] };  // 纯数组，无 code
        expect(h.f!(response)).toBe(response);
    });
});


describe('normalize — 业务失败路径', () => {
    it('code 非成功码 → reject 一个 ApiError（携带结构化 ApiResponse）', async () => {
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

    it('HTTP 2xx 但 code 失败 → 仍判失败', async () => {
        const h = install();
        const response = { status: 200, data: { code: 'ERR' } };
        await expect(h.f!(response)).rejects.toBeInstanceOf(AxpError);
    });
});


describe('normalize — 错误路径（onRejected）', () => {
    it('有 response → 附加 .api（结构化 ApiResponse）并透传原 error', async () => {
        const h = install();
        const err: any = { response: { status: 401, data: { code: 'AUTH', message: 'no' } }, message: 'Request failed' };
        await expect(h.r!(err)).rejects.toBe(err);  // 原 error 透传
        expect(err.api).toBeInstanceOf(AxpResponse);
        expect(err.api.code).toBe('AUTH');
        expect(err.api.status).toBe(401);
    });

    it('无 response（网络错误/超时）→ fromResponse 防 null，仍附 .api', async () => {
        const h = install();
        const err: any = { message: 'Network Error' };  // 无 response
        await expect(h.r!(err)).rejects.toBe(err);
        expect(err.api).toBeInstanceOf(AxpResponse);
        expect(err.api.status).toBe(0);
        expect(err.api.data).toBeNull();
    });
});


describe('normalize — 元信息', () => {
    it('enable:false → 不安装响应拦截器', () => {
        const { axios, resHandlers } = makeMockAxios();
        normalize({ enable: false }).install(axios);
        expect(resHandlers).toHaveLength(0);
    });

    it("工厂 .name 对齐插件名 'axp:normalize'", () => {
        expect(normalize.name).toBe('axp:normalize');
    });
});
