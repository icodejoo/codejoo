import { afterEach, describe, expect, it, vi } from 'vitest';
import Response, { AxpError } from '../../src/objects/Response';

afterEach(() => { vi.restoreAllMocks(); });

describe('Response — 状态边界与信封形状', () => {
    it.each([
        [199, 0, false], [200, 0, true], [299, '0000', true], [300, 0, false],
        [200, '0', false], [200, null, true], [500, undefined, false],
    ])('[public.member.AxpResponse.isSuccessful][public.member.AxpResponse.successful] status=%i code=%s successful=%s', (status, code, success) => {
        expect(Response.isSuccessful(status as number, code as any)).toBe(success);
    });
    it.each([undefined, null, {}, { data: undefined }])('[public.member.AxpResponse.fromResponse][public.member.AxpResponse.constructor] 缺失响应字段 %s 使用安全默认值', (input) => {
        expect(Response.fromResponse(input)).toMatchObject({ status: 0, code: 0, message: null, data: null, successful: false });
    });
    it('[public.member.AxpResponse.fromResponse][public.member.AxpResponse.data][public.member.AxpResponse.message] 信封中空串、false 和 0 不被默认值吞掉，数组即使带 code 也视为原始 body', () => {
        expect(Response.fromResponse({ status: 200, data: { code: 0, message: '', data: false } })).toMatchObject({ message: '', data: false });
        const array = Object.assign([1], { code: 1 });
        expect(Response.fromResponse({ status: 200, data: array }).data).toBe(array);
        expect(Response.fromResponse({ status: 200, data: { code: 0, data: 0 } }).data).toBe(0);
    });
    it('[public.export.ApiError][public.member.ApiError.response][public.member.ApiError.constructor] AxpError 保留响应身份和空消息，缺省消息包含状态与业务码', () => {
        const response = new Response(400, 'BAD');
        const error = new AxpError(response);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('ApiError');
        expect(error.response).toBe(response);
        expect(error.message).toBe('request failed (status=400, code=BAD)');
        expect(new AxpError(new Response(400, 1, '')).message).toBe('');
    });
    it('[public.member.AxpResponse.isSuccessful][public.member.AxpResponse.fromResponse][public.member.AxpResponse.constructor] 构造与 fromResponse 都使用可覆盖的成功判定', () => {
        vi.spyOn(Response, 'isSuccessful').mockImplementation((status, code) => status === 201 && code === 'OK');
        expect(new Response(201, 'OK').successful).toBe(true);
        expect(Response.fromResponse({ status: 201, data: { code: 0 } }).successful).toBe(false);
    });
});
