import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { create } from '../../core';
import ApiResponse from '../../objects/ApiResponse';
import normalize from '../normalize';
import notification, { $lookup, $resolve } from './notification';
import type { INotificationMessages, INotifyResolveCtx, TNotifyFn } from './types';


function mkResp(status: number, code: string | number, message: string | null = null, data: unknown = null, success = false): any {
    const apiResp = new ApiResponse(status, code, message, data, success);
    return { status, config: {}, data: apiResp, headers: {}, statusText: '' };
}


// ───────────────────────────────────────────────────────────────────────────
//  $lookup —— code → status → default
// ───────────────────────────────────────────────────────────────────────────

describe('notification — $lookup', () => {
    it('code lookup → string', () => {
        const resp = mkResp(200, 'BIZ_ERR');
        expect($lookup(resp.data, resp, { BIZ_ERR: 'biz!' })).toBe('biz!');
    });

    it('code lookup → function called with (apiResp, response)', () => {
        const resp = mkResp(200, 'X');
        const fn = vi.fn(() => 'dynamic');
        const messages: INotificationMessages = { X: fn };
        $lookup(resp.data, resp, messages);
        expect(fn).toHaveBeenCalledWith(resp.data, resp);
    });

    it('code miss → status hit', () => {
        const resp = mkResp(404, 'UNKNOWN');
        expect($lookup(resp.data, resp, { 404: 'not found' } as any)).toBe('not found');
    });

    it('all miss → default', () => {
        const resp = mkResp(0, 'NEVER');
        expect($lookup(resp.data, resp, { default: 'oops' })).toBe('oops');
    });

    it('returns null when nothing matches', () => {
        const resp = mkResp(0, 'NEVER');
        expect($lookup(resp.data, resp, {})).toBeNull();
    });

    it('empty string from function returns null', () => {
        const resp = mkResp(200, 'X');
        expect($lookup(resp.data, resp, { X: () => '' })).toBeNull();
    });

    it('null/undefined from function returns null', () => {
        const resp = mkResp(200, 'X');
        expect($lookup(resp.data, resp, { X: () => null })).toBeNull();
        expect($lookup(resp.data, resp, { X: () => undefined })).toBeNull();
    });

    it('numeric code coerced to string', () => {
        const resp = mkResp(200, 1001);
        expect($lookup(resp.data, resp, { 1001: 'numeric' } as any)).toBe('numeric');
    });

    it('status=0 (no HTTP) skips status lookup, falls to default', () => {
        const resp = mkResp(0, 'NEVER');
        expect($lookup(resp.data, resp, { 0: 'never', default: 'oops' } as any)).toBe('oops');
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $resolve —— config.notify 优先 + MaybeFun
// ───────────────────────────────────────────────────────────────────────────

describe('notification — $resolve', () => {
    const pluginNotify: TNotifyFn = vi.fn();

    it('null callback → null', () => {
        const resp = mkResp(200, 'BIZ');
        expect($resolve({}, resp.data, resp, { default: 'x' }, undefined)).toBeNull();
    });

    it('config.notify === null → null', () => {
        const resp = mkResp(200, 'BIZ');
        expect($resolve({ notify: null }, resp.data, resp, { default: 'x' }, pluginNotify)).toBeNull();
    });

    it('config.notify === "" → null', () => {
        const resp = mkResp(200, 'BIZ');
        expect($resolve({ notify: '' }, resp.data, resp, { default: 'x' }, pluginNotify)).toBeNull();
    });

    it('config.notify === "   " → null', () => {
        const resp = mkResp(200, 'BIZ');
        expect($resolve({ notify: '   ' }, resp.data, resp, { default: 'x' }, pluginNotify)).toBeNull();
    });

    it('config.notify === non-empty string bypasses table', () => {
        const resp = mkResp(500, 'X');
        const r = $resolve(
            { notify: 'override' },
            resp.data, resp,
            { X: 'from table', default: 'fallback' },
            pluginNotify,
        );
        expect(r).toEqual({ message: 'override', notify: pluginNotify });
    });

    it('config.notify trimmed', () => {
        const resp = mkResp(0, 'X');
        const r = $resolve({ notify: '  msg  ' }, resp.data, resp, {}, pluginNotify);
        expect(r).toEqual({ message: 'msg', notify: pluginNotify });
    });

    it('config.notify === undefined → fall through to table', () => {
        const resp = mkResp(0, 'X');
        const r = $resolve({}, resp.data, resp, { default: 'tbl' }, pluginNotify);
        expect(r?.message).toBe('tbl');
    });

    it('MaybeFun: function form receives INotifyResolveCtx', () => {
        let captured: INotifyResolveCtx | undefined;
        const cfgFn = (ctx: INotifyResolveCtx) => { captured = ctx; return 'dyn'; };
        const config = { notify: cfgFn, url: '/x' } as any;
        const resp = mkResp(200, 'X');
        const messages: INotificationMessages = { X: 'biz' };
        const r = $resolve(config, resp.data, resp, messages, pluginNotify);
        expect(r).toEqual({ message: 'dyn', notify: pluginNotify });
        expect(captured?.apiResp).toBe(resp.data);
        expect(captured?.response).toBe(resp);
        expect(captured?.config).toBe(config);
        expect(captured?.messages).toBe(messages);
        expect(typeof captured?.lookup).toBe('function');
    });

    it('MaybeFun: lookup() inside ctx delegates to default flow', () => {
        const config = {
            notify: ({ lookup }: INotifyResolveCtx) => lookup(),
        } as any;
        const resp = mkResp(500, 'X');
        const r = $resolve(config, resp.data, resp, { X: 'from table' }, pluginNotify);
        expect(r?.message).toBe('from table');
    });

    it('MaybeFun returns null → silent', () => {
        const resp = mkResp(0, 'X');
        const r = $resolve(
            { notify: () => null },
            resp.data, resp,
            { default: 'tbl' }, pluginNotify,
        );
        expect(r).toBeNull();
    });

    it('MaybeFun returns undefined → fall through to table', () => {
        const resp = mkResp(0, 'X');
        const r = $resolve(
            { notify: () => undefined },
            resp.data, resp,
            { default: 'tbl' }, pluginNotify,
        );
        expect(r?.message).toBe('tbl');
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  Plugin install
// ───────────────────────────────────────────────────────────────────────────

describe('notification — install', () => {
    it('throws when notification is the first plugin (normalize must be first)', () => {
        const ax = axios.create();
        const api = create(ax);
        expect(() => api.use(notification({ notify: () => undefined })))
            .toThrow(/requires "normalize"/);
    });

    it('does not register interceptor when enable:false (after passing dep check)', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), notification({ enable: false, notify: () => undefined })]);
        const snap = api.plugins().find(p => p.name === 'notification');
        expect(snap?.responseInterceptors).toBe(0);
    });

    it('registers one onFulfilled interceptor when enabled', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), notification({ notify: () => undefined })]);
        const snap = api.plugins().find(p => p.name === 'notification');
        expect(snap?.responseInterceptors).toBe(1);
    });

    it('eject removes the interceptor', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), notification({ notify: () => undefined })]);
        api.eject('notification');
        expect(api.plugins().find(p => p.name === 'notification')).toBeUndefined();
    });
});
