import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import mock from '../../src/plugins/mock';

/** 构造指定状态和路径的 adapter 响应。 */
function response(config: any, status = 200) {
    return { status, statusText: '', headers: {}, config, data: config.url };
}

describe('mock — 回落决策与 adapter 配置隔离', () => {
    it('[mock.fn.axpMock][mock.cb.fallbackWhen] resolve 的 404 也回落真实请求，mock 探测关闭 cache/share，原请求保持选项', async () => {
        const adapter = vi.fn(async (c) => response(c, c.url.startsWith('/mock') ? 404 : 200));
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/mock' }).install(ax);
        expect((await ax.get('/real', { mock: true, cache: true, key: 'k', share: 'race' })).data).toBe('/real');
        expect(adapter.mock.calls[0][0]).toMatchObject({ url: '/mock/real', cache: false, share: false });
        expect(adapter.mock.calls[1][0]).toMatchObject({ url: '/real', cache: true, share: 'race' });
    });
    it('[mock.req.mock.fallbackWhen][mock.cb.fallbackWhen] 请求级 fallbackWhen 覆盖插件级判定', async () => {
        const global = vi.fn(() => false);
        const local = vi.fn(() => true);
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/mock', fallbackWhen: global }).install(ax);
        expect((await ax.get('/real', { mock: { fallbackWhen: local } })).data).toBe('/real');
        expect(global).not.toHaveBeenCalled();
        expect(local).toHaveBeenCalledOnce();
    });
});
