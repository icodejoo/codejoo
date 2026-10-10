// 会话状态抽查：同一页面里按 L 批的顺序连续 setup（含 toggleCost），在 underline + shimmer 的 setup 后读根上两个动画（shimmer-root / pulse-root）的开始时间差。
// 假设：差值不为 0（两个动画不同帧开始）时步进边界错开，样式重算的帧数翻倍，表现为"样式重算多约 1.8 ms"；这和改前 / 改后 CSS 无关，取决于 enable() 里写属性与强制样式的时序。
// 用法：PORT_CDP=9688 node seq-check.mjs <端口...>
import { launch } from "./lib.mjs";
const ports = process.argv.slice(2);
const c = await launch({ headless: false, w: 1280, h: 900 });
await c.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const out = {};
try {
  for (const port of ports) {
    await c.goto(`http://localhost:${port}/bench/2026-10-10-layering/perf.html?css=base,global,tofu`, "window.ready===true");
    out[port] = await c.ev(`(async()=>{
      const off=()=>{const r=document.getElementById("root"); const a=r.getAnimations().filter(x=>x.animationName==="skz-shimmer-root"||x.animationName==="skz-pulse-root"); return a.length===2 ? +(a[1].startTime-a[0].startTime).toFixed(1) : (a.length===1?"仅1个":"无");};
      const rows=[];
      const seq=[[500,{effect:"shimmer"}],[2000,{effect:"fade"}],[2000,{effect:"pulse"}],[2000,{effect:"shimmer"}],[2000,{effect:"pulse",text:"underline"}],[2000,{effect:"shimmer",text:"underline"}]];
      for (const [n,opts] of seq) {
        await setup(n, opts); await new Promise(r=>setTimeout(r,500));
        const label=n+" "+JSON.stringify(opts); const o=off(); rows.push([label,o]);
        if (opts.effect!=="fade") { const ts=[]; for (let i=0;i<3;i++) { await toggleCost(); } }
      }
      const rep=[]; for (let i=0;i<8;i++){ await setup(2000,{effect:"shimmer",text:"underline"}); await new Promise(r=>setTimeout(r,400)); rep.push(off()); }
      return {seq:rows, repeatShimmerUnderline:rep};
    })()`);
  }
} finally { await c.close(); }
console.log(JSON.stringify(out, null, 1));
