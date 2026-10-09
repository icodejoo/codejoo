// 生成颜色测试页 colors.html：每个变体一行宽骨头（<p>），行级 CSS 变量覆盖 SVG / 混合模式 / 底色
import fs from "node:fs";
import { uri, band2a, dip, curShimmer } from "./svgs.mjs";
const rows = []; // {id, vars:{}, extra:""}
const hl = "var(--x-ske-highlight)";
rows.push({ id: "ref", vars: { "--x-ske-bg-img": `linear-gradient(100deg, transparent 0, ${hl} 50%, transparent 100%)`, "--x-ske-bg-pos": "20vw 0", "--x-ske-bg-size": "60vw 100vh" } });
rows.push({ id: "cur-light", vars: { "--x-ske-bg-img": uri(curShimmer(0.55)) } });
rows.push({ id: "cur-dark", vars: { "--x-ske-bg-img": uri(curShimmer(0.1)) } });
// 1a：遮罩
rows.push({ id: "1a-mask", vars: { "--x-ske-bg-img": `linear-gradient(${hl}, ${hl})` }, extra: `-webkit-mask-image:${uri(band2a(1))};mask-image:${uri(band2a(1))};-webkit-mask-size:100% 100%;mask-size:100% 100%;mask-repeat:no-repeat;` });
// 1b：底色=高光，黑色凹口
for (const [tn, a] of [["L", 0.074], ["D", 0.23]]) for (const bm of ["normal", "multiply", "luminosity"])
  rows.push({ id: `1b-${tn}-${bm}`, vars: { "--x-ske-fill": hl, "--x-ske-bg-img": uri(dip(a)), "--x-ske-bg-blend": bm } });
// 1c：白色光带 + 混合模式
for (const bm of ["soft-light", "overlay", "screen", "normal"]) for (const a of [0.15, 0.25, 0.4, 0.55, 0.75, 1])
  rows.push({ id: `1c-${bm}-${a}`, vars: { "--x-ske-bg-img": uri(band2a(a)), "--x-ske-bg-blend": bm } });
fs.writeFileSync("rows.json", JSON.stringify(rows.map((r) => r.id)));
const css = rows.map((r) => `#root p[data-v="${r.id}"]{${Object.entries(r.vars).map(([k, v]) => `${k}:${v}`).join(";")};${r.extra || ""}}`).join("\n");
const html = `<!doctype html><html><head><meta charset="utf-8"><title>colors</title><link rel="stylesheet" href="./base.css"><style>
html,body{margin:0;background:#fff}body{font:12px sans-serif}html[data-x-ske-theme=dark],html[data-x-ske-theme=dark] body{background:#111}
#root{padding:4px 0}#root p{margin:0 0 4px;height:18px;padding:0}
${css}</style></head><body>
<div id="root" x-ske x-ske-effect="shimmer" x-ske-engine="svg" x-ske-text="leaf">
${rows.map((r) => `<p data-v="${r.id}">${r.id}</p>`).join("\n")}
</div>
<script>
const q=new URLSearchParams(location.search);
document.documentElement.setAttribute("data-x-ske-theme",q.get("theme")||"light");
if(q.get("custom")) document.getElementById("root").style.cssText="--x-ske-color:#cfe3ff;--x-ske-highlight:#e8f2ff";
window.ready=true;
</script></body></html>`;
fs.writeFileSync("colors.html", html);
console.log(rows.length, "rows", html.length, "bytes");
