import { describe, expect, it } from 'vitest';
import Response, { AxpError } from '../../src/objects/Response';

describe('AxpResponse — 构造与字段规则', () => {
    it('[public.export.AxpResponse][public.member.AxpResponse.status][public.member.AxpResponse.code][public.member.AxpResponse.message][public.member.AxpResponse.data][public.member.AxpResponse.successful] 构造按顺序保存 status/code/message/data，并计算 successful', () => {
        const r = new Response(200, 0, 'ok', { n: 1 });
        expect(r).toMatchObject({ status: 200, code: 0, message: 'ok', data: { n: 1 }, successful: true });
        expect(new Response(500, 'E1', 'bad')).toMatchObject({ status: 500, code: 'E1', successful: false, data: null });
    });
    it('[public.member.AxpResponse.fromResponse][public.member.AxpResponse.status][public.member.AxpResponse.code] 信封响应取 body.code，非信封响应 code 缺省为 0', () => {
        expect(Response.fromResponse({ status: 200, data: { code: '0000', data: 1 } })).toMatchObject({ status: 200, code: '0000', data: 1, successful: true });
        expect(Response.fromResponse({ status: 201, data: 'raw' })).toMatchObject({ status: 201, code: 0, data: 'raw', successful: true });
    });
    it('[public.export.ApiError] ApiError 是 AxpError 的公开别名，消息取自响应 message', async () => {
        const { ApiError } = await import('../../src');
        expect(ApiError).toBe(AxpError);
        expect(new ApiError(new Response(400, 1, '参数错误')).message).toBe('参数错误');
    });
});
