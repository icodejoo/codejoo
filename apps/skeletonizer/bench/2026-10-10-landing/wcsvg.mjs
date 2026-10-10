// svg 引擎下宿主 ::before 的 SMIL 光带：隔时间截宿主区域和头像区域，比较像素是否在变且同步
import fs from "node:fs";
import crypto from "node:crypto";
import { launch, sleep } from "./lib.mjs";
const BASE = `http://localhost:${process.env.PORT_SRV || 5193}/bench/2026-10-10-landing/verify.html`;
const c = await launch({ headless: false });
await c.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const out = {};
for (const [label, css, opts] of [["svg shimmer", "base,svg", { effect: "shimmer", engine: "svg" }], ["svg pulse", "base,svg", { effect: "pulse", engine: "svg" }]]) {
  await c.goto(`${BASE}?css=${css}`, "window.ready===true");
  await c.ev(`setup(${JSON.stringify(opts)})`);
  await sleep(500);
  const rect = await c.ev(`(()=>{const r=root.querySelector("wc-card").getBoundingClientRect();const a=root.querySelector("img").getBoundingClientRect();return {host:{x:r.x,y:r.y,width:r.width,height:r.height},img:{x:a.x,y:a.y,width:a.width,height:a.height}}})()`);
  const hashes = [];
  for (let i = 0; i < 6; i++) {
    const shot = async (clip) => (await c.send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 } })).result.data;
    const h = await shot(rect.host), im = await shot(rect.img);
    hashes.push([crypto.createHash("sha1").update(h).digest("hex").slice(0, 8), crypto.createHash("sha1").update(im).digest("hex").slice(0, 8)]);
    if (i === 0) fs.writeFileSync(new URL(`shots/wcsvg-${label.replace(" ", "-")}-host.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), Buffer.from(h, "base64"));
    await sleep(170);
  }
  out[label] = { hostDistinct: new Set(hashes.map((x) => x[0])).size, imgDistinct: new Set(hashes.map((x) => x[1])).size, hashes };
}
await c.close();
console.log(JSON.stringify(out));
