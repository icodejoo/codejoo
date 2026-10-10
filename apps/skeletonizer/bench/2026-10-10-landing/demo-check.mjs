// demo（5188 vite dev）：文字下拉选 tofu，核对字体、tofu 样式分片加载、Web Component 区
import { launch, sleep } from "./lib.mjs";
const c = await launch({ headless: false, w: 1300, h: 950 });
await c.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await c.goto("http://localhost:5188/demo/index.html", "document.querySelectorAll('link[data-skz-css]').length>5");
await sleep(1000);
const out = {};
out.links = await c.ev(`[...document.querySelectorAll("link[data-skz-css]")].map(l=>l.dataset.skzCss).join(",")`);
await c.ev(`(()=>{const s=document.querySelector("#sel-text"); s.value="clip"; s.dispatchEvent(new Event("change"))})()`);await sleep(800);
await sleep(1200);
out.wcInfo = await c.ev(`(()=>{const wc=document.querySelector("#wc"); const host=wc.querySelector("demo-card"); const cs=getComputedStyle(host,"::before"); return {attrs:wc.getAttributeNames().join(","), hostVis:getComputedStyle(host).visibility, sheets:document.adoptedStyleSheets.length, cssHas:[...document.adoptedStyleSheets].map(s=>[...s.cssRules].map(r=>r.cssText).join("").includes("--skz-bg-img")), before:{content:cs.content, bg:cs.backgroundImage.slice(0,30), pos:cs.backgroundPosition, col:cs.backgroundColor, att:cs.backgroundAttachment}}})()`);
await c.ev(`(()=>{const s=document.querySelector("#sel-text"); s.value="tofu"; s.dispatchEvent(new Event("change"))})()`);await sleep(800);
out.tofu = await c.ev(`(async()=>{await document.fonts.ready; const root=document.querySelector("#cards"); const h=root.querySelector("h3,h4,p,span"); const cs=getComputedStyle(h); return {el:h.tagName, attr:root.getAttribute("skz-text"), font:cs.fontFamily.slice(0,20), deco:cs.textDecorationLine, fonts:[...document.fonts].map(f=>f.family+":"+f.status)}})()`);
await c.shot(new URL("shots/demo-tofu.png", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await c.ev(`document.querySelector("#wc").scrollIntoView({block:"center"})`); await sleep(1200);
out.wc = await c.ev(`(async()=>{const wc=document.querySelector("#wc"); if(!wc) return "no #wc"; const host=wc.querySelector("demo-card"); const rows=[]; const t0=performance.now(); while(performance.now()-t0<1200){await new Promise(r=>requestAnimationFrame(r)); const b=getComputedStyle(host,"::before"); rows.push([b.backgroundPosition,b.backgroundImage.slice(0,20),b.backgroundColor])} const im=wc.querySelector("img"); return {paused:wc.hasAttribute("skz-paused"), imgPosSync:rows.length&&im?getComputedStyle(im).backgroundPosition===rows[rows.length-1][0]:null, effectAttr:document.querySelector("[skz-effect]")?.getAttribute("skz-effect"), posDistinct:new Set(rows.map(r=>r[0])).size, img:rows[0][1], colorDistinct:new Set(rows.map(r=>r[2])).size}})()`);
await c.close();
console.log(JSON.stringify(out, null, 1));
