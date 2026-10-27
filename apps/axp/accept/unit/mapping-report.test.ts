import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkRequestOptions, validateScenarioMapping, mapRequestOptions, authUrlPatterns, PLUGIN_OPTION_MAP, REQUEST_OPTION_MAP, UNSUPPORTED_PLUGINS } from '../lib/mapping.ts';
import { parseConfig } from '../lib/config.ts';
import { analyzeDryRun, renderDryRun } from '../lib/dry-run.ts';
import { buildPlan } from '../lib/plan.ts';
import { buildMatrix, renderMatrix, skippedResult, totalsOf } from '../lib/report.ts';
import type { RunResult, Scenario } from '../lib/types.ts';
import { checkLoadingPaired } from '../lib/events.ts';
import { STEP_KINDS } from '../lib/walk.ts';

const sc = (over: Partial<Scenario> = {}): Scenario => ({ id: 'x.one', title: 't', requires: [], networks: ['normal'], steps: [{ wait: 1 }], expect: { '*': {} }, ...over });

describe('映射：中立选项 → axp 参数', () => {
  it('请求级选项翻译', () => {
    expect(mapRequestOptions({ auth: true, cache: { ttl_ms: 300, key: 'ck' }, timeout_ms: 500, silent: true })).toEqual({
      protected: true, cache: { expires: 300, key: 'ck' }, timeout: 500, silent: true,
    });
    expect(mapRequestOptions({ cache: false, share: 'race', loading: false, mock: true, normalize: false })).toEqual({
      cache: false, share: 'race', loading: false, mock: true, normalize: false,
    });
    expect(mapRequestOptions(undefined)).toEqual({});
  });

  it("key：中立 true/'deep' 含查询参数 → axp 'deep'；'simple' → axp true（axp 的 true 不含 params）", () => {
    expect(mapRequestOptions({ key: true }).key).toBe('deep');
    expect(mapRequestOptions({ key: 'deep' }).key).toBe('deep');
    expect(mapRequestOptions({ key: 'simple' }).key).toBe(true);
    expect(mapRequestOptions({ key: 'fixed' }).key).toBe('fixed');
  });

  it('retry：数字/布尔原样，对象翻译并把方法转小写', () => {
    expect(mapRequestOptions({ retry: 1 }).retry).toBe(1);
    expect(mapRequestOptions({ retry: false }).retry).toBe(false);
    expect(mapRequestOptions({ retry: { max: 2, delay_ms: 50, statuses: [429], methods: ['GET', 'POST'], respect_retry_after: true } }).retry).toEqual({
      max: 2, delay: 50, statusCodes: [429], methods: ['get', 'post'], respectRetryAfter: true,
    });
  });

  it('auth.url_pattern 是前缀语义：翻成 [前缀, 前缀/*]', () => {
    expect(authUrlPatterns('/t/private')).toEqual(['/t/private', '/t/private/*']);
    expect(authUrlPatterns('/t/public/guard/')).toEqual(['/t/public/guard', '/t/public/guard/*']);
    expect(authUrlPatterns(undefined)).toEqual(['/t/private', '/t/private/*']);
  });
});

describe('映射不了的选项要显式报错', () => {
  it('未知插件选项 / 取值不支持 / axp 没有的能力', () => {
    expect(validateScenarioMapping(sc({ client: { plugins: { cache: { ttl_ms: 1, bogus: 2 } } } }))).toEqual(['插件 cache.bogus: 没有对应的 axp 参数']);
    expect(validateScenarioMapping(sc({ client: { plugins: { auth: { refresh: 'other' } } } }))[0]).toMatch(/auth\.refresh: 仅支持/);
    expect(validateScenarioMapping(sc({ client: { plugins: { breaker: { threshold: 1 } } } }))).toEqual(['插件 breaker: axp 没有该能力']);
    expect(validateScenarioMapping(sc({ client: { plugins: { key: { scope: 'tenant' } } } }))[0]).toMatch(/key\.scope/);
  });

  it('请求选项：breaker 无对应能力；retry/cache 对象里的未知键也报错', () => {
    expect(checkRequestOptions({ id: 'r', path: '/x', options: { breaker: false } })[0]).toMatch(/breaker/);
    expect(checkRequestOptions({ id: 'r', path: '/x', options: { retry: { max: 1, jitter: true } as never } })[0]).toMatch(/retry\.jitter/);
    expect(checkRequestOptions({ id: 'r', path: '/x', options: { cache: { ttl_ms: 1, foo: 1 } as never } })[0]).toMatch(/cache\.foo/);
    expect(checkRequestOptions({ id: 'r', path: '/x', options: { cache: true, retry: 1 } })).toEqual([]);
  });

  it('嵌套在 parallel/fire/repeat 里的请求也会被检查', () => {
    const s = sc({ steps: [{ parallel: [{ fire: { repeat: { times: 2, step: { request: { id: 'r', path: '/x', options: { breaker: true } } } } } }] }] });
    expect(validateScenarioMapping(s)).toHaveLength(1);
  });

  it('映射表的每个插件都有登记，step 类型共 16 种', () => {
    expect(Object.keys(PLUGIN_OPTION_MAP).sort()).toEqual(['auth', 'cache', 'cancel', 'envs', 'filter', 'key', 'loading', 'log', 'mock', 'normalize', 'notify', 'repath', 'retry', 'share']);
    expect(Object.keys(REQUEST_OPTION_MAP).sort()).toEqual(['auth', 'breaker', 'cache', 'key', 'loading', 'mock', 'normalize', 'retry', 'share', 'silent', 'timeout_ms']);
    expect(STEP_KINDS).toHaveLength(16);
  });

  const dir = 'E:/workspaces/api-ws-demo/testkit/scenarios';
  it.skipIf(!fs.existsSync(dir))('真实场景里，schema 的 pluginOptions 与请求 options 的每个字段都已登记', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(dir, '..', 'scenario.schema.json'), 'utf8'));
    for (const p of Object.keys(schema.$defs.pluginOptions.properties)) expect(PLUGIN_OPTION_MAP[p] ?? (UNSUPPORTED_PLUGINS.includes(p) ? [] : undefined), `pluginOptions.${p}`).toBeDefined();
    for (const o of Object.keys(schema.$defs.request.properties.options.properties)) expect(REQUEST_OPTION_MAP[o], `options.${o}`).toBeDefined();
    for (const k of Object.keys(schema.$defs.step.properties)) expect(STEP_KINDS as readonly string[], `step ${k}`).toContain(k);
  });
});

describe('config：命令行优先于环境变量，未知过滤值直接报错', () => {
  const acceptDir = path.resolve('accept');
  it('默认值与相对路径', () => {
    const c = parseConfig([], { TESTKIT_SCENARIOS: 'rel/dir' }, '/work', acceptDir);
    expect(c.server).toBe('http://127.0.0.1:8080');
    expect(c.netem).toBe('http://127.0.0.1:9090');
    expect(c.scenarios).toBe(path.resolve('/work', 'rel/dir'));
    expect(c.dry).toBe(false);
  });

  it('过滤条件：命令行覆盖环境变量，逗号分隔', () => {
    const c = parseConfig(['--id', 'auth.,cache.', '--network', 'weak', '--adapter', 'fetch', '--dry'], { TESTKIT_NETWORK: 'normal', TESTKIT_STYLE: 'business' }, '/w', acceptDir);
    expect(c.filters).toEqual({ ids: ['auth.', 'cache.'], networks: ['weak'], styles: ['business'], adapters: ['fetch'] });
    expect(c.dry).toBe(true);
  });

  it('非法取值抛错', () => {
    expect(() => parseConfig(['--network', 'mars'], {}, '/w', acceptDir)).toThrow(/未知的网络/);
    expect(() => parseConfig(['--jobs', '0'], {}, '/w', acceptDir)).toThrow(/--jobs/);
  });
});

describe('report / dry-run', () => {
  const mk = (over: Partial<RunResult>): RunResult => ({ key: 'k', scenarioId: 'auth.x', domain: 'auth', network: 'normal', style: 'http', adapter: 'http', status: 'passed', reasons: [], durationMs: 1, ...over });

  it('汇总三态与跳过原因；矩阵按 领域×网络×风格 合并 adapter', () => {
    const rs = [
      mk({}), mk({ adapter: 'fetch' }), mk({ status: 'failed', reasons: ['x'] }),
      mk({ domain: 'cache', status: 'skipped', reasons: ['skipped: missing timeout'] }),
      mk({ domain: 'cache', style: 'business' }),
    ];
    expect(totalsOf(rs)).toEqual({ total: 5, passed: 3, failed: 1, skipped: 1, skipReasons: { 'missing timeout': 1 } });
    const m = buildMatrix(rs);
    expect(m.auth?.['normal@http']).toEqual({ passed: 2, failed: 1, skipped: 0 });
    expect(m.cache?.['normal@business']).toEqual({ passed: 1, failed: 0, skipped: 0 });
    const text = renderMatrix(m);
    expect(text).toContain('风格 http');
    expect(text).toContain('2✗1');
  });

  it('跳过项的结果写成 skipped: <原因>', () => {
    const [e] = buildPlan([sc({ requires: ['breaker'] })], { ids: [], networks: [], styles: [], adapters: [] });
    expect(skippedResult(e!).reasons).toEqual(['skipped: missing breaker']);
  });

  it('dry-run：统计总数/跳过/不可映射；缺能力而跳过的场景单独列出', () => {
    const list = [
      sc({ id: 'a.ok' }),
      sc({ id: 'a.bad', requires: ['cache'], client: { plugins: { cache: { bogus: 1 } } } }),
      sc({ id: 'b.skip', requires: ['breaker'], client: { plugins: { breaker: {} } } }),
    ];
    const r = analyzeDryRun(buildPlan(list, { ids: [], networks: [], styles: [], adapters: [] }));
    expect(r.summary).toMatchObject({ total: 12, toRun: 8, skipped: 4 });
    expect(r.unmappedRunnable.map((x) => x.id)).toEqual(['a.bad']);
    expect(r.unmappedSkipped.map((x) => x.id)).toEqual(['b.skip']);
    const text = renderDryRun(r);
    expect(text).toContain('missing breaker: 4');
    expect(text).toContain('a.bad');
  });

  it('loading 成对检查', () => {
    expect(checkLoadingPaired([])).toBeNull();
    expect(checkLoadingPaired([true, false, true, false])).toBeNull();
    expect(checkLoadingPaired([true])).toMatch(/未成对/);
    expect(checkLoadingPaired([false, true])).toMatch(/最后一个/);
  });
});
