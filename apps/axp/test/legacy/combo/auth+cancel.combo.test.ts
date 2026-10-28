import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { Axp } from '../../../src';
import auth from '../../../src/plugins/auth';
import cancel, { cancelAll } from '../../../src/plugins/cancel';
import { makeNetwork } from '../../helpers/network';
import { makeTM } from '../../helpers/auth';

describe('review — auth 重放的逻辑请求边界', () => {
  const path = '/review-auth';
  const initialToken = 'old';
  const refreshedToken = 'fresh';

  it.each([true, false])('[auth.cb.onRefresh × cancel.fn.cancelAll] 刷新期间 cancelAll 后不再重放，刷新结果 %s 均以 CanceledError 结束', async (refreshed) => {
    const net = makeNetwork().on('GET', path, () => ({ status: 401 }));
    const ax = axios.create({ adapter: net.adapter });
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const tm = makeTM(initialToken);
    Axp.install(ax, {
      auth: auth({ tokenManager: tm, onAccessExpired: vi.fn(), onRefresh: async () => {
        entered();
        await new Promise<void>((resolve) => { finish = resolve; });
        tm.set(refreshedToken);
        return refreshed;
      } }),
      cancel: cancel(),
    });
    const result = ax.get(path).catch((error) => error);
    await started;
    expect(cancelAll(ax)).toBe(1);
    finish();
    expect(await result).toMatchObject({ name: 'CanceledError', code: 'ERR_CANCELED' });
    expect(net.totalStarted).toBe(1);
    expect(cancelAll(ax)).toBe(0);
  });
});
