import { describe, it, expect, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import mock from '../../../src/plugins/mock';

/** 构造指定状态和路径的 adapter 响应。 */
function response(config: any, status = 200) {
    return { status, statusText: '', headers: {}, config, data: config.url };
}

describe('mock — 裸 axios.create()（非函数 adapter）', () => {
    it('[mock.fn.axpMock] 安装不崩；mock 返回 403 时不回落真实接口', async () => {
        const seen: string[] = [];
        const net = vi.fn(async (config: any) => {
            seen.push(config.url);
            const status = String(config.url).startsWith('http://m') ? 403 : 200;
            const resp = { status, statusText: '', headers: {}, config, data: 'x' };
            if (status >= 400) throw Object.assign(new Error('forbidden'), { response: resp, config, isAxiosError: true });
            return resp as any;
        });
        const ax = axios.create({ adapter: [net as any] });
        mock({ enable: true, mockUrl: 'http://m' }).install(ax);
        await expect(ax.get('/api', { mock: true })).rejects.toThrow('forbidden');
        expect(seen).toEqual(['http://m/api']);
    });
});

describe('mock — 回落决策与 adapter 配置隔离', () => {
    it('[mock.opt.mockUrl] 缺少 mockUrl 直接发送真实请求并经自定义 sink 记录警告', async () => {
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        mock({ enable: true }).install(ax);
        await ax.get('/real', { mock: true, debug: true, logger: sink });
        expect(adapter).toHaveBeenCalledOnce();
        expect(adapter.mock.calls[0][0].url).toBe('/real');
        expect(sink.warn).toHaveBeenCalledOnce();
    });
    it('[mock.fn.axpMock] 真实回落失败保留真实错误，不再重复回落', async () => {
        const first = new AxiosError('mock offline');
        const last = new Error('real offline');
        const adapter = vi.fn().mockRejectedValueOnce(first).mockRejectedValue(last);
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/mock' }).install(ax);
        await expect(ax.get('/real', { mock: true })).rejects.toBe(last);
        expect(adapter).toHaveBeenCalledTimes(2);
    });
    it('[mock.cb.fallbackWhen][mock.method.cleanup] 自定义判定抛错会拒绝，不发送真实回落；卸载后保持原 adapter', async () => {
        const error = new Error('decide');
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        const off = mock({ enable: true, mockUrl: '/mock', fallbackWhen: () => { throw error; } }).install(ax);
        await expect(ax.get('/real', { mock: true })).rejects.toBe(error);
        expect(adapter).toHaveBeenCalledOnce();
        off?.();
        expect(ax.defaults.adapter).toBe(adapter);
    });
});

/** 记录每次请求 url 的 adapter，用于判断走了 mock 还是真实。 */
function urlAdapter() {
    return vi.fn(async (c: any) => response(c));
}

/** 取 adapter 依次收到的 url。 */
function urls(adapter: ReturnType<typeof urlAdapter>) {
    return adapter.mock.calls.map((c) => c[0].url);
}

describe('mock — 插件选项边界', () => {
    it('[mock.opt.enable][mock.method.install] enable:false 不包装 adapter，install 不返回 cleanup', () => {
        const adapter = urlAdapter();
        const ax = axios.create({ adapter });
        expect(mock({ enable: false, mockUrl: '/mock' }).install(ax)).toBeUndefined();
        expect(ax.defaults.adapter).toBe(adapter);
    });

    it('[mock.opt.enable] enable:true 但缺 mockUrl：mock:true 请求直接走真实并 warn', async () => {
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const adapter = urlAdapter();
        const ax = axios.create({ adapter });
        mock({ enable: true, mock: true }).install(ax);
        await ax.get('/a', { debug: true, logger: sink });
        expect(urls(adapter)).toEqual(['/a']);
        expect(sink.warn).toHaveBeenCalledOnce();
    });

    it('[mock.opt.mock] 请求 mock 为 null / 0 时回退插件级 mock 值', async () => {
        const adapter = urlAdapter();
        const ax = axios.create({ adapter });
        mock({ enable: true, mock: true, mockUrl: '/mock' }).install(ax);
        await ax.get('/a', { mock: null as any });
        await ax.get('/b', { mock: 0 as any });
        expect(urls(adapter)).toEqual(['/mock/a', '/mock/b']);

        const adapter2 = urlAdapter();
        const ax2 = axios.create({ adapter: adapter2 });
        mock({ enable: true, mock: undefined, mockUrl: '/mock' }).install(ax2);
        await ax2.get('/a', { mock: null as any });
        expect(urls(adapter2)).toEqual(['/a']);
    });

    it('[mock.method.cleanup] cleanup 重复调用安全，卸载后 adapter 还原且可重装', async () => {
        const adapter = urlAdapter();
        const ax = axios.create({ adapter });
        const off = mock({ enable: true, mockUrl: '/mock' }).install(ax) as () => void;
        off();
        expect(() => off()).not.toThrow();
        expect(ax.defaults.adapter).toBe(adapter);
        mock({ enable: true, mockUrl: '/mock' }).install(ax);
        await ax.get('/a', { mock: true });
        expect(urls(adapter)).toEqual(['/mock/a']);
    });
});

describe('mock — 请求级 mock 配置边界', () => {
    it('[mock.req.mock] 空对象 {} 且无插件级 mockUrl：走真实；有插件级 mockUrl：沿用插件级 mock', async () => {
        const a1 = urlAdapter();
        const ax1 = axios.create({ adapter: a1 });
        mock({ enable: true }).install(ax1);
        await ax1.get('/a', { mock: {} });
        expect(urls(a1)).toEqual(['/a']);

        const a2 = urlAdapter();
        const ax2 = axios.create({ adapter: a2 });
        mock({ enable: true, mockUrl: '/mock' }).install(ax2);
        await ax2.get('/a', { mock: {} });
        expect(urls(a2)).toEqual(['/mock/a']);
    });

    it('[mock.req.mock.mock] mock:undefined 视同未指定；mock:false 压过插件级 mock:true', async () => {
        const adapter = urlAdapter();
        const ax = axios.create({ adapter });
        mock({ enable: true, mock: true, mockUrl: '/mock' }).install(ax);
        await ax.get('/a', { mock: { mock: undefined } });
        await ax.get('/b', { mock: { mock: false } });
        expect(urls(adapter)).toEqual(['/mock/a', '/b']);
    });

    it('[mock.req.mock.mockUrl] 空字符串 mockUrl 视为未配置：不 mock 且不回退到插件级', async () => {
        const adapter = urlAdapter();
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/mock' }).install(ax);
        await ax.get('/a', { mock: { mockUrl: '' } });
        expect(urls(adapter)).toEqual(['/a']);
    });

    it('[mock.req.mock.mockUrl] mockUrl 带结尾斜杠不产生双斜杠；绝对 url 去掉原 origin 保留 query/hash', async () => {
        const adapter = urlAdapter();
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: 'http://m/' }).install(ax);
        await ax.get('/a', { mock: true });
        await ax.get('http://real.com/b?x=1#h', { mock: true });
        expect(urls(adapter)).toEqual(['http://m/a', 'http://m/b?x=1#h']);
    });

    it('[mock.req.mock.fallbackWhen] 判定函数收到 {response}（成功）与 {error}（失败）；请求级 undefined 回退插件级', async () => {
        const decide = vi.fn(() => false);
        const adapter = vi.fn()
            .mockResolvedValueOnce({ status: 200, statusText: '', headers: {}, config: {}, data: 1 })
            .mockRejectedValueOnce(new Error('down'));
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/mock', fallbackWhen: decide }).install(ax);
        await ax.get('/a', { mock: { fallbackWhen: undefined } });
        await expect(ax.get('/b', { mock: true })).rejects.toThrow('down');
        expect(decide.mock.calls[0][0]).toHaveProperty('response');
        expect(decide.mock.calls[1][0]).toHaveProperty('error');
    });

    it('[mock.req.mock.fallbackWhen] 判定返回真值非 true（如 1）也回落；用户取消默认不回落', async () => {
        const adapter = vi.fn()
            .mockRejectedValueOnce(new Error('x'))
            .mockResolvedValueOnce({ status: 200, statusText: '', headers: {}, config: {}, data: 'real' });
        const ax = axios.create({ adapter });
        mock({ enable: true, mockUrl: '/mock' }).install(ax);
        const r = await ax.get('/a', { mock: { fallbackWhen: (() => 1) as any } });
        expect(r.data).toBe('real');

        const cancel = Object.assign(new Error('c'), { code: 'ERR_CANCELED' });
        const a2 = vi.fn().mockRejectedValue(cancel);
        const ax2 = axios.create({ adapter: a2 });
        mock({ enable: true, mockUrl: '/mock' }).install(ax2);
        await expect(ax2.get('/a', { mock: true })).rejects.toBe(cancel);
        expect(a2).toHaveBeenCalledOnce();
    });
});
