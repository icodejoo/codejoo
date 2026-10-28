import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { Axp, axpKey, axpShare } from '../../src';
import { makeNetwork } from '../helpers/network';
import cancel, { cancelAll } from '../../src/plugins/cancel';

describe('cancel — 与 cache / share / retry 组合（Axp.install 规范顺序）', () => {
    it('[cancel.fn.cancelAll × share.opt.policy] cancel + key + share：并发同 key 请求全部完成后 cancelAll 返回 0', async () => {
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { key: axpKey(), cancel: cancel(), share: axpShare() });
        const reqs = Array.from({ length: 5 }, () => ax.get('/s', { key: 'same', share: 'start', latency: 10 } as any));
        await Promise.all(reqs);
        expect(net.calls('GET', '/s')).toBe(1);
        expect(cancelAll(ax)).toBe(0);
    });
});
