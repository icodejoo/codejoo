import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import share, { $resolvePolicy, $rebindResponse } from '../../../src/plugins/share';
import { makeNetwork } from '../../helpers/network';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('share — 策略输入边界', () => {
    it.each([{}, { policy: undefined }, { policy: null }, { policy: '' }, { policy: 'START' }, { policy: 0 }])(
        '[share.req.share.policy] 对象策略为空或非法时回退插件策略：%j', (value) => {
            expect($resolvePolicy({ share: value } as any, { policy: 'end' })).toBe('end');
        },
    );

    it('[share.opt.enable] 插件关闭时请求级策略不能开启共享，也不会调用动态策略', async () => {
        vi.useFakeTimers();
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        const before = ax.defaults.adapter;
        expect(share({ enable: false }).install(ax)).toBeUndefined();
        const policy = vi.fn(() => 'start' as const);
        const pending = Promise.all([ax.get('/x', { key: 'k', share: policy }), ax.get('/x', { key: 'k', share: policy })]);
        await vi.runAllTimersAsync();
        expect((await pending).map((r) => r.status)).toEqual([200, 200]);
        expect(net.calls('GET', '/x')).toBe(2);
        expect(policy).not.toHaveBeenCalled();
        expect(ax.defaults.adapter).toBe(before);
    });

    it('[share.req.share.callback] 动态策略抛错不残留共享轮次，下一次同 key 可正常发送', async () => {
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        share().install(ax);
        const error = new Error('策略失败');
        await expect(ax.get('/x', { key: 'k', share: () => { throw error; } })).rejects.toBe(error);
        expect(net.calls('GET', '/x')).toBe(0);
        expect((await ax.get('/x', { key: 'k' })).status).toBe(200);
        expect(net.calls('GET', '/x')).toBe(1);
    });
});

describe('share — 响应外壳与清理边界', () => {
    it('[share.fn.$rebindResponse] 冻结响应仍能重绑，保留原始响应和共享 data', () => {
        const originalConfig = {} as any;
        const data = Object.freeze({ value: 1 });
        const response = Object.freeze({ config: originalConfig, data, status: 200, statusText: 'OK', headers: {} });
        const config = {};
        const copy = $rebindResponse(response, config);
        expect(copy).not.toBe(response);
        expect(copy.config).toBe(config);
        expect(copy.data).toBe(data);
        expect(copy.status).toBe(200);
        expect(response.config).toBe(originalConfig);
    });

    it('[share.method.install][share.method.cleanup] 重复安装后逆序之外也可独立卸载，重复清理不影响剩余层', async () => {
        vi.useFakeTimers();
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        const before = ax.defaults.adapter;
        const plugin = share();
        const first = plugin.install(ax);
        const second = plugin.install(ax);
        first?.();
        first?.();
        const shared = Promise.all([ax.get('/x', { key: 'k' }), ax.get('/x', { key: 'k' })]);
        await vi.runAllTimersAsync();
        expect((await shared).map((r) => r.status)).toEqual([200, 200]);
        expect(net.calls('GET', '/x')).toBe(1);
        second?.();
        second?.();
        expect(ax.defaults.adapter).toBe(before);
        const independent = Promise.all([ax.get('/x', { key: 'k' }), ax.get('/x', { key: 'k' })]);
        await vi.runAllTimersAsync();
        expect((await independent).map((r) => r.status)).toEqual([200, 200]);
        expect(net.calls('GET', '/x')).toBe(3);
        expect(vi.getTimerCount()).toBe(0);
    });
});
