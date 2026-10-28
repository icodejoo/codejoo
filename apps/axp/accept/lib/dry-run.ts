import { summarizePlan } from "./plan.ts";
import type { PlanSummary } from "./plan.ts";
import type { PlanEntry } from "./types.ts";

/** dry-run 的结构化结果 */
export interface DryRunResult {
  summary: PlanSummary;
  /** 会被执行、但有映射不了的选项的场景（会直接失败，需要处理） */
  unmappedRunnable: Array<{ id: string; issues: string[] }>;
  /** 有映射不了的选项，但本来就因缺少能力而跳过的场景（仅提示） */
  unmappedSkipped: Array<{ id: string; reason: string; issues: string[] }>;
}

/**
 * 干跑分析：不连接任何服务，只汇总运行计划并检查中立选项能否映射。
 * @param entries buildPlan 的结果
 * @returns 结构化结果
 */
export function analyzeDryRun(entries: PlanEntry[]): DryRunResult {
  const seen = new Set<string>();
  const unmappedRunnable: DryRunResult["unmappedRunnable"] = [];
  const unmappedSkipped: DryRunResult["unmappedSkipped"] = [];
  for (const e of entries) {
    if (!e.issues.length || seen.has(e.scenario.id)) continue;
    // 同一场景只要有一个条目会执行，就算"会执行"
    const runnable = entries.some((x) => x.scenario.id === e.scenario.id && x.decision.kind === "run");
    seen.add(e.scenario.id);
    if (runnable) unmappedRunnable.push({ id: e.scenario.id, issues: e.issues });
    else {
      const reason = e.decision.kind === "skip" ? e.decision.reason : "";
      unmappedSkipped.push({ id: e.scenario.id, reason, issues: e.issues });
    }
  }
  return { summary: summarizePlan(entries), unmappedRunnable, unmappedSkipped };
}

/** 按条数降序输出 `键: 数量` */
function sortedLines(map: Record<string, number>, indent = "  "): string[] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${indent}${k}: ${v}`);
}

/**
 * 把干跑结果渲染成文本。
 * @param r analyzeDryRun 的结果
 */
export function renderDryRun(r: DryRunResult): string {
  const s = r.summary;
  const out: string[] = [
    "== accept dry-run（不连接服务器）==",
    `场景数: ${s.scenarios}`,
    `运行计划总数: ${s.total}（场景 × 网络 × 风格 × adapter）`,
    `  需要执行: ${s.toRun}`,
    `  跳过: ${s.skipped}`,
    "跳过原因分布:",
    ...sortedLines(s.skipReasons),
    "待执行条数（按 adapter）:",
    ...sortedLines(s.byAdapter),
    "",
    `映射不了的选项（会执行的场景）: ${r.unmappedRunnable.length} 个场景`,
    ...r.unmappedRunnable.flatMap((x) => [`  ${x.id}`, ...x.issues.map((i) => `    - ${i}`)]),
    `映射不了的选项（本就因缺能力而跳过的场景，仅提示）: ${r.unmappedSkipped.length} 个场景`,
    ...r.unmappedSkipped.map((x) => `  ${x.id}（${x.reason}）: ${x.issues.join("；")}`),
  ];
  return out.join("\n");
}
