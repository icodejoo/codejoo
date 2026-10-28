import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import loading from '../../src/plugins/loading';
import { Axp } from '../../src/install';
import mock from '../../src/plugins/mock';
import { makeNetwork } from '../helpers/network';

// 来源 review 补丁
describe('loading 逻辑请求与清理', () => {
    const path = '/review-loading';

    it('[loading.fn.axpLoading × mock.opt.mock] mock 先卸载时 loading 保持生效，两者全卸载后不复活 mock', async () => {
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        const fn = vi.fn();
        const mockHandle = Axp.install(ax, { mock: mock({ enable: true, mock: true, mockUrl: 'http://mock' }) });
        const loadingHandle = Axp.install(ax, { loading: loading({ loading: fn }) });
        mockHandle.dispose();
        await ax.get(path);
        expect(fn.mock.calls.map(([value]) => value)).toEqual([true, false]);
        loadingHandle.dispose();
        await ax.get(path);
        expect(net.log.map((record) => record.url)).toEqual([path, path]);
        expect(ax.defaults.adapter).toBe(net.adapter);
    });
});

it('[loading.fn.axpLoading × mock.opt.mock] loading 先卸载时外层 mock 保持生效，两者全卸载后还原原 adapter', async () => {
    const path = '/review-mock';
    const net = makeNetwork();
    const ax = axios.create({ adapter: net.adapter });
    const loadingHandle = Axp.install(ax, { loading: loading({ loading: vi.fn() }) });
    const mockHandle = Axp.install(ax, { mock: mock({ enable: true, mock: true, mockUrl: 'http://mock' }) });
    loadingHandle.dispose();
    await ax.get(path);
    expect(net.log[0].url).toBe(`http://mock${path}`);
    mockHandle.dispose();
    expect(ax.defaults.adapter).toBe(net.adapter);
});
