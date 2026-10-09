// 实验 6：功能抽查。多个根并存、skz-paused、bg 模式、skz-ignore、滚动后动画仍在；读 ::after 计算样式与动画状态
import { launch, sleep, grab, diff } from "./cdp.mjs";
import fs from "node:fs";
const b = await launch();
await b.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
await b.send("Page.navigate", { url: "http://localhost:5188/demo/.tmp-sweep/multi.html" }); await sleep(1500);
const info = await b.ev(`(() => { const o = {}; for (const id of ["a","b","c"]) { const r = document.getElementById(id), cs = getComputedStyle(r, "::after"); o[id] = { anim: cs.animationName, playState: cs.animationPlayState, blend: cs.mixBlendMode, transform: cs.transform, anims: r.getAnimations({subtree:true}).filter(x=>x.animationName==="skz-sweep").length, ignorePtr: id==="a" ? getComputedStyle(r.querySelector("[skz-ignore]")).pointerEvents : undefined }; } return o; })()`);
console.log(JSON.stringify(info, null, 1));
// 暂停到 t=0 / 550，看各根的像素变化
const pa = (t) => b.ev(`(() => { for (const x of document.getAnimations()) if ((x.animationName||"").startsWith("skz-sweep")) { x.pause(); x.currentTime = ${t}; } })()`);
await pa(0); await sleep(250); const a0 = await grab(b); await pa(250); await sleep(250); const a1 = await grab(b, "func-multi-t250.png");
const rects = await b.ev(`["a","b","c"].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [id, Math.round(r.top), Math.round(r.bottom)]; })`);
const res = {};
for (const [id, top, bot] of rects) { const sub = (g) => ({ w: g.w, h: bot - top, ch: g.ch, data: g.data.subarray(top * g.w * g.ch, bot * g.w * g.ch) }); res[id] = diff(sub(a0), sub(a1)); }
console.log("rect diff", JSON.stringify(res));
// 滚动后（根 a 滚出视口再滚回），动画是否仍在
await b.ev("window.scrollTo(0, 2000)"); await sleep(300); await b.ev("window.scrollTo(0, 0)"); await sleep(300);
console.log("after scroll anims", await b.ev('document.getElementById("a").getAnimations({subtree:true}).filter(x=>x.animationName==="skz-sweep").map(x=>x.playState)'));
fs.writeFileSync("results/exp6-functional.json", JSON.stringify({ info, res }, null, 1));
await b.close();
