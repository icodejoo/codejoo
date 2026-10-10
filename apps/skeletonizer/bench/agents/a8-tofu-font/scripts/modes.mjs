// 其他模式不受影响：同页 tofu.css 已加载，对 leaf / underline / clip / tofu 四种根比较 h3 的字体、装饰线、背景；再测 ALL 变体对裸 div 文字
import { launch, sleep } from "./lib.mjs"; import fs from "node:fs";
const BASE = "http://localhost:5198/bench/agents/a8-tofu-font/";
const c = await launch({ headless: false });
await c.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
const out = {};
for (const css of ["base,global,tofu", "base,global,tofuall"]) {
  await c.goto(BASE + `demo.html?css=${css}`, "window.ready===true");
  out[css] = await c.ev(`(()=>{const r={};document.body.insertAdjacentHTML("beforeend",'<div id="m"></div>');
  for (const mode of ["leaf","underline","clip","tofu"]) { const d=document.createElement("div"); d.id="m-"+mode; d.innerHTML='<h3>Heading</h3><div>bare div text</div><p>para <span>span</span></p><input value="v"><button>btn</button>'; m.append(d); window.skel(d,{effect:"pulse",text:mode==="clip"?undefined:mode}); }
  for (const mode of ["leaf","underline","clip","tofu"]) { const q=(s)=>{const e=document.querySelector("#m-"+mode+" "+s);const c=getComputedStyle(e);return {ff:c.fontFamily.slice(0,12),td:c.textDecorationLine,fill:c.webkitTextFillColor,bgclip:c.backgroundClip,color:c.color}}; r[mode]={h3:q("h3"),bare:q("div"),span:q("span"),input:q("input"),button:q("button")} }
  return r})()`);
  await sleep(400);
  await c.shot(`shots/modes-${css.split(",").pop()}.png`, { x: 0, y: 380, width: 900, height: 320 });
}
fs.writeFileSync("data/modes.json", JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) for (const [m, r] of Object.entries(v)) console.log(k, m, "h3", JSON.stringify(r.h3), "bare", JSON.stringify(r.bare), "input.ff", r.input.ff, "btn", r.button.ff);
await c.close();
