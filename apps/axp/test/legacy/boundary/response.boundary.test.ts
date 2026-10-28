import { describe, expect, it } from 'vitest';
import Response, { AxpError } from '../../../src/objects/Response';

describe('AxpResponse — 边界', () => {
    it('[public.export.AxpResponse][public.member.AxpResponse.constructor][public.member.AxpResponse.status][public.member.AxpResponse.code] 无参构造使用默认值 status=0 code=0 且不成功；负数/超大 status 不成功', () => {
        expect(new Response()).toMatchObject({ status: 0, code: 0, message: null, data: null, successful: false });
        expect(new Response(-1, 0).successful).toBe(false);
        expect(new Response(Number.MAX_SAFE_INTEGER, 0).successful).toBe(false);
        expect(new Response(NaN, 0).successful).toBe(false);
    });
    it('[public.member.AxpResponse.message][public.member.AxpResponse.data] message/data 显式传 undefined 回落默认 null，空串/0/false 保持原值', () => {
        const d = new Response(200, 0, undefined, undefined);
        expect(d.message).toBeNull();
        expect(d.data).toBeNull();
        const v = new Response(200, 0, '', 0);
        expect(v.message).toBe('');
        expect(v.data).toBe(0);
        expect(new Response(200, 0, null, false as any).data).toBe(false);
    });
    it('[public.member.AxpResponse.successful][public.member.AxpResponse.code] 业务码字符串 "0"、空串、-1 都判失败；"0000" 与 0 判成功', () => {
        for (const c of ['0', '', -1, 'OK']) expect(new Response(200, c).successful).toBe(false);
        for (const c of ['0000', 0]) expect(new Response(200, c).successful).toBe(true);
    });
    it('[public.member.AxpResponse.fromResponse][public.member.AxpResponse.status] 响应 status 为 0/缺失/非数字时回落 0', () => {
        expect(Response.fromResponse({ status: 0, data: { code: 0 } }).successful).toBe(false);
        expect(Response.fromResponse({ data: { code: 0 } }).status).toBe(0);
    });
    it('[public.member.AxpResponse.fromResponse][public.member.AxpResponse.code] body 的 code 为 null/undefined 时仅按 HTTP 状态判定', () => {
        expect(Response.fromResponse({ status: 200, data: { code: null, data: 1 } }).successful).toBe(true);
        expect(Response.fromResponse({ status: 200, data: { code: undefined } }).successful).toBe(true);
        expect(Response.fromResponse({ status: 500, data: { code: null } }).successful).toBe(false);
    });
    it('[public.member.AxpResponse.isSuccessful] 边界 status 199/200/299/300 与 NaN、负数', () => {
        expect(Response.isSuccessful(NaN, 0)).toBe(false);
        expect(Response.isSuccessful(-200, 0)).toBe(false);
        expect(Response.isSuccessful(200, 0)).toBe(true);
        expect(Response.isSuccessful(299, undefined)).toBe(true);
        expect(Response.isSuccessful(300, null)).toBe(false);
    });
    it('[public.export.ApiError][public.member.ApiError.constructor][public.member.ApiError.response] ApiError 的 response 只读保留引用；message 为 null/空时分别回落/保持，可被 throw/catch 且保留堆栈', () => {
        const nullMsg = new AxpError(new Response(0, 0));
        expect(nullMsg.message).toBe('request failed (status=0, code=0)');
        expect(typeof nullMsg.stack).toBe('string');
        const res = new Response(500, 'X', 'boom');
        try { throw new AxpError(res); } catch (e: any) {
            expect(e).toBeInstanceOf(AxpError);
            expect(e.response).toBe(res);
        }
    });
});
