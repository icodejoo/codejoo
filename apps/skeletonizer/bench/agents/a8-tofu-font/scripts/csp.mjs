// CSP 与失败检测：font-src 'self'（挡 data:）、font-src 'self' + 外链字体、font-src data:；以及 document.fonts.load 在失败时的表现
import { launch, sleep } from "./lib.mjs"; import fs from "node:fs";
const BASE = "http://localhost:5198/bench/agents/a8-tofu-font/";
const c = await launch({ headless: false });
await c.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 300, deviceScaleFactor: 1, mobile: false });
const out = {};
for (const n of ["flash-tofu", "flash-tofu-broken", "flash-csp-data", "flash-csp-url", "flash-csp-fontdata"]) {
  await c.goto(BASE + n + ".html", "window.ready===true"); await sleep(600);
  const r = await c.ev(`(async()=>{const e=document.querySelector("h3");const ff=getComputedStyle(e).fontFamily;let loadRes;try{const l=await document.fonts.load('1em "Skz Tofu"','a');loadRes="resolved:"+l.length}catch(x){loadRes="rejected:"+x.name}
    const st=[...document.fonts].map(f=>f.family+":"+f.status);const ck=document.fonts.check('1em "Skz Tofu"','a');
    const w=(()=>{const s=document.createElement("span");s.style.cssText='font:100px "Skz Tofu",monospace;position:absolute;visibility:hidden';s.textContent="a";document.body.append(s);const x=s.getBoundingClientRect().width;s.remove();return x})();
    return {ff,loadRes,st,check:ck,probeW:w}})()`);
  out[n] = r; console.log(n, JSON.stringify(r));
}
fs.writeFileSync("data/csp.json", JSON.stringify(out, null, 1));
await c.close();
