import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import * as pub from '../../src';
import { Core, Axp, ApiError, AxpResponse, TokenManager, pluginLog, pluginWarn, pluginError } from '../../src';
import { create } from '../../src/core';

/** 构造记录 config 的 adapter，返回指定 body */
function mkAdapter(body: unknown = { code: 0, data: { ok: 1 } }) {
    return vi.fn(async (config: any) => ({ status: 200, statusText: '', headers: {}, config, data: body }));
}

describe('公共导出 — 入口符号', () => {
    it('[public.export.Core][public.export.Axp][public.export.AxpResponse][public.export.ApiError][public.export.TokenManager][public.export.pluginLog][public.export.pluginWarn][public.export.pluginError] 入口导出的运行时符号类型与别名正确', () => {
        expect(typeof Core).toBe('function');
        expect(typeof Axp.create).toBe('function');
        expect(typeof Axp.install).toBe('function');
        expect(pub.AxpResponse).toBe(AxpResponse);
        expect(new ApiError(new AxpResponse(500, 1, 'x'))).toBeInstanceOf(Error);
        expect(typeof TokenManager).toBe('function');
        for (const fn of [pluginLog, pluginWarn, pluginError]) expect(typeof fn).toBe('function');
    });
    it('[public.fn.Axp.create][public.member.Core.constructor][public.member.Core.axios] Axp.create 返回 Core，axios 为传入实例', () => {
        const ax = axios.create();
        const api = Axp.create(ax);
        expect(api).toBeInstanceOf(Core);
        expect(api.axios).toBe(ax);
    });
});

describe('Core — 动词方法族', () => {
    // body 类方法走 data，其余走 params
    const BODY = ['delete', 'post', 'put', 'patch'] as const;
    const PARAMS = ['get', 'head', 'options', 'purge', 'link', 'unlink'] as const;
    it.each([...BODY, ...PARAMS])('[public.member.Core.get][public.member.Core.head][public.member.Core.options][public.member.Core.purge][public.member.Core.link][public.member.Core.unlink][public.member.Core.delete][public.member.Core.post][public.member.Core.put][public.member.Core.patch] %s 发出对应 method/url，payload 走正确字段并解包信封', async (m) => {
        const adapter = mkAdapter();
        const api = create(axios.create({ adapter }));
        const out = await (api as any)[m]('/p')({ a: 1 });
        expect(out).toEqual({ ok: 1 });
        const cfg = adapter.mock.calls[0][0];
        expect(cfg.method).toBe(m);
        expect(cfg.url).toBe('/p');
        if ((BODY as readonly string[]).includes(m)) {
            expect(JSON.parse(cfg.data)).toEqual({ a: 1 });
            expect(cfg.params).toBeUndefined();
        } else {
            expect(cfg.params).toEqual({ a: 1 });
            expect(cfg.data).toBeUndefined();
        }
    });
});

describe('Core — 返回形态与 extends', () => {
    it('[public.req.raw] raw:true 返回原始 body（不解包信封）', async () => {
        const body = { code: 0, data: 5, message: 'm' };
        const api = create(axios.create({ adapter: mkAdapter(body) }));
        expect(await api.get('/')(undefined, { raw: true })).toBe(body);
    });
    it('[public.req.wrap] wrap:true 返回 AxpResponse，携带 status/code/message/data', async () => {
        const api = create(axios.create({ adapter: mkAdapter({ code: 0, data: 7, message: 'ok' }) }));
        const r: any = await api.get('/')(undefined, { wrap: true });
        expect(r).toBeInstanceOf(AxpResponse);
        expect(r).toMatchObject({ status: 200, code: 0, message: 'ok', data: 7, successful: true });
    });
    it('[public.req.nullable] nullable:true 允许 data 为 null：解包后原样得到 null，不改变其它形态', async () => {
        const api = create(axios.create({ adapter: mkAdapter({ code: 0, data: null }) }));
        expect(await api.get('/')(undefined, { nullable: true })).toBeNull();
    });
    it('[public.member.Core.extends] extends 返回独立子 Core，继承 defaults，overrides 覆盖且不污染父实例', async () => {
        const adapter = mkAdapter();
        const parent = create(axios.create({ adapter, baseURL: 'http://a', headers: { 'X-P': '1' } as any }));
        const child = parent.extends({ baseURL: 'http://b' });
        expect(child).toBeInstanceOf(Core);
        expect(child.axios).not.toBe(parent.axios);
        expect(parent.axios.defaults.baseURL).toBe('http://a');
        await child.get('/x')();
        expect(adapter.mock.calls[0][0].baseURL).toBe('http://b');
        expect(adapter.mock.calls[0][0].headers.get('X-P')).toBe('1');
    });
    it('[public.member.Core.constructor] 构造把非函数 adapter 归一化成函数，并开启 clarifyTimeoutError', () => {
        const ax = axios.create();
        expect(typeof ax.defaults.adapter).not.toBe('function');
        new Core(ax);
        expect(typeof ax.defaults.adapter).toBe('function');
        expect(ax.defaults.transitional?.clarifyTimeoutError).toBe(true);
    });
});
