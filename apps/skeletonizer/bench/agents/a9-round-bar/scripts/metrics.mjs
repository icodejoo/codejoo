// 量条高：100px 字号下逐像素扫描灰条上下沿，换算成 em，并给出相对基线的位置。用法：node metrics.mjs [lh]
import { launch } from "./lib.mjs";
import { decode } from "./png.mjs";
import fs from "node:fs";
const lh = process.argv[2] || "normal";
const b = await launch({ headless: true });
const res = [];
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 2100, deviceScaleFactor: 1, mobile: false });
  await b.goto(`http://localhost:5919/bench/agents/a9-round-bar/metrics.html?lh=${encodeURIComponent(lh)}`, "window.ready===true");
  const rows = await b.ev(`[...document.querySelectorAll(".row")].map(r=>({f:r.dataset.f,cells:[...r.querySelectorAll(".cell")].map(c=>{const s=c.querySelector("[skz-text]").getBoundingClientRect(),bl=c.querySelector(".bl").getBoundingClientRect();return {x:s.x+scrollX,y:s.y+scrollY,w:s.width,h:s.height,base:bl.bottom+scrollY}})}))`);
  const png = decode(await b.shot("D:/workspaces/codejoo/apps/skeletonizer/bench/agents/a9-round-bar/shots/metrics-" + lh + ".png", { x: 0, y: 0, width: 900, height: 2100 }, 1));
  const isGray = (x, y) => { const i = (y * png.w + x) * png.bpp; return png.data[i] < 235 && Math.abs(png.data[i] - png.data[i + 2]) < 20 && png.data[i] > 150; };
  for (const r of rows) {
    const o = { font: r.f, lh };
    ["clip", "round"].forEach((k, ci) => {
      const c = r.cells[ci]; const x = Math.round(c.x + c.w / 2) ; // 取条中部一列；字形透明（clip 下被裁成 fill，所以整列都是灰）
      let top = null, bot = null; for (let y = Math.floor(c.y - 60); y < c.y + c.h + 60; y++) { if (isGray(x, y)) { if (top === null) top = y; bot = y; } }
      o[k] = { top: +((top - c.base) / 100).toFixed(3), bottom: +((bot + 1 - c.base) / 100).toFixed(3), h: +((bot + 1 - top) / 100).toFixed(3), rectH: +(c.h / 100).toFixed(3) };
    });
    res.push(o); console.log(JSON.stringify(o));
  }
} finally { await b.close(); }
fs.writeFileSync(`D:/workspaces/codejoo/apps/skeletonizer/bench/agents/a9-round-bar/data/metrics-${lh}.json`, JSON.stringify(res, null, 1));
