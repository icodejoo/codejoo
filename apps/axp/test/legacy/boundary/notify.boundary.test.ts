import { afterEach, describe, expect, it, vi } from 'vitest';
import notify from '../../../src/plugins/notify';
import axios from 'axios';
import { Axp } from '../../../src';
import { makeNetwork } from '../../helpers/network';
import { use } from '../../helpers/install';

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

describe('notify — 回调返回值与卸载边界（真实 axios）', () => {
    /** 成功响应的 axios 实例。 */
    function okAxios() {
        return axios.create({ adapter: async (c) => response(c, { v: 1 }) });
    }

    it.each([undefined, null, 0, false, ''])('[notify.fn.axpNotify][notify.cb.stringify] stringify 返回 %s（falsy）→ 不触发 notify', async (text) => {
        const ax = okAxios();
        const notifyFn = vi.fn();
        notify({ notify: notifyFn, stringify: () => text as any }).install(ax);
        await ax.get('/');
        expect(notifyFn).not.toHaveBeenCalled();
    });

    it('[notify.fn.axpNotify] 纯空白字符串视为非空，照常通知（插件不 trim）', async () => {
        const ax = okAxios();
        const notifyFn = vi.fn();
        notify({ notify: notifyFn, stringify: () => '  ' }).install(ax);
        await ax.get('/');
        expect(notifyFn).toHaveBeenCalledWith('  ');
    });

    it('[notify.method.install] 同一实例重复 install 会各自触发一次 notify（两条独立拦截器）', async () => {
        const ax = okAxios();
        const notifyFn = vi.fn();
        const plugin = notify({ notify: notifyFn, stringify: () => 'x' });
        plugin.install(ax);
        plugin.install(ax);
        await ax.get('/');
        expect(notifyFn).toHaveBeenCalledTimes(2);
    });

    it('[notify.method.cleanup] cleanup 重复调用安全；卸载一个不影响另一个已装实例', async () => {
        const ax = okAxios();
        const a = vi.fn();
        const b = vi.fn();
        const offA = notify({ notify: a, stringify: () => 'a' }).install(ax) as () => void;
        notify({ notify: b, stringify: () => 'b' }).install(ax);
        offA();
        expect(() => offA()).not.toThrow();
        await ax.get('/');
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledOnce();
    });

    it.each([false, undefined, null, 'yes', 0])('[notify.req.silent] silent=%s：插件不读取，原样透传到 stringify 的 config 且不影响通知', async (silent) => {
        const ax = okAxios();
        const stringify = vi.fn(() => 'x');
        const notifyFn = vi.fn();
        notify({ notify: notifyFn, stringify }).install(ax);
        await ax.get('/', { silent } as any);
        expect((stringify.mock.calls[0] as any[])[3].silent).toBe(silent);
        expect(notifyFn).toHaveBeenCalledOnce();
    });

    it('[notify.req.silent] 错误路径同样透传 silent 到 stringify，错误仍原样 reject', async () => {
        const err = Object.assign(new Error('net'), { isAxiosError: true });
        const ax = axios.create({ adapter: async (c) => { throw Object.assign(err, { config: c }); } });
        const stringify = vi.fn(() => '');
        notify({ notify: vi.fn(), stringify }).install(ax);
        await expect(ax.get('/', { silent: true } as any)).rejects.toBe(err);
        expect((stringify.mock.calls[0] as any[])[3].silent).toBe(true);
    });
});
