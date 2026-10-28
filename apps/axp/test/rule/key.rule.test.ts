import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import key from '../../src/plugins/key';

describe('key — scope、采样与错误边界', () => {
    it('[key.fn.axpKey][key.method.cleanup] install 将不支持的 body 对应 key 清空；cleanup 后不再计算 key', async () => {
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
