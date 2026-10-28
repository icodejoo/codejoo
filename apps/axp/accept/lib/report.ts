import fs from "node:fs";
import path from "node:path";
import { ALL_NETWORKS, ALL_STYLES } from "./constants.ts";
import type { NetworkName, Style } from "./constants.ts";
import { domainOf } from "./loader.ts";
import type { PlanEntry, RunResult, RunStatus } from "./types.ts";

/** 矩阵单元格：该领域在某网络×风格下的三态计数 */
export interface Cell {
  passed: number;
  failed: number;
  skipped: number;
}

/** 矩阵：领域 → `网络@风格` → 计数 */
export type Matrix = Record<string, Record<string, Cell>>;

/** 汇总 */
export interface Totals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  skipReasons: Record<string, number>;
}

/** JSON 报告 */
export interface Report {
  generatedAt: string;
  config: { server: string; netem: string; scenarios: string; filters: unknown };
  totals: Totals;
  matrix: Matrix;
  runs: RunResult[];
}

/** 矩阵列键 */
export const cellKey = (n: NetworkName, s: Style): string => `${n}@${s}`;

/**
 * 把跳过的计划条目转成结果，原因写成 `skipped: ...`。
 * @param entry 计划条目（decision 为 skip）
 */
export function skippedResult(entry: PlanEntry): RunResult {
  const reason = entry.decision.kind === "skip" ? entry.decision.reason : "";
  return {
    key: entry.key,
    scenarioId: entry.scenario.id,
    domain: domainOf(entry.scenario.id),
    network: entry.network,
    style: entry.style,
    adapter: entry.adapter,
    status: "skipped",
    reasons: [`skipped: ${reason}`],
    durationMs: 0,
  };
}

/**
 * 汇总通过/失败/跳过数量与跳过原因分布。
 * @param results 全部结果
 */
export function totalsOf(results: RunResult[]): Totals {
  const t: Totals = { total: results.length, passed: 0, failed: 0, skipped: 0, skipReasons: {} };
  for (const r of results) {
    t[r.status]++;
    if (r.status === "skipped") {
      const reason = (r.reasons[0] ?? "").replace(/^skipped: /, "");
      t.skipReasons[reason] = (t.skipReasons[reason] ?? 0) + 1;
    }
  }
  return t;
}

/**
 * 汇总成矩阵（领域 × 网络 × 风格），adapter 维度合并计数。
 * @param results 全部结果
 */
export function buildMatrix(results: RunResult[]): Matrix {
  const m: Matrix = {};
  for (const r of results) {
    const row = (m[r.domain] ??= {});
    const cell = (row[cellKey(r.network, r.style)] ??= { passed: 0, failed: 0, skipped: 0 });
    cell[r.status as RunStatus]++;
  }
  return m;
}

/** 单元格文本：失败优先显示 `✗n`，其次 `通过/总数`，全跳过显示 `-` */
function cellText(c: Cell | undefined): string {
  if (!c) return ".";
  if (c.failed) return `${c.passed}✗${c.failed}`;
  if (c.passed) return `${c.passed}`;
  return "-";
}

/**
 * 把矩阵渲染成文本表：每个风格一张表，行是领域，列是网络。
 * 图例：数字=通过数，`a✗b`=通过 a 个、失败 b 个，`-`=全部跳过，`.`=没有该组合。
 * @param matrix 矩阵
 */
export function renderMatrix(matrix: Matrix): string {
  const domains = Object.keys(matrix).sort();
  const nameW = Math.max(6, ...domains.map((d) => d.length));
  const colW = 11;
  const out: string[] = [];
  for (const style of ALL_STYLES) {
    out.push(`\n风格 ${style}：`);
    out.push(`${"领域".padEnd(nameW)} ${ALL_NETWORKS.map((n) => n.padStart(colW)).join("")}`);
    for (const d of domains) {
      out.push(`${d.padEnd(nameW)} ${ALL_NETWORKS.map((n) => cellText(matrix[d]?.[cellKey(n, style)]).padStart(colW)).join("")}`);
    }
  }
  out.push("\n图例：数字=通过数；a✗b=通过 a 个、失败 b 个；-=全部跳过；.=没有该组合（adapter 合并计数）");
  return out.join("\n");
}

/**
 * 单次运行的一行输出。
 * @param r 结果
 */
export function formatLine(r: RunResult): string {
  const tag = r.status === "passed" ? "PASS" : r.status === "failed" ? "FAIL" : "SKIP";
  return `${tag} ${r.scenarioId} [${r.network}/${r.style}/${r.adapter}] ${r.durationMs}ms`;
}

/**
 * 失败原因的缩进输出。
 * @param r 结果
 */
export function formatReasons(r: RunResult): string {
  return r.reasons.map((x) => `     - ${x}`).join("\n");
}

/**
 * 把报告写成 JSON：`report-<时间戳>.json` 与 `latest.json`。
 * @param dir 报告目录（不存在会创建）
 * @param report 报告内容
 * @returns 带时间戳的文件路径
 */
export function writeJsonReport(dir: string, report: Report): string {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const file = path.join(dir, `report-${stamp}.json`);
  const text = JSON.stringify(report, null, 2);
  fs.writeFileSync(file, text);
  fs.writeFileSync(path.join(dir, "latest.json"), text);
  return file;
}
