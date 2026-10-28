import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import envs from '../../../src/plugins/envs';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function makeAx(): any {
    return { defaults: { baseURL: '', headers: {} } };
}

describe('envs/filter/repath — 次要分支与卸载', () => {
    it.each([{ timeout: 1 }, { name: 'named' }])('[envs.opt.rules[].config][envs.method.cleanup] envs 无 baseURL 配置 %s 也可安装并还原', (config) => {
        const ax = axios.create();
        const before = ax.defaults.timeout;
        const off = envs([{ rule: () => true, config }]).install(ax);
        expect(ax.defaults).toMatchObject(config);
        off?.();
        expect(ax.defaults.timeout).toBe(before);
    });
    it('[envs.cb.rules[].rule] envs rule 抛错不修改 defaults', () => {
        const ax = axios.create();
        const before = ax.defaults.baseURL;
        expect(() => envs([{ rule: () => { throw new Error('rule'); }, config: { baseURL: '/new' } }]).install(ax)).toThrow('rule');
        expect(ax.defaults.baseURL).toBe(before);
    });
});

describe('envs', () => {
    it.each([{}, { timeout: 0, baseURL: '' }])('[envs.opt.rules[].config] 空配置或零值配置 %s 保留其精确含义且可恢复', (config) => {
        const ax = axios.create({ baseURL: '/before', timeout: 1000 });
        const off = envs([{ rule: () => true, config }]).install(ax);
        expect(ax.defaults).toMatchObject({ baseURL: '/before', timeout: 1000, ...config });
        off?.();
        expect(ax.defaults.baseURL).toBe('/before');
        expect(ax.defaults.timeout).toBe(1000);
    });

    it('[envs.method.install][envs.fn.axpEnvs] 空规则列表 → no-op', () => {
        const ax = makeAx();
        const before = { ...ax.defaults };
        envs().install(ax);
        expect(ax.defaults).toEqual(before);
    });
});
