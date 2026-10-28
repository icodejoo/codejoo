import { describe, it, expect, vi } from 'vitest';
import envs from '../../src/plugins/envs';
import axios from 'axios';
import { Axp } from '../../src';
import { use } from '../helpers/install';

function makeAx(): any {
    return { defaults: { baseURL: '', headers: {} } };
}

describe('envs', () => {
    it('[envs.prop.name] 工厂返回固定插件名称', () => {
        expect(envs().name).toBe('axp:envs');
    });
    it('[envs.method.install][envs.fn.axpEnvs][envs.cb.rules[].rule][envs.opt.rules[].config] 选第一个匹配的规则，merge 到 defaults', () => {
        const ax = makeAx();
        envs([
            { rule: () => false, config: { baseURL: 'http://a' } },
            { rule: () => true, config: { baseURL: 'http://b', timeout: 5000 } },
            { rule: () => true, config: { baseURL: 'http://c' } },  // 不会执行
        ]).install(ax);
        expect(ax.defaults.baseURL).toBe('http://b');
        expect(ax.defaults.timeout).toBe(5000);
    });

    it('[envs.cb.rules[].rule] 第一条命中后 break：后续 rule() 不再调用', () => {
        const ax = makeAx();
        const r1 = vi.fn(() => true);
        const r2 = vi.fn(() => true);
        envs([
            { rule: r1, config: { baseURL: '/a' } },
            { rule: r2, config: { baseURL: '/b' } },
        ]).install(ax);
        expect(r1).toHaveBeenCalledOnce();
        expect(r2).not.toHaveBeenCalled();
    });

    it('[envs.fn.axpEnvs] 没有匹配 → 不修改 defaults', () => {
        const ax = makeAx();
        const before = { ...ax.defaults };
        envs([
            { rule: () => false, config: { baseURL: '/a' } },
            { rule: () => false, config: { baseURL: '/b' } },
        ]).install(ax);
        expect(ax.defaults).toEqual(before);
    });

    it('[envs.opt.rules[].config] 合并是浅 Object.assign（不递归）', () => {
        const ax = makeAx();
        ax.defaults.headers = { 'X-A': '1' };
        envs([
            { rule: () => true, config: { headers: { 'X-B': '2' } as any } },
        ]).install(ax);
        // 浅合并：X-A 被整体替换掉
        expect(ax.defaults.headers).toEqual({ 'X-B': '2' });
        expect(ax.defaults.headers['X-A']).toBeUndefined();
    });
});

describe('envs', () => {
  it('[envs.fn.axpEnvs][envs.cb.rules[].rule][envs.opt.rules[].config] the first matching rule wins and its config is shallow-merged into axios.defaults; a later, also-matching rule is never even evaluated', () => {
    const ax = axios.create();
    const api = Axp.create(ax);
    let secondRuleEvaluated = false;
    use(api, envs([
      { rule: () => true, config: { baseURL: 'https://prod.example.com', timeout: 5000, headers: { 'X-Env': 'prod' } } },
      { rule: () => { secondRuleEvaluated = true; return true; }, config: { baseURL: 'https://staging.example.com' } },
    ]));

    expect(ax.defaults.baseURL).toBe('https://prod.example.com');
    expect(ax.defaults.timeout).toBe(5000);
    // envs.ts applies via a flat Object.assign(defaults, config) — no axios
    // header normalization, so this lands exactly where it was given.
    expect((ax.defaults.headers as any)['X-Env']).toBe('prod');
    expect(secondRuleEvaluated).toBe(false);
  });

  it('[envs.fn.axpEnvs] no matching rule leaves axios.defaults untouched', () => {
    const ax = axios.create({ baseURL: 'https://default.example.com' });
    const api = Axp.create(ax);
    use(api, envs([{ rule: () => false, config: { baseURL: 'https://x' } }]));
    expect(ax.defaults.baseURL).toBe('https://default.example.com');
  });

  it('[envs.method.cleanup][envs.fn.axpEnvs] the cleanup install() returns reverts the applied config snapshot', () => {
    const ax = axios.create({ baseURL: 'https://default.example.com' });
    const api = Axp.create(ax);
    const cleanup = envs([{ rule: () => true, config: { baseURL: 'https://x' } }]).install(api.axios);
    expect(ax.defaults.baseURL).toBe('https://x');
    cleanup?.();
    expect(ax.defaults.baseURL).toBe('https://default.example.com');
  });
});
