import { describe, it, expect } from 'vitest';
import mock, {
    $shouldMock,
    $resolveMock,
    $rewriteUrl,
    $shouldFallback,
    type IMockOptions,
} from '../../src/plugins/mock';

describe('$shouldMock — runWhen 守卫', () => {
    const d: IMockOptions = { mock: false, mockUrl: 'http://m' };

    it('[mock.fn.$shouldMock][mock.req.mock] config.mock === true → true', () => {
        expect($shouldMock({ mock: true } as any, d)).toBe(true);
    });
    it('[mock.fn.$shouldMock][mock.req.mock] config.mock === false → false', () => {
        expect($shouldMock({ mock: false } as any, d)).toBe(false);
    });
    it('[mock.fn.$shouldMock][mock.req.mock] config.mock 对象含 mockUrl → true', () => {
        expect($shouldMock({ mock: { mockUrl: 'http://x' } } as any, d)).toBe(true);
    });
    it('[mock.fn.$shouldMock][mock.req.mock] config.mock 对象 mock=false → false', () => {
        expect($shouldMock({ mock: { mock: false, mockUrl: 'x' } } as any, d)).toBe(false);
    });
    it('[mock.fn.$shouldMock][mock.req.mock] config 未指定 → 插件级 mock 值', () => {
        expect($shouldMock({} as any, { mock: true })).toBe(true);
        expect($shouldMock({} as any, { mock: false })).toBe(false);
    });
});

describe('$resolveMock', () => {
    it('[mock.fn.$resolveMock][mock.req.mock][mock.opt.mockUrl] false → null', () => {
        expect($resolveMock({ mock: false } as any, { mockUrl: 'http://m' })).toBe(null);
    });
    it('[mock.fn.$resolveMock][mock.req.mock][mock.opt.mockUrl] true → 插件级 mockUrl', () => {
        expect($resolveMock({ mock: true } as any, { mockUrl: 'http://m' })).toEqual({ mockUrl: 'http://m' });
    });
    it('[mock.fn.$resolveMock][mock.req.mock][mock.opt.mockUrl] 对象 → 优先请求级 mockUrl', () => {
        expect($resolveMock({ mock: { mockUrl: 'http://x' } } as any, { mockUrl: 'http://m' }))
            .toEqual({ mockUrl: 'http://x' });
    });
    it('[mock.fn.$resolveMock][mock.req.mock][mock.opt.mockUrl] 对象 mock=false → null（即使有 mockUrl）', () => {
        expect($resolveMock({ mock: { mock: false, mockUrl: 'x' } } as any, { mockUrl: 'http://m' })).toBe(null);
    });
    it('[mock.fn.$resolveMock][mock.req.mock][mock.opt.mockUrl] 未指定 + 插件级 mock=true → 插件级', () => {
        expect($resolveMock({} as any, { mock: true, mockUrl: 'http://m' })).toEqual({ mockUrl: 'http://m' });
    });
    it('[mock.fn.$resolveMock][mock.req.mock][mock.opt.mockUrl] 未指定 + 插件级 mock=false → null', () => {
        expect($resolveMock({} as any, { mock: false, mockUrl: 'http://m' })).toBe(null);
    });
});

describe('$rewriteUrl', () => {
    it('[mock.fn.$rewriteUrl][mock.opt.mockUrl] 相对 url：拼接 mockUrl', () => {
        const cfg: any = { url: '/api/x' };
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.url).toBe('http://m/api/x');
    });

    it('[mock.fn.$rewriteUrl][mock.opt.mockUrl] 绝对 url：去掉原 origin，拼到 mockUrl', () => {
        const cfg: any = { url: 'https://prod.example.com/api/x?a=1' };
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.url).toBe('http://m/api/x?a=1');
    });

    it('[mock.fn.$rewriteUrl][mock.opt.mockUrl] url 未提供：改写 baseURL', () => {
        const cfg: any = {};
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.baseURL).toBe('http://m');
    });

    it('[mock.fn.$rewriteUrl][mock.opt.mockUrl] mockUrl 末尾 / 与 url 开头 / 不会重复', () => {
        const cfg: any = { url: '/api/x' };
        $rewriteUrl(cfg, 'http://m/');
        expect(cfg.url).toBe('http://m/api/x');
    });

    it('[mock.fn.$rewriteUrl][mock.opt.mockUrl] mockUrl 不带 / 也能正确拼接', () => {
        const cfg: any = { url: 'api/x' };
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.url).toBe('http://m/api/x');
    });

    it('[mock.fn.$rewriteUrl][mock.opt.mockUrl] 保留 query 与 hash', () => {
        const cfg: any = { url: 'https://e.com/p?q=1#h' };
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.url).toBe('http://m/p?q=1#h');
    });

    it('[mock.fn.$rewriteUrl][mock.opt.mockUrl] 解析失败的 url → 退化为简单拼接', () => {
        const cfg: any = { url: '://bad-url' };
        $rewriteUrl(cfg, 'http://m');
        expect(cfg.url).toBe('http://m/://bad-url');
    });
});

describe('$shouldFallback — 默认“mock 不存在”判定', () => {
    const httpErr = (status: number) => ({ response: { status }, isAxiosError: true });

    it('[mock.fn.$shouldFallback][mock.cb.fallbackWhen] error.response 为 403/500 → false（mock 存在，只是业务/服务端错误）', () => {
        expect($shouldFallback({ error: httpErr(403) })).toBe(false);
        expect($shouldFallback({ error: httpErr(500) })).toBe(false);
    });

    it('[mock.fn.$shouldFallback][mock.cb.fallbackWhen] error.response 为 404 → true；直接给 response 的 404 / 200 同理', () => {
        expect($shouldFallback({ error: httpErr(404) })).toBe(true);
        expect($shouldFallback({ response: { status: 404 } as any })).toBe(true);
        expect($shouldFallback({ response: { status: 200 } as any })).toBe(false);
    });

    it('[mock.fn.$shouldFallback][mock.cb.fallbackWhen] 无 response 的网络错误 → true（mock 不可达）', () => {
        expect($shouldFallback({ error: new Error('ECONNREFUSED') })).toBe(true);
    });

    it('[mock.fn.$shouldFallback][mock.cb.fallbackWhen] 取消 → false', () => {
        expect($shouldFallback({ error: { code: 'ERR_CANCELED' } })).toBe(false);
        expect($shouldFallback({ error: { name: 'CanceledError' } })).toBe(false);
    });
});

describe('mock: mockUrl redirect path', () => {
  it('[mock.fn.$shouldFallback][mock.cb.fallbackWhen] $shouldFallback: 404 or a non-cancel network error triggers fallback; a cancel or any other status does not', () => {
    expect($shouldFallback({ response: { status: 404 } as any })).toBe(true);
    expect($shouldFallback({ response: { status: 200 } as any })).toBe(false);
    expect($shouldFallback({ error: { code: 'ECONNREFUSED' } })).toBe(true);
    expect($shouldFallback({ error: { code: 'ERR_CANCELED' } })).toBe(false);
    expect($shouldFallback({})).toBe(false);
  });
});
