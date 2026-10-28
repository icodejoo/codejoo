import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { Axp } from '../../src';
import auth from '../../src/plugins/auth';
import cancel, { cancelAll } from '../../src/plugins/cancel';
import retry from '../../src/plugins/retry';
import notify from '../../src/plugins/notify';
import { makeNetwork } from '../helpers/network';
import { makeTM } from '../helpers/auth';

describe('review — auth 重放的逻辑请求边界', () => {
  const path = '/review-auth';
  const initialToken = 'old';
  const refreshedToken = 'fresh';

  it.each([200, 500])('[auth.cb.onAccessExpired × retry.opt.max × cancel.fn.cancelAll × notify.cb.notify] 重放返回 %i 时只通知一次、预算只用一次，controller 全部释放', async (status) => {
    const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit === 1 ? 401 : status }));
    const ax = axios.create({ adapter: net.adapter });
    const tm = makeTM(initialToken);
    const showNotice = vi.fn();
    Axp.install(ax, {
      auth: auth({ tokenManager: tm, onRefresh: () => { tm.set(refreshedToken); return true; }, onAccessExpired: vi.fn() }),
      retry: retry({ max: 1, delay: 0 }), cancel: cancel(),
      notify: notify({ notify: showNotice, stringify: () => 'done' }),
    });
    await ax.get(path).catch(() => undefined);
    expect(net.totalStarted).toBe(status === 200 ? 2 : 3);
    expect(showNotice).toHaveBeenCalledTimes(1);
    expect(cancelAll(ax)).toBe(0);
  });
});
