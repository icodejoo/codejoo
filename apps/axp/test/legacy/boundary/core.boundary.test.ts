import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { Core, Axp, pluginLog, pluginWarn, pluginError } from '../../../src';
import { create } from '../../../src/core';

/** 构造返回指定 body 的 adapter */
function mkAdapter(body: unknown = { code: 0, data: 1 }, status = 200) {
    return vi.fn(async (config: any) => ({ status, statusText: '', headers: {}, config, data: body }));
}

describe('Core — 动词方法族边界', () => {
    const ALL = ['get', 'head', 'options', 'purge', 'link', 'unlink', 'delete', 'post', 'put', 'patch'] as const;
    const IDS = '[public.member.Core.get][public.member.Core.head][public.member.Core.options][public.member.Core.purge][public.member.Core.link][public.member.Core.unlink][public.member.Core.delete][public.member.Core.post][public.member.Core.put][public.member.Core.patch]';
    it.each(ALL)(IDS + ' %s 无 payload、payload 为 0/空串/null 时不抛并解包', async (m) => {
        const adapter = mkAdapter();
        const api = create(axios.create({ adapter }));
        for (const payload of [undefined, 0, '', null]) {
            await expect((api as any)[m]('/p')(payload)).resolves.toBe(1);
        }
        expect(adapter).toHaveBeenCalledTimes(4);
    });
    it.each(ALL)(IDS + ' %s 适配器 reject 时原样拒绝（不吞错、不包装）', async (m) => {
        const err = new Error('net');
        const api = create(axios.create({ adapter: async () => { throw err; } }));
        await expect((api as any)[m]('/p')()).rejects.toBe(err);
    });
    it('[public.member.Core.get] http 请求选项的 url 优先于方法选项与路径参数', async () => {
        const adapter = mkAdapter();
        const api = create(axios.create({ adapter }));
        await api.get('/a', { url: '/b' } as any)(undefined, { url: '/c' });
        expect(adapter.mock.calls[0][0].url).toBe('/c');
    });
    it('[public.member.Core.post] 同一 dispatch 并发多次调用互不共享 config', async () => {
        const adapter = mkAdapter();
        const api = create(axios.create({ adapter }));
        const send = api.post('/p');
        await Promise.all([send({ n: 1 }), send({ n: 2 })]);
        const bodies = adapter.mock.calls.map((c) => JSON.parse(c[0].data).n).sort();
        expect(bodies).toEqual([1, 2]);
    });
});

describe('Core — 响应形态边界', () => {
    it('[public.req.raw][public.req.wrap] raw 与 wrap 同为 true 时 raw 优先；body 为 null 返回 null', async () => {
        const api = create(axios.create({ adapter: mkAdapter(null) }));
        expect(await api.get('/')(undefined, { raw: true, wrap: true })).toBeNull();
    });
    it('[public.req.raw] raw:false 仍解包', async () => {
        const api = create(axios.create({ adapter: mkAdapter() }));
        expect(await api.get('/')(undefined, { raw: false })).toBe(1);
    });
    it.each([null, '', 'text', 0, [1, 2]])('[public.req.wrap] wrap:true 面对非信封 body %s 也返回 AxpResponse 且 code 缺省', async (body) => {
        const api = create(axios.create({ adapter: mkAdapter(body) }));
        const r: any = await api.get('/')(undefined, { wrap: true });
        expect(r.status).toBe(200);
        expect(r.code).toBe(0);
        expect(r.data).toBe(body ?? null);
    });
    it('[public.req.wrap] wrap:false 视同未设置，走解包', async () => {
        const api = create(axios.create({ adapter: mkAdapter() }));
        expect(await api.get('/')(undefined, { wrap: false })).toBe(1);
    });
    it.each([null, undefined])('[public.req.nullable] 信封 data=%s 时 nullable 真/假都原样返回该值，不抛错（该选项仅影响类型）', async (data) => {
        const api = create(axios.create({ adapter: mkAdapter({ code: 0, data }) }));
        expect(await api.get('/')(undefined, { nullable: true })).toBe(data);
        expect(await api.get('/')(undefined, { nullable: false })).toBe(data);
    });
});

describe('Core — 构造与 extends 边界', () => {
    it('[public.member.Core.constructor] 重复对同一 axios 构造 Core 幂等：adapter 保持函数，不抛错', () => {
        const ax = axios.create();
        new Core(ax);
        const a1 = ax.defaults.adapter;
        expect(() => new Core(ax)).not.toThrow();
        expect(ax.defaults.adapter).toBe(a1);
    });
    it('[public.member.Core.constructor] 第二参数 options 传 undefined/{} 均可', () => {
        expect(() => new Core(axios.create(), undefined)).not.toThrow();
        expect(() => new Core(axios.create(), {})).not.toThrow();
    });
    it('[public.member.Core.axios] axios 属性与构造入参为同一引用，Axp.create 默认参数产生独立实例', () => {
        const ax = axios.create();
        expect(new Core(ax).axios).toBe(ax);
        expect(Axp.create().axios).not.toBe(Axp.create().axios);
    });
    it('[public.member.Core.extends] extends 不传参/传 {} 仍得到独立实例；多层 extends 互不污染', () => {
        const root = create(axios.create({ baseURL: 'http://r' }));
        const a = root.extends();
        const b = a.extends({ baseURL: 'http://b' });
        expect(a.axios).not.toBe(root.axios);
        expect(b.axios.defaults.baseURL).toBe('http://b');
        expect(a.axios.defaults.baseURL).toBe('http://r');
        expect(root.extends({}).axios).not.toBe(root.axios);
    });
    it('[public.member.Core.extends] 子实例 headers 修改不回写父实例', () => {
        const root = create(axios.create({ headers: { common: { 'X-A': '1' } } as any }));
        const child = root.extends();
        (child.axios.defaults.headers.common as any)['X-A'] = '2';
        expect((root.axios.defaults.headers.common as any)['X-A']).toBe('1');
    });
    it('[public.member.Core.extends] 可被子类继承，子类实例保持 Core 行为', () => {
        class Sub extends Core {}
        expect(new Sub(axios.create())).toBeInstanceOf(Core);
    });
});

describe('公共导出 — 边界', () => {
    it('[public.export.Core][public.export.Axp] Axp 只含 create/install', () => {
        expect(Object.keys(Axp).sort()).toEqual(['create', 'install']);
    });
    it('[public.fn.Axp.create] create 第二参数 options 可缺省/传空对象', () => {
        expect(Axp.create(axios.create(), {})).toBeInstanceOf(Core);
        expect(Axp.create(undefined, undefined)).toBeInstanceOf(Core);
    });
    it.each([
        ['log', pluginLog], ['warn', pluginWarn], ['error', pluginError],
    ] as const)('[public.export.pluginLog][public.export.pluginWarn][public.export.pluginError] %s 在 source 为 undefined/null/debug 假值时静默，logger 抛错会向上传播', (method, fn) => {
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
        for (const src of [undefined, null, { debug: 0, logger: sink }, { debug: '', logger: sink }] as any[]) {
            expect(() => fn(src, 'x')).not.toThrow();
        }
        expect(sink[method]).not.toHaveBeenCalled();
        sink[method].mockImplementation(() => { throw new Error('sink'); });
        expect(() => fn({ debug: true, logger: sink }, 'x')).toThrow('sink');
        sink[method].mockReset();
        fn({ debug: true, logger: sink });
        expect(sink[method]).toHaveBeenCalledWith();
    });
});
