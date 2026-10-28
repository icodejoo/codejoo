import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { create } from '../../src/core';
import { Axp } from '../../src';
import { makeNetwork } from '../helpers/network';

afterEach(() => { vi.restoreAllMocks(); });

describe('Core — 合并优先级与返回形状', () => {
    it('[public.member.Core.get][public.member.Core.axios] 请求选项覆盖方法选项和 payload，raw 优先于 wrap', async () => {
        const body = { code: 0, data: { n: 1 } };
        const adapter = vi.fn(async (config) => ({ status: 200, statusText: '', headers: {}, config, data: body }));
        const api = create(axios.create({ adapter }));
        const methodConfig = { url: '/method', params: { method: 1 }, wrap: true };
        const request = api.get('/first', methodConfig);
        const output = await request({ payload: 1 }, { url: '/last', params: { request: 1 }, raw: true });
        expect(output).toBe(body);
        expect(adapter.mock.calls[0][0].url).toBe('/last');
        expect(adapter.mock.calls[0][0].params).toEqual({ request: 1 });
    });
    it.each([null, 0, false, 'text', { code: 0 }, { data: 1 }])('[public.member.Core.get] 非完整信封 %s 原样返回', async (body) => {
        const api = create(axios.create({ adapter: async (config) => ({ status: 200, statusText: '', headers: {}, config, data: body }) }));
        expect(await api.get('/')()).toBe(body);
    });
    it('[public.fn.Axp.create][public.member.Core.constructor][public.member.Core.axios] 默认 create 创建独立 axios，构造保留既有 transitional 配置', () => {
        const a = create();
        const b = create();
        expect(a.axios).not.toBe(b.axios);
        const ax = axios.create({ transitional: { silentJSONParsing: false } });
        create(ax);
        expect(ax.defaults.transitional).toMatchObject({ silentJSONParsing: false, clarifyTimeoutError: true });
    });
});

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

/** 给请求加延迟（毫秒），配合 makeNetwork 制造乱序 */
const lat = (ms: number) => ({ latency: ms } as any);

describe('集成 — 高并发乱序夹杂错误：无串扰', () => {
  it('[public.member.Core.get] 20 个不同请求，偶数成功/奇数 400，乱序完成 → 各自结果正确、互不串扰', async () => {
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
