// 5188 dev server 只读访问：逐节截图。用法：node demo.mjs <light|dark> <effect> [textMode] [onlySection]
import { launch, sleep } from "./lib.mjs";
const [theme = "dark", effect = "shimmer", text = "round", only] = process.argv.slice(2);
const OUT = "D:/workspaces/codejoo/apps/skeletonizer/bench/agents/a11-demo-round/shots/";
const b = await launch({ headless: true, w: 1400, h: 1000 });
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 1000, deviceScaleFactor: 1, mobile: false });
  await b.goto("http://localhost:5188/demo/", "!!window.__sk");
  await b.ev(`(async()=>{__sk.state.dark=${theme === "dark"};__sk.state.effect=${JSON.stringify(effect)};__sk.state.text=${JSON.stringify(text)};__sk.apply();await new Promise(r=>setTimeout(r,800));})()`);
  await b.ev(`document.querySelector("header.bar").style.position="static"`);
  const n = await b.ev(`document.querySelectorAll("main > section").length`);
  for (let i = 0; i < n; i++) {
    if (only && +only !== i + 1) continue;
    const r = await b.ev(`(()=>{const e=document.querySelectorAll("main > section")[${i}];e.scrollIntoView();const b=e.getBoundingClientRect();return {x:Math.max(0,b.x+scrollX-12),y:b.y+scrollY-4,width:b.width+24,height:b.height+8}})()`);
    await sleep(300);
    await b.shot(`${OUT}demo-${theme}-${effect}-${text}-s${i + 1}.png`, r, 1);
  }
  console.log("sections", n);
} finally { await b.close(); }
