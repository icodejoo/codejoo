import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { Axp } from '../src/install';
import type { Plugin } from '../src/types';

describe('AxpHandle — 快照与无 cleanup 插件', () => {
    it('空 handle 支持查询、重复 dispose 以及 dispose 后重新 append', () => {
        const ax = axios.create();
        const handle = Axp.install(ax, {});
        expect(handle.plugins).toEqual([]);
        expect(handle.plugin('missing')).toBeUndefined();
        handle.dispose();
        handle.dispose();
        const plugin: Plugin = { name: 'inert', install: vi.fn() };
        handle.append(plugin);
        expect(handle.plugin('inert')).toBe(plugin);
        handle.dispose();
        expect(handle.plugins).toEqual([]);
    });
    it('plugins 每次返回新快照，修改快照不会改变查询及拆卸顺序', () => {
        const events: string[] = [];
        /** 创建可追踪安装和卸载顺序的插件。 */
        function plugin(name: string): Plugin {
            return {
                name,
                /** 记录安装并返回对应的卸载回调。 */
                install() {
                    events.push('install:' + name);
                    return () => { events.push('dispose:' + name); };
                },
            };
        }
        const a = plugin('a');
        const b = plugin('b');
        const handle = Axp.install(axios.create(), { envs: a, key: b });
        const snapshot = handle.plugins as Plugin[];
        snapshot.length = 0;
        expect(handle.plugins).toEqual([a, b]);
        expect(handle.plugin('a')).toBe(a);
        handle.dispose();
        expect(events).toEqual(['install:a', 'install:b', 'dispose:b', 'dispose:a']);
    });
});
