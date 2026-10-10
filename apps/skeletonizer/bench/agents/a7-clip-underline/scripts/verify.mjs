// 正确性：逐像素取样 + 计算样式。用法：node verify.mjs  （内部拿锁、起 Chrome 9533）
import fs from "node:fs";
import { launch, sleep } from "./lib.mjs";
import { decode, lum } from "./png.mjs";
const OUT = "E:/workspaces/codejoo/apps/skeletonizer/bench/agents/a7-clip-underline/";
const HOST = "http://localhost:5191/bench/agents/a7-clip-underline/verify.html";
const combos = [];
for (const theme of ["dark", "light"]) for (const engine of ["global", "svg"]) {
  combos.push({ mode: "base", engine, effect: "shimmer", theme }, { mode: "clip", engine, effect: "shimmer", theme }, { mode: "clipall", engine, effect: "shimmer", theme }, { mode: "clipnp", engine, effect: "shimmer", theme });
  combos.push({ mode: "base", engine, effect: "pulse", theme }, { mode: "clip", engine, effect: "pulse", theme });
}
combos.push({ mode: "clip", engine: "global", effect: "shimmer", theme: "dark", text: "leaf" }, { mode: "base", engine: "global", effect: "shimmer", theme: "dark", text: "leaf" }, { mode: "explicit", engine: "global", effect: "shimmer", theme: "dark" });
const b = await launch({ headless: false, w: 1280, h: 900 });
const results = [];
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  for (const c of combos) {
    const qs = new URLSearchParams(Object.entries(c)).toString();
    const tag = `${c.mode}-${c.engine}-${c.effect}-${c.theme}${c.text ? "-" + c.text : ""}`;
    await b.goto(`${HOST}?${qs}`, "window.ready===true");
    const rects = await b.ev(`(()=>{const r=(s)=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {x:Math.floor(b.x),y:Math.floor(b.y),w:Math.ceil(b.width),h:Math.ceil(b.height)}};
      return {h3:r("#g .card h3"),small:r("#g .card small"),p1:r("#g .card p"),p2:r("#g .card p:nth-of-type(2)"),raw:r("#rawdiv"),btn:r("#g .card button"),icon:r("#g .card i"),img:r("#g .card img"),ign:r("#ign p"),leaf:r("#leaf p"),bone:r("#bone")}})()`);
    const styles = await b.ev(`(()=>{const f=(s)=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e);return {clip:c.webkitBackgroundClip||c.backgroundClip,img:c.backgroundImage.slice(0,30),pos:c.backgroundPosition,attach:c.backgroundAttachment,size:c.backgroundSize,decoLine:c.textDecorationLine,decoColor:c.textDecorationColor,fill:c.webkitTextFillColor,bg:c.backgroundColor,thick:c.textDecorationThickness,off:c.textUnderlineOffset}};
      return {h3:f("#g .card h3"),b:f("#g .card b"),icon:f("#g .card i"),img:f("#g .card img"),btn:f("#g .card button"),ignP:f("#ign p"),ignBtn:f("#ign button"),leafP:f("#leaf p"),leafSpan:f("#leaf span"),bone:f("#bone"),root:{attrs:document.getElementById("root").getAttributeNames().join(" ")}}})()`);
    const shots = [];
    const T = 6, STEP = 250;
    for (let i = 0; i < T; i++) { const r = await b.send("Page.captureScreenshot", { format: "png" }); shots.push(decode(Buffer.from(r.result.data, "base64"))); if (i === 0) fs.writeFileSync(`${OUT}shots/v-${tag}.png`, Buffer.from(r.result.data, "base64")); await sleep(STEP); }
    const pos = await b.ev(`[...document.querySelectorAll("#g .card")[0].querySelectorAll("h3,i,img,button")].map(e=>getComputedStyle(e).backgroundPosition)`);
    const motion = {};
    for (const [k, r] of Object.entries(rects)) {
      if (!r) continue; let maxd = 0, changed = 0, lo = 255, hi = 0;
      for (let t = 1; t < T; t++) for (let y = r.y; y < r.y + r.h && y < shots[0].h; y += 1) for (let x = r.x; x < r.x + r.w && x < shots[0].w; x += 2) { const d = Math.abs(lum(shots[t], x, y) - lum(shots[0], x, y)); if (d > maxd) maxd = d; if (d > 2) changed++; }
      for (let t = 0; t < T; t++) for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x; x < r.x + r.w; x += 2) { const l = lum(shots[t], x, y); lo = Math.min(lo, l); hi = Math.max(hi, l); }
      motion[k] = { maxDelta: +maxd.toFixed(1), changedPx: changed, lumRange: [+lo.toFixed(0), +hi.toFixed(0)] };
    }
    const res = { tag, c, motion, styles, bgPosSample: pos };
    results.push(res); console.log(tag, JSON.stringify(Object.fromEntries(Object.entries(motion).map(([k, v]) => [k, v.maxDelta + "/" + v.changedPx]))));
  }
} finally { await b.close(); }
fs.writeFileSync(`${OUT}data/verify.jsonl`, results.map((r) => JSON.stringify(r)).join("\n") + "\n");
