import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { Axp } from '../../src';
import mock from '../../src/plugins/mock';
import share from '../../src/plugins/share';
import { makeNetwork } from '../helpers/network';

describe('mock 探测不参与 share 合并', () => {
  const path = '/ms';
  const mockPath = `http://mock${path}`;
  const N = 3;
  const setup = (net: ReturnType<typeof makeNetwork>) => {
    const ax = axios.create({ adapter: net.adapter });
    Axp.install(ax, { share: share(), mock: mock({ enable: true, mock: true, mockUrl: 'http://mock' }) });
    return ax;
  };
  const run = (ax: ReturnType<typeof setup>) =>
    Promise.all(Array.from({ length: N }, () => ax.get(path, { key: 'k', share: true } as any)));

  it('[mock.req.mock × share.req.share] 同 key 并发 N 个 mock 成功请求：探测发 N 次，不合并', async () => {
    const net = makeNetwork().on('GET', mockPath, () => ({ status: 200, data: 'mocked' }));
    const res = await run(setup(net));
    expect(res.map((r) => r.data)).toEqual(['mocked', 'mocked', 'mocked']);
    expect(net.calls('GET', mockPath)).toBe(N);
    expect(net.calls('GET', path)).toBe(0);
  });

  it('[mock.req.mock × share.req.share] 同 key 并发 N 个全部回落：探测 N 次，真实请求只 1 次（share 合并）', async () => {
    const net = makeNetwork()
      .on('GET', mockPath, () => ({ status: 404 }))
      .on('GET', path, () => ({ status: 200, data: 'real' }));
    const res = await run(setup(net));
    expect(res.map((r) => r.data)).toEqual(['real', 'real', 'real']);
    expect(net.calls('GET', mockPath)).toBe(N);
    expect(net.calls('GET', path)).toBe(1);
  });
});
