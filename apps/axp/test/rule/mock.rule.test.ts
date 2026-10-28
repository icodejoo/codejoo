import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import mock from '../../src/plugins/mock';
import { Axp } from '../../src';
import { makeNetwork } from '../helpers/network';
import { use } from '../helpers/install';

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

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('mock: mockUrl redirect path', () => {
  it('[mock.opt.mockUrl][mock.cb.fallbackWhen] a successful mock-server response is returned directly, and a fallback-triggering one instead falls back to the real API', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/mockbase/data', () => ({ data: { code: 0, data: { v: 'mocked' } } }));
    net.on('GET', '/data', () => ({ data: { code: 0, data: { v: 'real' } } }));
    use(api, [mock({ enable: true, mockUrl: '/mockbase' })]);

    const r1: any = await api.axios.get('/data', { mock: true } as any);
    expect(r1.data.data.v).toBe('mocked');

    const { net: net2, api: api2 } = mkApi();
    net2.on('GET', '/mockbase/data', () => ({ data: { code: 0, data: { v: 'mocked' } } }));
    net2.on('GET', '/data', () => ({ data: { code: 0, data: { v: 'real' } } }));
    use(api2, [mock({ enable: true, mockUrl: '/mockbase', fallbackWhen: () => true })]);
    const r2: any = await api2.axios.get('/data', { mock: true } as any);
    expect(r2.data.data.v).toBe('real');
  });

  it('[mock.cb.fallbackWhen][mock.opt.mockUrl] a mock server that errors outright falls back to the real API when fallbackWhen says so, and rejects otherwise', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/data', () => ({ data: { code: 0, data: { v: 'real' } } }));
    net.on('GET', '/deadmock/data', () => { throw new Error('ECONNREFUSED'); });
    use(api, [mock({ enable: true, mockUrl: '/deadmock', fallbackWhen: () => true })]);
    const r1: any = await api.axios.get('/data', { mock: true } as any);
    expect(r1.data.data.v).toBe('real');

    const { net: net2, api: api2 } = mkApi();
    net2.on('GET', '/deadmock/data', () => { throw new Error('ECONNREFUSED'); });
    use(api2, [mock({ enable: true, mockUrl: '/deadmock', fallbackWhen: () => false })]);
    await expect(api2.axios.get('/data', { mock: true } as any)).rejects.toBeTruthy();
  });
});
