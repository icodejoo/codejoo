// 把 results/<批>.jsonl 汇总成 results/summary.md（每个场景一行，指标分列）。
// 列：fps / 样式重算 / PrePaint / Paint / GPU（ms 每帧，3 次 trace 取中位数）/ Raster ms 每帧 / Paint 事件每秒 / 有绘制的帧每秒（占 fps 的百分比）/ RasterTask 每秒 / 探针（--skz-shimmer-p 每秒变化次数，svg 无）
import fs from "node:fs";
const DIR = new URL("./results/", import.meta.url);
const f = (v, d = 2) => (v == null ? "—" : String(+(+v).toFixed(d)));
const TITLE = { A: "A：主矩阵（shimmer + global + enable，pulse 原样）", B: "B：pulse 的贡献（-nop 去掉 pulse，-ps pulse 也 steps）", C: "C：4× CPU 降速，2000 卡", D: "D：svg 引擎（nat 原样 SMIL；d36 / d18 是 calcMode=discrete 的 36 / 18 档）" };
let md = "# 汇总（summarize.mjs 自动生成）\n\n名字规则：`<批>-<变体>-<clip|ul>`；变体 lin / s36 / s18 = shimmer 的 linear / steps(36) / steps(18)；`@N` 为卡片数，N=500 约 4000 元素、2000 约 16000 元素。\n";
for (const b of ["A", "B", "C", "D"]) {
  const file = new URL(`${b}.jsonl`, DIR);
  if (!fs.existsSync(file)) continue;
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  md += `\n## ${TITLE[b]}\n\n| 场景 | fps | 样式重算 | PrePaint | Paint | GPU | Raster | Paint事件/s | 有绘制帧/s（占比） | RasterTask/s | p 变化/s |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of rows) {
    const pf = r.paintFramesPS != null && r.fps ? `${f(r.paintFramesPS, 1)}（${f((r.paintFramesPS / r.fps) * 100, 0)}%）` : "—";
    md += `| ${r.name} | ${f(r.fps, 1)} | ${f(r.UpdateLayoutTree)} | ${f(r.PrePaint)} | ${f(r.Paint)} | ${f(r.gpu)} | ${f(r.rasterMs)} | ${f(r.nPaintPS, 1)} | ${pf} | ${f(r.nRasterPS, 1)} | ${r.probe ? f(r.probe.changesPerSec, 1) : "—"} |\n`;
  }
}
fs.writeFileSync(new URL("summary.md", DIR), md);
console.log("written results/summary.md");
