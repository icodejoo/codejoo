// 方块宽 / 真实宽 的比值（1.0 即完全贴合），多种真实字体 x 多种文本；同时试 narrow 取值的影响（用比值反推）
import { launch } from "./lib.mjs"; import fs from "node:fs";
const c = await launch({ headless: true });
await c.goto("http://localhost:5198/bench/agents/a8-tofu-font/widths.html", "window.ready===true");
const rows = await c.ev("measure()");
fs.writeFileSync("data/widths.json", JSON.stringify(rows, null, 1));
for (const r of rows) console.log(JSON.stringify(r));
await c.close();
