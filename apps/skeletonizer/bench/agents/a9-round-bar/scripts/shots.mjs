// 逐 case 截图（section 区域，DPR 2）。用法：node shots.mjs <theme> <effect> [base] [cases]
import { launch } from "./lib.mjs";
const [theme = "light", effect = "solid", base = "core", cases = ""] = process.argv.slice(2);
const OUT = "D:/workspaces/codejoo/apps/skeletonizer/bench/agents/a9-round-bar/shots/";
const b = await launch({ headless: true, w: 1280, h: 900 });
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 2, mobile: false });
  await b.goto(`http://localhost:5919/bench/agents/a9-round-bar/verify.html?theme=${theme}&effect=${effect}&base=${base}${cases ? "&cases=" + cases : ""}`, "window.ready===true");
  const ids = await b.ev(`[...document.querySelectorAll("section")].map(s=>s.id)`);
  for (const id of ids) {
    const r = await b.ev(`(()=>{const b=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height}})()`);
    await b.shot(`${OUT}${id}-${theme}-${effect}.png`, r, 2);
  }
  console.log("done", ids.length);
} finally { await b.close(); }
