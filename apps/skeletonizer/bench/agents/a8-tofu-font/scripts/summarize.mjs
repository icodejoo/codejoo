// 汇总 jsonl 成表：node summarize.mjs <文件...>
import fs from "node:fs";
for (const f of process.argv.slice(2)) { console.log("##", f); for (const l of fs.readFileSync(f, "utf8").trim().split("\n")) { const o = JSON.parse(l); console.log(o.name.padEnd(38), String(o.fps).padStart(5), "重算", String(o.UpdateLayoutTree).padStart(6), "PrePaint", String(o.PrePaint).padStart(6), "Paint", String(o.Paint).padStart(5), "GPU", String(o.gpu).padStart(6), "合成", String(o.compositor).padStart(5), "开启ms", o.toggleMs, "stalls", o.stalls); } }
