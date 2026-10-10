// 防火墙兼容：2000 卡片 global+enable shimmer，视口外项（skz-fw）文字骨头的背景位置应静止，视口内项在动
import fs from "node:fs";
import { launch, sleep } from "./lib.mjs";
const OUT = "E:/workspaces/codejoo/apps/skeletonizer/bench/agents/a7-clip-underline/";
const b = await launch({ headless: false });
const res = [];
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  for (const css of ["base,global", "base,global,clip", "base,global,clip,clipnp"]) {
    await b.goto(`http://localhost:5191/bench/agents/a7-clip-underline/perf.html?css=${css}`, "window.ready===true");
    await b.ev(`setup(2000,{effect:"shimmer"})`); await sleep(800);
    const probe = `(()=>{const cards=[...document.getElementById("root").children];const vis=cards.find(c=>{const r=c.getBoundingClientRect();return r.top>0&&r.bottom<innerHeight});const far=cards[1500];
      const f=(c)=>{const h=c.querySelector("h3"),p=c.querySelector("p"),cs=getComputedStyle(h);return {fw:c.hasAttribute("skz-fw"),pos:cs.backgroundPosition,clip:cs.webkitBackgroundClip,deco:cs.textDecorationColor,pPos:getComputedStyle(p).backgroundPosition,ul:cs.getPropertyValue("--skz-ul-fill")}};
      return {vis:f(vis),far:f(far),fwCount:cards.filter(c=>c.hasAttribute("skz-fw")).length}})()`;
    const a = await b.ev(probe); await sleep(300); const c2 = await b.ev(probe);
    const r = { css, fwCount: a.fwCount, visible: { fw: a.vis.fw, pos0: a.vis.pos, pos1: c2.vis.pos, moved: a.vis.pos !== c2.vis.pos, clip: a.vis.clip, deco: a.vis.deco }, far: { fw: a.far.fw, pos0: a.far.pos, pos1: c2.far.pos, moved: a.far.pos !== c2.far.pos, ul0: a.far.ul, ul1: c2.far.ul } };
    res.push(r); console.log(JSON.stringify(r));
  }
} finally { await b.close(); }
fs.writeFileSync(OUT + "data/firewall.jsonl", res.map((r) => JSON.stringify(r)).join("\n") + "\n");
