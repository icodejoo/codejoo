import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { create } from '../../src/core';

afterEach(() => { vi.restoreAllMocks(); });

describe('Core — 合并优先级与返回形状', () => {
    it('[public.member.Core.get][public.member.Core.axios] 请求选项覆盖方法选项和 payload，raw 优先于 wrap', async () => {
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
    it.each([null, 0, false, 'text', { code: 0 }, { data: 1 }])('[public.member.Core.get] 非完整信封 %s 原样返回', async (body) => {
        const api = create(axios.create({ adapter: async (config) => ({ status: 200, statusText: '', headers: {}, config, data: body }) }));
        expect(await api.get('/')()).toBe(body);
    });
    it('[public.fn.Axp.create][public.member.Core.constructor][public.member.Core.axios] 默认 create 创建独立 axios，构造保留既有 transitional 配置', () => {
        const a = create();
        const b = create();
        expect(a.axios).not.toBe(b.axios);
        const ax = axios.create({ transitional: { silentJSONParsing: false } });
        create(ax);
        expect(ax.defaults.transitional).toMatchObject({ silentJSONParsing: false, clarifyTimeoutError: true });
    });
});
