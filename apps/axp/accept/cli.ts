/**
 * axp 的 testkit 验收执行器入口。
 *
 * 用法：
 *   npm run accept                 # 先 vp pack，再对真实服务器 + netem 跑全部场景
 *   npm run accept:dry             # 干跑：只输出运行计划、跳过统计，并检查中立选项能否映射
 *   node accept/cli.ts --id auth. --network normal --style http --adapter http
 *
 * 环境变量：TESTKIT_SERVER、TESTKIT_NETEM、TESTKIT_SCENARIOS（见 lib/constants.ts）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from './lib/config.ts';
import type { AcceptConfig } from './lib/config.ts';
import { analyzeDryRun, renderDryRun } from './lib/dry-run.ts';
import { loadScenarios, LoaderError } from './lib/loader.ts';
import { buildPlan } from './lib/plan.ts';
import { buildMatrix, formatLine, formatReasons, renderMatrix, skippedResult, totalsOf, writeJsonReport } from './lib/report.ts';
import type { Report } from './lib/report.ts';
import type { PlanEntry, RunResult } from './lib/types.ts';

/** accept/ 目录绝对路径 */
const ACCEPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 被测产物入口（打包后的 esm） */
const DIST_ENTRY = path.resolve(ACCEPT_DIR, '..', 'dist', 'esm', 'index.mjs');
/** 每完成多少个运行输出一次进度 */
const PROGRESS_EVERY = 50;
/** 退出码：有失败 */
const EXIT_FAILED = 1;
/** 退出码：环境不可用（缺产物、连不上服务） */
const EXIT_ENV = 2;

/** 预检：测试服务器与 netem 都可达，避免上千条运行逐条报同一个连接错误 */
async function preflight(cfg: AcceptConfig): Promise<string | null> {
  const probe = async (label: string, url: string): Promise<string | null> => {
    try {
      await fetch(url, { signal: AbortSignal.timeout(3000) });
      return null;
    } catch (e) {
      return `${label} 不可达（${url}）: ${(e as Error).message}`;
    }
  };
  return (await probe('测试服务器', `${cfg.server}/t/ping`)) ?? (await probe('netem 控制面', `${cfg.netem}/presets`));
}

/** 执行全部待跑条目，边跑边输出，返回包含跳过项的完整结果 */
async function execute(cfg: AcceptConfig, plan: PlanEntry[]): Promise<RunResult[]> {
  const { runEntry, mapPool } = await import('./lib/runner.ts');
  const { NetemClient } = await import('./lib/netem-client.ts');
  const deps = { config: cfg, netem: new NetemClient(cfg.netem), session: crypto.randomBytes(3).toString('hex') };
  const toRun = plan.filter((e) => e.decision.kind === 'run');
  let done = 0;
  const ran = await mapPool(toRun, cfg.jobs, async (entry, i) => {
    const r = await runEntry(entry, i + 1, deps);
    done++;
    if (r.status === 'failed') console.log(`${formatLine(r)}\n${formatReasons(r)}`);
    else if (cfg.verbose) console.log(formatLine(r));
    else if (done % PROGRESS_EVERY === 0) console.log(`  ... ${done}/${toRun.length}`);
    return r;
  });
  const byKey = new Map(ran.map((r) => [r.key, r]));
  return plan.map((e) => byKey.get(e.key) ?? skippedResult(e));
}

/** 主流程 */
async function main(): Promise<number> {
  const cfg = parseConfig(process.argv.slice(2), process.env, process.cwd(), ACCEPT_DIR);
  let plan: PlanEntry[];
  try {
    plan = buildPlan(loadScenarios(cfg.scenarios), cfg.filters);
  } catch (e) {
    if (e instanceof LoaderError) { console.error(e.message); return EXIT_ENV; }
    throw e;
  }
  if (cfg.dry) {
    console.log(renderDryRun(analyzeDryRun(plan)));
    return 0;
  }
  if (!fs.existsSync(DIST_ENTRY)) {
    console.error(`缺少打包产物 ${DIST_ENTRY}，请先执行 vp pack（npm run accept 会自动执行）`);
    return EXIT_ENV;
  }
  const env = await preflight(cfg);
  if (env) { console.error(env); return EXIT_ENV; }

  const results = await execute(cfg, plan);
  const totals = totalsOf(results);
  const matrix = buildMatrix(results);
  console.log(renderMatrix(matrix));
  console.log(`\n共 ${totals.total} 项：通过 ${totals.passed}，失败 ${totals.failed}，跳过 ${totals.skipped}`);
  for (const [reason, n] of Object.entries(totals.skipReasons)) console.log(`  skipped: ${reason} × ${n}`);
  const report: Report = {
    generatedAt: new Date().toISOString(),
    config: { server: cfg.server, netem: cfg.netem, scenarios: cfg.scenarios, filters: cfg.filters },
    totals, matrix, runs: results,
  };
  console.log(`JSON 报告: ${writeJsonReport(cfg.reportDir, report)}`);
  return totals.failed ? EXIT_FAILED : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(EXIT_ENV); });
