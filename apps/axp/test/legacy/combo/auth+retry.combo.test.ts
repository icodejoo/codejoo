import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { Axp } from '../../../src';
import auth from '../../../src/plugins/auth';
import retry from '../../../src/plugins/retry';
import { makeNetwork } from '../../helpers/network';
import { makeTM } from '../../helpers/auth';
import { sleep } from '../../helpers/sleep';

/** 请求用的测试路径 */
const PATH = '/attempt';

describe('review #7 — retry 的每次尝试经过 auth 单次尝试阶段', () => {
  it('[auth.cb.onRefresh × retry.opt.max] 500 → 401 → 刷新 → 成功：onRefresh 1 次，最终 200', async () => {
    const net = makeNetwork().on('GET', PATH, (config, hit) => {
      if (hit === 1) return { status: 500 };
      return { status: String((config.headers as any).get('Authorization')) === 'Bearer fresh' ? 200 : 401 };
    });
    const ax = axios.create({ adapter: net.adapter });
    const tm = makeTM('old');
    const onRefresh = vi.fn(() => { tm.set('fresh'); return true; });
    Axp.install(ax, {
      auth: auth({ tokenManager: tm, onRefresh, onAccessExpired: vi.fn() }),
      retry: retry({ max: 2, delay: 1 }),
    });
    const r = await ax.get(PATH);
    expect(r.status).toBe(200);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(net.totalStarted).toBe(3);
  });

  it('[auth.cb.onRefresh × retry.opt.delay] 等待重试期间 token 被别的请求刷新：重发带新 token', async () => {
    const seen: unknown[] = [];
    const net = makeNetwork().on('GET', PATH, (config, hit) => {
      seen.push((config.headers as any).get('Authorization'));
      return { status: hit === 1 ? 500 : 200 };
    });
    const ax = axios.create({ adapter: net.adapter });
    const tm = makeTM('old');
    Axp.install(ax, {
      auth: auth({ tokenManager: tm, onRefresh: () => true, onAccessExpired: vi.fn() }),
      retry: retry({ max: 1, delay: 30 }),
    });
    const p = ax.get(PATH);
    await sleep(10);
    tm.set('fresh');
    await p;
    expect(seen).toEqual(['Bearer old', 'Bearer fresh']);
  });
});
