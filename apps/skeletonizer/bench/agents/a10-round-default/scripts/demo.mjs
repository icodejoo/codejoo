// 5188 上的 dev server 只读访问：逐节截图。用法：node demo.mjs <light|dark> [effect]
import { launch, sleep } from "./lib.mjs";
const [theme = "dark", effect = "shimmer"] = process.argv.slice(2);
const OUT = "D:/workspaces/codejoo/apps/skeletonizer/bench/agents/a10-round-default/shots/";
const b = await launch({ headless: true, w: 1400, h: 1000 });
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 1000, deviceScaleFactor: 1, mobile: false });
  await b.goto("http://localhost:5188/demo/", "!!window.__sk");
  await b.ev(`(async()=>{__sk.state.dark=${theme === "dark"};__sk.state.effect=${JSON.stringify(effect)};__sk.apply();await new Promise(r=>setTimeout(r,800));})()`);
  const errs = await b.ev(`[...document.querySelectorAll("link[data-skz-css]")].length`);
  console.log("css links", errs);
  const n = await b.ev(`document.querySelectorAll("main > section").length`);
  for (let i = 0; i < n; i++) {
    const r = await b.ev(`(()=>{const e=document.querySelectorAll("main > section")[${i}];e.scrollIntoView();const b=e.getBoundingClientRect();return {x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height}})()`);
    await sleep(300);
    await b.shot(`${OUT}demo-${theme}-${effect}-s${i + 1}.png`, r, 1);
  }
  console.log("sections", n);
} finally { await b.close(); }
