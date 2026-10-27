import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import mock, { $shouldMock, $resolveMock, $rewriteUrl, $shouldFallback, type IMockOptions } from '../src/plugins/mock';
import { Axp } from '../src/install';
import retry from '../src/plugins/retry';
import { makeNetwork } from './helpers/network';
import loading from '../src/plugins/loading';

it('loading 先卸载时外层 mock 保持生效，两者全卸载后还原原 adapter', async () => {
    const path = '/review-mock';
    const net = makeNetwork();
    const ax = axios.create({ adapter: net.adapter });
    const loadingHandle = Axp.install(ax, { loading: loading({ loading: vi.fn() }) });
    const mockHandle = Axp.install(ax, { mock: mock({ enable: true, mock: true, mockUrl: 'http://mock' }) });
    loadingHandle.dispose();
    await ax.get(path);
    expect(net.log[0].url).toBe(`http://mock${path}`);
    mockHandle.dispose();
    expect(ax.defaults.adapter).toBe(net.adapter);
});

it('review #2 — retry 保留请求级 mock:false', async () => {
    const path = '/review-mock';
    const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit === 1 ? 500 : 200 }));
    const ax = axios.create({ adapter: net.adapter });
    Axp.install(ax, { retry: retry({ max: 1, delay: 0 }), mock: mock({ enable: true, mock: true, mockUrl: 'http://mock' }) });
    await ax.get(path, { mock: false });
    expect(net.log.map((record) => record.url)).toEqual([path, path]);
});


describe('$shouldMock — runWhen 守卫', () => {
    const d: IMockOptions = { mock: false, mockUrl: 'http://m' };

    it('config.mock === true → true', () => {
        expect($shouldMock({ mock: true } as any, d)).toBe(true);
    });
    it('config.mock === false → false', () => {
        expect($shouldMock({ mock: false } as any, d)).toBe(false);
    });
    it('config.mock 对象含 mockUrl → true', () => {
        expect($shouldMock({ mock: { mockUrl: 'http://x' } } as any, d)).toBe(true);
    });
    it('config.mock 对象 mock=false → false', () => {
        expect($shouldMock({ mock: { mock: false, mockUrl: 'x' } } as any, d)).toBe(false);
    });
    it('config 未指定 → 插件级 mock 值', () => {
        expect($shouldMock({} as any, { mock: true })).toBe(true);
        expect($shouldMock({} as any, { mock: false })).toBe(false);
    });
});


describe('$resolveMock', () => {
    it('false → null', () => {
        expect($resolveMock({ mock: false } as any, { mockUrl: 'http://m' })).toBe(null);
    });
    it('true → 插件级 mockUrl', () => {
        expect($resolveMock({ mock: true } as any, { mockUrl: 'http://m' })).toEqual({ mockUrl: 'http://m' });
    });
    it('对象 → 优先请求级 mockUrl', () => {
        expect($resolveMock({ mock: { mockUrl: 'http://x' } } as any, { mockUrl: 'http://m' }))
            .toEqual({ mockUrl: 'http://x' });
    });
    it('对象 mock=false → null（即使有 mockUrl）', () => {
        expect($resolveMock({ mock: { mock: false, mockUrl: 'x' } } as any, { mockUrl: 'http://m' })).toBe(null);
    });
    it('未指定 + 插件级 mock=true → 插件级', () => {
        expect($resolveMock({} as any, { mock: true, mockUrl: 'http://m' })).toEqual({ mockUrl: 'http://m' });
    });
    it('未指定 + 插件级 mock=false → null', () => {
        expect($resolveMock({} as any, { mock: false, mockUrl: 'http://m' })).toBe(null);
    });
});


describe('$rewriteUrl', () => {
    it('相对 url：拼接 mockUrl', () => {
        const cfg: any = { url: '/api/x' };
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.url).toBe('http://m/api/x');
    });

    it('绝对 url：去掉原 origin，拼到 mockUrl', () => {
        const cfg: any = { url: 'https://prod.example.com/api/x?a=1' };
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.url).toBe('http://m/api/x?a=1');
    });

    it('url 未提供：改写 baseURL', () => {
        const cfg: any = {};
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.baseURL).toBe('http://m');
    });

    it('mockUrl 末尾 / 与 url 开头 / 不会重复', () => {
        const cfg: any = { url: '/api/x' };
        $rewriteUrl(cfg, 'http://m/');
        expect(cfg.url).toBe('http://m/api/x');
    });

    it('mockUrl 不带 / 也能正确拼接', () => {
        const cfg: any = { url: 'api/x' };
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.url).toBe('http://m/api/x');
    });

    it('保留 query 与 hash', () => {
        const cfg: any = { url: 'https://e.com/p?q=1#h' };
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.url).toBe('http://m/p?q=1#h');
    });

    it('解析失败的 url → 退化为简单拼接', () => {
        const cfg: any = { url: '://bad-url' };
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.url).toBe('http://m/://bad-url');
    });
});


describe('$shouldFallback — 默认“mock 不存在”判定', () => {
    const httpErr = (status: number) => ({ response: { status }, isAxiosError: true });

    it('error.response 为 403/500 → false（mock 存在，只是业务/服务端错误）', () => {
        expect($shouldFallback({ error: httpErr(403) })).toBe(false);
        expect($shouldFallback({ error: httpErr(500) })).toBe(false);
    });

    it('error.response 为 404 → true；直接给 response 的 404 / 200 同理', () => {
        expect($shouldFallback({ error: httpErr(404) })).toBe(true);
        expect($shouldFallback({ response: { status: 404 } as any })).toBe(true);
        expect($shouldFallback({ response: { status: 200 } as any })).toBe(false);
    });

    it('无 response 的网络错误 → true（mock 不可达）', () => {
        expect($shouldFallback({ error: new Error('ECONNREFUSED') })).toBe(true);
    });

    it('取消 → false', () => {
        expect($shouldFallback({ error: { code: 'ERR_CANCELED' } })).toBe(false);
        expect($shouldFallback({ error: { name: 'CanceledError' } })).toBe(false);
    });
});


describe('mock — 裸 axios.create()（非函数 adapter）', () => {
    it('安装不崩；mock 返回 403 时不回落真实接口', async () => {
        const seen: string[] = [];
        const net = vi.fn(async (config: any) => {
            seen.push(config.url);
            const status = String(config.url).startsWith('http://m') ? 403 : 200;
            const resp = { status, statusText: '', headers: {}, config, data: 'x' };
            if (status >= 400) throw Object.assign(new Error('forbidden'), { response: resp, config, isAxiosError: true });
            return resp as any;
        });
        const ax = axios.create({ adapter: [net as any] });
        mock({ enable: true, mockUrl: 'http://m' }).install(ax);
        await expect(ax.get('/api', { mock: true })).rejects.toThrow('forbidden');
        expect(seen).toEqual(['http://m/api']);
    });
});
