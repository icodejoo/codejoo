import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { create } from '../src/core';
import Response, { AxpError } from '../src/objects/Response';

afterEach(() => { vi.restoreAllMocks(); });

describe('Response — 状态边界与信封形状', () => {
    it.each([
        [199, 0, false], [200, 0, true], [299, '0000', true], [300, 0, false],
        [200, '0', false], [200, null, true], [500, undefined, false],
    ])('status=%i code=%s successful=%s', (status, code, success) => {
        expect(Response.isSuccessful(status as number, code as any)).toBe(success);
    });
    it.each([undefined, null, {}, { data: undefined }])('缺失响应字段 %s 使用安全默认值', (input) => {
        expect(Response.fromResponse(input)).toMatchObject({ status: 0, code: 0, message: null, data: null, successful: false });
    });
    it('信封中空串、false 和 0 不被默认值吞掉，数组即使带 code 也视为原始 body', () => {
        expect(Response.fromResponse({ status: 200, data: { code: 0, message: '', data: false } })).toMatchObject({ message: '', data: false });
        const array = Object.assign([1], { code: 1 });
        expect(Response.fromResponse({ status: 200, data: array }).data).toBe(array);
        expect(Response.fromResponse({ status: 200, data: { code: 0, data: 0 } }).data).toBe(0);
    });
    it('AxpError 保留响应身份和空消息，缺省消息包含状态与业务码', () => {
        const response = new Response(400, 'BAD');
        const error = new AxpError(response);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('ApiError');
        expect(error.response).toBe(response);
        expect(error.message).toBe('request failed (status=400, code=BAD)');
        expect(new AxpError(new Response(400, 1, '')).message).toBe('');
    });
    it('构造与 fromResponse 都使用可覆盖的成功判定', () => {
        vi.spyOn(Response, 'isSuccessful').mockImplementation((status, code) => status === 201 && code === 'OK');
        expect(new Response(201, 'OK').successful).toBe(true);
        expect(Response.fromResponse({ status: 201, data: { code: 0 } }).successful).toBe(false);
    });
});

describe('Core — 合并优先级与返回形状', () => {
    it('请求选项覆盖方法选项和 payload，raw 优先于 wrap', async () => {
        const body = { code: 0, data: { n: 1 } };
        const adapter = vi.fn(async (config) => ({ status: 200, statusText: '', headers: {}, config, data: body }));
        const api = create(axios.create({ adapter }));
        const methodConfig = { url: '/method', params: { method: 1 }, wrap: true };
        const request = api.get('/first', methodConfig);
        const output = await request({ payload: 1 }, { url: '/last', params: { request: 1 }, raw: true });
        expect(output).toBe(body);
        expect(adapter.mock.calls[0][0].url).toBe('/last');
        expect(adapter.mock.calls[0][0].params).toEqual({ request: 1 });
    });
    it.each([null, 0, false, 'text', { code: 0 }, { data: 1 }])('非完整信封 %s 原样返回', async (body) => {
        const api = create(axios.create({ adapter: async (config) => ({ status: 200, statusText: '', headers: {}, config, data: body }) }));
        expect(await api.get('/')()).toBe(body);
    });
    it('默认 create 创建独立 axios，构造保留既有 transitional 配置', () => {
        const a = create();
        const b = create();
        expect(a.axios).not.toBe(b.axios);
        const ax = axios.create({ transitional: { silentJSONParsing: false } });
        create(ax);
        expect(ax.defaults.transitional).toMatchObject({ silentJSONParsing: false, clarifyTimeoutError: true });
    });
});
