import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import key, { $parse } from '../../../src/plugins/key';

describe('key — scope、采样与错误边界', () => {
    it('[key.fn.axpKey][key.method.install][key.method.cleanup] install 将不支持的 body 对应 key 清空；cleanup 后不再计算 key', async () => {
        const adapter = vi.fn(async (config) => ({ config, status: 200, statusText: '', headers: {}, data: 'ok' }));
        const ax = axios.create({ adapter, transformRequest: [] });
        const off = key().install(ax);
        await ax.post('/', new Map([[1, 2]]), { key: 'deep' });
        expect(adapter.mock.calls[0][0].key).toBeUndefined();
        off?.();
        await ax.get('/', { key: true });
        expect(adapter.mock.calls[1][0].key).toBe(true);
    });
});

describe('key — 钩子与开关', () => {
    it('[key.cb.before][key.cb.after] 前钩子修改输入，后钩子收到计算后的 key', async () => {
        const seen: unknown[] = [];
        const ax = axios.create({ adapter: async (config) => {
            seen.push(config.key);
            return { config, status: 200, statusText: '', headers: {}, data: 'ok' };
        } });
        const plugin = key({
            before(config) { seen.push(config.key); config.params = { n: 2 }; },
            after(config) { seen.push(config.key); },
        });
        plugin.install(ax);
        await ax.get('/x', { key: 'deep', params: { n: 1 } });
        const expected = $parse({ url: '/x', method: 'get', key: 'deep', params: { n: 2 } });
        expect(seen).toEqual(['deep', expected, expected]);
    });

    it('[key.opt.enable] 总开关关闭时保留请求 key 且不执行钩子', async () => {
        const before = vi.fn();
        const adapter = vi.fn(async (config) => ({ config, status: 200, statusText: '', headers: {}, data: null }));
        const ax = axios.create({ adapter });
        key({ enable: false, before }).install(ax);
        await ax.get('/x', { key: true });
        expect(adapter.mock.calls[0][0].key).toBe(true);
        expect(before).not.toHaveBeenCalled();
    });

    it('[key.prop.name] 工厂返回固定插件名称', () => {
        expect(key().name).toBe('axp:key');
    });

    it('[key.req.key.enable] 请求级 enable:false 应保留原配置并跳过生成', async () => {
        const ax = axios.create({ adapter: async (config) => ({ config, status: 200, statusText: '', headers: {}, data: config.key }) });
        key().install(ax);
        const result = await ax.get('/x', { key: { enable: false } });
        expect(result.data).toEqual({ enable: false });
    });
});
