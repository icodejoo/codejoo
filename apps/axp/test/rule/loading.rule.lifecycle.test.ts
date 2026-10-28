import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import loading from '../../src/plugins/loading';
import { makeNetwork } from '../helpers/network';

describe('loading — 安装与卸载', () => {
    const path = '/loading-lifecycle';

    it('[loading.prop.name] 工厂返回固定插件名称', () => {
        expect(loading().name).toBe('axp:loading');
    });

    it('[loading.method.install][loading.method.cleanup] 安装产生显示隐藏，卸载恢复原 adapter 且后续请求不再回调', async () => {
        const net = makeNetwork();
        const ax = axios.create({ adapter: net.adapter });
        const fn = vi.fn();
        const off = loading({ loading: fn }).install(ax);
        await ax.get(path);
        expect(fn.mock.calls).toEqual([[true], [false]]);
        off?.();
        expect(ax.defaults.adapter).toBe(net.adapter);
        await ax.get(path);
        expect(fn.mock.calls).toEqual([[true], [false]]);
    });

});
