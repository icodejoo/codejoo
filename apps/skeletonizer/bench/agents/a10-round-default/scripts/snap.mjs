// 按配置截图整页（DPR 2）。用法：node snap.mjs <输出目录> <名字=查询串> ...
// 例：node snap.mjs shots core-round="css=core" core-clip="css=core&mode=clip"
import { launch } from "./lib.mjs";
import path from "node:path";
const [outDir, ...cfgs] = process.argv.slice(2);
const b = await launch({ headless: true, w: 1280, h: 900 });
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 2, mobile: false });
  for (const c of cfgs) {
    const i = c.indexOf("="); const name = c.slice(0, i), qs = c.slice(i + 1);
    await b.goto(`http://localhost:5921/bench/agents/a10-round-default/t.html?${qs}`, "window.ready===true");
    const r = await b.ev(`(()=>{const b=document.getElementById("skroot").getBoundingClientRect();return {x:0,y:0,width:Math.ceil(b.right+12),height:Math.ceil(b.bottom+12)}})()`);
    await b.shot(path.join(outDir, name + ".png"), r, 2);
    console.log("shot", name);
  }
} finally { await b.close(); }
