import { afterEach, describe, expect, it, vi } from 'vitest';
import filter, { $filter, $resolveOptions, defaultPredicate } from '../../../src/plugins/filter';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('envs/filter/repath — 次要分支与卸载', () => {
    it('[filter.fn.$filter][filter.opt.ignoreValues] filter 忽略继承属性，收集 dropped，ignoreValues 支持 NaN', () => {
        const data = Object.assign(Object.create({ inherited: 1 }), { n: NaN, empty: null, keep: 0 });
        const dropped: any[] = [];
        expect($filter(data, { predicate: ([, v]) => v == null || Number.isNaN(v), ignoreValues: [NaN] }, dropped))
            .toEqual({ n: NaN, keep: 0 });
        expect(dropped).toEqual([['empty', null]]);
    });
});

describe('defaultPredicate — 默认丢弃判定', () => {
    it('[filter.fn.defaultPredicate][filter.cb.predicate] null / undefined / NaN / 空串 / 全空白 → 丢弃', () => {
        expect(defaultPredicate(['k', null])).toBe(true);
        expect(defaultPredicate(['k', undefined])).toBe(true);
        expect(defaultPredicate(['k', NaN])).toBe(true);
        expect(defaultPredicate(['k', ''])).toBe(true);
        expect(defaultPredicate(['k', '   '])).toBe(true);
    });
    it('[filter.fn.defaultPredicate][filter.cb.predicate] 0 / false / 非空串 / 对象 → 保留', () => {
        expect(defaultPredicate(['k', 0])).toBe(false);
        expect(defaultPredicate(['k', false])).toBe(false);
        expect(defaultPredicate(['k', 'x'])).toBe(false);
        expect(defaultPredicate(['k', {}])).toBe(false);
    });
});

describe('$filter — 条目级过滤', () => {
    it('[filter.fn.$filter] 丢弃空字段，保留有效字段', () => {
        const out = $filter({ a: 1, b: '', c: null, d: 'x' }, { predicate: defaultPredicate });
        expect(out).toEqual({ a: 1, d: 'x' });
    });

    it('[filter.fn.$filter][filter.opt.ignoreKeys] ignoreKeys：命中 key 即使空也保留', () => {
        const out = $filter({ a: '', b: '' }, { predicate: defaultPredicate, ignoreKeys: ['a'] });
        expect(out).toEqual({ a: '' });
    });

    it('[filter.fn.$filter][filter.opt.ignoreValues] ignoreValues：命中 value 即使该丢也保留（NaN 特例）', () => {
        const out = $filter({ a: NaN, b: null }, { predicate: defaultPredicate, ignoreValues: [NaN] });
        expect(out).toEqual({ a: NaN });
    });

    it('[filter.fn.$filter][filter.cb.predicate] 自定义 predicate：丢弃所有数字', () => {
        const out = $filter({ a: 1, b: 'x', c: 2 }, { predicate: ([, v]) => typeof v === 'number' });
        expect(out).toEqual({ b: 'x' });
    });

    it('[filter.fn.$filter] dropped 出参：收集被丢弃条目', () => {
        const dropped: any[] = [];
        $filter({ a: 1, b: '' }, { predicate: defaultPredicate }, dropped);
        expect(dropped).toEqual([['b', '']]);
    });
});

describe('$resolveOptions — 请求级/插件级合并', () => {
    it('[filter.fn.$resolveOptions][filter.req.filter.callback] 请求级函数被调用解包', () => {
        const fnReq = (_c: any) => ({ predicate: ([, v]: any) => v === 'drop' });
        const out = $resolveOptions({ filter: fnReq } as any, {})!;
        expect(out.predicate(['k', 'drop'])).toBe(true);
        expect(out.predicate(['k', 'keep'])).toBe(false);
    });

    it('[filter.fn.$resolveOptions][filter.req.filter] 请求级对象覆盖插件级', () => {
        const pluginPred = () => false;
        const reqPred = () => true;
        const out = $resolveOptions({ filter: { predicate: reqPred } } as any, { predicate: pluginPred })!;
        expect(out.predicate).toBe(reqPred);
    });

    it('[filter.fn.$resolveOptions][filter.req.filter][filter.cb.predicate] 请求级缺失 → 用插件级；都缺 → defaultPredicate', () => {
        const pluginPred = () => true;
        expect($resolveOptions({ filter: true } as any, { predicate: pluginPred })!.predicate).toBe(pluginPred);
        expect($resolveOptions({ filter: true } as any, {})!.predicate).toBe(defaultPredicate);
    });

    it('[filter.fn.$resolveOptions][filter.req.filter.ignoreKeys][filter.req.filter.ignoreValues] ignoreKeys / ignoreValues 请求级优先回退插件级', () => {
        const out = $resolveOptions({ filter: { ignoreKeys: ['x'] } } as any, { ignoreValues: [0] })!;
        expect(out.ignoreKeys).toEqual(['x']);
        expect(out.ignoreValues).toEqual([0]);
    });
});

describe('filter — 函数形式解出 falsy / enable:false → 跳过过滤', () => {
    it('[filter.fn.$resolveOptions][filter.req.filter.callback][filter.req.filter.enable] $resolveOptions：函数返回 false / undefined / enable:false 对象 → null；其余照常解析', () => {
        expect($resolveOptions({ filter: () => false } as any, {})).toBeNull();
        expect($resolveOptions({ filter: () => undefined } as any, {})).toBeNull();
        expect($resolveOptions({ filter: () => ({ enable: false }) } as any, {})).toBeNull();
        expect($resolveOptions({ filter: { enable: false } } as any, {})).toBeNull();
        expect($resolveOptions({ filter: () => true } as any, {})!.predicate).toBe(defaultPredicate);
        expect($resolveOptions({ filter: () => ({}) } as any, {})!.predicate).toBe(defaultPredicate);
    });
});
