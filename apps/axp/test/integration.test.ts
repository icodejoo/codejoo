import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { create, reqkey, share, cache, retry, loading, mock } from '../src';
import { makeNetwork } from './helpers/network';

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

const lat = (ms: number) => ({ latency: ms } as any);


describe('集成 — share「start」高并发去重', () => {
  it('50 个并发同 key 请求 → 真实 HTTP 只发一次，全部拿到同一结果', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/list', (_c, hit) => ({ data: { code: 0, data: { servedHit: hit } } }));
    api.use([reqkey(), share({ policy: 'start' })]);

    const reqs = Array.from({ length: 50 }, () =>
      api.get('/list')(undefined, { key: true, share: 'start', ...lat(20) }),
    );
    const out = await Promise.all(reqs);

    expect(net.calls('GET', '/list')).toBe(1);          // HTTP 只发一次
    expect(out.every((r: any) => r.servedHit === 1)).toBe(true);  // 全部同一结果
  });
});


describe('集成 — race 乱序 + 夹杂错误', () => {
  it('三并发各自发 HTTP，前两个失败、第三个成功 → 全部拿到成功结果', async () => {
    const { net, api } = mkApi();
    // 同一 key 下：前两次 500，第三次成功
    net.on('GET', '/race', (_c, hit) =>
      hit < 3 ? { status: 500 } : { data: { code: 0, data: 'winner' } },
    );
    api.use([reqkey(), share({ policy: 'race' })]);

    const reqs = Array.from({ length: 3 }, () =>
      api.get('/race')(undefined, { key: true, share: 'race', ...lat(10) }),
    );
    const out = await Promise.all(reqs);
    expect(net.calls('GET', '/race')).toBe(3);          // race：每个 caller 各发一次
    expect(out.every((r) => r === 'winner')).toBe(true); // 第一个成功的赢家分发给所有
  });
});


describe('集成 — retry 瞬时错误恢复', () => {
  it('前两次 500、第三次 200 → retry 自动恢复，对外只见成功', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/flaky', (_c, hit) =>
      hit < 3 ? { status: 500 } : { data: { code: 0, data: 'recovered' } },
    );
    api.use([retry({ max: 5 })]);

    const r = await api.get('/flaky')(undefined, { retry: 5, ...lat(5) });
    expect(r).toBe('recovered');
    expect(net.calls('GET', '/flaky')).toBe(3);  // 失败2 + 成功1
  });

  it('始终失败 → 耗尽重试后 reject', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/down', () => ({ status: 503 }));
    api.use([retry({ max: 2 })]);
    await expect(api.get('/down')(undefined, { retry: 2, ...lat(2) })).rejects.toBeTruthy();
    expect(net.calls('GET', '/down')).toBe(3);  // 首发 + 2 次重试
  });
});


describe('集成 — cache 命中（顺序）', () => {
  it('首发未命中→打网络；二发命中→不再打网络', async () => {
    const { net, api } = mkApi();
    let n = 0;
    net.on('GET', '/cfg', () => ({ data: { code: 0, data: { v: ++n } } }));
    api.use([reqkey(), cache({ expires: 10_000 })]);

    const r1: any = await api.get('/cfg')(undefined, { key: true, cache: true });
    const r2: any = await api.get('/cfg')(undefined, { key: true, cache: true });
    expect(r1.v).toBe(1);
    expect(r2.v).toBe(1);                         // 命中缓存，值不变
    expect(net.calls('GET', '/cfg')).toBe(1);     // 网络只打一次
  });
});


describe('集成 — 高并发乱序夹杂错误：无串扰', () => {
  it('20 个不同请求，偶数成功/奇数 400，乱序完成 → 各自结果正确、互不串扰', async () => {
    const { net, api } = mkApi();
    net.fallback((c) => {
      const id = Number(new URL('http://x' + c.url).searchParams.get('id'));
      return id % 2 === 0
        ? { data: { code: 0, data: { id, ok: true } } }
        : { status: 400, data: { code: 'BAD', data: { id } } };
    });
    // 不装任何插件：纯 Core dispatch，验证并发隔离
    const reqs = Array.from({ length: 20 }, (_, i) =>
      api
        .get(`/item?id=${i}`)(undefined, lat(((i * 7) % 13) + 1)) // 乱序延迟
        .then((data: any) => ({ i, status: 'ok' as const, data }))
        .catch((e: any) => ({ i, status: 'err' as const, id: e?.response?.data?.data?.id })),
    );
    const out = await Promise.all(reqs);

    for (const r of out) {
      if (r.i % 2 === 0) {
        expect(r.status).toBe('ok');
        expect((r as any).data.id).toBe(r.i);   // 成功值对应自己的 id（无串扰）
      } else {
        expect(r.status).toBe('err');
        expect((r as any).id).toBe(r.i);        // 错误也对应自己的 id
      }
    }
  });
});


describe('集成 — mock 插件「客户端回落」（404 → axios 层重发真实）', () => {
  it('mock 路径 404 → 插件在 axios 层改打真实路径并返回真实数据', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/mockbase/api/data', () => ({ status: 404 }));            // mock 不存在
    net.on('GET', '/api/data', () => ({ data: { code: 0, data: { real: true } } })); // 真实
    api.use(mock({ enable: true, mockUrl: '/mockbase' }));
    const r: any = await api.get('/api/data')(undefined, { mock: true, ...lat(5) });
    expect(r.real).toBe(true);
    expect(net.calls('GET', '/mockbase/api/data')).toBe(1);  // 先打 mock
    expect(net.calls('GET', '/api/data')).toBe(1);           // 404 后客户端回落真实
  });
});


describe('集成 — loading 并发计数', () => {
  it('多并发只 show 一次、hide 一次（计数边界）', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: 1 } }));
    const states: boolean[] = [];
    api.use([loading({ loading: (v) => states.push(v) })]);

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => api.get(`/x${i}`)(undefined, { loading: true, ...lat(15) })),
    );

    expect(states.filter((v) => v === true)).toHaveLength(1);   // 仅一次 show
    expect(states.filter((v) => v === false)).toHaveLength(1);  // 仅一次 hide
    expect(states[0]).toBe(true);
    expect(states[states.length - 1]).toBe(false);
  });
});
