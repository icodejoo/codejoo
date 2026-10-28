import { it, expect } from 'vitest';
import axios from 'axios';
import mock from '../../src/plugins/mock';
import { Axp } from '../../src/install';
import retry from '../../src/plugins/retry';
import { makeNetwork } from '../helpers/network';

it('[mock.req.mock × retry.opt.max] review #2 — retry 保留请求级 mock:false', async () => {
    const path = '/review-mock';
    const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit === 1 ? 500 : 200 }));
    const ax = axios.create({ adapter: net.adapter });
    Axp.install(ax, { retry: retry({ max: 1, delay: 0 }), mock: mock({ enable: true, mock: true, mockUrl: 'http://mock' }) });
    await ax.get(path, { mock: false });
    expect(net.log.map((record) => record.url)).toEqual([path, path]);
});
