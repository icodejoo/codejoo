import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { Axp } from '../../../src/install';
import type { Plugin } from '../../../src/types';

/** 构造记录 install/cleanup 事件的插件；fail 为真时 install 抛错 */
function mkPlugin(name: string, log: string[], fail = false): Plugin {
    return {
        name,
        /** 安装：记录事件，必要时抛错 */
        install() {
            if (fail) throw new Error('boom:' + name);
            log.push('install:' + name);
            return () => { log.push('dispose:' + name); };
        },
    };
}

describe('AxpHandle — 边界', () => {
    it('[public.handle.axios] 返回同一实例，dispose 后仍可读取', () => {
        const ax = axios.create();
        const h = Axp.install(ax, {});
        h.dispose();
        expect(h.axios).toBe(ax);
    });
    it('[public.fn.Axp.install] null/false/undefined 的槽位被忽略；初始安装中途抛错则倒序回滚并 rethrow', () => {
        const log: string[] = [];
        const h = Axp.install(axios.create(), { logger: null, envs: false, auth: undefined, key: mkPlugin('k', log) });
        expect(h.plugins.map((p) => p.name)).toEqual(['k']);
        log.length = 0;
        expect(() => Axp.install(axios.create(), { logger: mkPlugin('a', log), envs: mkPlugin('b', log), auth: mkPlugin('c', log, true) })).toThrow('boom:c');
        expect(log).toEqual(['install:a', 'install:b', 'dispose:b', 'dispose:a']);
    });
    it('[public.handle.plugins] 空名称/重复名称插件不影响快照；返回值每次都是新数组', () => {
        const log: string[] = [];
        const h = Axp.install(axios.create(), { envs: mkPlugin('', log), key: mkPlugin('', log) });
        expect(h.plugins).toHaveLength(2);
        expect(h.plugins).not.toBe(h.plugins);
        h.dispose();
        expect(h.plugins).toEqual([]);
    });
    it('[public.handle.plugin] 空串/不存在名称返回 undefined；重名取先注册者；dispose 后查不到', () => {
        const log: string[] = [];
        const first = mkPlugin('dup', log);
        const h = Axp.install(axios.create(), { envs: first, key: mkPlugin('dup', log) });
        expect(h.plugin('dup')).toBe(first);
        expect(h.plugin('')).toBeUndefined();
        expect(h.plugin(undefined as any)).toBeUndefined();
        h.dispose();
        expect(h.plugin('dup')).toBeUndefined();
    });
    it('[public.handle.dispose] 无 cleanup 的插件跳过；cleanup 抛错不中断后续、结束后抛第一个错；重复 dispose 不再调用 cleanup', () => {
        const cleanup = vi.fn();
        const h = Axp.install(axios.create(), {
            envs: { name: 'a', install: () => cleanup },
            key: { name: 'b', install: () => undefined },
        });
        h.dispose();
        h.dispose();
        expect(cleanup).toHaveBeenCalledTimes(1);
        const bad = Axp.install(axios.create(), {
            envs: { name: 'a', install: () => cleanup },
            key: { name: 'b', install: () => () => { throw new Error('bad cleanup'); } },
        });
        cleanup.mockClear();
        expect(() => bad.dispose()).toThrow('bad cleanup');
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(() => bad.dispose()).not.toThrow();
    });
    it('[public.handle.dispose] 多个 cleanup 抛错：全部执行、列表清空，抛出第一个（倒序先执行的）错误', () => {
        const log: string[] = [];
        const mk = (n: string, fail: boolean) => ({ name: n, install: () => () => { log.push(n); if (fail) throw new Error('err:' + n); } });
        const h = Axp.install(axios.create(), { envs: mk('a', true), key: mk('b', true), filter: mk('c', false) } as any);
        expect(() => h.dispose()).toThrow(/err:/);
        expect(log.length).toBe(3);
        expect(h.plugins).toEqual([]);
    });
    it('[public.handle.prepend] 空 handle 上 prepend 等价于唯一插件；install 抛错时回滚到原顺序并 rethrow', () => {
        const log: string[] = [];
        const h = Axp.install(axios.create(), {});
        const only = mkPlugin('only', log);
        h.prepend(only);
        expect(h.plugins).toEqual([only]);
        log.length = 0;
        expect(() => h.prepend(mkPlugin('bad', log, true))).toThrow('boom:bad');
        expect(h.plugins).toEqual([only]);
        expect(log).toEqual(['dispose:only', 'install:only']);
    });
    it('[public.handle.append] 同一插件对象重复 append：各自有独立 cleanup；install 抛错则不入列', () => {
        const log: string[] = [];
        const h = Axp.install(axios.create(), {});
        const p = mkPlugin('p', log);
        h.append(p);
        h.append(p);
        expect(h.plugins).toHaveLength(2);
        log.length = 0;
        h.dispose();
        expect(log).toEqual(['dispose:p', 'dispose:p']);
        expect(() => h.append(mkPlugin('bad', log, true))).toThrow('boom:bad');
        expect(h.plugins).toEqual([]);
    });
    it('[public.handle.insertBefore] anchor 不在 handle 中（含 dispose 后）抛带名称的错，且不触发任何 cleanup', () => {
        const log: string[] = [];
        const a = mkPlugin('a', log);
        const h = Axp.install(axios.create(), { envs: a });
        log.length = 0;
        expect(() => h.insertBefore(mkPlugin('ghost', log), mkPlugin('n', log))).toThrow(/anchor "ghost" is not installed/);
        expect(log).toEqual([]);
        h.dispose();
        expect(() => h.insertBefore(a, mkPlugin('n', log))).toThrow(/anchor "a"/);
    });
    it('[public.handle.insertAfter] anchor 为最后一个等价于追加；anchor 非本 handle 抛错；新插件装不上时回滚', () => {
        const log: string[] = [];
        const a = mkPlugin('a', log);
        const b = mkPlugin('b', log);
        const h = Axp.install(axios.create(), { envs: a, key: b });
        const n = mkPlugin('n', log);
        h.insertAfter(b, n);
        expect(h.plugins).toEqual([a, b, n]);
        expect(() => h.insertAfter(mkPlugin('x', log), mkPlugin('y', log))).toThrow(/anchor "x"/);
        expect(() => h.insertAfter(a, mkPlugin('bad', log, true))).toThrow('boom:bad');
        expect(h.plugins).toEqual([a, b, n]);
    });
});
