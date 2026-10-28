import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { Axp } from '../../src';
import auth from '../../src/plugins/auth';
import mock from '../../src/plugins/mock';
import share from '../../src/plugins/share';
import { makeNetwork } from '../helpers/network';
import { makeTM } from '../helpers/auth';
import { sleep } from '../helpers/sleep';

describe('review — auth 重放的逻辑请求边界', () => {
  const path = '/review-auth';
  const initialToken = 'old';
  const refreshedToken = 'fresh';

  it('[auth.cb.onRefresh × mock.req.mock × share.req.share] auth 重放保留 mock:false 与 share:false', async () => {
    const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit <= 2 ? 401 : 200 }));
    const ax = axios.create({ adapter: net.adapter });
    const tm = makeTM(initialToken);
    Axp.install(ax, {
      auth: auth({ tokenManager: tm, onRefresh: async () => { await sleep(5); tm.set(refreshedToken); return true; }, onAccessExpired: vi.fn() }),
      mock: mock({ enable: true, mock: true, mockUrl: 'http://mock' }), share: share(),
    });
    await Promise.all(Array.from({ length: 2 }, () => ax.get(path, { key: 'review', mock: false, share: false })));
    expect(net.log.map((record) => record.url)).toEqual([path, path, path, path]);
  });
});
