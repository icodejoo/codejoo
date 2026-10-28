import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import key, { $parse } from '../src/plugins/key';

/** 按指定请求体与选项生成 deep key。 */
function fingerprint(data: unknown, options: any = {}) {
    return $parse({ method: 'post', url: '/x', data, key: { ...options } });
}

describe('key — scope、采样与错误边界', () => {
    it.each([null, undefined, '', NaN])('scope=%s 不增加后缀', (scope) => {
        expect($parse({ key: 'literal' }, { scope: () => scope })).toBe('literal');
    });
    it('scope=0 不丢失，请求级静态空 scope 可覆盖插件值', () => {
        expect($parse({ key: 'literal' }, { scope: 0 })).toBe('literal#0');
        const config = { url: '/x', key: { scope: '' } };
        expect($parse(config, { scope: 'plugin' })).toBe($parse(config));
    });
    it('采样长字符串时首中尾差异均影响指纹，短字符串仍全量计算', () => {
        const base = 'a'.repeat(100);
        for (const index of [0, 48, 99]) {
            const changed = base.slice(0, index) + 'b' + base.slice(index + 1);
            expect(fingerprint(changed, { sample: true })).not.toBe(fingerprint(base, { sample: true }));
        }
        expect(fingerprint('short', { sample: true })).toBe(fingerprint('short', { sample: false }));
    });
    it('继承属性不参与 deep key，无原型对象按自有字段计算', () => {
        const data = Object.assign(Object.create({ inherited: 42 }), { own: 1 });
        expect(fingerprint(data)).toBe(fingerprint({ own: 1 }));
        expect(fingerprint(Object.assign(Object.create(null), { own: 1 }))).toBe(fingerprint({ own: 1 }));
    });
    it('用户 key/scope/getter 抛错保持身份，不被当作不可序列化哨兵吞掉', () => {
        const error = new Error('user callback');
        expect(() => $parse({ key: () => { throw error; } })).toThrow(error);
        expect(() => $parse({ key: 'k' }, { scope: () => { throw error; } })).toThrow(error);
        const data = { get value() { throw error; } };
        expect(() => fingerprint(data)).toThrow(error);
    });
    it('忽略值可以保留 false、空字符串等特殊标签，避免与缺失项等价', () => {
        expect(fingerprint({ value: '' }, { ignores: [''] })).not.toBe(fingerprint({}));
        expect(fingerprint({ value: false }, { ignores: [false] })).not.toBe(fingerprint({ value: false }));
    });
    it('install 将不支持的 body 对应 key 清空；cleanup 后不再计算 key', async () => {
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
