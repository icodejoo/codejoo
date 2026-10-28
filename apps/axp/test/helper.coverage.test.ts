import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosHeaders } from 'axios';
import type { AxiosAdapter, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import {
    asArray, isObject, isPrimitive, callAdapter, cloneAxiosDefaults, cloneAxiosHeaders,
    resolveAdapter, wrapAdapter, getBaseAdapter, captureRawRequest, withRawRequest,
    registerAttemptHook, runAttempt,
} from '../src/helper';
import type { AttemptHook } from '../src/helper';
import { setInternal, getInternal, delInternal } from '../src/bag';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** 构造不访问网络的成功响应。 */
function response(config: any, data: unknown = 'ok') {
    return { status: 200, statusText: 'OK', headers: {}, config, data };
}

/** 手动执行捕获转换，模拟 axios 转换请求体的阶段。 */
function capture(data: unknown) {
    const config: AxiosRequestConfig = { data };
    captureRawRequest(config);
    const transforms = asArray(config.transformRequest);
    transforms[0].call(config as InternalAxiosRequestConfig, data, new AxiosHeaders());
    return config;
}

describe('helper — 基础值与克隆边界', () => {
    it.each([undefined, null])('asArray(%s) 返回新空数组', (value) => {
        expect(asArray(value)).toEqual([]);
    });
    it('asArray 复制数组且保留单值身份', () => {
        const value = {};
        const list = [value];
        expect(asArray(list)).toEqual(list);
        expect(asArray(list)).not.toBe(list);
        expect(asArray(value)[0]).toBe(value);
    });
    it.each([null, undefined, 0, false, '', Symbol('x'), 1n])('isPrimitive 接受 %s', (value) => {
        expect(isPrimitive(value)).toBe(true);
        expect(isObject(value)).toBe(false);
    });
    it.each([{}, [], new Date(), () => undefined])('isPrimitive 拒绝引用值 %s', (value) => {
        expect(isPrimitive(value)).toBe(false);
    });
    it('isObject 接受无原型对象并拒绝数组', () => {
        expect(isObject(Object.create(null))).toBe(true);
        expect(isObject([])).toBe(false);
    });
    it('headers 缺失原样返回；AxiosHeaders 复制后独立', () => {
        expect(cloneAxiosHeaders(undefined)).toBeUndefined();
        const source = new AxiosHeaders({ a: '1' });
        const copy = cloneAxiosHeaders(source) as AxiosHeaders;
        copy.set('a', '2');
        expect(source.get('a')).toBe('1');
    });
    it('defaults 复制方法头、params、转换数组与 transitional，函数保留引用', () => {
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
    it('callAdapter 将同步异常转换成同一错误的 rejection', async () => {
        const error = new Error('sync');
        const adapter: AxiosAdapter = () => { throw error; };
        await expect(callAdapter(adapter, {} as any)).rejects.toBe(error);
    });
    it('resolveAdapter 缺省候选、字符串和函数均可解析；非法名称抛错', () => {
        const ax = axios.create();
        ax.defaults.adapter = undefined;
        expect(typeof resolveAdapter(ax)).toBe('function');
        ax.defaults.adapter = 'fetch';
        expect(resolveAdapter(ax)).toBe(axios.getAdapter('fetch'));
        ax.defaults.adapter = 'invalid';
        expect(() => resolveAdapter(ax)).toThrow();
    });
});

describe('bag — 私有数据生命周期', () => {
    it('读删不存在的 bag 不创建任何属性', () => {
        const config = {};
        expect(getInternal(config, 'x')).toBeUndefined();
        delInternal(config, 'x');
        expect(Reflect.ownKeys(config)).toEqual([]);
    });
    it('覆写与删除只影响对应 config，枚举、展开与 axios 合并均不可见', () => {
        const a = { url: '/a' };
        const b = { url: '/b' };
        setInternal(a, 'x', 1);
        setInternal(a, 'y', 2);
        setInternal(a, 'x', 3);
        expect(getInternal(a, 'x')).toBe(3);
        expect(getInternal(b, 'x')).toBeUndefined();
        expect(Object.keys(a)).toEqual(['url']);
        expect(JSON.stringify(a)).toBe('{"url":"/a"}');
        expect(getInternal({ ...a }, 'x')).toBeUndefined();
        expect(getInternal(axios.mergeConfig({}, a), 'x')).toBeUndefined();
        delInternal(a, 'x');
        expect(getInternal(a, 'x')).toBeUndefined();
        expect(getInternal(a, 'y')).toBe(2);
    });
});

describe('helper — adapter 外部替换与旧引用', () => {
    it('外部替换后移除旧层不覆盖新 adapter，旧层引用退化为直通', async () => {
        const base = vi.fn(async (c) => response(c, 'base'));
        const replacement = vi.fn(async (c) => response(c, 'replacement'));
        const ax = axios.create({ adapter: base });
        const called = vi.fn();
        const off = wrapAdapter(ax, (prev) => (c) => { called(); return prev(c); });
        const old = ax.defaults.adapter as AxiosAdapter;
        ax.defaults.adapter = replacement;
        expect(getBaseAdapter(ax)).toBe(replacement);
        const offNew = wrapAdapter(ax, (prev) => prev);
        off();
        expect((await ax.get('/')).data).toBe('replacement');
        expect((await old({} as any)).data).toBe('base');
        expect(called).not.toHaveBeenCalled();
        offNew();
        expect(ax.defaults.adapter).toBe(replacement);
    });
});

describe('helper — 原始请求体与单次尝试钩子', () => {
    it('重复 captureRawRequest 不重复插入捕获项，未捕获配置返回新外壳', () => {
        const config = { data: 'text', transformRequest: vi.fn() };
        captureRawRequest(config);
        captureRawRequest(config);
        expect(asArray(config.transformRequest)).toHaveLength(2);
        const plain = { data: 'text' };
        expect(withRawRequest(plain)).toEqual(plain);
        expect(withRawRequest(plain)).not.toBe(plain);
    });
    it.each([[{ n: 1 }], { nested: { n: 1 } }, Object.assign(Object.create(null), { n: 1 })].map((data) => ({ data })))(
        '纯数据快照与每次还原均独立：$data', ({ data }) => {
            const config = capture(data);
            const a = withRawRequest(config);
            const b = withRawRequest(config);
            expect(a.data).toEqual(data);
            expect(a.data).not.toBe(data);
            expect(a.data).not.toBe(b.data);
        },
    );
    it.each([null, 'text', new URLSearchParams('a=1'), new Uint8Array([1])])(
        '非纯数据保持原值或引用：%s', (data) => {
            expect(withRawRequest(capture(data)).data).toBe(data);
        },
    );
    it('structuredClone 缺失或失败均回退原引用', () => {
        const data = { n: 1 };
        vi.stubGlobal('structuredClone', undefined);
        expect(withRawRequest(capture(data)).data).toBe(data);
        vi.stubGlobal('structuredClone', vi.fn(() => { throw new Error('clone'); }));
        expect(withRawRequest(capture(data)).data).toBe(data);
    });
    it('钩子按登记顺序运行且注销幂等，运行中注销不改变本次快照', async () => {
        const calls: string[] = [];
        const ax = axios.create();
        /** 构造记录顺序的尝试钩子。 */
        function hook(name: string): AttemptHook {
            return {
                /** 记录请求准备顺序。 */
                async onRequest(c) { calls.push(name + ':request'); return c; },
                /** 记录响应处理顺序。 */
                async onResponse(r) { calls.push(name + ':response'); return r; },
                /** 错误保持拒绝。 */
                async onError(e) { throw e; },
            };
        }
        const offA = registerAttemptHook(ax, hook('a'));
        const offB = registerAttemptHook(ax, hook('b'));
        const adapter = vi.fn(async (c) => response(c));
        const pending = runAttempt(ax, { url: '/', adapter });
        offB(); offB();
        await pending;
        expect(calls).toEqual(['a:request', 'b:request', 'a:response', 'b:response']);
        offA(); offA();
        calls.length = 0;
        await runAttempt(ax, { url: '/', adapter });
        expect(calls).toEqual([]);
    });
    it('请求准备失败不发送网络，错误钩子可恢复并交给后续响应钩子', async () => {
        const ax = axios.create();
        const error = new Error('prepare');
        const adapter = vi.fn();
        const recovered = response({}, 'recovered');
        const onError = vi.fn(async () => recovered);
        const onResponse = vi.fn(async (r) => r);
        registerAttemptHook(ax, {
            /** 模拟凭证准备失败。 */
            async onRequest() { throw error; },
            onResponse, onError,
        });
        registerAttemptHook(ax, {
            /** 后续准备因前一项失败不会执行。 */
            async onRequest(c) { return c; },
            onResponse,
            /** 未恢复的错误继续拒绝。 */
            async onError(e) { throw e; },
        });
        await expect(runAttempt(ax, { adapter })).resolves.toBe(recovered);
        expect(adapter).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(error);
        expect(onResponse).toHaveBeenCalledOnce();
    });
});
