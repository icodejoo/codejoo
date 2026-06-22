// 类型机器性能基准：对若干「形态变体」用 tsc --extendedDiagnostics 量 checker 堆内存/类型数/耗时。
// 运行：node bench/run.mjs
import { generate } from "./generate.mjs";
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

function findTsc() {
  const pnpm = join(repoRoot, "node_modules", ".pnpm");
  for (const d of existsSync(pnpm) ? readdirSync(pnpm).filter((x) => x.startsWith("typescript@")) : []) {
    const cand = join(pnpm, d, "node_modules", "typescript", "lib", "tsc.js");
    if (existsSync(cand)) return cand;
  }
  const direct = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
  if (existsSync(direct)) return direct;
  throw new Error("tsc.js not found — install typescript");
}
const TSC = findTsc();

const variants = [
  { name: "global + interface (current default)", opts: { wrap: "global", decl: "interface" } },
  { name: "module + interface", opts: { wrap: "module", decl: "interface" } },
  { name: "global + type (pre-Tier1)", opts: { wrap: "global", decl: "type" } },
  { name: "global + iface, methodOnly index", opts: { wrap: "global", decl: "interface", index: "methodOnly" } },
  { name: "global + iface, no Paths union", opts: { wrap: "global", decl: "interface", union: false } },
  { name: "global + iface, methodOnly + no union", opts: { wrap: "global", decl: "interface", index: "methodOnly", union: false } },
];

const METRICS = ["Memory used", "Types", "Symbols", "Instantiations", "Check time", "Total time"];
function parse(out) {
  const lines = out.split("\n");
  const r = {};
  for (const m of METRICS) {
    const l = lines.find((x) => x.trim().startsWith(m + ":"));
    r[m] = l
      ? l
          .slice(l.indexOf(":") + 1)
          .trim()
          .split(/\s+/)[0]
      : "-";
  }
  return r;
}
function run(opts) {
  const dir = join(tmpdir(), "axp-bench", Math.random().toString(36).slice(2));
  generate(dir, opts);
  let out;
  try {
    out = execFileSync(process.execPath, [TSC, "-p", join(dir, "tsconfig.json"), "--extendedDiagnostics"], { encoding: "utf8" });
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "");
  }
  return parse(out);
}

console.log("tsc:", TSC, "\n");
const rows = variants.map((v) => ({ name: v.name, ...run(v.opts) }));
const cols = ["name", ...METRICS];
const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
const line = (vals) => vals.map((x, i) => String(x ?? "").padEnd(w[i])).join("  ");
console.log(line(cols));
console.log(w.map((x) => "-".repeat(x)).join("  "));
for (const r of rows) console.log(line(cols.map((c) => r[c])));
