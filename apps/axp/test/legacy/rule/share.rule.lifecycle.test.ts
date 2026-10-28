import { describe, it, expect } from 'vitest';
import axios from 'axios';
import share from '../../../src/plugins/share';
import { makeNetwork } from '../../helpers/network';

describe('share — 安装与卸载', () => {
    it('[share.method.cleanup] 卸载恢复原始 adapter，同 key 的请求各自发送', async () => {
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        const before = ax.defaults.adapter;
        const off = share().install(ax);
        expect(ax.defaults.adapter).not.toBe(before);
        off?.();
        expect(ax.defaults.adapter).toBe(before);
        const results = await Promise.all([ax.get('/x', { key: 'k' }), ax.get('/x', { key: 'k' })]);
        expect(results.map((r) => r.status)).toEqual([200, 200]);
        expect(net.calls('GET', '/x')).toBe(2);
    });
});
