import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import loading from '../../../src/plugins/loading';
import { Axp } from '../../../src/install';
import retry from '../../../src/plugins/retry';
import auth from '../../../src/plugins/auth';
import TokenManager from '../../../src/objects/TokenManager';
import mock from '../../../src/plugins/mock';
import { makeNetwork } from '../../helpers/network';

// 来源 review 补丁
describe('loading 逻辑请求与清理', () => {
    const path = '/review-loading';

    it('[loading.cb.loading × auth.cb.onRefresh] auth 刷新和 replay 后 retry 期间始终显示', async () => {
        const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit === 1 ? 401 : hit === 2 ? 500 : 200 }));
        const values: boolean[] = [];
        const tm = new TokenManager();
        tm.set('old');
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, {
            auth: auth({ tokenManager: tm, onRefresh: () => { expect(values).toEqual([true]); tm.set('fresh'); return true; }, onAccessExpired: vi.fn() }),
            retry: retry({ max: 1, delay: 1 }),
            loading: loading({ loading: (value) => values.push(value) }),
        });
        await ax.get(path);
        expect(values).toEqual([true, false]);
        expect(net.totalStarted).toBe(3);
    });

    it.each([401, 500])('[loading.cb.loading × auth.cb.onRefresh] 首发 %i 后重发抛出无 config 的错误也释放 loading', async (status) => {
        const failure = new Error('adapter failed');
        const net = makeNetwork().on('GET', path, (_config, hit) => {
            if (hit === 1) return { status };
            throw failure;
        });
        const tm = new TokenManager();
        tm.set('old');
        const fn = vi.fn();
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, {
            auth: auth({ tokenManager: tm, onRefresh: () => { tm.set('fresh'); return true; }, onAccessExpired: vi.fn() }),
            retry: retry({ max: 1, delay: 0 }), loading: loading({ loading: fn }),
        });
        await expect(ax.get(path)).rejects.toBe(failure);
        expect(fn.mock.calls.map(([value]) => value)).toEqual([true, false]);
    });
});
