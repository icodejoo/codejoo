import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { Axp, axpNotify as notify } from '../../../src';
import { makeNetwork } from '../../helpers/network';
import { use } from '../../helpers/install';

function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('notify', () => {
  it('[notify.cb.notify][notify.cb.stringify] a successful response is stringified and, if non-empty, passed to notify — the response itself passes through unchanged', async () => {
    // `message` is `undefined` on the success path (no AxiosError involved)
    // and falls back to `response.statusText` (empty in this mock) — the
    // envelope's own `data.message` field is read off `data`, not `message`.
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { v: 1 }, message: 'all good' } }));
    const messages: string[] = [];
    use(api, [notify<any>({
      notify: (m) => messages.push(m),
      stringify: (data) => `ok: ${data?.message} v=${data?.data?.v}`,
    })]);

    const r = await api.axios.get('/data');
    expect((r.data as any).data.v).toBe(1);
    expect(messages).toEqual(['ok: all good v=1']);
  });

  it('[notify.cb.stringify] an empty stringify result means no notification', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: null, message: '' } }));
    const messages: string[] = [];
    use(api, [notify({ notify: (m) => messages.push(m), stringify: () => '' })]);

    await api.axios.get('/data');
    expect(messages).toEqual([]);
  });

  it('[notify.cb.stringify][notify.cb.notify] an HTTP error is also stringified via the same callback, and the error still propagates', async () => {
    // `message` here is the AxiosError's OWN description (e.g. "Request
    // failed with status code 500"), not `response.data.message` — matches
    // dioman's DiomanNotify exactly (`err.message`, a DioException's own
    // description, not a field pulled out of the response body). A caller
    // wanting the body's own message field reads it off `data` themselves.
    const { net, api } = mkApi();
    net.fallback(() => ({ status: 500, data: { code: 1, data: null, message: 'server exploded' } }));
    const messages: string[] = [];
    use(api, [notify<any>({
      notify: (m) => messages.push(m),
      stringify: (data, message, status) => `err ${status}: ${message} (body says: ${data?.message})`,
    })]);

    await expect(api.axios.get('/data')).rejects.toBeTruthy();
    expect(messages).toEqual(['err 500: Request failed with status code 500 (body says: server exploded)']);
  });

  it('[notify.cb.stringify][notify.fn.axpNotify] a network-level error (no HTTP response at all) still gets stringified, with status 0', async () => {
    const { net, api } = mkApi();
    net.fallback(() => { throw new Error('ECONNREFUSED'); });
    const calls: Array<{ data: unknown; message: string; status: number }> = [];
    use(api, [notify({
      notify: () => {},
      stringify: (data, message, status) => { calls.push({ data, message, status }); return 'x'; },
    })]);

    await expect(api.axios.get('/data')).rejects.toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe(0);
  });
});


describe('notify — 安装/卸载与请求级 silent（真实 axios）', () => {
  /** 成功响应的 axios 实例。 */
  function okAxios() {
    return axios.create({ adapter: async (c) => ({ config: c, data: { v: 1 }, status: 200, statusText: 'OK', headers: {} }) });
  }

  it("[notify.prop.name] 插件实例 name 为 'axp:notify'", () => {
    expect(notify({ notify: () => {}, stringify: () => '' }).name).toBe('axp:notify');
  });

  it('[notify.method.install][notify.method.cleanup] install 后响应触发 notify，cleanup 后不再触发', async () => {
    const ax = okAxios();
    const messages: string[] = [];
    const off = notify({ notify: (m) => messages.push(m), stringify: () => 'hi' }).install(ax) as () => void;
    await ax.get('/a');
    off();
    await ax.get('/b');
    expect(messages).toEqual(['hi']);
  });

  it('[notify.req.silent] silent 由执行器 stringify 读取：stringify 据 config.silent 返回空串即可静默；插件本身不读取 silent', async () => {
    const ax = okAxios();
    const messages: string[] = [];
    notify({ notify: (m) => messages.push(m), stringify: (_d, _m, _s, config) => (config.silent ? '' : 'toast') }).install(ax);
    await ax.get('/a', { silent: true } as any);
    await ax.get('/b');
    expect(messages).toEqual(['toast']);

    // stringify 不看 silent 时，silent:true 也照常通知
    const ax2 = okAxios();
    const m2: string[] = [];
    notify({ notify: (m) => m2.push(m), stringify: () => 'always' }).install(ax2);
    await ax2.get('/c', { silent: true } as any);
    expect(m2).toEqual(['always']);
  });
});
