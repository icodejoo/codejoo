import { afterEach, describe, expect, it, vi } from 'vitest';
import notify from '../../src/plugins/notify';
import axios from 'axios';
import { Axp } from '../../src';
import { makeNetwork } from '../helpers/network';
import { use } from '../helpers/install';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 创建可直接调用拦截器回调的最小 axios 替身。 */
function interceptors() {
    const request = { use: vi.fn(), eject: vi.fn() };
    const response = { use: vi.fn(), eject: vi.fn() };
    const ax: any = { defaults: {}, interceptors: { request, response } };
    return { ax, request, response };
}

/** 构造 adapter 层成功响应。 */
function response(config: any, data: unknown = 'ok') {
    return { config, data, status: 200, statusText: '', headers: {} };
}

function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('normalize/notify — 失败旁路与清理', () => {
    it.each(['stringify', 'notify'])('[notify.cb.stringify][notify.cb.notify][notify.method.cleanup] HTTP 错误路径 %s 抛错仍保留原错误，并记录日志', async (phase) => {
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const { ax, response: hooks } = interceptors();
        const sideEffectError = new Error('side effect');
        const stringify = vi.fn(() => { if (phase === 'stringify') throw sideEffectError; return 'message'; });
        const callback = vi.fn(() => { throw sideEffectError; });
        const off = notify({ stringify, notify: callback }).install(ax);
        const config = { debug: true, logger: sink };
        const error = Object.assign(new Error('network'), { config });
        await expect(hooks.use.mock.calls[0][1](error)).rejects.toBe(error);
        expect(sink.error).toHaveBeenCalledWith(expect.any(String), sideEffectError);
        expect(stringify).toHaveBeenCalledWith(undefined, 'network', 0, config);
        off?.();
        expect(hooks.eject).toHaveBeenCalledOnce();
    });
    it('[notify.cb.stringify] notify error 无 config/message/response 时使用空值回退', async () => {
        const { ax, response: hooks } = interceptors();
        const stringify = vi.fn(() => '');
        notify({ stringify, notify: vi.fn() }).install(ax);
        const error = {};
        await expect(hooks.use.mock.calls[0][1](error)).rejects.toBe(error);
        expect(stringify).toHaveBeenCalledWith(undefined, '', 0, {});
    });
});

describe('notify', () => {
  it('[notify.cb.stringify][notify.cb.notify] stringify or notify throwing does not corrupt an otherwise-successful response', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { v: 1 } } }));
    use(api, [notify({
      notify: () => { throw new Error('notify sink is down'); },
      stringify: () => 'boom',
    })]);

    const r = await api.axios.get('/data');
    expect((r.data as any).data.v).toBe(1);
  });
});
