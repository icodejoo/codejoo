// 汇总 simplify 复测：results/S-<标签>.jsonl → 控制台 markdown 表。node summarize-simplify.mjs
import fs from "node:fs";
const DIR = new URL("./results/", import.meta.url);
const f = (v, d = 2) => (v == null ? "—" : String(+(+v).toFixed(d)));
const labels = ["before", "after", "after2", "before2"].filter((l) => fs.existsSync(new URL(`S-${l}.jsonl`, DIR)));
const data = {};
for (const l of labels) data[l] = Object.fromEntries(fs.readFileSync(new URL(`S-${l}.jsonl`, DIR), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x)).map((r) => [r.name, r]));
const names = Object.keys(data[labels[0]] || {});
console.log("| 场景 | 批 | fps | 样式重算 ms | PrePaint ms | Paint ms | GPU ms | 有绘制帧占比 |\n|---|---|---|---|---|---|---|---|");
for (const n of names) for (const l of labels) {
  const r = data[l][n]; if (!r) continue;
  console.log(`| ${n} | ${l} | ${f(r.fps, 1)} | ${f(r.UpdateLayoutTree)} | ${f(r.PrePaint)} | ${f(r.Paint)} | ${f(r.gpu)} | ${r.paintFramesPS != null && r.fps ? f((r.paintFramesPS / r.fps) * 100, 0) + "%" : "—"} |`);
}
