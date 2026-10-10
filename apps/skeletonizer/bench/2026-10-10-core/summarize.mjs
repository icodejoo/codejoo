// 把 results/<批>-<标签>.jsonl 汇总成 results/summary.md。
// 用法：node summarize.mjs <批 M|T> <标签,标签,...>
// 每格：fps / 样式重算 ms / PrePaint ms / Paint ms / GPU ms / 开启耗时 ms（每帧中位数，3 次 trace 取中位数）
import fs from "node:fs";
const DIR = new URL("./results/", import.meta.url);
const [batch, labelsArg] = process.argv.slice(2);
const labels = labelsArg.split(",");
const f = (v, d = 2) => (v == null ? "—" : String(+(+v).toFixed(d)));
const data = {};
for (const l of labels) {
  const file = new URL(`${batch}-${l}.jsonl`, DIR);
  if (!fs.existsSync(file)) continue;
  data[l] = Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((x) => JSON.parse(x))
      .map((r) => [r.name, r]),
  );
}
const names = [...new Set(Object.values(data).flatMap((d) => Object.keys(d)))];
const cell = (r) => (r ? `${f(r.fps, 1)} / ${f(r.UpdateLayoutTree)} / ${f(r.PrePaint)} / ${f(r.Paint)} / ${f(r.gpu)} / ${r.toggleMs != null ? f(r.toggleMs, 1) : "—"}` : "—");
let md = `# 汇总（summarize.mjs 生成，批 ${batch}）\n\n每格：fps / 样式重算 ms / PrePaint ms / Paint ms / GPU ms / 开启耗时 ms\n\n| 场景 | ${labels.join(" | ")} |\n|---|${labels.map(() => "---").join("|")}|\n`;
for (const n of names) md += `| ${n} | ${labels.map((l) => cell(data[l]?.[n])).join(" | ")} |\n`;
fs.writeFileSync(new URL(`summary-${batch}.md`, DIR), md);
console.log(md);
