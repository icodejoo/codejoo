import { describe, it, expect } from 'vitest';
import normalizeRequest, {
    $resolveOptions,
    $filter,
    defaultPredicate,
} from '../src/plugins/normalize-request';


function makeMockCtx() {
    const reqHandlers: Array<(config: any) => any> = [];
    const runWhens: Array<(config: any) => boolean> = [];
    const ctx: any = {
        axios: { defaults: {} },
        name: 'normalize-request',
        logger: { log: () => { }, warn: () => { }, error: () => { } },
        request: (f: any, _r: any, opts: any) => { reqHandlers.push(f); if (opts?.runWhen) runWhens.push(opts.runWhen); },
        response: () => { },
        adapter: () => { },
        transformRequest: () => { },
        transformResponse: () => { },
        cleanup: () => { },
    };
    return { ctx, reqHandlers, runWhens };
}


describe('defaultPredicate — 默认丢弃判定', () => {
    it('null / undefined / NaN / 空串 / 全空白 → 丢弃', () => {
        expect(defaultPredicate(['k', null])).toBe(true);
        expect(defaultPredicate(['k', undefined])).toBe(true);
        expect(defaultPredicate(['k', NaN])).toBe(true);
        expect(defaultPredicate(['k', ''])).toBe(true);
        expect(defaultPredicate(['k', '   '])).toBe(true);
    });
    it('0 / false / 非空串 / 对象 → 保留', () => {
        expect(defaultPredicate(['k', 0])).toBe(false);
        expect(defaultPredicate(['k', false])).toBe(false);
        expect(defaultPredicate(['k', 'x'])).toBe(false);
        expect(defaultPredicate(['k', {}])).toBe(false);
    });
});


describe('$filter — 条目级过滤', () => {
    it('丢弃空字段，保留有效字段', () => {
        const out = $filter({ a: 1, b: '', c: null, d: 'x' }, { predicate: defaultPredicate });
        expect(out).toEqual({ a: 1, d: 'x' });
    });

    it('ignoreKeys：命中 key 即使空也保留', () => {
        const out = $filter({ a: '', b: '' }, { predicate: defaultPredicate, ignoreKeys: ['a'] });
        expect(out).toEqual({ a: '' });
    });

    it('ignoreValues：命中 value 即使该丢也保留（NaN 特例）', () => {
        const out = $filter({ a: NaN, b: null }, { predicate: defaultPredicate, ignoreValues: [NaN] });
        expect(out).toEqual({ a: NaN });
    });

    it('自定义 predicate：丢弃所有数字', () => {
        const out = $filter({ a: 1, b: 'x', c: 2 }, { predicate: ([, v]) => typeof v === 'number' });
        expect(out).toEqual({ b: 'x' });
    });

    it('dropped 出参：收集被丢弃条目', () => {
        const dropped: any[] = [];
        $filter({ a: 1, b: '' }, { predicate: defaultPredicate }, dropped);
        expect(dropped).toEqual([['b', '']]);
    });
});


describe('$resolveOptions — 请求级/插件级合并', () => {
    it('请求级函数被调用解包', () => {
        const fnReq = (_c: any) => ({ predicate: ([, v]: any) => v === 'drop' });
        const out = $resolveOptions({ filter: fnReq } as any, {});
        expect(out.predicate(['k', 'drop'])).toBe(true);
        expect(out.predicate(['k', 'keep'])).toBe(false);
    });

    it('请求级对象覆盖插件级', () => {
        const pluginPred = () => false;
        const reqPred = () => true;
        const out = $resolveOptions({ filter: { predicate: reqPred } } as any, { predicate: pluginPred });
        expect(out.predicate).toBe(reqPred);
    });

    it('请求级缺失 → 用插件级；都缺 → defaultPredicate', () => {
        const pluginPred = () => true;
        expect($resolveOptions({ filter: true } as any, { predicate: pluginPred }).predicate).toBe(pluginPred);
        expect($resolveOptions({ filter: true } as any, {}).predicate).toBe(defaultPredicate);
    });

    it('ignoreKeys / ignoreValues 请求级优先回退插件级', () => {
        const out = $resolveOptions({ filter: { ignoreKeys: ['x'] } } as any, { ignoreValues: [0] });
        expect(out.ignoreKeys).toEqual(['x']);
        expect(out.ignoreValues).toEqual([0]);
    });
});


describe('normalize-request — 集成（拦截器 + runWhen）', () => {
    it('过滤 params 与 data，并 delete config.filter', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        normalizeRequest().install(ctx);
        const config: any = { url: '/x', filter: true, params: { a: 1, b: '' }, data: { c: null, d: 2 } };
        reqHandlers[0](config);
        expect(config.params).toEqual({ a: 1 });
        expect(config.data).toEqual({ d: 2 });
        expect(config.filter).toBeUndefined();
    });

    it('runWhen：enable:false → 恒不运行', () => {
        const { ctx, runWhens } = makeMockCtx();
        normalizeRequest({ enable: false }).install(ctx);
        expect(runWhens[0]({ filter: true })).toBe(false);
    });

    it('runWhen：config.filter 为假值 → 不运行', () => {
        const { ctx, runWhens } = makeMockCtx();
        normalizeRequest().install(ctx);
        expect(runWhens[0]({ filter: false })).toBe(false);
        expect(runWhens[0]({ filter: '' })).toBe(false);
        expect(runWhens[0]({ filter: true })).toBe(true);
        expect(runWhens[0]({ filter: { predicate: () => true } })).toBe(true);
    });
});
