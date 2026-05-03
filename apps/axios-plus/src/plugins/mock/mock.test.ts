import { describe, it, expect } from 'vitest';
import { $shouldMock, $resolveMock, $rewriteUrl } from './mock';
import type { IMockOptions } from './types';


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
