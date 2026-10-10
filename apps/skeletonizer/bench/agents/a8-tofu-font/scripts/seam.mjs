// 接缝检测：不同字号 x DPR，截图后在每个方块行的中间像素行扫描"亮点"（理想为纯黑实心）
import { launch, sleep } from "./lib.mjs"; import { decode, lum } from "./png.mjs"; import fs from "node:fs";
const BASE = "http://localhost:5198/bench/agents/a8-tofu-font/";
const c = await launch({ headless: false });
const rows = [];
for (const dpr of [1, 1.25, 1.5, 2, 3]) for (const fs_ of [12, 14, 16, 32]) {
  await c.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 300, deviceScaleFactor: dpr, mobile: false });
  await c.goto(BASE + `seam.html?fs=${fs_}`, "window.ready===true"); await c.ev("document.fonts.ready.then(()=>1)"); await sleep(300);
  await c.shot(`shots/seam-fs${fs_}-dpr${dpr}.png`);
  const r = await c.ev(`["a","b","c"].map(id=>{const r=document.getElementById(id).getBoundingClientRect();const rg=document.createRange();rg.selectNodeContents(document.getElementById(id));const t=rg.getBoundingClientRect();return {l:t.left,t:r.top,w:t.width,h:r.height}})`);
  const img = decode(fs.readFileSync(`shots/seam-fs${fs_}-dpr${dpr}.png`));
  const res = { dpr, fs: fs_ };
  r.forEach((q, i) => {
    // 取行中间的 5 条像素行；只统计"文字左右各内缩 2 字"区间
    const cy = Math.round((q.t + q.h / 2) * dpr); let bright = 0, tot = 0, maxL = 0;
    const x0 = Math.round((q.l + fs_) * dpr), x1 = Math.round((q.l + q.w - fs_) * dpr);
    for (let dy = -2; dy <= 2; dy++) for (let x = x0; x < x1; x++) { const L = lum(img, x, cy + dy); tot++; if (L > 24) bright++; maxL = Math.max(maxL, L); }
    res["row" + "abc"[i]] = { bright, tot, maxL: Math.round(maxL) };
  });
  rows.push(res); console.log(JSON.stringify(res));
}
fs.writeFileSync("data/seam.jsonl", rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
await c.close();
