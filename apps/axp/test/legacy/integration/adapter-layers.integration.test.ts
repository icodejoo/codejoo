import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { Axp } from '../../../src/install';
import cache from '../../../src/plugins/cache';
import share from '../../../src/plugins/share';
import { create } from '../../../src/core';
import { wrapAdapter, getBaseAdapter } from '../../../src/helper';

const resp = (data: any, config: any = {}): AxiosResponse =>
    ({ status: 200, statusText: 'OK', headers: {}, config, data }) as any;

describe('wrapAdapter — #18 每层可独立移除', () => {
    it('[helper.wrapAdapter] 非 LIFO 移除：先摘 A 不影响 B，再摘 B 不会复活 A', async () => {
        const base = vi.fn(async (c: any) => resp('base', c));
        const ax = axios.create({ adapter: base as any });
        const calls: string[] = [];
        const rmA = wrapAdapter(ax, (prev) => (c) => {
            calls.push('A');
            return prev(c);
        });
        const rmB = wrapAdapter(ax, (prev) => (c) => {
            calls.push('B');
            return prev(c);
        });
        await (ax.defaults.adapter as any)({});
        expect(calls).toEqual(['B', 'A']);
        calls.length = 0;
        rmA();
        await (ax.defaults.adapter as any)({});
        expect(calls).toEqual(['B']);
        rmB();
        expect(ax.defaults.adapter).toBe(base);
    });

    it('[helper.wrapAdapter] 重复 remove 无副作用；层闭包状态在重建链后保留', async () => {
        const base = vi.fn(async (c: any) => resp('base', c));
        const ax = axios.create({ adapter: base as any });
        let n = 0;
        wrapAdapter(ax, (prev) => (c) => {
            n++;
            return prev(c);
        });
        const rmB = wrapAdapter(ax, (prev) => prev);
        rmB();
        rmB();
        await (ax.defaults.adapter as any)({});
        await (ax.defaults.adapter as any)({});
        expect(n).toBe(2);
    });

    it('[helper.getBaseAdapter] getBaseAdapter 返回最底层 adapter', () => {
        const base = vi.fn();
        const ax = axios.create({ adapter: base as any });
        wrapAdapter(ax, (prev) => prev);
        expect(getBaseAdapter(ax)).toBe(base);
    });
});

describe('cache / share 非 LIFO 卸载（Axp 级）', () => {
    it('[cache.method.cleanup][share.method.cleanup] 先卸内层 cache，外层 share 仍正常；全摘后不复活 cache', async () => {
        const net = vi.fn(async (c: any) => resp({ n: 1 }, c));
        const ax = axios.create({ adapter: net as any });
        const h1 = Axp.install(ax, { cache: cache() });
        const h2 = Axp.install(ax, { share: share() });
        h1.dispose();
        await ax.get('/a', { cache: true, key: 'k' } as any);
        await ax.get('/a', { cache: true, key: 'k' } as any);
        expect(net).toHaveBeenCalledTimes(2);
        h2.dispose();
        expect(typeof ax.defaults.adapter).toBe('function');
        await ax.get('/a', { cache: true, key: 'k' } as any);
        expect(net).toHaveBeenCalledTimes(3);
    });
});

describe('Core.extends — #17 不继承父实例的插件 adapter', () => {
    it('[public.member.Core.extends] 子实例不命中父缓存', async () => {
        const net = vi.fn(async (c: any) => resp({ n: 1 }, c));
        const parent = create(axios.create({ adapter: net as any }));
        cache().install(parent.axios);
        await parent.axios.get('/a', { cache: true, key: 'k' } as any);
        await parent.axios.get('/a', { cache: true, key: 'k' } as any);
        expect(net).toHaveBeenCalledTimes(1);
        const child = parent.extends();
        await child.axios.get('/a', { cache: true, key: 'k' } as any);
        await child.axios.get('/a', { cache: true, key: 'k' } as any);
        expect(net).toHaveBeenCalledTimes(3);
    });

    it('[public.member.Core.extends] overrides.adapter 仍可覆盖', async () => {
        const net = vi.fn(async (c: any) => resp('p', c));
        const mine = vi.fn(async (c: any) => resp('c', c));
        const parent = create(axios.create({ adapter: net as any }));
        cache().install(parent.axios);
        const child = parent.extends({ adapter: mine as any });
        const r = await child.axios.get('/a');
        expect(r.data).toBe('c');
    });
});
