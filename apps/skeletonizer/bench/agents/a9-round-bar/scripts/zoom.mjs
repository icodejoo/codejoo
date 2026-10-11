import { launch } from "./lib.mjs";
const OUT = "D:/workspaces/codejoo/apps/skeletonizer/bench/agents/a9-round-bar/shots/";
const b = await launch({ headless: true });
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 500, height: 300, deviceScaleFactor: 1, mobile: false });
  for (const theme of ["light", "dark"]) {
    await b.goto(`http://localhost:5919/bench/agents/a9-round-bar/zoom.html?theme=${theme}&effect=solid`, "window.ready===true");
    const r = await b.ev(`(()=>{const b=document.getElementById("o").getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}})()`);
    await b.shot(`${OUT}zoom-compare-${theme}.png`, r, 6);
  }
} finally { await b.close(); }
