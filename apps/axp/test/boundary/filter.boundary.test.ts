import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import filter, { defaultPredicate } from '../../src/plugins/filter';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 构造 adapter 层成功响应。 */
function response(config: any, data: unknown = 'ok') {
    return { config, data, status: 200, statusText: '', headers: {} };
}

describe('envs/filter/repath — 次要分支与卸载', () => {
    it('[filter.req.filter.callback][filter.fn.axpFilter] filter 函数解析为 false 时删除配置，数组与文本保持原值', async () => {
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        const off = filter().install(ax);
        await ax.post('/', 'body', { params: [1, null], filter: () => false });
        const config = adapter.mock.calls[0][0];
        expect(config).not.toHaveProperty('filter');
        expect(config.params).toEqual([1, null]);
        expect(config.data).toBe('body');
        off?.();
        await ax.get('/', { params: { empty: null }, filter: true });
        expect(adapter.mock.calls[1][0].params).toEqual({ empty: null });
    });
});

/** 装好 filter 的 axios，返回 adapter 以读取最终发出的 config。 */
function setup(opts?: Parameters<typeof filter>[0]) {
    const adapter = vi.fn(async (c: any) => response(c));
    const ax = axios.create({ adapter });
    const off = filter(opts).install(ax) as () => void;
    return { ax, adapter, off, sent: (i = 0) => adapter.mock.calls[i][0] as any };
}

describe('filter — 插件选项边界', () => {
    it('[filter.opt.enable] enable:false 时 filter:true 也不过滤，config.filter 不被清理；省略 enable 视为 true', async () => {
        const off = setup({ enable: false });
        await off.ax.get('/', { params: { a: '' }, filter: true });
        expect(off.sent().params).toEqual({ a: '' });
        expect(off.sent().filter).toBe(true);
        const on = setup({ enable: undefined });
        await on.ax.get('/', { params: { a: '' }, filter: true });
        expect(on.sent().params).toEqual({});
    });

    it('[filter.method.install] 同一实例重复 install 不抛错，过滤结果幂等', async () => {
        const { ax, adapter } = setup();
        filter().install(ax);
        await ax.get('/', { params: { a: '', b: 1 }, filter: true });
        expect(adapter.mock.calls[0][0].params).toEqual({ b: 1 });
    });

    it('[filter.method.cleanup] cleanup 重复调用安全，卸载后可重新 install', async () => {
        const { ax, adapter, off } = setup();
        off();
        expect(() => off()).not.toThrow();
        filter().install(ax);
        await ax.get('/', { params: { a: null }, filter: true });
        expect(adapter.mock.calls[0][0].params).toEqual({});
    });

    it('[filter.cb.predicate] predicate 抛错 → 请求拒绝为同一错误，不发出请求', async () => {
        const err = new Error('boom');
        const { ax, adapter } = setup({ predicate: () => { throw err; } });
        await expect(ax.get('/', { params: { a: 1 }, filter: true })).rejects.toBe(err);
        expect(adapter).not.toHaveBeenCalled();
    });

    it.fails('[filter.cb.predicate] 期望（源码注释声明 === true 才丢弃）：返回 1 / Promise 视为保留；现状是真值即丢弃', async () => {
        const { ax, sent } = setup({ predicate: (([k]: [string, any]) => (k === 'n' ? 1 : Promise.resolve(true))) as any });
        await ax.get('/', { params: { n: 'x', p: 'y' }, filter: true });
        expect(sent().params).toEqual({ n: 'x', p: 'y' });
    });

    it('[filter.opt.ignoreKeys] 空数组不豁免任何 key；不存在的 key 不影响结果', async () => {
        const a = setup({ ignoreKeys: [] });
        await a.ax.get('/', { params: { k: '' }, filter: true });
        expect(a.sent().params).toEqual({});
        const b = setup({ ignoreKeys: ['nope'] });
        await b.ax.get('/', { params: { k: '' }, filter: true });
        expect(b.sent().params).toEqual({});
    });

    it('[filter.opt.ignoreValues] 空数组不豁免；可豁免 undefined 与 NaN（===，NaN 特例）', async () => {
        const a = setup({ ignoreValues: [] });
        await a.ax.get('/', { params: { k: null }, filter: true });
        expect(a.sent().params).toEqual({});
        const b = setup({ ignoreValues: [undefined, NaN] });
        await b.ax.get('/', { params: { u: undefined, n: NaN, z: null }, filter: true });
        expect(Object.keys(b.sent().params).sort()).toEqual(['n', 'u']);
    });

    it('[filter.fn.defaultPredicate] 边界值：Infinity/-0/空数组/空白(含 NBSP 与换行) 的判定', () => {
        expect(defaultPredicate(['k', Infinity])).toBe(false);
        expect(defaultPredicate(['k', -0])).toBe(false);
        expect(defaultPredicate(['k', []])).toBe(false);
        expect(defaultPredicate(['k', ' \n\t'])).toBe(true);
        expect(defaultPredicate(['k', ' x '])).toBe(false);
    });
});

describe('filter — 请求级配置边界', () => {
    it('[filter.req.filter] 假值与空白字符串不运行；空对象 / 非空字符串回退插件默认过滤', async () => {
        const { ax, sent } = setup();
        await ax.get('/', { params: { a: '' }, filter: 0 as any });
        await ax.get('/', { params: { a: '' }, filter: '  ' as any });
        await ax.get('/', { params: { a: '' }, filter: {} });
        await ax.get('/', { params: { a: '' }, filter: 'yes' as any });
        expect(sent(0).params).toEqual({ a: '' });
        expect(sent(1).params).toEqual({ a: '' });
        expect(sent(2).params).toEqual({});
        expect(sent(3).params).toEqual({});
    });

    it('[filter.req.filter] params/data 为 undefined、数组、原始值时不报错、原样保留', async () => {
        const { ax, sent } = setup();
        await ax.post('/', undefined, { filter: true });
        await ax.post('/', 'text', { params: [null], filter: true });
        expect(sent(0).data).toBeUndefined();
        expect(sent(1).params).toEqual([null]);
        expect(sent(1).data).toBe('text');
    });

    it('[filter.req.filter][filter.req.filter.enable] filter 函数抛错 → 请求拒绝；{enable:undefined} 视为启用', async () => {
        const err = new Error('fn');
        const { ax, sent } = setup();
        await expect(ax.get('/', { filter: () => { throw err; } })).rejects.toBe(err);
        await ax.get('/', { params: { a: '' }, filter: { enable: undefined } });
        expect(sent().params).toEqual({});
    });

    it('[filter.req.filter.enable] {enable:false} 对象跳过过滤并清掉 config.filter', async () => {
        const { ax, sent } = setup();
        await ax.get('/', { params: { a: '' }, filter: { enable: false } });
        expect(sent().params).toEqual({ a: '' });
        expect(sent()).not.toHaveProperty('filter');
    });

    it('[filter.req.filter.predicate] 请求级 predicate 为 undefined/null 时回退插件级', async () => {
        const { ax, sent } = setup({ predicate: ([k]) => k === 'drop' });
        await ax.get('/', { params: { drop: 1, e: '' }, filter: { predicate: undefined } });
        await ax.get('/', { params: { drop: 1, e: '' }, filter: { predicate: null as any } });
        expect(sent(0).params).toEqual({ e: '' });
        expect(sent(1).params).toEqual({ e: '' });
    });

    it('[filter.req.filter.ignoreKeys] 请求级空数组覆盖插件级豁免（?? 不把 [] 当缺省）', async () => {
        const { ax, sent } = setup({ ignoreKeys: ['a'] });
        await ax.get('/', { params: { a: '' }, filter: true });
        await ax.get('/', { params: { a: '' }, filter: { ignoreKeys: [] } });
        expect(sent(0).params).toEqual({ a: '' });
        expect(sent(1).params).toEqual({});
    });

    it('[filter.req.filter.ignoreValues] 请求级 ignoreValues 覆盖插件级，空数组即取消豁免', async () => {
        const { ax, sent } = setup({ ignoreValues: [null] });
        await ax.get('/', { params: { a: null }, filter: true });
        await ax.get('/', { params: { a: null }, filter: { ignoreValues: [] } });
        expect(sent(0).params).toEqual({ a: null });
        expect(sent(1).params).toEqual({});
    });
});
