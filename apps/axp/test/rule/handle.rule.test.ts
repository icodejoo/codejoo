import { describe, expect, it } from 'vitest';
import axios from 'axios';
import { Axp } from '../../src/install';
import type { Plugin } from '../../src/types';

/** 构造会在 response 拦截器里记录自己名字的插件（response 拦截器 FIFO，即安装顺序） */
function mkPlugin(name: string, log: string[]): Plugin {
    return {
        name,
        /** 安装：记录并注册 response 拦截器 */
        install(ax) {
            log.push('install:' + name);
            const id = ax.interceptors.response.use((r) => { log.push('run:' + name); return r; });
            return () => { log.push('dispose:' + name); ax.interceptors.response.eject(id); };
        },
    };
}

/** 发一次请求，返回本次实际执行的插件名顺序 */
async function run(ax: ReturnType<typeof axios.create>, log: string[]): Promise<string[]> {
    log.length = 0;
    await ax.get('/x');
    return log.filter((s) => s.startsWith('run:')).map((s) => s.slice(4));
}

/** 带直接返回 200 的 adapter 的 axios */
const mkAx = () => axios.create({ adapter: async (config) => ({ status: 200, statusText: '', headers: {}, config, data: {} }) });

describe('AxpHandle — 顺序操作', () => {
    it('[public.handle.axios] handle.axios 即 install 传入的实例', () => {
        const ax = mkAx();
        expect(Axp.install(ax, {}).axios).toBe(ax);
    });
    it('[public.handle.prepend][public.handle.append][public.handle.insertBefore][public.handle.insertAfter][public.handle.plugins] 各插入方法后 plugins 与实际执行顺序一致', async () => {
        const log: string[] = [];
        const ax = mkAx();
        const a = mkPlugin('a', log);
        const b = mkPlugin('b', log);
        const h = Axp.install(ax, { envs: a, key: b });
        expect(await run(ax, log)).toEqual(['a', 'b']);
        const p = mkPlugin('p', log);
        h.prepend(p);
        expect(h.plugins.map((x) => x.name)).toEqual(['p', 'a', 'b']);
        expect(await run(ax, log)).toEqual(['p', 'a', 'b']);
        const z = mkPlugin('z', log);
        h.append(z);
        expect(await run(ax, log)).toEqual(['p', 'a', 'b', 'z']);
        const m = mkPlugin('m', log);
        h.insertBefore(b, m);
        expect(await run(ax, log)).toEqual(['p', 'a', 'm', 'b', 'z']);
        const n = mkPlugin('n', log);
        h.insertAfter(a, n);
        expect(await run(ax, log)).toEqual(['p', 'a', 'n', 'm', 'b', 'z']);
        expect(h.plugins.map((x) => x.name)).toEqual(['p', 'a', 'n', 'm', 'b', 'z']);
    });
    it('[public.handle.dispose] dispose 按安装顺序反序 cleanup，且之后请求不再经过插件', async () => {
        const log: string[] = [];
        const ax = mkAx();
        const h = Axp.install(ax, { envs: mkPlugin('a', log), key: mkPlugin('b', log) });
        log.length = 0;
        h.dispose();
        expect(log).toEqual(['dispose:b', 'dispose:a']);
        expect(await run(ax, log)).toEqual([]);
    });
    it('[public.handle.prepend][public.handle.insertBefore][public.handle.insertAfter] 重排会整体 cleanup 并按新顺序重装', () => {
        const log: string[] = [];
        const a = mkPlugin('a', log);
        const h = Axp.install(mkAx(), { envs: a });
        log.length = 0;
        h.prepend(mkPlugin('p', log));
        expect(log).toEqual(['dispose:a', 'install:p', 'install:a']);
    });
});
