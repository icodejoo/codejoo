import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { create } from '../../core';
import ApiResponse from '../../objects/ApiResponse';
import normalize from '../normalize';
import rethrow, { $shouldReject } from './rethrow';
import type { IResolvedRethrow } from './rethrow';


function mkResp(status: number, code: string | number, data: unknown = null, success = false, config: any = {}): { apiResp: ApiResponse; response: any; config: any } {
    // ApiResponse 构造: (status, code, data, message, success)
    const apiResp = new ApiResponse(status, code, data, null, success);
    return {
        apiResp,
        response: { status, config, data: apiResp, headers: {}, statusText: '' },
        config,
    };
}

const baseOpts: IResolvedRethrow = { enable: true };


// ───────────────────────────────────────────────────────────────────────────
//  $shouldReject —— 核心契约：success===true 永远 resolve，配置不可破
// ───────────────────────────────────────────────────────────────────────────

describe('rethrow — core contract: success===true always resolves', () => {
    it('success=true with non-null data → false (resolve)', () => {
        const r = mkResp(200, '0000', { x: 1 }, true);
        expect($shouldReject(r.apiResp, r.response, r.config, baseOpts)).toBe(false);
    });

    it('success=true with null data → false (resolve) — 不再因 null data 而 reject', () => {
        const r = mkResp(200, '0000', null, true);
        expect($shouldReject(r.apiResp, r.response, r.config, baseOpts)).toBe(false);
    });

    it('success=true with undefined data → false (resolve)', () => {
        const r = mkResp(200, '0000', undefined, true);
        expect($shouldReject(r.apiResp, r.response, r.config, baseOpts)).toBe(false);
    });

    it('success=true + shouldRethrow returning true → 仍 resolve（契约不可破）', () => {
        const r = mkResp(200, '0000', { x: 1 }, true);
        const opts: IResolvedRethrow = { ...baseOpts, shouldRethrow: () => true };
        expect($shouldReject(r.apiResp, r.response, r.config, opts)).toBe(false);
    });

    it('success=true + config.rethrow=false → resolve（与默认相同）', () => {
        const r = mkResp(200, '0000', { x: 1 }, true, { rethrow: false });
        expect($shouldReject(r.apiResp, r.response, r.config, baseOpts)).toBe(false);
    });

    it('success=true + config.rethrow=true → 仍 resolve（不允许强制 reject 成功响应）', () => {
        const r = mkResp(200, '0000', { x: 1 }, true, { rethrow: true });
        expect($shouldReject(r.apiResp, r.response, r.config, baseOpts)).toBe(false);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $shouldReject —— success=false 路径：默认 reject，可由 rethrow:false / shouldRethrow 豁免
// ───────────────────────────────────────────────────────────────────────────

describe('rethrow — failure path', () => {
    it('success=false → true (reject) by default', () => {
        const r = mkResp(500, 'HTTP_ERR', null, false);
        expect($shouldReject(r.apiResp, r.response, r.config, baseOpts)).toBe(true);
    });

    it('success=false + config.rethrow=false → false (resolve, 单次豁免)', () => {
        const r = mkResp(500, 'HTTP_ERR', null, false, { rethrow: false });
        expect($shouldReject(r.apiResp, r.response, r.config, baseOpts)).toBe(false);
    });

    it('success=false + config.rethrow=true → true (reject, 与默认相同)', () => {
        const r = mkResp(500, 'HTTP_ERR', null, false, { rethrow: true });
        expect($shouldReject(r.apiResp, r.response, r.config, baseOpts)).toBe(true);
    });

    it('config.rethrow MaybeFun: 函数返回 false → resolve', () => {
        const fn = vi.fn(() => false);
        const r = mkResp(500, 'X', null, false, { rethrow: fn, url: '/x' });
        expect($shouldReject(r.apiResp, r.response, r.config, baseOpts)).toBe(false);
        expect(fn).toHaveBeenCalledWith(r.config);
    });

    it('shouldRethrow returning false → resolve（自定义豁免，如 CANCEL 不当错）', () => {
        const r = mkResp(0, 'CANCEL', null, false);
        const opts: IResolvedRethrow = {
            ...baseOpts,
            shouldRethrow: (a) => a.code === 'CANCEL' ? false : null,
        };
        expect($shouldReject(r.apiResp, r.response, r.config, opts)).toBe(false);
    });

    it('shouldRethrow returning true → reject（默认就是 reject，等价默认）', () => {
        const r = mkResp(500, 'X', null, false);
        const opts: IResolvedRethrow = { ...baseOpts, shouldRethrow: () => true };
        expect($shouldReject(r.apiResp, r.response, r.config, opts)).toBe(true);
    });

    it('shouldRethrow returning null/undefined → fall through to default reject', () => {
        const r = mkResp(500, 'X', null, false);
        const opts: IResolvedRethrow = { ...baseOpts, shouldRethrow: () => null };
        expect($shouldReject(r.apiResp, r.response, r.config, opts)).toBe(true);
    });

    it('config.rethrow=false 优先于 shouldRethrow（请求级豁免最高）', () => {
        const r = mkResp(500, 'X', null, false, { rethrow: false });
        const opts: IResolvedRethrow = { ...baseOpts, shouldRethrow: () => true };
        expect($shouldReject(r.apiResp, r.response, r.config, opts)).toBe(false);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  Plugin install
// ───────────────────────────────────────────────────────────────────────────

describe('rethrow — install', () => {
    it('throws when normalize not installed first', () => {
        const ax = axios.create();
        const api = create(ax);
        expect(() => api.use(rethrow())).toThrow(/requires "normalize"/);
    });

    it('does not register when enable:false', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), rethrow({ enable: false })]);
        const snap = api.plugins().find(p => p.name === 'rethrow');
        expect(snap?.responseInterceptors).toBe(0);
    });

    it('registers one response interceptor when enabled', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), rethrow()]);
        const snap = api.plugins().find(p => p.name === 'rethrow');
        expect(snap?.responseInterceptors).toBe(1);
    });

    it('eject removes the interceptor', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), rethrow()]);
        api.eject('rethrow');
        expect(api.plugins().find(p => p.name === 'rethrow')).toBeUndefined();
    });
});
