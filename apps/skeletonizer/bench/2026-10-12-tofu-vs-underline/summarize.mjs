// 汇总 results/<批>.jsonl 为 results/summary.md：每格 underline | tofu | 差值%
import fs from "node:fs";
const DIR = new URL("./results/", import.meta.url);
const f = (v, d = 2) => (v == null ? "—" : String(+(+v).toFixed(d)));
const d = (a, b) => (a == null || b == null || +a === 0 ? "—" : `${(((b - a) / a) * 100).toFixed(0)}%`);
const T = { A: "A：规模 × 效果（skz-auto）", B: "B：显式 skz-text，2000 卡", C: "C：4× CPU 降速，2000 卡", D: "D：开启 / 关闭耗时（暖，ms，中位数）", E: "E：含行内 skz-ignore，2000 卡 pulse global（auto）" };
let md = "# 汇总（summarize.mjs 生成）\n\n格内：underline | tofu | 差值%（(tofu-ul)/ul）。指标：fps / 样式重算 ms/帧 / Layout / PrePaint / Paint / GPU / 有绘制帧占比。\n";
for (const b of Object.keys(T)) {
  const file = new URL(`${b}.jsonl`, DIR); if (!fs.existsSync(file)) continue;
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const cells = {}; for (const r of rows) { if (r.name.startsWith("CAN")) continue; const [id, m, eff, mark, n, cpu] = r.name.split("|"); (cells[`${eff}|${mark}|${n}|${cpu || ""}`] ||= {})[m] = r; }
  md += `\n## ${T[b]}\n\n`;
  if (b === "D") {
    md += "| 场景 | 开启 ul | 开启 tofu | 差 | 关闭 ul | 关闭 tofu | 差 | 开启各次 ul / tofu |\n|---|---|---|---|---|---|---|---|\n";
    for (const [k, c] of Object.entries(cells)) md += `| ${k} | ${f(c.ul?.toggleOnMs, 1)} | ${f(c.tofu?.toggleOnMs, 1)} | ${d(c.ul?.toggleOnMs, c.tofu?.toggleOnMs)} | ${f(c.ul?.toggleOffMs, 1)} | ${f(c.tofu?.toggleOffMs, 1)} | ${d(c.ul?.toggleOffMs, c.tofu?.toggleOffMs)} | ${(c.ul?.toggleOnAll || []).join(" ")} / ${(c.tofu?.toggleOnAll || []).join(" ")} |\n`;
    continue;
  }
  md += "| 场景（效果/标记/卡数/降速） | fps | 样式重算 | Layout | PrePaint | Paint | GPU | 有绘制帧占比 |\n|---|---|---|---|---|---|---|---|\n";
  const pf = (r) => (r?.paintFramesPS != null && r.fps ? f((r.paintFramesPS / r.fps) * 100, 0) + "%" : "—");
  for (const [k, c] of Object.entries(cells)) {
    const a = c.ul, t = c.tofu; const col = (key, dd = 2) => `${f(a?.[key] ?? 0, dd)} / ${f(t?.[key] ?? 0, dd)} / ${d(a?.[key] ?? 0, t?.[key] ?? 0)}`;
    md += `| ${k} | ${f(a?.fps, 1)} / ${f(t?.fps, 1)} | ${col("UpdateLayoutTree")} | ${col("Layout")} | ${col("PrePaint")} | ${col("Paint")} | ${col("gpu")} | ${pf(a)} / ${pf(t)} |\n`;
  }
}
fs.writeFileSync(new URL("summary.md", DIR), md); console.log("ok");
