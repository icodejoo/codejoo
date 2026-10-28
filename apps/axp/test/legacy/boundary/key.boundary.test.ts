import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import key, { $key, $parse } from '../../../src/plugins/key';

function fingerprint(data: unknown, options: any = {}) {
    return $parse({ method: 'post', url: '/x', data, key: { ...options } });
}

describe('key — 拦截与空配置边界', () => {
    it.each(['before', 'after'] as const)('[key.cb.before][key.cb.after] %s 抛错保留错误身份且不发送请求', async (hook) => {
        const error = new Error('钩子失败');
        const adapter = vi.fn();
        const ax = axios.create({ adapter });
        key({ [hook]: () => { throw error; } }).install(ax);
        await expect(ax.get('/x', { key: true })).rejects.toBe(error);
        expect(adapter).not.toHaveBeenCalled();
    });

    it('[key.opt.enable][key.fn.axpKey] 总开关关闭时不会执行抛错的动态 key', async () => {
        const callback = vi.fn(() => { throw new Error('不可执行'); });
        const ax = axios.create({ adapter: async (config) => ({ config, status: 200, statusText: '', headers: {}, data: null }) });
        key({ enable: false }).install(ax);
        const result = await ax.get('/x', { key: callback });
        expect(result.config.key).toBe(callback);
        expect(callback).not.toHaveBeenCalled();
    });

    it('[key.req.key][key.req.key.number] 零和负数保持有效，空白与未指定 key 跳过钩子', async () => {
        const before = vi.fn();
        const ax = axios.create({ adapter: async (config) => ({ config, status: 200, statusText: '', headers: {}, data: null }) });
        key({ before }).install(ax);
        for (const value of [0, -1]) {
            expect((await ax.get('/x', { key: value })).config.key).toBe(String(value));
        }
        for (const value of [undefined, null, false, '', '   ']) await ax.get('/x', { key: value });
        expect(before).toHaveBeenCalledTimes(2);
    });

    it('[key.opt.fastMode][key.req.key.fastMode][key.opt.ignores][key.req.key.ignores] 空请求级 ignores 覆盖默认列表，false 覆盖简单模式', () => {
        const config = { url: '/x', key: { fastMode: false, ignores: [] }, params: { n: 1, empty: null } };
        const defaults = { fastMode: true, ignores: ['empty'] };
        expect($parse(config, defaults)).toBe($key(config, false));
        expect($parse(config, defaults)).not.toBe($key(config, true));
        expect($parse(config, defaults)).not.toBe($key(config, false, { ignores: ['empty'] }));
    });

    it('[key.method.install][key.method.cleanup] 同一插件重复安装后分别且幂等清理拦截器', async () => {
        const before = vi.fn();
        const ax = axios.create({ adapter: async (config) => ({ config, status: 200, statusText: '', headers: {}, data: null }) });
        const plugin = key({ before });
        const first = plugin.install(ax);
        const second = plugin.install(ax);
        first?.(); first?.();
        await ax.get('/x', { key: true });
        expect(before).toHaveBeenCalledTimes(1);
        second?.();
        expect((await ax.get('/x', { key: true })).config.key).toBe(true);
        expect(before).toHaveBeenCalledTimes(1);
    });

    it('[key.req.key.scope.callback] 请求级 scope 回调抛错保留错误身份', () => {
        const error = new Error('租户读取失败');
        expect(() => $parse({ key: { scope: () => { throw error; } } })).toThrow(error);
    });

    it('[key.req.key.enable] 请求级关闭应阻止抛错的 scope 回调', () => {
        const scope = vi.fn(() => { throw new Error('不可执行'); });
        expect($parse({ key: { enable: false, scope } })).toBeNull();
        expect(scope).not.toHaveBeenCalled();
    });
});

describe('key — scope、采样与错误边界', () => {
    it.each([null, undefined, '', NaN])('[key.fn.$parse][key.opt.scope][key.cb.scope] scope=%s 不增加后缀', (scope) => {
        expect($parse({ key: 'literal' }, { scope: () => scope })).toBe('literal');
    });
    it('[key.fn.$parse][key.opt.scope][key.req.key.scope] scope=0 不丢失，请求级静态空 scope 可覆盖插件值', () => {
        expect($parse({ key: 'literal' }, { scope: 0 })).toBe('literal#0');
        const config = { url: '/x', key: { scope: '' } };
        expect($parse(config, { scope: 'plugin' })).toBe($parse(config));
    });
    it('[key.fn.$parse][key.req.key.callback][key.cb.scope] 用户 key/scope/getter 抛错保持身份，不被当作不可序列化哨兵吞掉', () => {
        const error = new Error('user callback');
        expect(() => $parse({ key: () => { throw error; } })).toThrow(error);
        expect(() => $parse({ key: 'k' }, { scope: () => { throw error; } })).toThrow(error);
        const data = { get value() { throw error; } };
        expect(() => fingerprint(data)).toThrow(error);
    });
});

describe('key — scope、采样与错误边界', () => {
    it('[key.fn.$key][key.opt.sample][key.req.key.sample] 采样长字符串时首中尾差异均影响指纹，短字符串仍全量计算', () => {
        const base = 'a'.repeat(100);
        for (const index of [0, 48, 99]) {
            const changed = base.slice(0, index) + 'b' + base.slice(index + 1);
            expect(fingerprint(changed, { sample: true })).not.toBe(fingerprint(base, { sample: true }));
        }
        expect(fingerprint('short', { sample: true })).toBe(fingerprint('short', { sample: false }));
    });
    it('[key.fn.$key] 继承属性不参与 deep key，无原型对象按自有字段计算', () => {
        const data = Object.assign(Object.create({ inherited: 42 }), { own: 1 });
        expect(fingerprint(data)).toBe(fingerprint({ own: 1 }));
        expect(fingerprint(Object.assign(Object.create(null), { own: 1 }))).toBe(fingerprint({ own: 1 }));
    });
});

