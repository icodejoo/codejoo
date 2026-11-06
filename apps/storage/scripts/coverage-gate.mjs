import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, files, section, location, json, isMain } from "./test-infra.mjs";

/** 对 V8 coverage-summary 执行严格门禁，并逐条核对源码豁免。 */
export function checkCoverage({ summary, sources, markdown, root = ROOT }) {
  const errors = [];
  const entries = Object.entries(summary).filter(([name]) => name !== "total");
  const recorded = new Set(entries.map(([name]) => location(name, root)));
  const exemptions = section(markdown, "豁免清单");
  const registered = new Set([...exemptions.matchAll(/^\|\s*`?(src\/[^|`]+:\d+)`?\s*\|\s*([^|]+)\|/gm)].map((match) => match[1].trim()));
  const seen = new Set();
  for (const [path, source] of Object.entries(sources)) {
    if (!recorded.has(path)) errors.push(`没有采集记录: ${path}`);
    const pattern = /(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g;
    for (const match of source.matchAll(pattern)) {
      if (!/\bv8\s+ignore\b/.test(match[0])) continue;
      const key = `${path}:${source.slice(0, match.index).split("\n").length}`;
      seen.add(key);
      if (!registered.has(key)) errors.push(`v8 ignore 未登记: ${key}`);
    }
  }
  for (const key of registered) if (!seen.has(key)) errors.push(`豁免已失效或行号漂移: ${key}`);
  if (entries.length === 0) errors.push("没有文件覆盖率采集记录");
  if (Object.keys(sources).length === 0) errors.push("没有待统计的源文件");
  for (const [name] of entries) if (!(location(name, root) in sources)) errors.push(`统计范围超出 src 或文件已删除: ${name}`);
  const metrics = {};
  for (const [metric, minimum] of [
    ["lines", 100],
    ["branches", 95],
  ]) {
    let total = 0;
    let covered = 0;
    for (const [name, entry] of entries) {
      const value = entry[metric];
      if (!value || !Number.isInteger(value.total) || !Number.isInteger(value.covered) || value.total < 0 || value.covered < 0 || value.covered > value.total) {
        errors.push(`无效 ${metric} 记录: ${name}`);
        continue;
      }
      total += value.total;
      covered += value.covered;
    }
    const reported = summary.total?.[metric];
    if (!reported || reported.total !== total || reported.covered !== covered) errors.push(`${metric} total 与文件记录不一致`);
    const pct = total ? (covered / total) * 100 : 0;
    metrics[metric] = { total, covered, pct, minimum };
    if (total === 0) errors.push(`${metric}: 0/0 判失败`);
    else if (pct < minimum) errors.push(`${metric}: ${covered}/${total} (${pct.toFixed(2)}%) < ${minimum}%`);
  }
  return { errors, metrics };
}

/** 从磁盘读取当前报告，缺失报告、无记录和未登记豁免均返回非零退出码。 */
export function main() {
  try {
    const result = checkCoverage({
      summary: json(resolve(ROOT, process.argv[2] ?? "coverage/coverage-summary.json")),
      sources: Object.fromEntries(
        files(resolve(ROOT, "src"))
          .filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !path.endsWith(".d.ts"))
          .map((path) => [location(path), readFileSync(path, "utf8")]),
      ),
      markdown: readFileSync(resolve(ROOT, "test/ACCEPTANCE.md"), "utf8"),
    });
    for (const [name, metric] of Object.entries(result.metrics)) console.log(`${name}: ${metric.covered}/${metric.total} = ${metric.pct.toFixed(2)}% (要求 ${metric.minimum}%)`);
    for (const error of result.errors) console.error(`[coverage] ${error}`);
    return result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(`[coverage] ${error.message}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main();
