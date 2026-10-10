// 汇总 results/<批>.jsonl：每个场景 clip（默认）与 underline 并排。node summarize.mjs [批...]（默认 G GD F）
import fs from "node:fs";
const DIR = new URL("./results/", import.meta.url);
const batches = process.argv.slice(2).length ? process.argv.slice(2) : ["G", "GD", "F"];
const f = (x, d = 2) => (x == null ? "—" : (+x).toFixed(d));
const cell = (r) => (r ? `${f(r.fps, 1)} / ${f(r.UpdateLayoutTree)} / ${f(r.PrePaint)} / ${f(r.Paint)} / ${f(r.gpu)} / ${f(r.toggleMs, 1)}` : "—");
for (const b of batches) {
  const file = new URL(`${b}.jsonl`, DIR);
  if (!fs.existsSync(file)) continue;
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.log(`\n### ${b}\n列：fps / 样式重算 / PrePaint / Paint / GPU（ms 每帧）/ 开启 ms\n\n| 场景 | 规模 | 默认 clip | underline | clip ÷ underline（GPU / 开启） |\n|---|---|---|---|---|`);
  const by = {};
  for (const r of rows) {
    const m = r.name.match(/^(\S+?)-(clip|ul) (.*?)( 默认clip| underline)? @(\d+)$/);
    if (!m) { if (r.name.startsWith("CAN")) console.log(`| ${r.name} | ${r.elements} | ${cell(r)} | | |`); continue; }
    ((by[`${m[1]} @${m[5]}`] ??= { desc: m[3], n: r.elements }))[m[2]] = r;
  }
  for (const [k, v] of Object.entries(by)) {
    const g = v.clip?.gpu && v.ul?.gpu ? (v.clip.gpu / v.ul.gpu).toFixed(2) : "—";
    const t = v.clip?.toggleMs && v.ul?.toggleMs ? (v.clip.toggleMs / v.ul.toggleMs).toFixed(2) : "—";
    console.log(`| ${k} ${v.desc} | ${v.n} | ${cell(v.clip)} | ${cell(v.ul)} | ${g}× / ${t}× |`);
  }
}
