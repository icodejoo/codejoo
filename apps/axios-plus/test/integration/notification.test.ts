// Integration coverage for the notification plugin.
//   - notification 在 response 阶段读 ApiResponse，决定是否调 notify(message, ctx)
//   - 必须先装 normalize（requirePlugin 强校验）
//   - messages 是 code/status → message 的查找表，default 兜底

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { INotifyHookCtx } from '../../src';
import { normalizePlugin, notificationPlugin } from '../../src';
import { startHarness, stopHarness, type IntegrationHarness } from './_helpers';

describe('notification plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(() => {
        const names = h.api.plugins().map(p => p.name).reverse();
        for (const name of names) h.api.eject(name);
    });

    it('未装 normalize ⇒ install 抛错', () => {
        expect(() =>
            h.api.use([notificationPlugin({ notify: () => { } })]),
        ).toThrow(/requires "normalize"/);
    });

    it('成功响应 ⇒ 默认不通知（success 跳过）', () => {
        const calls: Array<{ msg: string; success: boolean; code: any }> = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            notificationPlugin({
                notify: (msg, ctx: INotifyHookCtx) => {
                    calls.push({ msg, success: ctx.apiResp.success, code: ctx.apiResp.code });
                },
                messages: {
                    '0000': 'success!',
                    default: 'oops',
                },
            }),
        ]);

        return h.ax.get('/pet/42').then(() => {
            // 默认 success 路径不弹通知
            expect(calls).toEqual([]);
        });
    });

    it('业务失败 ⇒ messages 按 code 查找', () => {
        const calls: string[] = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            notificationPlugin({
                notify: (msg) => calls.push(msg),
                messages: {
                    BIZ_ERR: '业务异常',
                    default: '其他错',
                },
            }),
        ]);

        return h.ax.get('/flaky/biz-error').then(() => {
            expect(calls).toContain('业务异常');
        });
    });

    it('请求级 notify:false / 空字符串 ⇒ 跳过', () => {
        const calls: string[] = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            notificationPlugin({
                notify: (msg) => calls.push(msg),
                messages: { default: 'fail' },
            }),
        ]);

        return h.ax.get('/flaky/biz-error', { notify: '' } as any).then(() => {
            expect(calls).toEqual([]);
        });
    });

    it('请求级 notify 字符串 ⇒ 直接用，跳过 messages 查找', () => {
        const calls: string[] = [];
        h.api.use([
            normalizePlugin({ success: (a: any) => a.code === '0000' }),
            notificationPlugin({
                notify: (msg) => calls.push(msg),
                messages: { default: 'plugin-default' },
            }),
        ]);

        return h.ax.get('/flaky/biz-error', { notify: 'custom-msg' } as any).then(() => {
            expect(calls).toContain('custom-msg');
            expect(calls).not.toContain('plugin-default');
        });
    });
});
