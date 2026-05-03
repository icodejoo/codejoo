// Integration coverage for the auth plugin.
//   - 受保护请求 ⇒ ready 钩子附加 Authorization
//   - 用 /echo 端点取回服务端实际看到的 headers，避免 axios 拦截器 LIFO 顺序问题

import axios from 'axios';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { authPlugin, normalizePlugin, type ITokenManager } from '../../src';
import { startHarness, stopHarness, type IntegrationHarness } from './_helpers';


function makeTokenManager(initial: string | undefined): ITokenManager {
    let access: string | undefined = initial;
    let refresh: string | undefined = 'refresh-1';
    return {
        get accessToken() { return access; },
        set accessToken(v) { access = v ?? undefined; },
        get refreshToken() { return refresh; },
        set refreshToken(v) { refresh = v ?? undefined; },
        canRefresh: true,
        set(a, r) { access = a; refresh = r; },
        clear() { access = undefined; refresh = undefined; },
        toHeaders() {
            return access ? { Authorization: access } : undefined;
        },
    };
}


describe('auth plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(() => {
        const names = h.api.plugins().map(p => p.name).reverse();
        for (const name of names) h.api.eject(name);
    });

    it('未装 normalize ⇒ install 抛错', () => {
        expect(() => h.api.use([authPlugin({
            tokenManager: makeTokenManager('x'),
            onRefresh: async () => true,
            onAccessExpired: async () => { },
        })])).toThrow(/requires "normalize"/);
    });

    it('受保护请求 + ready 钩子 ⇒ 服务端真实收到 Authorization 头', async () => {
        const tm = makeTokenManager('my-access-1');
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            authPlugin({
                tokenManager: tm,
                urlPattern: '*',
                ready: (tm, config) => {
                    config.headers!.Authorization = tm.accessToken!;
                },
                onRefresh: async () => true,
                onAccessExpired: async () => { },
            }),
        ]);

        const r = await h.ax.get('/echo');
        const headers = (r.data as any).data?.headers ?? {};
        expect(headers.authorization).toBe('my-access-1');
    });

    it('未受保护请求 ⇒ 服务端不收到 Authorization', async () => {
        const tm = makeTokenManager('access-x');
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            authPlugin({
                tokenManager: tm,
                urlPattern: [],
                ready: (tm, c) => { c.headers!.Authorization = tm.accessToken!; },
                onRefresh: async () => true,
                onAccessExpired: async () => { },
            }),
        ]);

        const r = await h.ax.get('/echo');
        const headers = (r.data as any).data?.headers ?? {};
        expect(headers.authorization).toBeUndefined();
    });

    it('受保护 + accessToken 缺失 ⇒ 触发 onAccessDenied + 归一化为失败响应', async () => {
        const tm = makeTokenManager(undefined);   // 显式 undefined
        let denied = 0;
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            authPlugin({
                tokenManager: tm,
                urlPattern: '*',
                onRefresh: async () => true,
                onAccessExpired: async () => { },
                onAccessDenied: async () => { denied++; },
            }),
        ]);

        // normalize 会把请求侧的 throw 归一化成 resolved ApiResponse —— 业务侧需要装 rethrow 才能拿到 reject。
        // 此处只验证 onAccessDenied 被调 + 响应 success=false。
        const r = await h.ax.get('/ok');
        expect((r.data as any).success).toBe(false);
        expect(denied).toBe(1);
    });

    it('urlPattern: string[] —— 不在白名单内的路径不带 token', async () => {
        const tm = makeTokenManager('tok-A');
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            authPlugin({
                tokenManager: tm,
                urlPattern: ['/secure/*', '!/secure/login'],
                ready: (tm, c) => { c.headers!.Authorization = tm.accessToken!; },
                onRefresh: async () => true,
                onAccessExpired: async () => { },
            }),
        ]);

        const r = await h.ax.get('/echo');
        const headers = (r.data as any).data?.headers ?? {};
        expect(headers.authorization).toBeUndefined();
    });

    it('单次 config.protected:true 覆盖插件级 urlPattern:[]', async () => {
        const tm = makeTokenManager('tok-B');
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            authPlugin({
                tokenManager: tm,
                urlPattern: [],
                ready: (tm, c) => { c.headers!.Authorization = tm.accessToken!; },
                onRefresh: async () => true,
                onAccessExpired: async () => { },
            }),
        ]);

        const r = await h.ax.get('/echo', { protected: true } as any);
        const headers = (r.data as any).data?.headers ?? {};
        expect(headers.authorization).toBe('tok-B');
    });
});


// 仅引用 axios 防止 tree-shake / unused-import 警告
void axios;
