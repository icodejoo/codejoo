import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { Axp, axpKey, axpCache } from '../../../src';
import { makeNetwork } from '../../helpers/network';
import cancel, { cancelAll } from '../../../src/plugins/cancel';

describe('cancel — 与 cache / share / retry 组合（Axp.install 规范顺序）', () => {
    it('[cancel.fn.cancelAll × cache.req.cache] cancel + cache：命中缓存后 controller 不残留，cancelAll 返回 0', async () => {
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { key: axpKey(), cancel: cancel(), cache: axpCache() });
        await ax.get('/a', { key: 'k', cache: true } as any);   // 未命中，真实请求
        await ax.get('/a', { key: 'k', cache: true } as any);   // 命中，响应来自缓存
        expect(net.calls('GET', '/a')).toBe(1);
        expect(cancelAll(ax)).toBe(0);
    });
});
