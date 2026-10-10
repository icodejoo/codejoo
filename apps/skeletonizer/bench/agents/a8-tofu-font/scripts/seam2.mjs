// 接缝检测 2：重叠量 x 字号(10..20 含小数) x DPR，只测窄方块行
import { launch, sleep } from "./lib.mjs"; import { decode, lum } from "./png.mjs"; import fs from "node:fs";
const BASE = "http://localhost:5198/bench/agents/a8-tofu-font/";
const c = await launch({ headless: false });
const rows = [];
for (const ov of [0, 40, 60, 80]) for (const dpr of [1, 1.25, 2]) {
  let worst = 0, bad = [];
  for (const fs_ of [10, 11, 12, 13, 14, 15, 16, 18, 20, 24]) {
    await c.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 200, deviceScaleFactor: dpr, mobile: false });
    await c.goto(BASE + `seam2.html?fs=${fs_}&font=fonts-ov/ov${ov}-both.woff2`, "window.ready===true"); await sleep(200);
    await c.shot("shots/tmp.png");
    const q = await c.ev(`(()=>{const r=document.getElementById("a").getBoundingClientRect();const g=document.createRange();g.selectNodeContents(a);const t=g.getBoundingClientRect();return {l:t.left,t:r.top,w:t.width,h:r.height}})()`);
    const img = decode(fs.readFileSync("shots/tmp.png")); const cy = Math.round((q.t + q.h / 2) * dpr);
    let maxL = 0; for (let dy = -2; dy <= 2; dy++) for (let x = Math.round((q.l + fs_) * dpr); x < Math.round((q.l + q.w - fs_) * dpr); x++) maxL = Math.max(maxL, lum(img, x, cy + dy));
    worst = Math.max(worst, maxL); if (maxL > 12) bad.push(fs_ + ":" + Math.round(maxL));
  }
  const r = { overlap: ov, dpr, worstLum: Math.round(worst), bad: bad.join(" ") }; rows.push(r); console.log(JSON.stringify(r));
}
fs.writeFileSync("data/seam2.jsonl", rows.map((x) => JSON.stringify(x)).join("\n") + "\n"); fs.rmSync("shots/tmp.png");
await c.close();
