import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { Axp, axpKey as key, axpShare as share } from '../../../src';
import { makeNetwork } from '../../helpers/network';
import { use } from '../../helpers/install';

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('share: end policy', () => {
  it('[share.opt.policy][share.fn.$end] only the LATEST caller settles the shared promise — an earlier, superseded caller for the same key is redirected to that result instead of its own', async () => {
    // makeNetwork()'s route handler must return synchronously — it does NOT
    // await a returned Promise (`'data' in out` is false for a thenable, so
    // it silently falls back to `{code:0,data:null}`). Sequencing "a is
    // still in flight when b lands" is done via relative `latency` instead
    // of a manual release gate: `hit` is assigned at dispatch time (before
    // the delay), so the first-DISPATCHED call is reliably "a" regardless
    // of which one's timer fires first.
    const { net, api } = mkApi();
    net.on('GET', '/data', (_config, hit) => hit === 1
      ? { data: { code: 0, data: { v: 'a-stale' } } }
      : { data: { code: 0, data: { v: 'b-latest' } } });
    use(api, [key(), share({ policy: 'end' })]);

    const a = api.axios.get('/data', { key: true, share: 'end', latency: 30 } as any);
    await new Promise((r) => setTimeout(r, 5)); // ensure a dispatches first
    const b = await api.axios.get('/data', { key: true, share: 'end', latency: 5 } as any);
    const aResult: any = await a;

    expect((b.data as any).data.v).toBe('b-latest');
    expect(aResult.data.data.v).toBe('b-latest');
  });

  it('[share.opt.policy][share.fn.$end] a solo caller (no supersession) just settles with its own result', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { v: 1 } } }));
    use(api, [key(), share({ policy: 'end' })]);
    const r: any = await api.axios.get('/data', { key: true, share: 'end' } as any);
    expect(r.data.data.v).toBe(1);
  });

  it('[share.opt.policy][share.fn.$end] a solo caller whose own request fails settles the entry with that failure', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ status: 500, data: { code: 1, data: null } }));
    use(api, [key(), share({ policy: 'end' })]);
    await expect(api.axios.get('/data', { key: true, share: 'end' } as any)).rejects.toBeTruthy();
  });
});

describe('share: race policy', () => {
  it('[share.opt.policy][share.fn.$race] the first attempt to SUCCEED wins for everyone, including a slower attempt still in flight', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/data', (_config, hit) => hit === 1
      ? { data: { code: 0, data: { v: 'slow' } } }
      : { data: { code: 0, data: { v: 'fast' } } });
    use(api, [key(), share({ policy: 'race' })]);

    const slow = api.axios.get('/data', { key: true, share: 'race', latency: 30 } as any);
    await new Promise((r) => setTimeout(r, 5)); // ensure slow dispatches first
    const fast: any = await api.axios.get('/data', { key: true, share: 'race', latency: 5 } as any);
    const slowResult: any = await slow;

    expect(fast.data.data.v).toBe('fast');
    expect(slowResult.data.data.v).toBe('fast');
  });

  it('[share.opt.policy][share.fn.$race] only once every in-flight attempt has failed does the race settle as a failure for everyone', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ status: 500, data: { code: 1, data: null } }));
    use(api, [key(), share({ policy: 'race' })]);
    await expect(api.axios.get('/data', { key: true, share: 'race' } as any)).rejects.toBeTruthy();
  });
});

describe('share: none policy and no-key no-op', () => {
  it('[share.opt.policy][share.req.share] policy:"none" passes every request through independently — never shared', async () => {
    const { net, api } = mkApi();
    let calls = 0;
    net.on('GET', '/data', () => { calls++; return { status: 500, data: { code: 1, data: null } }; });
    use(api, [key(), share({ policy: 'none' })]);
    await expect(api.axios.get('/data', { key: true, share: 'none' } as any)).rejects.toBeTruthy();
    await expect(api.axios.get('/data', { key: true, share: 'none' } as any)).rejects.toBeTruthy();
    expect(calls).toBe(2);
  });
});

/** 给请求加延迟（毫秒），配合 makeNetwork 制造乱序 */
const lat = (ms: number) => ({ latency: ms } as any);

describe('集成 — share「start」高并发去重', () => {
  it('[share.opt.policy][share.fn.$start] 50 个并发同 key 请求 → 真实 HTTP 只发一次，全部拿到同一结果', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/list', (_c, hit) => ({ data: { code: 0, data: { servedHit: hit } } }));
    use(api, [key(), share({ policy: 'start' })]);

    const reqs = Array.from({ length: 50 }, () =>
      api.get('/list')(undefined, { key: true, share: 'start', ...lat(20) }),
    );
    const out = await Promise.all(reqs);

    expect(net.calls('GET', '/list')).toBe(1);          // HTTP 只发一次
    expect(out.every((r: any) => r.servedHit === 1)).toBe(true);  // 全部同一结果
  });
});

describe('集成 — race 乱序 + 夹杂错误', () => {
  it('[share.opt.policy][share.fn.$race] 三并发各自发 HTTP，前两个失败、第三个成功 → 全部拿到成功结果', async () => {
    const { net, api } = mkApi();
    // 同一 key 下：前两次 500，第三次成功
    net.on('GET', '/race', (_c, hit) =>
      hit < 3 ? { status: 500 } : { data: { code: 0, data: 'winner' } },
    );
    use(api, [key(), share({ policy: 'race' })]);

    const reqs = Array.from({ length: 3 }, () =>
      api.get('/race')(undefined, { key: true, share: 'race', ...lat(10) }),
    );
    const out = await Promise.all(reqs);
    expect(net.calls('GET', '/race')).toBe(3);          // race：每个 caller 各发一次
    expect(out.every((r: unknown) => r === 'winner')).toBe(true); // 第一个成功的赢家分发给所有
  });
});
