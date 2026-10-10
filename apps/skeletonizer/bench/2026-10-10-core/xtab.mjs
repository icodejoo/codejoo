// 交叉表：node xtab.mjs <结果 jsonl> —— 行 = 效果，列 = 卡数；每格 帧率 / 样式重算 / PrePaint / Paint / GPU / 开启
// 场景名形如 "core-pulse @250 4x"，金丝雀（CAN-*）单独列出
import fs from "node:fs";
const f = (v, d = 2) => (v == null ? "—" : String(+(+v).toFixed(d)));
const files = process.argv[2].split(",");
const rows = files.flatMap((p) => fs.readFileSync(p, "utf8").trim().split("\n").map(JSON.parse));
const cell = (r) => (r ? `${f(r.fps, 1)} / ${f(r.UpdateLayoutTree)} / ${f(r.PrePaint)} / ${f(r.Paint)} / ${f(r.gpu)} / ${r.toggleMs != null ? f(r.toggleMs, 1) : "—"}` : "—");
const parse = (n) => { const m = n.match(/^(core|full)-(\w+) @(\d+)( 4x)?$/); return m ? { mode: m[1], eff: m[2], n: +m[3], slow: !!m[4] } : null; };
const groups = new Map();
for (const r of rows) {
  const p = parse(r.name); if (!p) continue;
  const g = `${p.mode}${p.slow ? " 4x" : ""}`;
  if (!groups.has(g)) groups.set(g, new Map());
  groups.get(g).set(`${p.eff}|${p.n}`, r);
}
for (const [g, m] of groups) {
  const sizes = [...new Set([...m.keys()].map((k) => +k.split("|")[1]))].sort((a, b) => a - b);
  const effs = [...new Set([...m.keys()].map((k) => k.split("|")[0]))];
  const elements = Object.fromEntries(sizes.map((n) => [n, [...m.entries()].find(([k]) => k.endsWith(`|${n}`))[1].elements]));
  console.log(`\n### ${g}\n\n| 效果 | ${sizes.map((n) => `${n} 卡（${elements[n]} 元素）`).join(" | ")} |\n|---|${sizes.map(() => "---").join("|")}|`);
  for (const e of effs) console.log(`| ${e} | ${sizes.map((n) => cell(m.get(`${e}|${n}`))).join(" | ")} |`);
}
console.log("\n### 金丝雀");
for (const r of rows.filter((r) => r.name.startsWith("CAN"))) console.log(`| ${r.name} | ${cell(r)} |`);
