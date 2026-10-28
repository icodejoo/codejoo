import { afterEach, describe, expect, it, vi } from 'vitest';
import logger from '../../src/plugins/logger';
import {
    CONSOLE_LOGGER,
    pluginLog,
    pluginWarn,
    pluginError,
    asArray,
    isObject,
    isPrimitive,
    callAdapter,
    cloneAxiosDefaults,
    cloneAxiosHeaders,
    captureRawRequest,
    withRawRequest,
} from '../../src/helper';
import { AxiosHeaders } from 'axios';
import type { AxiosAdapter, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

afterEach(() => { vi.restoreAllMocks(); });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** 手动执行捕获转换，模拟 axios 转换请求体的阶段。 */
function capture(data: unknown) {
    const config: AxiosRequestConfig = { data };
    captureRawRequest(config);
    const transforms = asArray(config.transformRequest);
    transforms[0].call(config as InternalAxiosRequestConfig, data, new AxiosHeaders());
    return config;
}

describe('logger — 日志级别、默认值与卸载', () => {
    it.each([
        { call: pluginLog, method: 'log' as const },
        { call: pluginWarn, method: 'warn' as const },
        { call: pluginError, method: 'error' as const },
    ])('[public.export.pluginLog][public.export.pluginWarn][public.export.pluginError][logger.opt.debug][logger.opt.logger] $method 关闭时静默，开启时转发全部参数并可回退默认 sink', ({ call, method }) => {
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const fallback = vi.spyOn(CONSOLE_LOGGER, method).mockImplementation(() => {});
        call(undefined, 'hidden');
        call({ debug: false, logger: sink }, 'hidden');
        expect(sink[method]).not.toHaveBeenCalled();
        expect(fallback).not.toHaveBeenCalled();
        const data = { n: 1 };
        call({ debug: true, logger: sink }, 'message', data);
        expect(sink[method]).toHaveBeenCalledWith('message', data);
        call({ debug: true }, 'fallback');
        expect(fallback).toHaveBeenCalledWith('fallback');
    });
});

describe('helper — 基础值与克隆边界', () => {
    it.each([undefined, null])('[helper.asArray] asArray(%s) 返回新空数组', (value) => {
        expect(asArray(value)).toEqual([]);
    });
    it('[helper.asArray] asArray 复制数组且保留单值身份', () => {
        const value = {};
        const list = [value];
        expect(asArray(list)).toEqual(list);
        expect(asArray(list)).not.toBe(list);
        expect(asArray(value)[0]).toBe(value);
    });
    it.each([null, undefined, 0, false, '', Symbol('x'), 1n])('[helper.isPrimitive][helper.isObject] isPrimitive 接受 %s', (value) => {
        expect(isPrimitive(value)).toBe(true);
        expect(isObject(value)).toBe(false);
    });
    it.each([{}, [], new Date(), () => undefined])('[helper.isPrimitive] isPrimitive 拒绝引用值 %s', (value) => {
        expect(isPrimitive(value)).toBe(false);
    });
    it('[helper.isObject] isObject 接受无原型对象并拒绝数组', () => {
        expect(isObject(Object.create(null))).toBe(true);
        expect(isObject([])).toBe(false);
    });
    it('[helper.cloneAxiosHeaders] headers 缺失原样返回；AxiosHeaders 复制后独立', () => {
        expect(cloneAxiosHeaders(undefined)).toBeUndefined();
        const source = new AxiosHeaders({ a: '1' });
        const copy = cloneAxiosHeaders(source) as AxiosHeaders;
        copy.set('a', '2');
        expect(source.get('a')).toBe('1');
    });
    it('[helper.cloneAxiosDefaults] defaults 复制方法头、params、转换数组与 transitional，函数保留引用', () => {
        const transform = vi.fn();
        const source = {
            headers: { common: { a: '1' }, 'X-Flat': '2' }, params: { p: 1 },
            transformRequest: transform, transformResponse: [transform],
            transitional: { silentJSONParsing: false },
        };
        const copy = cloneAxiosDefaults(source as unknown as AxiosRequestConfig);
        expect(copy.headers).toEqual(source.headers);
        expect((copy.headers as any).common).not.toBe(source.headers.common);
        expect(copy.params).not.toBe(source.params);
        expect(copy.transformRequest).toEqual([transform]);
        expect(copy.transformResponse).not.toBe(source.transformResponse);
        expect(copy.transitional).not.toBe(source.transitional);
        expect(cloneAxiosDefaults({ params: 'p' }).params).toBe('p');
        expect(cloneAxiosDefaults({}).transformResponse).toEqual([]);
    });
    it('[helper.callAdapter] callAdapter 将同步异常转换成同一错误的 rejection', async () => {
        const error = new Error('sync');
        const adapter: AxiosAdapter = () => { throw error; };
        await expect(callAdapter(adapter, {} as any)).rejects.toBe(error);
    });
});

describe('helper — 原始请求体与单次尝试钩子', () => {
    it('[helper.captureRawRequest][helper.withRawRequest] 重复 captureRawRequest 不重复插入捕获项，未捕获配置返回新外壳', () => {
        const config = { data: 'text', transformRequest: vi.fn() };
        captureRawRequest(config);
        captureRawRequest(config);
        expect(asArray(config.transformRequest)).toHaveLength(2);
        const plain = { data: 'text' };
        expect(withRawRequest(plain)).toEqual(plain);
        expect(withRawRequest(plain)).not.toBe(plain);
    });
    it.each([[{ n: 1 }], { nested: { n: 1 } }, Object.assign(Object.create(null), { n: 1 })].map((data) => ({ data })))(
        '[helper.withRawRequest] 纯数据快照与每次还原均独立：$data', ({ data }) => {
            const config = capture(data);
            const a = withRawRequest(config);
            const b = withRawRequest(config);
            expect(a.data).toEqual(data);
            expect(a.data).not.toBe(data);
            expect(a.data).not.toBe(b.data);
        },
    );
    it.each([null, 'text', new URLSearchParams('a=1'), new Uint8Array([1])])(
        '[helper.withRawRequest] 非纯数据保持原值或引用：%s', (data) => {
            expect(withRawRequest(capture(data)).data).toBe(data);
        },
    );
    it('[helper.withRawRequest] structuredClone 缺失或失败均回退原引用', () => {
        const data = { n: 1 };
        vi.stubGlobal('structuredClone', undefined);
        expect(withRawRequest(capture(data)).data).toBe(data);
        vi.stubGlobal('structuredClone', vi.fn(() => { throw new Error('clone'); }));
        expect(withRawRequest(capture(data)).data).toBe(data);
    });
});
