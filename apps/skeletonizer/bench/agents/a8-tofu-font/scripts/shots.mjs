// 视觉验证：套 tofu 后截图（深/浅色 x DPR），并输出字体与接缝所需的测量
import { launch, sleep } from "./lib.mjs"; import fs from "node:fs";
const BASE = "http://localhost:5198/bench/agents/a8-tofu-font/";
const c = await launch({ headless: false });
const S = "shots/";
const out = {};
for (const scheme of ["light", "dark"]) {
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.goto(BASE + "demo.html?css=base,global,tofu", "window.ready===true");
  await c.ev(`apply({effect:"solid",text:"tofu"})`); await sleep(600);
  out[scheme] = await c.ev(`({fam:getComputedStyle(document.querySelector("#cards h3")).fontFamily, loaded:[...document.fonts].map(f=>f.family+":"+f.status)})`);
  await c.shot(S + `cards-${scheme}.png`);
}
console.log(JSON.stringify(out));
await c.close();
