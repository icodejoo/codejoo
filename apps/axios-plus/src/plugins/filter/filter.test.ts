import { describe, it, expect, vi } from 'vitest';
import filter, { $filter, $resolveOptions, defaultPredicate } from './filter';
import type { IFilterOptions } from './types';


function makeMockCtx() {
    const reqHandlers: Array<{ fn: (c: any) => any; opts?: any }> = [];
    const ctx: any = {
        axios: { defaults: { adapter: vi.fn() } },
        name: 'filter',
        logger: { log: () => { }, warn: () => { }, error: () => { } },
        request: (fn: any, _r: any, opts: any) => { reqHandlers.push({ fn, opts }); },
        response: () => { },
        adapter: () => { },
        transformRequest: () => { },
        transformResponse: () => { },
        cleanup: () => { },
        plugins: () => [],
    };
    return { ctx, reqHandlers };
}


/* ── defaultPredicate ──────────────────────────────────────────────── */

describe('defaultPredicate —— 默认丢弃规则', () => {
    it('null / undefined / NaN ⇒ drop', () => {
        expect(defaultPredicate(['k', null])).toBe(true);
        expect(defaultPredicate(['k', undefined])).toBe(true);
        expect(defaultPredicate(['k', NaN])).toBe(true);
    });
    it('空白字符串 ⇒ drop（trim 后为空）', () => {
        expect(defaultPredicate(['k', ''])).toBe(true);
        expect(defaultPredicate(['k', '   '])).toBe(true);
        expect(defaultPredicate(['k', '\t\n'])).toBe(true);
    });
    it('正常 primitive / 对象 ⇒ keep', () => {
        expect(defaultPredicate(['k', 'hi'])).toBe(false);
        expect(defaultPredicate(['k', 0])).toBe(false);
        expect(defaultPredicate(['k', false])).toBe(false);
        expect(defaultPredicate(['k', {}])).toBe(false);
    });
});


/* ── $filter ───────────────────────────────────────────────────────── */

describe('$filter —— 对象级过滤', () => {
    const opts = { predicate: defaultPredicate };

    it('丢掉 null / undefined / 空串', () => {
        const r = $filter({ a: 1, b: null, c: undefined, d: '   ', e: 'ok' }, opts);
        expect(r).toEqual({ a: 1, e: 'ok' });
    });

    it('ignoreKeys 命中 ⇒ 即使 value 为空也保留', () => {
        const r = $filter(
            { keep: null, drop: null, x: 1 },
            { ...opts, ignoreKeys: ['keep'] },
        );
        expect(r).toEqual({ keep: null, x: 1 });
    });

    it('ignoreValues 命中 ⇒ 该 value 永远保留（含 NaN 特例）', () => {
        const r = $filter(
            { a: NaN, b: 0, c: null, d: '' },
            { ...opts, ignoreValues: [NaN, 0] },
        );
        expect(r.a).toBeNaN();
        expect(r.b).toBe(0);
        expect(r).not.toHaveProperty('c');
        expect(r).not.toHaveProperty('d');
    });

    it('自定义 predicate ⇒ 接管"是否丢弃"判定', () => {
        // 丢掉所有 string，保留其他
        const r = $filter(
            { a: 'x', b: 1, c: 'y', d: null },
            { predicate: ([_k, v]) => typeof v === 'string' },
        );
        expect(r).toEqual({ b: 1, d: null });
    });

    it('deep:false（默认）⇒ 嵌套对象不递归', () => {
        const r = $filter(
            { x: { inner: null, ok: 1 } },
            { ...opts },
        );
        expect(r.x).toEqual({ inner: null, ok: 1 }); // 内部不动
    });

    it('deep:true ⇒ 嵌套对象递归过滤', () => {
        const r = $filter(
            { x: { inner: null, ok: 1 }, y: 'hi' },
            { ...opts, deep: true },
        );
        expect(r).toEqual({ x: { ok: 1 }, y: 'hi' });
    });

    it('deep:true ⇒ 数组里的对象也递归', () => {
        const r = $filter(
            { list: [{ a: null, b: 1 }, { c: '   ', d: 2 }] },
            { ...opts, deep: true },
        );
        expect(r.list).toEqual([{ b: 1 }, { d: 2 }]);
    });

    it('dropped 出参 ⇒ 收集被丢弃的 [key, value]', () => {
        const dropped: any[] = [];
        $filter({ a: null, b: 1, c: '' }, { ...opts }, dropped);
        expect(dropped).toEqual([['a', null], ['c', '']]);
    });
});


/* ── $resolveOptions ───────────────────────────────────────────────── */

describe('$resolveOptions —— 请求级 + 插件级合并', () => {
    const defaults: IFilterOptions = { ignoreKeys: ['preserve'], deep: false };

    it('config.filter 是对象 ⇒ 字段覆盖', () => {
        const o = $resolveOptions({ filter: { deep: true } } as any, defaults);
        expect(o.deep).toBe(true);
        expect(o.ignoreKeys).toEqual(['preserve']); // 缺失字段回退到 defaults
    });

    it('config.filter 是函数 ⇒ 调用后用其返回值', () => {
        const fn = vi.fn(() => ({ deep: true, ignoreKeys: ['x'] }));
        const o = $resolveOptions({ filter: fn } as any, defaults);
        expect(fn).toHaveBeenCalledOnce();
        expect(o.deep).toBe(true);
        expect(o.ignoreKeys).toEqual(['x']);
    });

    it('config.filter 不是对象 ⇒ 完全用 defaults', () => {
        const o = $resolveOptions({ filter: true } as any, defaults);
        expect(o.deep).toBe(false);
        expect(o.ignoreKeys).toEqual(['preserve']);
    });

    it('predicate 缺省 ⇒ defaultPredicate', () => {
        const o = $resolveOptions({ filter: true } as any, {});
        expect(o.predicate).toBe(defaultPredicate);
    });
});


/* ── install + runWhen ─────────────────────────────────────────────── */

describe('filter — install', () => {
    it('插件 enable:false ⇒ runWhen 永远 false（拦截器装但不跑）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        filter({ enable: false }).install(ctx);
        const opts = reqHandlers[0]?.opts;
        expect(opts?.runWhen?.({ filter: true })).toBe(false);
    });

    it('runWhen：config.filter 为 falsy ⇒ 跳过', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        filter().install(ctx);
        const { runWhen } = reqHandlers[0].opts!;
        expect(runWhen({ filter: false })).toBe(false);
        expect(runWhen({ filter: 0 })).toBe(false);
        expect(runWhen({ filter: '' })).toBe(false);
        expect(runWhen({ filter: '  ' })).toBe(false);
    });

    it('runWhen：config.filter 为 truthy ⇒ 进入', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        filter().install(ctx);
        const { runWhen } = reqHandlers[0].opts!;
        expect(runWhen({ filter: true })).toBe(true);
        expect(runWhen({ filter: {} })).toBe(true);
        expect(runWhen({ filter: () => true })).toBe(true);
    });

    it('拦截器 ⇒ 过滤 params + data，并 delete config.filter', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        filter().install(ctx);
        const config: any = {
            filter: true,
            params: { a: 1, b: null, c: '' },
            data: { x: undefined, y: 'ok' },
        };
        reqHandlers[0].fn(config);
        expect(config.params).toEqual({ a: 1 });
        expect(config.data).toEqual({ y: 'ok' });
        expect(config.filter).toBeUndefined();
    });

    it('isRetry(config) ⇒ 跳过过滤（首发已过滤过）', () => {
        const { ctx, reqHandlers } = makeMockCtx();
        filter().install(ctx);
        const config: any = {
            filter: true,
            __retry: 1, // RETRY_KEY
            params: { a: null }, // 应保持不动
        };
        reqHandlers[0].fn(config);
        expect(config.params).toEqual({ a: null });
    });
});
