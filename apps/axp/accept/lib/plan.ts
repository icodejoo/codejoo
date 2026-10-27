import { ALL_ADAPTERS, ALL_STYLES, SUPPORTED_CAPABILITIES } from './constants.ts';
import type { AdapterName } from './constants.ts';
import type { Filters } from './config.ts';
import { resolveExpectation } from './expect.ts';
import { validateScenarioMapping } from './mapping.ts';
import type { PlanEntry, Scenario } from './types.ts';

/** 计划汇总 */
export interface PlanSummary {
  /** 场景数 */
  scenarios: number;
  /** 计划总条数（场景×网络×风格×adapter，已按过滤条件裁剪） */
  total: number;
  /** 需要执行的条数 */
  toRun: number;
  /** 跳过的条数 */
  skipped: number;
  /** 跳过原因 → 条数 */
  skipReasons: Record<string, number>;
  /** adapter → 条数（仅统计需要执行的） */
  byAdapter: Record<string, number>;
}

/**
 * 判断场景缺哪些能力。
 * @param scenario 场景
 * @param supported 客户端具备的能力集合
 * @returns 缺失能力名（按声明顺序）
 */
export function missingCapabilities(scenario: Scenario, supported: ReadonlySet<string> = SUPPORTED_CAPABILITIES): string[] {
  return scenario.requires.filter((c) => !supported.has(c));
}

/**
 * 判断场景 id 是否命中前缀过滤。
 * @param id 场景 id
 * @param prefixes 前缀列表；空表示全部命中
 */
export function matchesIdFilter(id: string, prefixes: string[]): boolean {
  return prefixes.length === 0 || prefixes.some((p) => id.startsWith(p));
}

/**
 * 生成运行计划：场景 × 网络 × 风格 × adapter，并标注每一项是执行还是跳过。
 * 跳过的依据：缺少能力（`skipped: missing <cap>`），或预期里写了 `skip`（该网络/风格下不适用）。
 * 同时给每个场景算一遍"中立选项能否映射"（对该场景的所有条目相同）。
 * @param scenarios 场景列表
 * @param filters 过滤条件（id 前缀、网络、风格、adapter）；空数组表示不过滤
 * @param supported 客户端具备的能力集合，默认 axp 的能力
 * @returns 计划条目，顺序：场景、网络、风格、adapter
 * @example buildPlan(scenarios, { ids: ['auth.'], networks: [], styles: [], adapters: ['http'] })
 */
export function buildPlan(
  scenarios: Scenario[],
  filters: Filters,
  supported: ReadonlySet<string> = SUPPORTED_CAPABILITIES,
): PlanEntry[] {
  const entries: PlanEntry[] = [];
  for (const sc of scenarios) {
    if (!matchesIdFilter(sc.id, filters.ids)) continue;
    const missing = missingCapabilities(sc, supported);
    const issues = validateScenarioMapping(sc);
    const styles = sc.styles ?? ALL_STYLES;
    for (const network of sc.networks) {
      if (filters.networks.length && !filters.networks.includes(network)) continue;
      for (const style of styles) {
        if (filters.styles.length && !filters.styles.includes(style)) continue;
        for (const adapter of ALL_ADAPTERS as readonly AdapterName[]) {
          if (filters.adapters.length && !filters.adapters.includes(adapter)) continue;
          const key = `${sc.id}|${network}|${style}|${adapter}`;
          const base = { key, scenario: sc, network, style, adapter, issues };
          if (missing.length) {
            entries.push({ ...base, decision: { kind: 'skip', category: 'missing-capability', reason: `missing ${missing.join('+')}` } });
            continue;
          }
          const exp = resolveExpectation(sc, network, style);
          if (exp?.skip) {
            entries.push({ ...base, decision: { kind: 'skip', category: 'not-applicable', reason: `not applicable: ${exp.skip}` } });
            continue;
          }
          entries.push({ ...base, decision: { kind: 'run' } });
        }
      }
    }
  }
  return entries;
}

/**
 * 汇总计划：总数、执行数、跳过数及原因分布。
 * @param entries buildPlan 的结果
 */
export function summarizePlan(entries: PlanEntry[]): PlanSummary {
  const skipReasons: Record<string, number> = {};
  const byAdapter: Record<string, number> = {};
  let toRun = 0;
  for (const e of entries) {
    if (e.decision.kind === 'skip') skipReasons[e.decision.reason] = (skipReasons[e.decision.reason] ?? 0) + 1;
    else {
      toRun++;
      byAdapter[e.adapter] = (byAdapter[e.adapter] ?? 0) + 1;
    }
  }
  return {
    scenarios: new Set(entries.map((e) => e.scenario.id)).size,
    total: entries.length,
    toRun,
    skipped: entries.length - toRun,
    skipReasons,
    byAdapter,
  };
}
