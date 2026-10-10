// 防火墙抽查（改前 / 改后）：200 卡，视口外卡片（skz-fw）上的派生变量是否钉住；视口内的是否仍在变。
// 用法：PORT_CDP=9688 node fw-check.mjs
import { launch, sleep } from "./lib.mjs";
const c = await launch({ headless: false, w: 1280, h: 900 });
await c.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const out = {};
try {
  for (const [ver, port] of [["before", 5195], ["after", 5196]]) {
    for (const [effect, text] of [["shimmer", undefined], ["shimmer", "underline"], ["pulse", undefined], ["pulse", "underline"]]) {
      await c.goto(`http://localhost:${port}/bench/2026-10-10-layering/perf.html?css=base,global,tofu`, "window.ready===true");
      await c.ev(`setup(200, ${JSON.stringify({ effect, text })})`);
      await sleep(600);
      out[`${ver} ${effect}/${text ?? "clip"}`] = await c.ev(`(async()=>{
        const items=[...document.getElementById("root").children]; const fw=items.filter(x=>x.hasAttribute("skz-fw")); const near=items[0], far=items[150];
        const v=(e)=>{const cs=getComputedStyle(e.querySelector("h3")); const r=getComputedStyle(e); return [cs.backgroundColor, cs.backgroundPosition, cs.textDecorationColor, r.getPropertyValue("--skz-pulse-c"), r.getPropertyValue("--skz-shimmer-p"), r.getPropertyValue("--skz-ul-fill")].join(" | ")};
        const S=[]; for (let i=0;i<5;i++){ S.push([v(near), v(far)]); await new Promise(r=>setTimeout(r,170)); }
        return {fw: fw.length, total: items.length, nearDistinct: new Set(S.map(s=>s[0])).size, farDistinct: new Set(S.map(s=>s[1])).size, far: S[0][1]};
      })()`);
    }
  }
} finally { await c.close(); }
console.log(JSON.stringify(out, null, 1));
