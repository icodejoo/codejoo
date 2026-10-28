import { it, expect } from 'vitest';
import axios from 'axios';
import axpRetry from '../../../src/plugins/retry';
import { Axp } from '../../../src/install';
import { makeNetwork } from '../../helpers/network';
import share from '../../../src/plugins/share';

it('[retry.opt.max × share.req.share] review #2 — 并发重试始终保留 share:false', async () => {
    const path = '/review-share';
    const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit <= 2 ? 500 : 200 }));
    const ax = axios.create({ adapter: net.adapter });
    Axp.install(ax, { retry: axpRetry({ max: 1, delay: 10 }), share: share() });
    await Promise.all(Array.from({ length: 2 }, () => ax.get(path, { key: 'review-share', share: false })));
    expect(net.totalStarted).toBe(4);
});
