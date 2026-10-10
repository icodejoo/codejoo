// 汇总 Y 批：每个标签 6 次新鲜加载的 underline / clip shimmer 样式重算（ms/帧）、GPU：列出每次值和中位数
import fs from "node:fs";
const DIR = new URL("./results/", import.meta.url);
const labels = process.argv.slice(2);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log("| 标签 | underline 样式重算（6 次） | 中位 | clip 样式重算（6 次） | 中位 | underline GPU 中位 |\n|---|---|---|---|---|---|");
for (const l of labels) {
  const file = new URL(`Y-${l}.jsonl`, DIR);
  if (!fs.existsSync(file)) continue;
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x));
  const u = rows.filter((r) => r.name.includes("underline")), c = rows.filter((r) => r.name.includes("clip"));
  console.log(`| ${l} | ${u.map((r) => r.UpdateLayoutTree.toFixed(1)).join(" ")} | ${med(u.map((r) => r.UpdateLayoutTree)).toFixed(2)} | ${c.map((r) => r.UpdateLayoutTree.toFixed(1)).join(" ")} | ${med(c.map((r) => r.UpdateLayoutTree)).toFixed(2)} | ${med(u.map((r) => r.gpu)).toFixed(2)} |`);
}
