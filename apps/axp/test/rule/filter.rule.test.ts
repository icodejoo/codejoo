import { describe, it, expect } from 'vitest';
import filter from '../../src/plugins/filter';
import axios from 'axios';
import { Axp } from '../../src';
import { makeNetwork } from '../helpers/network';
import { use } from '../helpers/install';

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

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('filter', () => {
  it('[filter.fn.axpFilter][filter.fn.defaultPredicate][filter.req.filter] the default predicate drops empty/whitespace-only strings, null and NaN, and filters both params and data the same way', async () => {
    const { net, api } = mkApi();
    let seenParams: any;
    let seenData: any;
    net.on('GET', '/data', (config) => { seenParams = config.params; return { data: { code: 0, data: null } }; });
    net.on('POST', '/data', (config) => { seenData = config.data; return { data: { code: 0, data: null } }; });
    use(api, [filter()]);

    await api.axios.get('/data', { params: { keep: 'x', blank: '   ', empty: '' }, filter: true } as any);
    expect(seenParams).toEqual({ keep: 'x' });

    await api.axios.post('/data', { keep: 1, dropMe: null, blank: '  ' }, { filter: true } as any);
    // axios's default transformRequest JSON.stringifies the body between
    // filter's request interceptor and the adapter — the mock route
    // handler sees the post-transform string, not the live object.
    expect(JSON.parse(seenData)).toEqual({ keep: 1 });
  });

  it('[filter.req.filter] without config.filter:true, filter is a no-op (per-request opt-in, unlike Dio\'s always-on DiomanFilter)', async () => {
    const { net, api } = mkApi();
    let seenParams: any;
    net.on('GET', '/data', (config) => { seenParams = config.params; return { data: { code: 0, data: null } }; });
    use(api, [filter()]);

    await api.axios.get('/data', { params: { blank: '' } });
    expect(seenParams).toEqual({ blank: '' });
  });
});
