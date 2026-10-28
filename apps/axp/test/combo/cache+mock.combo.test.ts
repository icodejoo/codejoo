import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { Axp } from '../../src';
import cache from '../../src/plugins/cache';
import mock from '../../src/plugins/mock';
import { makeNetwork } from '../helpers/network';

describe('mock 探测不进缓存', () => {
  const path = '/cm';
  const mockPath = `http://mock${path}`;
  const setup = (net: ReturnType<typeof makeNetwork>) => {
    const ax = axios.create({ adapter: net.adapter });
    Axp.install(ax, { cache: cache(), mock: mock({ enable: true, mock: true, mockUrl: 'http://mock' }) });
    return ax;
  };
  const opt = { key: 'k', cache: true } as any;

  it('[mock.req.mock × cache.req.cache] 同 key 两次 mock 成功：探测各发一次，响应不写入缓存', async () => {
    const net = makeNetwork().on('GET', mockPath, () => ({ status: 200, data: 'mocked' }));
    const ax = setup(net);
    expect((await ax.get(path, { ...opt })).data).toBe('mocked');
    expect((await ax.get(path, { ...opt })).data).toBe('mocked');
    expect(net.log.map((r) => r.url)).toEqual([mockPath, mockPath]);
    // 关掉 mock 后同 key 走真实接口：缓存里没有 mock 数据，真实请求发出
    net.on('GET', path, () => ({ status: 200, data: 'real' }));
    expect((await ax.get(path, { ...opt, mock: false })).data).toBe('real');
    expect(net.log.map((r) => r.url)).toEqual([mockPath, mockPath, path]);
  });

  it('[mock.req.mock × cache.req.cache] mock 404 回落：真实响应被缓存，再次回落命中缓存', async () => {
    const net = makeNetwork()
      .on('GET', mockPath, () => ({ status: 404 }))
      .on('GET', path, () => ({ status: 200, data: 'real' }));
    const ax = setup(net);
    expect((await ax.get(path, { ...opt })).data).toBe('real');
    expect((await ax.get(path, { ...opt })).data).toBe('real');
    // 探测每次都发（2 次），真实接口只打 1 次
    expect(net.log.map((r) => r.url)).toEqual([mockPath, path, mockPath]);
  });
});
