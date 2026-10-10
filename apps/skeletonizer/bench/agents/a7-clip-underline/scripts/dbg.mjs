import { launch } from "./lib.mjs";
const b = await launch({ headless: true, lock: false });
try {
  await b.send("Runtime.enable");
  await b.goto("http://localhost:5191/bench/agents/a7-clip-underline/perf.html?css=base,svg", "window.ready===true");
  console.log(await b.ev(`(async()=>{await setup(5,{effect:"shimmer",engine:"svg"});const r=document.getElementById("root");const cs=getComputedStyle(r);
   const m=await import("../../../dist/svg-DjwClTit.mjs"); const exp=Object.keys(m);
   let res; try{ res=m.t? "t":"" }catch(e){}
   return JSON.stringify({hl:cs.getPropertyValue("--skz-highlight"),exp,blob:typeof URL.createObjectURL, attrs:[...r.attributes].map(a=>a.name)})})()`));
} finally { await b.close(); }
