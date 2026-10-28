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

/** 给请求加延迟（毫秒），配合 makeNetwork 制造乱序 */
const lat = (ms: number) => ({ latency: ms } as any);

describe('集成 — mock 插件「客户端回落」（404 → axios 层重发真实）', () => {
  it('[mock.fn.axpMock][mock.cb.fallbackWhen] mock 路径 404 → 插件在 axios 层改打真实路径并返回真实数据', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/mockbase/api/data', () => ({ status: 404 }));            // mock 不存在
    net.on('GET', '/api/data', () => ({ data: { code: 0, data: { real: true } } })); // 真实
    use(api, mock({ enable: true, mockUrl: '/mockbase' }));
    const r: any = await api.get('/api/data')(undefined, { mock: true, ...lat(5) });
    expect(r.real).toBe(true);
    expect(net.calls('GET', '/mockbase/api/data')).toBe(1);  // 先打 mock
    expect(net.calls('GET', '/api/data')).toBe(1);           // 404 后客户端回落真实
  });
});

/** 记录每次请求 url 的 adapter，用于判断走了 mock 还是真实。 */
function urlAdapter() {
    return vi.fn(async (c: any) => response(c));
}

describe('mock — 开关、请求级覆盖与卸载（真实 axios）', () => {
    it("[mock.prop.name] 插件实例 name 为 'axp:mock'", () => {
        expect(mock().name).toBe('axp:mock');
    });

    it('[mock.opt.enable] enable:true 时 mock:true 请求先打 mock；默认 enable:false 完全不介入', async () => {
        const on = urlAdapter();
        const axOn = axios.create({ adapter: on });
        mock({ enable: true, mockUrl: '/mock' }).install(axOn);
        await axOn.get('/a', { mock: true });
        expect(on.mock.calls[0][0].url).toBe('/mock/a');

        const off = urlAdapter();
        const axOff = axios.create({ adapter: off });
        mock({ mockUrl: '/mock' }).install(axOff);
        await axOff.get('/a', { mock: true });
        expect(off.mock.calls.map((c) => c[0].url)).toEqual(['/a']);
    });

    it('[mock.opt.mock] 插件级 mock:true 让无 config.mock 的请求也走 mock，请求级 mock:false 可退出', async () => {
        const adapter = urlAdapter();
        const ax = axios.create({ adapter });
        mock({ enable: true, mock: true, mockUrl: '/mock' }).install(ax);
        await ax.get('/a');
        await ax.get('/b', { mock: false });
        expect(adapter.mock.calls.map((c) => c[0].url)).toEqual(['/mock/a', '/b']);
    });

    it('[mock.req.mock.mock] 对象形式 mock:true 启用；mock:false 即使带 mockUrl 也走真实', async () => {
        const adapter = urlAdapter();
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/mock' }).install(ax);
        await ax.get('/a', { mock: { mock: true } });
        await ax.get('/b', { mock: { mock: false, mockUrl: '/other' } });
        expect(adapter.mock.calls.map((c) => c[0].url)).toEqual(['/mock/a', '/b']);
    });

    it('[mock.req.mock.mockUrl] 请求级 mockUrl 覆盖插件级 mockUrl', async () => {
        const adapter = urlAdapter();
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/global' }).install(ax);
        await ax.get('/a', { mock: { mockUrl: '/local' } });
        expect(adapter.mock.calls[0][0].url).toBe('/local/a');
    });

    it('[mock.method.install][mock.method.cleanup] install 包装 adapter，cleanup 后请求不再被 mock', async () => {
        const adapter = urlAdapter();
        const ax = axios.create({ adapter });
        const off = mock({ enable: true, mockUrl: '/mock' }).install(ax) as () => void;
        expect(ax.defaults.adapter).not.toBe(adapter);
        await ax.get('/a', { mock: true });
        off();
        await ax.get('/b', { mock: true });
        expect(adapter.mock.calls.map((c) => c[0].url)).toEqual(['/mock/a', '/b']);
    });
});
