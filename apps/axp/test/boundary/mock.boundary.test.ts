import { describe, it, expect, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import mock from '../../src/plugins/mock';

/** 构造指定状态和路径的 adapter 响应。 */
function response(config: any, status = 200) {
    return { status, statusText: '', headers: {}, config, data: config.url };
}

describe('mock — 裸 axios.create()（非函数 adapter）', () => {
    it('[mock.fn.axpMock] 安装不崩；mock 返回 403 时不回落真实接口', async () => {
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

describe('mock — 回落决策与 adapter 配置隔离', () => {
    it('[mock.opt.mockUrl] 缺少 mockUrl 直接发送真实请求并经自定义 sink 记录警告', async () => {
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        mock({ enable: true }).install(ax);
        await ax.get('/real', { mock: true, debug: true, logger: sink });
        expect(adapter).toHaveBeenCalledOnce();
        expect(adapter.mock.calls[0][0].url).toBe('/real');
        expect(sink.warn).toHaveBeenCalledOnce();
    });
    it('[mock.fn.axpMock] 真实回落失败保留真实错误，不再重复回落', async () => {
        const first = new AxiosError('mock offline');
        const last = new Error('real offline');
        const adapter = vi.fn().mockRejectedValueOnce(first).mockRejectedValue(last);
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/mock' }).install(ax);
        await expect(ax.get('/real', { mock: true })).rejects.toBe(last);
        expect(adapter).toHaveBeenCalledTimes(2);
    });
    it('[mock.cb.fallbackWhen][mock.method.cleanup] 自定义判定抛错会拒绝，不发送真实回落；卸载后保持原 adapter', async () => {
        const error = new Error('decide');
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        const off = mock({ enable: true, mockUrl: '/mock', fallbackWhen: () => { throw error; } }).install(ax);
        await expect(ax.get('/real', { mock: true })).rejects.toBe(error);
        expect(adapter).toHaveBeenCalledOnce();
        off?.();
        expect(ax.defaults.adapter).toBe(adapter);
    });
});
