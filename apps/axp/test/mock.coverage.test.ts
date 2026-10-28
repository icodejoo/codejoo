import { describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import mock from '../src/plugins/mock';

/** 构造指定状态和路径的 adapter 响应。 */
function response(config: any, status = 200) {
    return { status, statusText: '', headers: {}, config, data: config.url };
}

describe('mock — 回落决策与 adapter 配置隔离', () => {
    it('resolve 的 404 也回落真实请求，mock 探测关闭 cache/share，原请求保持选项', async () => {
        const adapter = vi.fn(async (c) => response(c, c.url.startsWith('/mock') ? 404 : 200));
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/mock' }).install(ax);
        expect((await ax.get('/real', { mock: true, cache: true, key: 'k', share: 'race' })).data).toBe('/real');
        expect(adapter.mock.calls[0][0]).toMatchObject({ url: '/mock/real', cache: false, share: false });
        expect(adapter.mock.calls[1][0]).toMatchObject({ url: '/real', cache: true, share: 'race' });
    });
    it('请求级 fallbackWhen 覆盖插件级判定', async () => {
        const global = vi.fn(() => false);
        const local = vi.fn(() => true);
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/mock', fallbackWhen: global }).install(ax);
        expect((await ax.get('/real', { mock: { fallbackWhen: local } })).data).toBe('/real');
        expect(global).not.toHaveBeenCalled();
        expect(local).toHaveBeenCalledOnce();
    });
    it('缺少 mockUrl 直接发送真实请求并经自定义 sink 记录警告', async () => {
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        mock({ enable: true }).install(ax);
        await ax.get('/real', { mock: true, debug: true, logger: sink });
        expect(adapter).toHaveBeenCalledOnce();
        expect(adapter.mock.calls[0][0].url).toBe('/real');
        expect(sink.warn).toHaveBeenCalledOnce();
    });
    it('真实回落失败保留真实错误，不再重复回落', async () => {
        const first = new AxiosError('mock offline');
        const last = new Error('real offline');
        const adapter = vi.fn().mockRejectedValueOnce(first).mockRejectedValue(last);
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/mock' }).install(ax);
        await expect(ax.get('/real', { mock: true })).rejects.toBe(last);
        expect(adapter).toHaveBeenCalledTimes(2);
    });
    it('自定义判定抛错会拒绝，不发送真实回落；卸载后保持原 adapter', async () => {
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
