// 首次开启（冷）：新页面里 2000 张卡先带 skz 但 skz-text=underline，再切到目标文字模式，量切换到第 2 帧的耗时；字体首次使用含解码
import { launch, sleep } from "./lib.mjs"; import fs from "node:fs";
const BASE = "http://localhost:5198/bench/agents/a8-tofu-font/perf.html";
const c = await launch({ headless: false, lock: true });
const rows = [];
for (const [css, target] of [["base,global,tofu", "tofu"], ["base,global,tofu", "underline"], ["base,global", "clip"], ["base,global", "underline"]]) for (let k = 0; k < 3; k++) {
  await c.goto(`${BASE}?css=${css}`, "window.ready===true");
  await c.ev(`setup(2000, [["skz-effect","shimmer"],["skz-text","${target === "tofu" || target === "clip" ? "leaf" : "underline"}"]])`);
  await sleep(500);
  const ms = await c.ev(`(async()=>{const r=document.getElementById("root");const nf=()=>new Promise(r=>requestAnimationFrame(r));const t=performance.now();r.setAttribute("skz-text","${target}");await nf();await nf();return performance.now()-t})()`);
  const font = await c.ev(`[...document.fonts].map(f=>f.status).join()`);
  rows.push({ target, css, run: k, ms: +ms.toFixed(1), font });
}
fs.writeFileSync("data/cold.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
for (const r of rows) console.log(JSON.stringify(r));
await c.close();
