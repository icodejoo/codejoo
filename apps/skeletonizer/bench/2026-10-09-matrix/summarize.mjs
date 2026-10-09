// 汇总 results/*.jsonl：node summarize.mjs [markdown|json]
// 同一场景正向、反向两遍各自是 3 次中位数；表里给两遍的平均，并标出两遍差异大的（>20% 且 >2 单位）
import fs from "node:fs";
const DIR = new URL("./results/", import.meta.url);
const load = (f) => (fs.existsSync(new URL(f, DIR)) ? fs.readFileSync(new URL(f, DIR), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const batches = ["A", "B", "C", "D", "E", "S", "F"];
const METRICS = ["fps", "UpdateLayoutTree", "PrePaint", "Paint", "toggleMs"];
export const all = {};
for (const b of batches) for (const [pass, f] of [[1, `${b}.jsonl`], [2, `${b}-rev.jsonl`]]) for (const r of load(f)) { (all[r.name] ??= { name: r.name, passes: {} }).passes[pass] = { ...r, batch: b }; }
const avg = (xs) => { xs = xs.filter((x) => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
for (const s of Object.values(all)) {
  s.m = {};
  for (const k of [...METRICS, "Layout", "elements", "mainBusy", "gpu", "compositor"]) {
    const ZERO = ["UpdateLayoutTree", "PrePaint", "Paint", "Layout", "gpu", "compositor"].includes(k);
    const v = [1, 2].map((p) => (s.passes[p] ? (s.passes[p][k] ?? (ZERO ? 0 : undefined)) : undefined));
    s.m[k] = avg(v); s.m[k + "_d"] = v[0] != null && v[1] != null ? Math.abs(v[0] - v[1]) : 0;
  }
  s.snap = (s.passes[1] || s.passes[2]).snap;
}
const f1 = (x) => (x == null ? "—" : (+x).toFixed(1));
const f2 = (x) => (x == null ? "—" : (+x).toFixed(2));
export const row = (name) => {
  const s = all[name]; if (!s) return `| ${name} | 缺 |`;
  const m = s.m; const flag = (k) => (m[k + "_d"] > 2 && m[k + "_d"] / Math.max(m[k], 1e-9) > 0.2 ? "*" : "");
  return `| ${m.elements} | ${f1(m.fps)}${flag("fps")} | ${f2(m.UpdateLayoutTree)}${flag("UpdateLayoutTree")} | ${f2(m.PrePaint)}${flag("PrePaint")} | ${f2(m.Paint)}${flag("Paint")} | ${m.toggleMs == null ? "—" : f1(m.toggleMs)} |`;
};
if (process.argv[2] === "json") console.log(JSON.stringify(all, null, 1));
else if (process.argv[2] !== "pivot") for (const b of batches) {
  console.log(`\n### ${b}`); console.log("| 场景 | 元素 | fps | 样式重算 ms/帧 | PrePaint | Paint | 开启 ms |\n|---|---|---|---|---|---|---|");
  for (const s of Object.values(all).filter((x) => Object.values(x.passes)[0].batch === b)) console.log(`| ${s.name} ${row(s.name)}`);
}
// pivot 模式：500 / 2000（4000 / 16000 元素）并排，供报告用：node summarize.mjs pivot
if (process.argv[2] === "pivot") {
  const cell = (s) => (s ? `${f1(s.m.fps)} / ${f2(s.m.UpdateLayoutTree)} / ${f2(s.m.PrePaint)} / ${f2(s.m.Paint)}` : "—");
  const tog = (s) => (s && s.m.toggleMs != null ? f1(s.m.toggleMs) : "—");
  const groups = {};
  for (const s of Object.values(all)) { const m = s.name.match(/^(\S+) (.*) @(\d+)$/); if (!m || m[1].startsWith("CAN")) continue; ((groups[m[1]] ??= { id: m[1], desc: m[2], b: Object.values(s.passes)[0].batch }))[m[3]] = s; }
  let cur = "";
  for (const g of Object.values(groups)) {
    if (g.b !== cur) { cur = g.b; console.log(`\n#### ${cur}\n| 编号 | 场景 | 4000 元素 fps / 样式 / PrePaint / Paint | 16000 元素 fps / 样式 / PrePaint / Paint | 开启 ms（4000 / 16000） |\n|---|---|---|---|---|`); }
    console.log(`| ${g.id} | ${g.desc} | ${cell(g[500])} | ${cell(g[2000] || g[100])} | ${tog(g[500])} / ${tog(g[2000] || g[100])} |`);
  }
  console.log("\n金丝雀（同一场景批首批尾各测一次）：");
  for (const s of Object.values(all).filter((x) => x.name.startsWith("CAN"))) console.log(`- ${s.name}: fps ${f1(s.m.fps)} 样式 ${f2(s.m.UpdateLayoutTree)} 开启 ${f1(s.m.toggleMs)}`);
}
