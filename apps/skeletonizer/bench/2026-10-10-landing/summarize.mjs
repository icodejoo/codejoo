// 把 results/<批>.jsonl 汇总成 results/summary.md（每个场景一行，指标分列）。
// 列：fps / 样式重算 / PrePaint / Paint / GPU（ms 每帧，3 次 trace 取中位数）/ Raster ms 每帧 / Paint 事件每秒 / 有绘制的帧每秒（占 fps 的百分比）/ RasterTask 每秒 / 探针（--skz-shimmer-p 每秒变化次数，svg 无）
import fs from "node:fs";
const DIR = new URL("./results/", import.meta.url);
const f = (v, d = 2) => (v == null ? "—" : String(+(+v).toFixed(d)));
const TITLE = { A: "A：2000 卡主矩阵（落地后 vs 落地前）", B: "B：4× CPU 降速，2000 卡 shimmer global（默认 steps(36)）", C: "C：4× CPU 降速 + `--skz-shimmer-timing: steps(18)`" };
let md = "# 汇总（summarize.mjs 自动生成）\n\n名字规则：`<批>-<新|旧>-<效果>-<文字模式>`；新 = 落地后的 dist，旧 = 落地前的 global.css（linear + 挂 pulse + 旧防火墙）；`@N` 为卡片数，2000 约 16000 元素。\n";
for (const b of ["A", "B", "C"]) {
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
