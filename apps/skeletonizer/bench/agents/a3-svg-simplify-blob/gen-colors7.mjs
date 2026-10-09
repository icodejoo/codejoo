// 实验 1d / 5（修正版）：单张通用图 + 衰减层；blob 三种来源对比
import fs from "node:fs";
import { uri, curShimmer, band2a, band2f, band2fBlk, band2g } from "./svgs.mjs";
const hl = "var(--x-ske-highlight)", col = "var(--x-ske-color)";
const att = (b) => `linear-gradient(color-mix(in srgb, ${col} ${b * 100}%, transparent), color-mix(in srgb, ${col} ${b * 100}%, transparent))`;
const rows = [
  { id: "ref", vars: { "--x-ske-bg-img": `linear-gradient(100deg, transparent 0, ${hl} 50%, transparent 100%)`, "--x-ske-bg-pos": "20vw 0", "--x-ske-bg-size": "60vw 100vh" } },
  { id: "prod-light", vars: { "--x-ske-bg-img": uri(curShimmer(0.55)) } },
  { id: "prod-dark", vars: { "--x-ske-bg-img": uri(curShimmer(0.1)) } },
  { id: "sl1", vars: { "--x-ske-bg-img": uri(band2a(1)), "--x-ske-bg-blend": "soft-light" } },
];
rows.push({ id: "s2g", vars: { "--x-ske-bg-img": uri(band2g()), "--x-ske-bg-blend": "soft-light" } }, { id: "s2g-att69", vars: { "--x-ske-bg-img": `${att(0.69)}, ${uri(band2g())}`, "--x-ske-bg-blend": "normal, soft-light" } });
rows.push({ id: "blobA", vars: {} }, { id: "blobB", vars: {} }, { id: "blobC", vars: {} }, { id: "blobfrag", vars: {} });
fs.writeFileSync("rows7.json", JSON.stringify(rows.map((r) => r.id)));
const css = rows.filter((r) => Object.keys(r.vars).length).map((r) => `#root p[data-v="${r.id}"]{${Object.entries(r.vars).map(([k, v]) => `${k}:${v}`).join(";")}}`).join("\n");
fs.writeFileSync("colors7.html", `<!doctype html><html><head><meta charset="utf-8"><title>colors7</title><link rel="stylesheet" href="./base.css"><script src="./blob5.js"></script><style>
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
let st = ""; if (q.get("custom")) st += "--x-ske-color:#cfe3ff;--x-ske-highlight:#e8f2ff;"; if (q.get("custom2")) st += "--x-ske-color:#c7d2fe;--x-ske-highlight:#818cf8;"; if (q.get("dur")) st += "--x-ske-duration:" + q.get("dur") + ";";
root.style.cssText = st;
const row = (id) => document.querySelector('[data-v="' + id + '"]');
const cost = {};
// B、C 先于 A 生成：B = 未经 Image.decode 的 blob URL，C = 同一份 SVG 的 data URI
const p = Blob5.read(root), svg = Blob5.shimmerSvg(p.hl, p.ms);
cost.read = p;
const t0 = performance.now(); const ub = Blob5.mk(svg); cost.mkBlobMs = +(performance.now() - t0).toFixed(2);
row("blobB").style.setProperty("--x-ske-bg-img", 'url("' + ub + '")');
row("blobC").style.setProperty("--x-ske-bg-img", 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")');
// A：与实验 5 同样的路径（根上写 --x-ske-svg-shimmer，之后还做 Image.decode 测量成本）
const doApply = async () => { const t0 = performance.now(); const r = Blob5.apply(root); const t1 = performance.now(); const im = new Image(); im.src = r.url; await im.decode(); const t2 = performance.now(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const t3 = performance.now(); return { gen: +(t1 - t0).toFixed(2), decode: +(t2 - t1).toFixed(2), frame2: +(t3 - t2).toFixed(2), hit: r.hit }; };
cost.cold = await doApply();
cost.warm = await doApply();
const dark = q.get("theme") !== "dark";
document.documentElement.setAttribute("data-x-ske-theme", dark ? "dark" : "light");
cost.themeSwitch = await doApply();
document.documentElement.setAttribute("data-x-ske-theme", q.get("theme") || "light");
cost.themeBack = await doApply();
row("blobA").style.setProperty("--x-ske-bg-img", "var(--x-ske-svg-shimmer)");
try { const txt = await (await fetch("./sprite.min.svg")).text(); const u = URL.createObjectURL(new Blob([txt], { type: "image/svg+xml" })); row("blobfrag").style.setProperty("--x-ske-bg-img", 'url("' + u + '#shimmer-light")'); } catch (e) { cost.fragErr = String(e); }
window.cost = cost;
await new Promise(r => setTimeout(r, 300));
window.ready = true;
})();
</script></body></html>`);
console.log(rows.length, "rows");
