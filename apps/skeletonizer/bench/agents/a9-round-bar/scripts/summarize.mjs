// 汇总 results/<批>.jsonl 成 markdown 表。用法：node summarize.mjs P [C ...]
import fs from "node:fs";
const f = (v) => (v === undefined ? "—" : v);
for (const b of process.argv.slice(2)) {
  const rows = fs.readFileSync(new URL(`../results/${b}.jsonl`, import.meta.url), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.log(`\n### ${b}\n\n| 场景 | 元素 | fps | 样式重算 | PrePaint | Paint | GPU | 开启 ms | 有绘制帧/s | 光带 次/s |\n|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of rows) console.log(`| ${r.name} | ${r.elements} | ${f(r.fps)} | ${f(r.UpdateLayoutTree)} | ${f(r.PrePaint)} | ${f(r.Paint)} | ${f(r.gpu)} | ${f(r.toggleMs)} | ${f(r.paintFramesPS)} | ${r.probe ? r.probe.changesPerSec : "—"} |`);
}
