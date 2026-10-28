import { describe, it, expect } from 'vitest';
import mock, {
    $resolveMock,
    $rewriteUrl,
    $shouldFallback,
} from '../../src/plugins/mock';

describe('$resolveMock', () => {
    it.each([
        [{ mock: true }, { mock: false, mockUrl: 'http://m' }, { mockUrl: 'http://m' }],
        [{ mock: false }, { mock: false, mockUrl: 'http://m' }, null],
        [{ mock: { mockUrl: 'http://x' } }, { mock: false, mockUrl: 'http://m' }, { mockUrl: 'http://x' }],
        [{ mock: { mock: false, mockUrl: 'x' } }, { mock: false, mockUrl: 'http://m' }, null],
        [{}, { mock: true }, {}],
        [{}, { mock: false }, null],
        [{ mock: {} }, { mock: false, mockUrl: 'http://m' }, { mockUrl: 'http://m' }],
    ] as const)('[mock.fn.$resolveMock][mock.req.mock] 请求 %j 与默认 %j → %j', (config, defaults, expected) => {
        expect($resolveMock(config as any, defaults)).toEqual(expected);
    });
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
