import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import loading from '../../src/plugins/loading';
import { Axp } from '../../src/install';
import retry from '../../src/plugins/retry';
import normalize from '../../src/plugins/normalize';
import cancel, { cancelAll } from '../../src/plugins/cancel';
import { makeNetwork } from '../helpers/network';

// 来源 review 补丁
describe('loading 逻辑请求与清理', () => {
    const path = '/review-loading';

    it.each([200, 500])('[loading.cb.loading × retry.opt.max] retry 最终 %i：等待期间保持显示，最终只有一对回调', async (status) => {
        const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit === 1 ? 500 : status }));
        const values: boolean[] = [];
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, {
            retry: retry({ max: 1, delay: () => { expect(values).toEqual([true]); return 1; } }),
            loading: loading({ loading: (value) => values.push(value) }),
        });
        await ax.get(path).catch(() => undefined);
        expect(values).toEqual([true, false]);
    });

    it('[loading.req.loading × retry.opt.max] loading:false 在 retry 后仍不参与计数', async () => {
        const net = makeNetwork().on('GET', path, (_config, hit) => ({ status: hit === 1 ? 500 : 200 }));
        const fn = vi.fn();
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { retry: retry({ max: 1, delay: 0 }), loading: loading({ loading: fn }) });
        await ax.get(path, { loading: false });
        expect(fn).not.toHaveBeenCalled();
    });

    it('[loading.cb.loading × retry.opt.max] 业务错误与 retry 等待期间取消均正确关闭 loading', async () => {
        const net = makeNetwork().on('GET', path, () => ({ data: { code: 1 } }));
        const values: boolean[] = [];
        const ax = axios.create({ adapter: net.adapter });
        const handle = Axp.install(ax, { normalize: normalize(), loading: loading({ loading: (value) => values.push(value) }) });
        await expect(ax.get(path)).rejects.toThrow();
        expect(values).toEqual([true, false]);
        handle.dispose();
        values.length = 0;
        net.on('GET', path, () => ({ status: 500 }));
        Axp.install(ax, { cancel: cancel(), retry: retry({ max: 1, delay: () => { cancelAll(ax); return 1; } }), loading: loading({ loading: (value) => values.push(value) }) });
        await expect(ax.get(path)).rejects.toMatchObject({ code: 'ERR_CANCELED' });
        expect(values).toEqual([true, false]);
    });
});
