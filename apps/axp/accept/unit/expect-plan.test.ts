import { describe, expect, it } from 'vitest';
import { expectKeys, resolveExpectation } from '../lib/expect.ts';
import { buildPlan, matchesIdFilter, missingCapabilities, summarizePlan } from '../lib/plan.ts';
import type { Filters } from '../lib/config.ts';
import type { Expectation, Scenario } from '../lib/types.ts';

/** 构造最小场景 */
function sc(over: Partial<Scenario> & { expect?: Record<string, Expectation> } = {}): Scenario {
  return { id: 'x.one', title: 't', requires: [], networks: ['normal'], steps: [{ wait: 1 }], expect: { '*': {} }, ...over };
}
const NO_FILTER: Filters = { ids: [], networks: [], styles: [], adapters: [] };

describe('expect 合并：网络@风格 > 网络 > *@风格 > *', () => {
  it('候选键从低到高', () => {
    expect(expectKeys('weak', 'business')).toEqual(['*', '*@business', 'weak', 'weak@business']);
  });

  it('高优先级的同名字段覆盖低优先级，未覆盖的字段保留', () => {
    const s = sc({
      networks: ['normal', 'weak'],
      expect: {
        '*': { results: { r: { ok: true } }, client: { pending_after: { eq: 0 } } },
        '*@business': { results: { r: { ok: false } } },
        normal: { server: { total: { eq: 1 } } },
        'normal@business': { results: { r: { ok: false, error: 'status:500' } } },
      },
    });
    const normalBiz = resolveExpectation(s, 'normal', 'business');
    expect(normalBiz?.results).toEqual({ r: { ok: false, error: 'status:500' } });
    expect(normalBiz?.server).toEqual({ total: { eq: 1 } });
    expect(normalBiz?.client).toEqual({ pending_after: { eq: 0 } });
    // normal@http：没有 *@http，也没有 normal@http → 用 normal 的 server + * 的 results
    expect(resolveExpectation(s, 'normal', 'http')?.results).toEqual({ r: { ok: true } });
    // weak@business：只命中 * 与 *@business
    expect(resolveExpectation(s, 'weak', 'business')?.results).toEqual({ r: { ok: false } });
    expect(resolveExpectation(s, 'weak', 'business')?.server).toBeUndefined();
  });

  it('没有任何键命中时返回 null', () => {
    expect(resolveExpectation(sc({ expect: { weak: {} } }), 'normal', 'http')).toBeNull();
  });
});

describe('plan：场景 × 网络 × 风格 × adapter', () => {
  it('默认两种风格、两种 adapter 全展开', () => {
    const plan = buildPlan([sc({ networks: ['normal', 'weak'] })], NO_FILTER);
    expect(plan).toHaveLength(2 * 2 * 2);
    expect(new Set(plan.map((e) => e.key)).size).toBe(8);
  });

  it('styles 收窄风格', () => {
    const plan = buildPlan([sc({ styles: ['http'] })], NO_FILTER);
    expect(plan.map((e) => e.style)).toEqual(['http', 'http']);
  });

  it('缺能力 → skipped: missing <cap>，多个缺失合并书写', () => {
    const s = sc({ requires: ['auth', 'breaker', 'timeout'] });
    expect(missingCapabilities(s)).toEqual(['breaker', 'timeout']);
    const e = buildPlan([s], NO_FILTER)[0];
    expect(e?.decision).toEqual({ kind: 'skip', category: 'missing-capability', reason: 'missing breaker+timeout' });
  });

  it('expect.skip 只跳过对应网络', () => {
    const s = sc({ networks: ['normal', 'offline'], expect: { '*': {}, offline: { skip: '断网时无意义' } } });
    const plan = buildPlan([s], { ...NO_FILTER, adapters: ['http'], styles: ['http'] });
    const byNet = Object.fromEntries(plan.map((e) => [e.network, e.decision.kind]));
    expect(byNet).toEqual({ normal: 'run', offline: 'skip' });
    expect(plan.find((e) => e.network === 'offline')?.decision).toMatchObject({ category: 'not-applicable', reason: 'not applicable: 断网时无意义' });
  });

  it('过滤：id 前缀、网络、风格、adapter', () => {
    const list = [sc({ id: 'auth.a', networks: ['normal', 'weak'] }), sc({ id: 'cache.b', networks: ['normal'] })];
    expect(buildPlan(list, { ...NO_FILTER, ids: ['auth.'] }).every((e) => e.scenario.id === 'auth.a')).toBe(true);
    expect(buildPlan(list, { ...NO_FILTER, networks: ['weak'] }).every((e) => e.network === 'weak')).toBe(true);
    expect(buildPlan(list, { ...NO_FILTER, styles: ['business'], adapters: ['fetch'] })).toHaveLength(3);
    expect(matchesIdFilter('auth.a', [])).toBe(true);
    expect(matchesIdFilter('auth.a', ['cache.', 'auth.'])).toBe(true);
    expect(matchesIdFilter('auth.a', ['cache.'])).toBe(false);
  });

  it('映射问题随条目带出', () => {
    const s = sc({ client: { plugins: { cache: { bogus: 1 } } }, requires: ['cache'] });
    expect(buildPlan([s], NO_FILTER)[0]?.issues).toEqual(['插件 cache.bogus: 没有对应的 axp 参数']);
  });

  it('汇总：总数、执行数、跳过原因分布、按 adapter', () => {
    const list = [sc({ id: 'a.x', requires: ['breaker'] }), sc({ id: 'a.y' })];
    const sum = summarizePlan(buildPlan(list, NO_FILTER));
    expect(sum).toMatchObject({ scenarios: 2, total: 8, toRun: 4, skipped: 4, skipReasons: { 'missing breaker': 4 }, byAdapter: { http: 2, fetch: 2 } });
  });
});
