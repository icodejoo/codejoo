import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import filter from '../../src/plugins/filter';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 构造 adapter 层成功响应。 */
function response(config: any, data: unknown = 'ok') {
    return { config, data, status: 200, statusText: '', headers: {} };
}

describe('envs/filter/repath — 次要分支与卸载', () => {
    it('[filter.req.filter.callback][filter.fn.axpFilter] filter 函数解析为 false 时删除配置，数组与文本保持原值', async () => {
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        const off = filter().install(ax);
        await ax.post('/', 'body', { params: [1, null], filter: () => false });
        const config = adapter.mock.calls[0][0];
        expect(config).not.toHaveProperty('filter');
        expect(config.params).toEqual([1, null]);
        expect(config.data).toBe('body');
        off?.();
        await ax.get('/', { params: { empty: null }, filter: true });
        expect(adapter.mock.calls[1][0].params).toEqual({ empty: null });
    });
});
