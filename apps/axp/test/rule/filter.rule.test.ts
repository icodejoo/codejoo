import { describe, it, expect } from 'vitest';
import filter from '../../src/plugins/filter';

function makeMockAxios() {
    const reqHandlers: Array<(config: any) => any> = [];
    const runWhens: Array<(config: any) => boolean> = [];
    const axios: any = {
        defaults: {},
        interceptors: {
            request: {
                use: (f: any, _r: any, opts: any) => {
                    reqHandlers.push(f);
                    if (opts?.runWhen) runWhens.push(opts.runWhen);
                    return reqHandlers.length - 1;
                },
                eject: () => { },
            },
        },
    };
    return { axios, reqHandlers, runWhens };
}

describe('filter — 集成（拦截器 + runWhen）', () => {
    it('[filter.fn.axpFilter][filter.req.filter] 过滤 params 与 data，并 delete config.filter', () => {
        const { axios, reqHandlers } = makeMockAxios();
        filter().install(axios);
        const config: any = { url: '/x', filter: true, params: { a: 1, b: '' }, data: { c: null, d: 2 } };
        reqHandlers[0](config);
        expect(config.params).toEqual({ a: 1 });
        expect(config.data).toEqual({ d: 2 });
        expect(config.filter).toBeUndefined();
    });

    it('[filter.opt.enable] runWhen：enable:false → 恒不运行', () => {
        const { axios, runWhens } = makeMockAxios();
        filter({ enable: false }).install(axios);
        expect(runWhens[0]({ filter: true })).toBe(false);
    });

    it('[filter.req.filter] runWhen：config.filter 为假值 → 不运行', () => {
        const { axios, runWhens } = makeMockAxios();
        filter().install(axios);
        expect(runWhens[0]({ filter: false })).toBe(false);
        expect(runWhens[0]({ filter: '' })).toBe(false);
        expect(runWhens[0]({ filter: true })).toBe(true);
        expect(runWhens[0]({ filter: { predicate: () => true } })).toBe(true);
    });
});

describe('filter — 函数形式解出 falsy / enable:false → 跳过过滤', () => {
    it('[filter.req.filter.callback] config.filter = () => false：不过滤 params/data，仍 delete config.filter', () => {
        const { axios, reqHandlers } = makeMockAxios();
        filter().install(axios);
        const config: any = { url: '/x', filter: () => false, params: { a: 1, b: '' }, data: { c: null } };
        reqHandlers[0](config);
        expect(config.params).toEqual({ a: 1, b: '' });
        expect(config.data).toEqual({ c: null });
        expect(config.filter).toBeUndefined();
    });

    it('[filter.req.filter.enable] config.filter = () => ({ enable:false })：同样跳过', () => {
        const { axios, reqHandlers } = makeMockAxios();
        filter().install(axios);
        const config: any = { url: '/x', filter: () => ({ enable: false }), params: { b: '' } };
        reqHandlers[0](config);
        expect(config.params).toEqual({ b: '' });
    });
});
