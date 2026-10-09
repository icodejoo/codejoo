import fs from "node:fs";
import { uri, curShimmer } from "./svgs.mjs";
const hl = "var(--x-ske-highlight)";
const rows = [
  { id: "ref", vars: { "--x-ske-bg-img": `linear-gradient(100deg, transparent 0, ${hl} 50%, transparent 100%)`, "--x-ske-bg-pos": "20vw 0", "--x-ske-bg-size": "60vw 100vh" } },
  { id: "prod-light", vars: { "--x-ske-bg-img": uri(curShimmer(0.55)) } },
  { id: "prod-dark", vars: { "--x-ske-bg-img": uri(curShimmer(0.1)) } },
  { id: "blob", vars: {} }, // 用根上的 --x-ske-svg-shimmer（页面脚本写入 blob URL）
  { id: "blobfrag", vars: {} }, // 页面脚本写 blob(sprite)#shimmer-light
];
fs.writeFileSync("rows5.json", JSON.stringify(rows.map((r) => r.id)));
const css = rows.filter((r) => Object.keys(r.vars).length).map((r) => `#root p[data-v="${r.id}"]{${Object.entries(r.vars).map(([k, v]) => `${k}:${v}`).join(";")}}`).join("\n");
fs.writeFileSync("colors5.html", `<!doctype html><html><head><meta charset="utf-8"><title>colors5</title><link rel="stylesheet" href="./base.css"><script src="./blob5.js"></script><style>
html,body{margin:0;background:#fff}html[data-x-ske-theme=dark],html[data-x-ske-theme=dark] body{background:#111}
#root{padding:4px 0}#root p{margin:0 0 4px;height:18px;padding:0}
${css}</style></head><body>
<div id="root" x-ske x-ske-effect="shimmer" x-ske-engine="svg" x-ske-text="leaf">
${rows.map((r) => `<p data-v="${r.id}">${r.id}</p>`).join("\n")}
</div>
<script>
(async () => {
const q = new URLSearchParams(location.search), root = document.getElementById("root");
document.documentElement.setAttribute("data-x-ske-theme", q.get("theme") || "light");
let st = ""; if (q.get("custom")) st += "--x-ske-color:#cfe3ff;--x-ske-highlight:#e8f2ff;"; if (q.get("dur")) st += "--x-ske-duration:" + q.get("dur") + ";";
root.style.cssText = st;
const cost = {};
const doApply = async () => { const t0 = performance.now(); const r = Blob5.apply(root); const t1 = performance.now(); const im = new Image(); im.src = r.url; await im.decode(); const t2 = performance.now(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const t3 = performance.now(); return { gen: +(t1 - t0).toFixed(2), decode: +(t2 - t1).toFixed(2), frame2: +(t3 - t2).toFixed(2), hit: r.hit }; };
if (q.get("blob") !== "0") {
  cost.cold = await doApply();
  cost.warm = await doApply();
  // 切深色重新生成（缓存未命中），再切回（命中）
  const dark = q.get("theme") !== "dark";
  document.documentElement.setAttribute("data-x-ske-theme", dark ? "dark" : "light");
  cost.themeSwitch = await doApply();
  document.documentElement.setAttribute("data-x-ske-theme", q.get("theme") || "light");
  cost.themeBack = await doApply();
}
// blob 精灵 + 片段
try { const txt = await (await fetch("./sprite.min.svg")).text(); const u = URL.createObjectURL(new Blob([txt], { type: "image/svg+xml" })); document.querySelector('[data-v="blobfrag"]').style.setProperty("--x-ske-bg-img", 'url("' + u + '#shimmer-light")'); cost.frag = u.slice(0, 30); } catch (e) { cost.fragErr = String(e); }
window.cost = cost;
await new Promise(r => setTimeout(r, 300));
window.ready = true;
})();
</script></body></html>`);
console.log("ok");
